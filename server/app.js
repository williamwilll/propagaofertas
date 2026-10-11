import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { inspectFlow } from '../shared/workflow.js';

const text = z.string().trim().max(300);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const flowSchema = z.object({
  name: text.min(1), account: text, source: text, sourceConsent: z.boolean(),
  platform: z.enum(['Amazon', 'Shopee', 'Mercado Livre', 'TikTok', 'Kwai']),
  distributor: text, destinations: z.array(text.min(1)).max(50), destinationConsent: z.boolean(),
  days: z.array(z.number().int().min(0).max(6)).max(7), start: time, end: time,
  interval: z.number().int().min(1).max(1440), dailyLimit: z.number().int().min(1).max(1000),
  mode: z.enum(['manual', 'automatic'])
}).strict().refine(v => v.start < v.end, { message: 'O horário final deve ser posterior ao inicial.' });
const offerSchema = z.object({
  title: text.min(1), price: z.number().positive().max(10000000),
  url: z.string().trim().max(2000).url().refine(v => { try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } }, 'Use um link HTTPS sem credenciais.'),
  description: z.string().trim().max(2000)
}).strict();

export function createApp(dbPath = resolve('data/ofertazap.sqlite')) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS flows (id TEXT PRIMARY KEY, data TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS offers (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL);`);
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const host = req.headers.host?.split(':')[0];
    if (!['localhost', '127.0.0.1'].includes(host)) return res.status(403).json({error:'Acesso disponível somente neste computador.'});
    const origin = req.headers.origin;
    if (origin && !['http://localhost:5173','http://127.0.0.1:5173','http://localhost:3001','http://127.0.0.1:3001'].includes(origin)) return res.status(403).json({error:'Origem não autorizada.'});
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  const rows = table => db.prepare(`SELECT * FROM ${table} ORDER BY created_at DESC`).all().map(({data,...row}) => ({...JSON.parse(data),...row}));
  app.get('/api/state', (_req, res) => res.json({flows:rows('flows'),offers:rows('offers'),integrationsReady:false}));
  for (const [table, schema] of [['flows',flowSchema],['offers',offerSchema]]) {
    app.post(`/api/${table}`, (req,res) => {
      const result = schema.safeParse(req.body);
      if (!result.success) return res.status(400).json({error:'Confira os campos informados.',details:result.error.issues});
      const id=randomUUID(), created=new Date().toISOString();
      if (table==='flows') db.prepare('INSERT INTO flows VALUES (?,?,?,?)').run(id,JSON.stringify(result.data),'draft',created);
      else db.prepare('INSERT INTO offers VALUES (?,?,?)').run(id,JSON.stringify(result.data),created);
      res.status(201).json({id});
    });
    app.put(`/api/${table}/:id`, (req,res) => {
      const result=schema.safeParse(req.body);
      if(!result.success) return res.status(400).json({error:'Confira os campos informados.',details:result.error.issues});
      const update=db.prepare(`UPDATE ${table} SET data=? WHERE id=?`).run(JSON.stringify(result.data),req.params.id);
      if(!update.changes) return res.status(404).json({error:'Registro não encontrado.'});
      res.json({ok:true});
    });
    app.delete(`/api/${table}/:id`, (req,res) => {
      const result=db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id);
      if(!result.changes) return res.status(404).json({error:'Registro não encontrado.'});
      res.json({ok:true});
    });
  }
  app.get('/api/flows/:id/check', (req,res) => {
    const flow = db.prepare('SELECT data FROM flows WHERE id=?').get(req.params.id);
    if (!flow) return res.status(404).json({error:'Fluxo não encontrado.'});
    res.json(inspectFlow(JSON.parse(flow.data)));
  });
  app.post('/api/flows/:id/activate', (req,res) => {
    const flow = db.prepare('SELECT data FROM flows WHERE id=?').get(req.params.id);
    if (!flow) return res.status(404).json({error:'Fluxo não encontrado.'});
    res.status(409).json({error:'Ativação bloqueada: confira as pendências do fluxo.',...inspectFlow(JSON.parse(flow.data))});
  });
  app.use('/api', (_req,res) => res.status(404).json({error:'Operação não encontrada.'}));
  app.use(express.static(resolve('dist')));
  app.use((error,_req,res,_next) => { if(error.status===400 || error.status===413) return res.status(error.status).json({error:'Requisição inválida ou muito grande.'}); console.error(error); res.status(500).json({error:'Não foi possível concluir a operação.'}); });
  return {app,db};
}
