import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import pg from 'pg';

const schema = [
 'CREATE TABLE IF NOT EXISTS flows (id TEXT PRIMARY KEY, data TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS offers (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS sessions (session_key TEXT PRIMARY KEY, expires_at TEXT NOT NULL, owner_key TEXT NOT NULL)',
 'CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at)',
 'CREATE INDEX IF NOT EXISTS flows_created ON flows (created_at DESC)',
 'CREATE INDEX IF NOT EXISTS offers_created ON offers (created_at DESC)',
 'CREATE TABLE IF NOT EXISTS whatsapp_connections (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS ml_auth (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS whatsapp_messages (remote_id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS send_queue (id TEXT PRIMARY KEY, flow_id TEXT NOT NULL, offer_id TEXT, destino TEXT NOT NULL, status TEXT NOT NULL, scheduled_for TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL)',
 'CREATE INDEX IF NOT EXISTS send_queue_due ON send_queue (status, scheduled_for)',
 'CREATE INDEX IF NOT EXISTS send_queue_flow ON send_queue (flow_id)'
];
const MAX_LIST = 200;
const clampLimit = value => Number.isInteger(value) && value > 0 ? Math.min(value, MAX_LIST) : MAX_LIST;
const tableName = name => {if(!['flows','offers'].includes(name))throw new Error('Tabela inválida');return name;};
function repository(query,close,kind){
 const ready=(async()=>{for(const statement of schema)await query(statement);})();
 const run=async(sql,params=[])=>{await ready;return query(sql,params);};
 const unpack=row=>row?{...JSON.parse(row.data),id:row.id,created_at:row.created_at,...(row.status?{status:row.status}:{})}:null;
 return {
  ready,kind,query:run,close,
  async ping(){await run('SELECT 1');},
  async list(table, limit){return (await run(`SELECT * FROM ${tableName(table)} ORDER BY created_at DESC LIMIT ?`,[clampLimit(limit)])).rows.map(unpack);},
  async get(table,id){return unpack((await run(`SELECT * FROM ${tableName(table)} WHERE id=?`,[id])).rows[0]);},
  async insert(table,id,data,created){
   if(tableName(table)==='flows')await run('INSERT INTO flows (id,data,status,created_at) VALUES (?,?,?,?)',[id,JSON.stringify(data),'draft',created]);
   else await run('INSERT INTO offers (id,data,created_at) VALUES (?,?,?)',[id,JSON.stringify(data),created]);
  },
  async update(table,id,data){return (await run(`UPDATE ${tableName(table)} SET data=? WHERE id=?`,[JSON.stringify(data),id])).rowCount;},
  async remove(table,id){return (await run(`DELETE FROM ${tableName(table)} WHERE id=?`,[id])).rowCount;},
  async setStatus(table,id,status){if(tableName(table)!=='flows')throw new Error('Tabela inválida');if(!['draft','active'].includes(status))throw new Error('Status inválido');return (await run(`UPDATE flows SET status=? WHERE id=?`,[status,id])).rowCount;},
  async getConnection(){const row=(await run('SELECT * FROM whatsapp_connections WHERE id=?',['default'])).rows[0];return row?{...JSON.parse(row.data),created_at:row.created_at}:null;},  async saveConnection(data){const created=new Date().toISOString();await run('INSERT INTO whatsapp_connections (id,data,created_at) VALUES (?,?,?) ON CONFLICT (id) DO UPDATE SET data=excluded.data',['default',JSON.stringify(data),created]);},
  async getMlAuth(){const row=(await run('SELECT * FROM ml_auth WHERE id=?',['default'])).rows[0];return row?{...JSON.parse(row.data),created_at:row.created_at}:null;},
  async saveMlAuth(data){const created=new Date().toISOString();await run('INSERT INTO ml_auth (id,data,created_at) VALUES (?,?,?) ON CONFLICT (id) DO UPDATE SET data=excluded.data',['default',JSON.stringify(data),created]);},
  async clearMlAuth(){return (await run('DELETE FROM ml_auth WHERE id=?',['default'])).rowCount;},
  async getSecret(key){return (await run('SELECT value FROM secrets WHERE key=?',[key])).rows[0]?.value||null;},
  async saveSecret(key,value){await run('INSERT INTO secrets (key,value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value=excluded.value',[key,String(value??'')]);},
  async recordInbound(remoteId,data){try{await run('INSERT INTO whatsapp_messages (remote_id,data,created_at) VALUES (?,?,?)',[remoteId,JSON.stringify(data),new Date().toISOString()]);return {duplicate:false};}catch(error){const code=String(error?.code||'')+String(error?.message||'');if(/23505|UNIQUE|CONSTRAINT|duplicate/i.test(code))return {duplicate:true};throw error;}},
  async enqueueSend(job){await run('INSERT INTO send_queue (id,flow_id,offer_id,destino,status,scheduled_for,attempts,created_at) VALUES (?,?,?,?,?,?,?,?)',[job.id,job.flowId,job.offerId||null,job.destino,'pending',job.scheduledFor,0,new Date().toISOString()]);},
  async listDueQueue(now,limit=10){return (await run('SELECT * FROM send_queue WHERE status=? AND scheduled_for<=? ORDER BY scheduled_for ASC LIMIT ?',['pending',now,clampLimit(limit)])).rows;},
  async markQueue(id,status,attempts,lastError){return (await run('UPDATE send_queue SET status=?,attempts=?,last_error=? WHERE id=?',[status,attempts,lastError||null,id])).rowCount;},
  async queueDepth(){const row=(await run("SELECT COUNT(*) AS total FROM send_queue WHERE status='pending'")).rows[0];return Number(row?.total||row?.count||0);},
  async listQueue(status,limit=50){const allowed=['pending','sent','dead','failed'];if(!allowed.includes(status))throw new Error('Status inválido');return (await run('SELECT * FROM send_queue WHERE status=? ORDER BY scheduled_for DESC LIMIT ?',[status,clampLimit(limit)])).rows;},
  async queueStats(){const rows=(await run("SELECT status, COUNT(*) AS total FROM send_queue GROUP BY status")).rows;const out={pending:0,sent:0,dead:0,failed:0};for(const r of rows)out[r.status]=Number(r.total||r.count||0);const flows=(await run("SELECT COUNT(*) AS total FROM flows WHERE status='active'")).rows[0];out.activeFlows=Number(flows?.total||flows?.count||0);return out;}
 };
}
export function createSqliteStore(path){
 if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
 const db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL');
 const query=async(sql,params=[])=>{
  const statement=db.prepare(sql);
  if(/^SELECT\b/i.test(sql)){const rows=statement.all(...params);return {rows,rowCount:rows.length};}
  const result=statement.run(...params);return {rows:[],rowCount:Number(result.changes)};
 };
 return repository(query,()=>db.close(),'sqlite');
}
export function createPostgresStore(connectionString,Pool=pg.Pool){
 const url=new URL(connectionString);
 if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('DATABASE_URL deve ser uma conexão PostgreSQL.');
 // Always verify the remote certificate, even when the supplied URL says sslmode=require.
 url.searchParams.set('sslmode','verify-full');
 const pool=new Pool({connectionString:url.toString(),max:5,idleTimeoutMillis:30000,connectionTimeoutMillis:10000,query_timeout:15000});
 pool.on('error',()=>console.error('Falha de conexão no pool PostgreSQL.'));
 const query=(sql,params=[])=>{let i=0;return pool.query(sql.replace(/\?/g,()=>`$${++i}`),params);};
 return repository(query,()=>pool.end(),'postgres');
}
