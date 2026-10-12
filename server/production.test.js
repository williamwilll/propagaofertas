import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {newDb} from 'pg-mem';
import {createApp} from './app.js';
import {createSqliteStore,createPostgresStore} from './store.js';
import {loadConfig} from './config.js';

const credentials={email:'owner@example.test',password:'Testing-only-not-a-real-password-123'};
const production={production:true,appOrigin:'https://propagaofertas.example.test',adminEmail:credentials.email,adminPassword:credentials.password};
async function setup(options={}){
 const store=options.store||createSqliteStore(':memory:');
 const {app,ready}=createApp(':memory:',{...production,...options,store});await ready;
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const request=async(path,method='GET',body,cookie,headers={})=>{
  return new Promise((resolve,reject)=>{
   const req=httpRequest({hostname:'127.0.0.1',port:server.address().port,path,method,headers:{Host:'propagaofertas.example.test','X-Forwarded-Proto':'https',Origin:production.appOrigin,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers}},res=>{
    let text='';res.setEncoding('utf8');res.on('data',part=>{text+=part;});res.on('end',()=>{
     try{const h=new Headers();for(const [key,value] of Object.entries(res.headers))if(value)h.set(key,Array.isArray(value)?value.join(','):value);resolve({status:res.statusCode,data:JSON.parse(text),headers:h,cookie:h.get('set-cookie')?.split(';')[0]});}catch(error){reject(error);}
    });
   });req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
  });
 };
 return {request,store,close:async()=>{await new Promise(r=>server.close(r));await store.close();}};
}

test('produção exige PostgreSQL, HTTPS e credenciais fortes, inclusive no Render',()=>{
 const env={NODE_ENV:'production',DATABASE_URL:'postgresql://user:dummy@db.example.test/neondb',RENDER_EXTERNAL_URL:production.appOrigin,ADMIN_EMAIL:credentials.email,ADMIN_PASSWORD:credentials.password};
 const config=loadConfig(env);assert.equal(config.host,'0.0.0.0');assert.equal(config.appOrigin,production.appOrigin);
 assert.throws(()=>loadConfig({...env,DATABASE_URL:''}),/DATABASE_URL/);
 assert.throws(()=>loadConfig({...env,ADMIN_PASSWORD:'123'}),/ADMIN_PASSWORD/);
 assert.throws(()=>loadConfig({...env,APP_ORIGIN:'http://insecure.test'}),/HTTPS/);
 assert.throws(()=>loadConfig({...env,DATABASE_URL:'sqlite:local'}),/PostgreSQL/);
 assert.throws(()=>loadConfig({...env,NODE_ENV:'development',RENDER:'true',ADMIN_EMAIL:''}),/ADMIN_EMAIL/);
 assert.throws(()=>createApp(':memory:',production),/PostgreSQL/);
 assert.equal(loadConfig({}).host,'127.0.0.1');
});

test('API protegida, sessão opaca, rotação, logout e expiração',async()=>{
 const ctx=await setup();try{
  assert.equal((await ctx.request('/healthz')).status,200);
  assert.equal((await ctx.request('/api/auth/session')).data.authenticated,false);
  for(const [path,method] of [['/api/state','GET'],['/api/offers','POST'],['/api/flows/example','DELETE'],['/api/flows/example/check','GET']])assert.equal((await ctx.request(path,method)).status,401);
  assert.equal((await ctx.request('/api/auth/login','POST',{...credentials,password:'wrong'})).status,401);
  const login=await ctx.request('/api/auth/login','POST',credentials);assert.equal(login.status,200);
  assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/Secure/);assert.match(login.headers.get('set-cookie'),/SameSite=Strict/);
  assert.equal(login.headers.get('cache-control'),'no-store');
  const rows=(await ctx.store.query('SELECT * FROM sessions')).rows;
  assert.equal(rows.length,1);assert.notEqual(rows[0].session_key,login.cookie.split('=')[1]);
  assert.equal((await ctx.request('/api/state','GET',null,login.cookie)).status,200);
  const session=await ctx.request('/api/auth/session','GET',null,login.cookie);assert.equal(session.data.email,credentials.email);
  const rotated=await ctx.request('/api/auth/login','POST',credentials,login.cookie);assert.notEqual(rotated.cookie,login.cookie);
  assert.equal((await ctx.request('/api/state','GET',null,login.cookie)).status,401);
  await ctx.request('/api/auth/logout','POST',{},rotated.cookie);
  assert.equal((await ctx.request('/api/state','GET',null,rotated.cookie)).status,401);
  const next=await ctx.request('/api/auth/login','POST',credentials);
  await ctx.store.query('UPDATE sessions SET expires_at=?',['2000-01-01T00:00:00.000Z']);
  assert.equal((await ctx.request('/api/state','GET',null,next.cookie)).status,401);
 }finally{await ctx.close();}
});

test('origem, host, HTTPS e limite de tentativas',async()=>{
 const ctx=await setup();try{
  assert.equal((await ctx.request('/api/auth/login','POST',credentials,null,{Origin:'https://evil.example'})).status,403);
  assert.equal((await ctx.request('/api/auth/login','POST',credentials,null,{Origin:''})).status,403);
  assert.equal((await ctx.request('/api/auth/session','GET',null,null,{Host:'evil.example'})).status,403);
  assert.equal((await ctx.request('/api/auth/session','GET',null,null,{'X-Forwarded-Proto':'http'})).status,400);
  for(let i=0;i<10;i++)assert.equal((await ctx.request('/api/auth/login','POST',{...credentials,password:'wrong'})).status,401);
  const limited=await ctx.request('/api/auth/login','POST',credentials);assert.equal(limited.status,429);assert.ok(limited.headers.get('retry-after'));
 }finally{await ctx.close();}
});

test('adapter PostgreSQL executa CRUD e sessões com SQL parametrizado (banco emulado)',async()=>{
 const memory=newDb();const {Pool}=memory.adapters.createPg();
 const store=createPostgresStore('postgresql://test:dummy@localhost/test',Pool);
 const ctx=await setup({store});try{
  const login=await ctx.request('/api/auth/login','POST',credentials);assert.equal(login.status,200);
  const offer={title:"Produto ' com aspas",price:49.9,url:'https://example.com/item',description:'Cadastro no PostgreSQL'};
  const created=await ctx.request('/api/offers','POST',offer,login.cookie);assert.equal(created.status,201);
  assert.equal((await ctx.request('/api/state','GET',null,login.cookie)).data.offers[0].title,offer.title);
  assert.equal((await ctx.request('/api/offers/'+created.data.id,'PUT',{...offer,price:45},login.cookie)).status,200);
  assert.equal((await ctx.request('/api/state','GET',null,login.cookie)).data.offers[0].price,45);
  assert.equal((await ctx.request('/api/offers/'+created.data.id,'DELETE',null,login.cookie)).status,200);
  assert.equal((await ctx.request('/api/auth/session','GET',null,login.cookie)).data.storage,'postgres');
  assert.equal((await ctx.request('/api/auth/logout','POST',{},login.cookie)).status,200);
  assert.equal((await ctx.request('/api/state','GET',null,login.cookie)).status,401);
 }finally{await ctx.close();}
});
