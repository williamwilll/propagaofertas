import express from 'express';
import helmet from 'helmet';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {resolve} from 'node:path';
import {inspectFlow} from '../shared/workflow.js';
import {createSqliteStore,createPostgresStore} from './store.js';
import {installAuth} from './auth.js';
import {validateProduction} from './config.js';
import {rateLimit} from 'express-rate-limit';
import {importProduct} from './product-import.js';
import {ProductError} from './product-fetch.js';
import {verifySignature,parseWebhookPayload,isStale,processDueQueue,createGraphSender} from './whatsapp.js';
import {allowedImageUrl,imageDomains} from '../shared/product-policy.js';

const text=z.string().trim().max(300);
const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const flowSchema=z.object({
 name:text.min(1),account:text,source:text,sourceConsent:z.boolean(),
 platform:z.enum(['Amazon','Shopee','Mercado Livre','TikTok','Kwai']),
 distributor:text,destinations:z.array(text.min(1)).max(50),destinationConsent:z.boolean(),
 days:z.array(z.number().int().min(0).max(6)).max(7),start:time,end:time,
 interval:z.number().int().min(1).max(1440),dailyLimit:z.number().int().min(1).max(1000),
 mode:z.enum(['manual','automatic'])
}).strict().refine(v=>v.start<v.end,{message:'O horário final deve ser posterior ao inicial.'});
const offerSchema=z.object({
 title:text.min(1),price:z.number().positive().max(10000000),
 url:z.string().trim().max(2000).url().refine(v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}},'Use um link HTTPS sem credenciais.'),
 description:z.string().trim().max(2000),
 imageUrl:z.string().max(2000).refine(v=>v===''||allowedImageUrl(v),'Imagem de origem não permitida.').optional().default('')
}).strict();

export function createApp(dbPath=resolve('data/ofertazap.sqlite'),options={}){
 const config={production:false,...options};
 if(config.production){
  validateProduction(config);
  if(!options.store&&!config.databaseUrl)throw new Error('PostgreSQL é obrigatório em produção.');
 }
 const db=options.store||(config.databaseUrl?createPostgresStore(config.databaseUrl):createSqliteStore(dbPath));
 const app=express();app.disable('x-powered-by');
 if(config.production)app.set('trust proxy',1);
 app.use(helmet({strictTransportSecurity:config.production?undefined:false,contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'",'https://fonts.googleapis.com'],fontSrc:["'self'",'https://fonts.gstatic.com'],imgSrc:["'self'",'data:',...imageDomains.flatMap(d=>['https://'+d,'https://*.'+d])],connectSrc:["'self'"],frameAncestors:["'none'"],upgradeInsecureRequests:config.production?[]:null}}}));
 // Health probes must not repeatedly wake the free Neon compute.
 app.get('/healthz',async(_req,res)=>{try{await db.ready;res.json({ok:true});}catch{res.status(503).json({ok:false});}});
 const origin=config.production?new URL(config.appOrigin).origin:null;
 const allowedOrigins=origin?[origin]:['http://localhost:5173','http://127.0.0.1:5173','http://localhost:3001','http://127.0.0.1:3001'];
 app.use((req,res,next)=>{
  const host=req.headers.host?.toLowerCase();
  const hostAllowed=config.production?host===new URL(origin).host:['localhost','127.0.0.1'].includes(host?.split(':')[0]);
  if(!hostAllowed)return res.status(403).json({error:'Host não autorizado.'});
  if(config.production&&!req.secure)return res.status(400).json({error:'Use HTTPS para acessar o aplicativo.'});
  const requestOrigin=req.headers.origin;
  const mutating=!['GET','HEAD','OPTIONS'].includes(req.method);
  if((requestOrigin&&!allowedOrigins.includes(requestOrigin))||(config.production&&mutating&&!requestOrigin))return res.status(403).json({error:'Origem não autorizada.'});
  next();
 });
 app.use('/api',(_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 // Global abuse guard: generous for SPA polling, strict limits stay on login/import.
 // In-memory store is enough for single-instance free tier; shared Redis needed if scaled.
 // Webhook Meta tem retry próprio — não limitar aqui, a proteção é a assinatura HMAC.
 app.use('/api',rateLimit({windowMs:15*60*1000,limit:300,standardHeaders:'draft-7',legacyHeaders:false,skip:req=>req.path==='/api/whatsapp/webhook',message:{error:'Muitas requisições. Aguarde alguns minutos.'}}));
 app.use(express.json({limit:'64kb',verify:(req,_res,buf)=>{req.rawBody=buf;}}));
 // Webhook Meta é público (sem sessão) e precisa responder <3s. Montado antes do auth.
 app.get('/api/whatsapp/webhook',(req,res)=>{
  const mode=req.query['hub.mode'],token=req.query['hub.verify_token'],challenge=req.query['hub.challenge'];
  if(mode==='subscribe'&&token&&token===config.whatsappVerifyToken&&typeof challenge==='string')return res.send(challenge);
  return res.status(403).json({error:'Verificação inválida.'});
 });
 app.post('/api/whatsapp/webhook',async(req,res)=>{
  try{
   const raw=req.rawBody||Buffer.from(JSON.stringify(req.body||{}));
   if(config.whatsappAppSecret&&!verifySignature(raw,req.headers['x-hub-signature-256'],config.whatsappAppSecret))return res.status(401).json({error:'Assinatura inválida.'});
   const payload=req.body;
   if(payload?.object!=='whatsapp_business_account')return res.json({ok:true,ignored:true});
   const {messages}=parseWebhookPayload(payload);
   for(const m of messages){
    if(!m.remoteId)continue;
    const stored=await db.recordInbound(m.remoteId,{from:m.from,type:m.type,at:new Date(m.timestampMs).toISOString()});
    if(stored.duplicate)continue;
    if(isStale(m.timestampMs))continue;
   }
   res.json({ok:true,received:messages.length});
  }catch{res.status(503).json({error:'Fila indisponível. A Meta tentará novamente.'});}
 });
 const authReady=installAuth(app,db,config);
 const ready=Promise.all([db.ready,authReady]);
 app.get('/api/state',async(_req,res)=>res.json({flows:await db.list('flows'),offers:await db.list('offers'),integrationsReady:false}));
 let activeImports=0;
 const importLimit=rateLimit({windowMs:60000,limit:10,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Aguarde um minuto antes de buscar mais produtos.'}});
 app.post('/api/offers/import',importLimit,async(req,res)=>{
  const result=z.object({url:z.string().trim().min(1).max(2000)}).strict().safeParse(req.body);
  if(!result.success)return res.status(400).json({error:'Informe somente o link do produto.'});
  if(activeImports>=2)return res.status(429).json({error:'Já existem buscas em andamento. Aguarde e tente novamente.'});
  activeImports++;
  try{res.json(await (options.productImporter||importProduct)(result.data.url));}
  catch(error){if(error instanceof ProductError)return res.status(error.status).json({error:error.message,code:error.code});res.status(502).json({error:'A loja não respondeu à leitura. Você pode cadastrar o produto manualmente.'});}
  finally{activeImports--;}
 });
 for(const [table,schema] of [['flows',flowSchema],['offers',offerSchema]]){
  app.post(`/api/${table}`,async(req,res)=>{
   const result=schema.safeParse(req.body);
   if(!result.success)return res.status(400).json({error:'Confira os campos informados.',details:result.error.issues});
   const id=randomUUID();await db.insert(table,id,result.data,new Date().toISOString());res.status(201).json({id});
  });
  app.put(`/api/${table}/:id`,async(req,res)=>{
   const result=schema.safeParse(req.body);
   if(!result.success)return res.status(400).json({error:'Confira os campos informados.',details:result.error.issues});
   if(!await db.update(table,req.params.id,result.data))return res.status(404).json({error:'Registro não encontrado.'});
   res.json({ok:true});
  });
  app.delete(`/api/${table}/:id`,async(req,res)=>{
   if(!await db.remove(table,req.params.id))return res.status(404).json({error:'Registro não encontrado.'});
   res.json({ok:true});
  });
 }
 app.get('/api/flows/:id/check',async(req,res)=>{
  const flow=await db.get('flows',req.params.id);
  if(!flow)return res.status(404).json({error:'Fluxo não encontrado.'});
  const connection=await db.getConnection().catch(()=>null);
  res.json(inspectFlow(flow,{whatsapp:!!connection?.verified}));
 });
 app.post('/api/flows/:id/activate',async(req,res)=>{
  const flow=await db.get('flows',req.params.id);
  if(!flow)return res.status(404).json({error:'Fluxo não encontrado.'});
  const connection=await db.getConnection().catch(()=>null);
  res.status(409).json({error:'Ativação bloqueada: confira as pendências do fluxo.',...inspectFlow(flow,{whatsapp:!!connection?.verified})});
 });
 app.get('/api/whatsapp/status',async(_req,res)=>{
  const connection=await db.getConnection().catch(()=>null);
  const depth=await db.queueDepth().catch(()=>0);
  res.json({configured:!!(config.whatsappToken&&config.whatsappPhoneNumberId),verified:!!connection?.verified,queueDepth:depth});
 });
 app.get('/api/integrations/shopee-status',async(_req,res)=>{
  res.json({configured:!!(process.env.SHOPEE_APP_ID&&process.env.SHOPEE_APP_SECRET)});
 });
 app.post('/api/whatsapp/connect',async(req,res)=>{
  const result=z.object({phoneNumberId:z.string().trim().min(1).max(64)}).strict().safeParse(req.body);
  if(!result.success)return res.status(400).json({error:'Informe o ID do número.'});
  if(!(config.whatsappToken&&config.whatsappPhoneNumberId))return res.status(409).json({error:'Configure WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID no servidor.'});
  await db.saveConnection({phoneNumberId:result.data.phoneNumberId,verified:true});
  res.json({ok:true});
 });
 app.post('/api/queue/process',async(_req,res)=>{
  if(!(config.whatsappToken&&config.whatsappPhoneNumberId))return res.status(409).json({error:'WhatsApp não configurado.'});
  const sender=options.whatsappSender||createGraphSender({token:config.whatsappToken,phoneNumberId:config.whatsappPhoneNumberId});
  res.json(await processDueQueue(db,sender,{now:new Date().toISOString(),limit:10}));
 });
 app.use('/api',(_req,res)=>res.status(404).json({error:'Operação não encontrada.'}));
 app.use(express.static(resolve('dist'),{setHeaders(res,path){if(path.endsWith('index.html'))res.setHeader('Cache-Control','no-cache');}}));
 app.use((error,_req,res,_next)=>{
  if(error.status===400||error.status===413)return res.status(error.status).json({error:'Requisição inválida ou muito grande.'});
  // Never log connection strings, request bodies or credentials.
  console.error('Falha interna ao processar requisição.');
  res.status(500).json({error:'Não foi possível concluir a operação. Tente novamente.'});
 });
 return {app,db,ready};
}
