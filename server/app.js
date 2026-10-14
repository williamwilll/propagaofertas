import express from 'express';
import helmet from 'helmet';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {resolve} from 'node:path';
import {inspectFlow,destinationsVerified} from '../shared/workflow.js';
import {createSqliteStore,createPostgresStore} from './store.js';
import {installAuth} from './auth.js';
import {validateProduction} from './config.js';
import {rateLimit} from 'express-rate-limit';
import ipaddr from 'ipaddr.js';
import {importProduct} from './product-import.js';
import {ProductError} from './product-fetch.js';
import {verifySignature,parseWebhookPayload,isStale,processDueQueue,createGraphSender,enqueueFlowSends} from './whatsapp.js';
import {createBaileysProvider} from './whatsapp-baileys.js';
import {PLATFORMS,integrationsStatus,testPlatform} from './affiliates.js';
import {telegramDestino,telegramGetChat,telegramGetMe,telegramTest,createTelegramSender} from './telegram.js';
import {mlAppCreds,mlRedirectUri,mlAuthUrl,mlExchangeCode,mlRefresh,mlTokenExpired,mlPredictCategory,mlPublishOffer} from './ml.js';
import {composeOffer} from '../shared/workflow.js';
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
  const host=(req.headers.host?.toLowerCase()||'').split(':').slice(0,-1).join(':').replace(/^\[|\]$/g,'')||(req.headers.host?.toLowerCase()||'');
  const localHost=['localhost','127.0.0.1','::1'].includes(host);
  let lanHost=false;
  if(config.allowLan&&!localHost){
   try{lanHost=['private','loopback','linkLocal'].includes(ipaddr.process(host).range());}catch{lanHost=false;}
  }
  const hostAllowed=config.production?req.headers.host?.toLowerCase()===new URL(origin).host:(localHost||lanHost||(config.publicHost&&host===config.publicHost));
  if(!hostAllowed)return res.status(403).json({error:'Host não autorizado.'});
  if(config.production&&!req.secure)return res.status(400).json({error:'Use HTTPS para acessar o aplicativo.'});
  const requestOrigin=req.headers.origin;
  const publicOrigin=config.publicHost&&requestOrigin==='https://'+config.publicHost;
  const lanOrigin=config.allowLan&&!!requestOrigin&&/^http:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/i.test(requestOrigin);
  const mutating=!['GET','HEAD','OPTIONS'].includes(req.method);
  if((requestOrigin&&!allowedOrigins.includes(requestOrigin)&&!lanOrigin&&!publicOrigin)||(config.production&&mutating&&!requestOrigin))return res.status(403).json({error:'Origem não autorizada.'});
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
 // Provedor de envio: Baileys local (QR) ou Cloud API (token). Testes injetam via options.
 const baileys=options.baileysProvider||createBaileysProvider({sessionDir:resolve('data/wpp-session')});
 const cloudConfigured=!!(config.whatsappToken&&config.whatsappPhoneNumberId);
 if((options.enableBaileys||process.env.WHATSAPP_PROVIDER==='baileys')&&!options.baileysProvider)baileys.start().catch(()=>{});
 const normName=v=>String(v??'').trim().normalize('NFKC').toLocaleLowerCase('pt-BR');
 async function computeIntegrations(flow){
  const connection=await db.getConnection().catch(()=>null);
  let groups=[];
  try{if(baileys.status().connected)groups=await baileys.listGroups();}catch{groups=[];}
  const whatsapp=!!connection?.verified||baileysConnected();
  const offers=await db.list('offers',1).catch(()=>[]);
  const all=flow?(flow.destinations||[]).map(d=>String(d||'').trim()).filter(Boolean):[];
  const tgDests=all.filter(d=>telegramDestino(d));
  const waDests=all.filter(d=>!telegramDestino(d));
  const tgToken=String(process.env.TELEGRAM_BOT_TOKEN||'').trim();
  const tgFetch=options.telegramFetch||fetch;
  let tgOk=true;
  if(tgDests.length){
   if(!tgToken||tgDests.length>20)tgOk=false;
   else{
    const checks=await Promise.all(tgDests.map(async d=>{
     try{await telegramGetChat(tgToken,d,{fetchImpl:tgFetch,timeoutMs:8000});return true;}catch{return false;}
    }));
    tgOk=checks.every(Boolean);
   }
  }
  const waOk=waDests.length?destinationsVerified({...flow,destinations:waDests},groups):true;
  return {whatsapp,affiliate:offers.length>0,permissions:all.length>0&&waOk&&tgOk};
 }
 function baileysConnected(){try{return baileys.status().connected;}catch{return false;}}
 async function resolveSender(){
  const bst=baileys.status();
  let groups=[];
  if(bst.connected){try{groups=await baileys.listGroups();}catch{groups=[];}}
  const useBaileys=bst.connected;
  const tgToken=String(process.env.TELEGRAM_BOT_TOKEN||'').trim();
  const tgBase=tgToken?createTelegramSender({token:tgToken,fetchImpl:options.telegramFetch||fetch}):(options.telegramSender||null);
  const cloudBase=options.whatsappSender||(cloudConfigured?createGraphSender({token:config.whatsappToken,phoneNumberId:config.whatsappPhoneNumberId}):null);
  if(!useBaileys&&!tgBase&&!cloudBase)return null;
  return async job=>{
   let offer=job.offer,text=job.text;
   if(!text&&job.offer_id){
    try{const found=await db.get('offers',job.offer_id);if(found){offer=found;text=composeOffer(found);}}catch{}
   }
   if(!text)throw new Error('Oferta do envio não encontrada.');
   const tgId=telegramDestino(job.destino);
   if(tgId){
    if(!tgBase)throw new Error('Telegram não configurado. Defina TELEGRAM_BOT_TOKEN no servidor.');
    return tgBase({...job,destino:tgId,text,offer});
   }
   if(useBaileys){
    const want=String(job.destino||'').trim();
    const g=groups.find(x=>x.id===want||normName(x.name)===normName(want));
    if(!g)throw new Error(`Grupo "${want}" não está no WhatsApp conectado.`);
    return baileys.sendJob({...job,destino:g.id,text,offer});
   }
   if(!cloudBase)throw new Error('Nenhum provedor conectado. Pareie o WhatsApp (QR) ou configure a Cloud API.');
   if(/^\d{7,15}$/.test(String(job.destino||'').replace(/\D/g,''))&&String(job.destino).replace(/\D/g,'').length>=7){
    return cloudBase({...job,destino:'+'+String(job.destino).replace(/\D/g,''),text,offer});
   }
   throw new Error('Destino não é um telefone; conecte o Baileys para enviar a grupos.');
  };
 }
 app.get('/api/state',async(_req,res)=>res.json({flows:await db.list('flows'),offers:await db.list('offers'),queue:await db.queueStats().catch(()=>({pending:0,sent:0,dead:0,failed:0,activeFlows:0})),integrationsReady:false}));
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
  res.json(inspectFlow(flow,await computeIntegrations(flow)));
 });
 app.post('/api/flows/:id/activate',async(req,res)=>{
  const flow=await db.get('flows',req.params.id);
  if(!flow)return res.status(404).json({error:'Fluxo não encontrado.'});
  const inspection=inspectFlow(flow,await computeIntegrations(flow));
  if(!inspection.ready)return res.status(409).json({error:'Ativação bloqueada: confira as pendências do fluxo.',...inspection});
  await db.setStatus('flows',req.params.id,'active');
  res.json({ok:true,status:'active',...inspection});
 });
 app.post('/api/flows/:id/deactivate',async(req,res)=>{
  if(!await db.get('flows',req.params.id))return res.status(404).json({error:'Fluxo não encontrado.'});
  await db.setStatus('flows',req.params.id,'draft');
  res.json({ok:true,status:'draft'});
 });
 app.post('/api/flows/:id/dispatch',async(req,res)=>{
  const flow=await db.get('flows',req.params.id);
  if(!flow)return res.status(404).json({error:'Fluxo não encontrado.'});
  if(flow.status!=='active')return res.status(409).json({error:'Ative o fluxo antes de enfileirar.'});
  const offers=await db.list('offers');
  if(!offers.length)return res.status(409).json({error:'Cadastre ao menos uma oferta.'});
  res.json(await enqueueFlowSends(db,flow,offers));
 });
 app.get('/api/queue',async(req,res)=>{
  const status=String(req.query.status||'pending');
  try{res.json({items:await db.listQueue(status,50)});}
  catch{res.status(400).json({error:'Status inválido. Use pending, sent, dead ou failed.'});}
 });
 app.get('/api/queue/stats',async(_req,res)=>res.json(await db.queueStats()));
 app.get('/api/whatsapp/status',async(_req,res)=>{
  const connection=await db.getConnection().catch(()=>null);
  const depth=await db.queueDepth().catch(()=>0);
  let baileysStatus=null;
  try{baileysStatus=baileys.status();}catch{}
  res.json({configured:!!(config.whatsappToken&&config.whatsappPhoneNumberId)||!!baileysStatus?.connected,verified:!!connection?.verified,baileys:baileysStatus?{connected:baileysStatus.connected,me:baileysStatus.me,hasQR:baileysStatus.hasQR,needsRepair:baileysStatus.needsRepair,lastError:baileysStatus.lastError}:null,queueDepth:depth});
 });
 app.get('/api/integrations/status',async(_req,res)=>{
  const offers=await db.list('offers',200).catch(()=>[]);
  res.json(integrationsStatus(process.env,offers));
 });
 app.post('/api/integrations/:platform/test',async(req,res)=>{
  const platform=String(req.params.platform||'');
  if(!PLATFORMS.includes(platform))return res.status(404).json({error:'Plataforma desconhecida.'});
  const offers=await db.list('offers',200).catch(()=>[]);
  try{
   const r=await testPlatform(platform,offers,{fetchImpl:options.affiliatesFetch||fetch,env:process.env});
   if(r.error)return res.status(r.status||422).json({error:r.error,code:r.code});
   res.json(r);
  }catch{res.status(502).json({error:'A plataforma não respondeu. Tente novamente.'});}
 });
 app.post('/api/whatsapp/connect',async(req,res)=>{
  const result=z.object({phoneNumberId:z.string().trim().min(1).max(64)}).strict().safeParse(req.body);
  if(!result.success)return res.status(400).json({error:'Informe o ID do número.'});
  if(!(config.whatsappToken&&config.whatsappPhoneNumberId))return res.status(409).json({error:'Configure WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID no servidor.'});
  await db.saveConnection({phoneNumberId:result.data.phoneNumberId,verified:true});
  res.json({ok:true});
 });
 app.post('/api/queue/process',async(_req,res)=>{
  const sender=await resolveSender();
  if(!sender)return res.status(409).json({error:'Nenhum provedor conectado. Pareie o WhatsApp (QR), configure a Cloud API ou o Telegram.'});
  res.json(await processDueQueue(db,sender,{now:new Date().toISOString(),limit:10}));
 });
 app.get('/api/telegram/status',async(_req,res)=>{
  const token=String(process.env.TELEGRAM_BOT_TOKEN||'').trim();
  if(!token)return res.json({configured:false});
  try{res.json({configured:true,...(await telegramGetMe(token,{fetchImpl:options.telegramFetch||fetch}))});}
  catch(e){res.json({configured:true,error:e instanceof Error?e.message:'Falha ao falar com o Telegram.'});}
 });
 app.post('/api/telegram/test',async(req,res)=>{
  const token=String(process.env.TELEGRAM_BOT_TOKEN||'').trim();
  if(!token)return res.status(409).json({error:'Defina TELEGRAM_BOT_TOKEN no servidor.'});
  const result=z.object({chatId:z.string().trim().min(1).max(64)}).strict().safeParse(req.body);
  if(!result.success)return res.status(400).json({error:'Informe @canal ou o ID.'});
  try{res.json(await telegramTest(token,result.data.chatId,{fetchImpl:options.telegramFetch||fetch}));}
  catch(e){res.status(409).json({error:e instanceof Error?e.message:'Falha no envio.'});}
 });
 app.get('/api/whatsapp/baileys/status',async(_req,res)=>res.json(baileys.status()));
 app.get('/api/whatsapp/baileys/groups',async(_req,res)=>{
  try{res.json({groups:await baileys.listGroups()});}
  catch(e){res.status(409).json({error:e instanceof Error?e.message:'WhatsApp não conectado.'});}
 });
 app.post('/api/whatsapp/baileys/test',async(req,res)=>{
  const result=z.object({groupId:z.string().trim().min(1).max(128)}).strict().safeParse(req.body);
  if(!result.success)return res.status(400).json({error:'Informe o grupo.'});
  try{res.json(await baileys.sendTest(result.data.groupId));}
  catch(e){res.status(409).json({error:e instanceof Error?e.message:'Falha no envio.'});}
 });
 app.post('/api/whatsapp/baileys/logout',async(_req,res)=>res.json(await baileys.logout()));
 // Mercado Livre vendedor (OAuth2 + publicação). Tokens no banco do servidor.
 async function mlAccess(){
  const creds=mlAppCreds(process.env);
  if(!creds)throw new Error('Defina ML_APP_ID e ML_APP_SECRET no servidor.');
  let auth=await db.getMlAuth().catch(()=>null);
  if(!auth)throw new Error('Conecte sua conta do Mercado Livre primeiro.');
  if(mlTokenExpired(auth)){
   auth={...await mlRefresh({appId:creds.appId,secret:creds.secret,refreshToken:auth.refreshToken}),created_at:new Date().toISOString()};
   await db.saveMlAuth(auth);
  }
  return {creds,auth};
 }
 app.get('/api/ml/status',async(_req,res)=>{
  const creds=mlAppCreds(process.env);
  if(!creds)return res.json({configured:false,needs:['ML_APP_ID','ML_APP_SECRET'],redirectUri:mlRedirectUri(process.env)});
  const auth=await db.getMlAuth().catch(()=>null);
  res.json({configured:true,connected:!!auth&&!mlTokenExpired(auth),userId:auth?.userId||null,redirectUri:mlRedirectUri(process.env)});
 });
 app.get('/api/ml/auth-url',async(_req,res)=>{
  const creds=mlAppCreds(process.env);
  if(!creds)return res.status(409).json({error:'Defina ML_APP_ID e ML_APP_SECRET no servidor.',needs:['ML_APP_ID','ML_APP_SECRET']});
  res.json({url:mlAuthUrl({appId:creds.appId,redirectUri:mlRedirectUri(process.env)}),redirectUri:mlRedirectUri(process.env)});
 });
 app.get('/api/ml/callback',async(req,res)=>{
  try{
   const creds=mlAppCreds(process.env);
   if(!creds)throw new Error('App não configurado no servidor.');
   const code=String(req.query.code||'');
   if(!code)throw new Error('Autorização negada no Mercado Livre.');
   const tokens=await mlExchangeCode({appId:creds.appId,secret:creds.secret,code,redirectUri:mlRedirectUri(process.env)});
   await db.saveMlAuth(tokens);
   res.send('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Conectado</title></head><body style="font-family:sans-serif;padding:40px"><h1>Conta do Mercado Livre conectada.</h1><p>Pode fechar esta aba e voltar ao PropagaOfertas.</p></body></html>');
  }catch(e){res.status(400).send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Erro</title></head><body style="font-family:sans-serif;padding:40px"><h1>Não foi possível conectar.</h1><p>${e instanceof Error?e.message:'Erro.'}</p></body></html>`);}
 });
 app.post('/api/ml/disconnect',async(_req,res)=>{await db.clearMlAuth().catch(()=>{});res.json({ok:true});});
 app.post('/api/ml/predict',async(req,res)=>{
  try{
   const {auth}=await mlAccess();
   const result=z.object({title:z.string().trim().min(1).max(300)}).strict().safeParse(req.body);
   if(!result.success)return res.status(400).json({error:'Informe o título.'});
   res.json(await mlPredictCategory(result.data.title,auth.accessToken,{fetchImpl:options.mlFetch||fetch}));
  }catch(e){res.status(e instanceof Error&&/Conecte|Defina/.test(e.message)?409:502).json({error:e instanceof Error?e.message:'Falha.'});}
 });
 const publishLimit=rateLimit({windowMs:60*60*1000,limit:30,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Limite de publicações: aguarde antes de anunciar de novo.'}});
 app.post('/api/ml/publish',publishLimit,async(req,res)=>{
  try{
   const {auth}=await mlAccess();
   const result=z.object({offerId:z.string().trim().min(1).max(128),categoryId:z.string().trim().min(1).max(32).optional(),price:z.number().positive().max(10000000).optional(),quantity:z.number().int().min(1).max(100000).optional(),listingType:z.string().trim().max(32).optional()}).strict().safeParse(req.body);
   if(!result.success)return res.status(400).json({error:'Confira os campos informados.',details:result.error.issues});
   const offer=await db.get('offers',result.data.offerId);
   if(!offer)return res.status(404).json({error:'Oferta não encontrada.'});
   const run=async token=>mlPublishOffer(offer,{categoryId:result.data.categoryId,price:result.data.price,quantity:result.data.quantity,listingType:result.data.listingType},{accessToken:token},{fetchImpl:options.mlFetch||fetch});
   try{res.json(await run(auth.accessToken));}
   catch(e){
    if(e&&e.code==='ML_UNAUTHORIZED'){
     const creds=mlAppCreds(process.env);
     const renewed={...await mlRefresh({appId:creds.appId,secret:creds.secret,refreshToken:auth.refreshToken}),created_at:new Date().toISOString()};
     await db.saveMlAuth(renewed);
     res.json(await run(renewed.accessToken));
    }else throw e;
   }
  }catch(e){
   const msg=e instanceof Error?e.message:'Não foi possível publicar.';
   if(/Conecte sua conta|Defina ML_APP/.test(msg))return res.status(409).json({error:msg});
   const status=e&&e.status===400?400:(/Oferta|categoria|Categoria|Título|Preço|Quantidade|imagem/i.test(msg)?(e.status||422):502);
   res.status(status).json({error:msg,code:e&&e.code});
  }
 });
 app.post('/api/whatsapp/baileys/pair-code',async(req,res)=>{
  const result=z.object({phone:z.string().trim().min(10).max(20)}).strict().safeParse(req.body);
  if(!result.success)return res.status(400).json({error:'Informe o número com DDI+DDD.'});
  try{res.json({code:await baileys.requestPairCode(result.data.phone)});}
  catch(e){res.status(409).json({error:e instanceof Error?e.message:'Falha ao gerar código.'});}
 });
 app.use('/api',(_req,res)=>res.status(404).json({error:'Operação não encontrada.'}));
 app.use(express.static(resolve('dist'),{setHeaders(res,path){const base=path.split(/[\\/]/).pop();if(base==='index.html'||base==='sw.js'||base.endsWith('.webmanifest'))res.setHeader('Cache-Control','no-cache');}}));
 app.use((error,_req,res,_next)=>{
  if(error.status===400||error.status===413)return res.status(error.status).json({error:'Requisição inválida ou muito grande.'});
  // Never log connection strings, request bodies or credentials.
  console.error('Falha interna ao processar requisição.');
  res.status(500).json({error:'Não foi possível concluir a operação. Tente novamente.'});
 });
 async function processQueue(limit=10){
  const sender=await resolveSender();
  if(!sender)return {processed:0,sent:0,failed:0,dead:0,skipped:'no-provider'};
  return processDueQueue(db,sender,{now:new Date().toISOString(),limit});
 }
 return {app,db,ready,processQueue,baileys};
}
