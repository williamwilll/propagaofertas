import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import pg from 'pg';

const schema = [
 'CREATE TABLE IF NOT EXISTS flows (id TEXT PRIMARY KEY, data TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS offers (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS sessions (session_key TEXT PRIMARY KEY, expires_at TEXT NOT NULL, owner_key TEXT NOT NULL)',
 'CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at)'
];
const tableName = name => {if(!['flows','offers'].includes(name))throw new Error('Tabela inválida');return name;};
function repository(query,close,kind){
 const ready=(async()=>{for(const statement of schema)await query(statement);})();
 const run=async(sql,params=[])=>{await ready;return query(sql,params);};
 const unpack=row=>row?{...JSON.parse(row.data),id:row.id,created_at:row.created_at,...(row.status?{status:row.status}:{})}:null;
 return {
  ready,kind,query:run,close,
  async ping(){await run('SELECT 1');},
  async list(table){return (await run(`SELECT * FROM ${tableName(table)} ORDER BY created_at DESC`)).rows.map(unpack);},
  async get(table,id){return unpack((await run(`SELECT * FROM ${tableName(table)} WHERE id=?`,[id])).rows[0]);},
  async insert(table,id,data,created){
   if(tableName(table)==='flows')await run('INSERT INTO flows (id,data,status,created_at) VALUES (?,?,?,?)',[id,JSON.stringify(data),'draft',created]);
   else await run('INSERT INTO offers (id,data,created_at) VALUES (?,?,?)',[id,JSON.stringify(data),created]);
  },
  async update(table,id,data){return (await run(`UPDATE ${tableName(table)} SET data=? WHERE id=?`,[JSON.stringify(data),id])).rowCount;},
  async remove(table,id){return (await run(`DELETE FROM ${tableName(table)} WHERE id=?`,[id])).rowCount;}
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
