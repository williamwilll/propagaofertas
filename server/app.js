import express from 'express';
import helmet from 'helmet';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {resolve} from 'node:path';
import {inspectFlow} from '../shared/workflow.js';
import {createSqliteStore,createPostgresStore} from './store.js';
import {installAuth} from './auth.js';
import {validateProduction} from './config.js';

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
 description:z.string().trim().max(2000)
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
 app.use(helmet({strictTransportSecurity:config.production?undefined:false,contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'",'https://fonts.googleapis.com'],fontSrc:["'self'",'https://fonts.gstatic.com'],imgSrc:["'self'",'data:'],connectSrc:["'self'"],frameAncestors:["'none'"],upgradeInsecureRequests:config.production?[]:null}}}));
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
 app.use(express.json({limit:'64kb'}));
 const authReady=installAuth(app,db,config);
 const ready=Promise.all([db.ready,authReady]);
 app.get('/api/state',async(_req,res)=>res.json({flows:await db.list('flows'),offers:await db.list('offers'),integrationsReady:false}));
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
  res.json(inspectFlow(flow));
 });
 app.post('/api/flows/:id/activate',async(req,res)=>{
  const flow=await db.get('flows',req.params.id);
  if(!flow)return res.status(404).json({error:'Fluxo não encontrado.'});
  res.status(409).json({error:'Ativação bloqueada: confira as pendências do fluxo.',...inspectFlow(flow)});
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
