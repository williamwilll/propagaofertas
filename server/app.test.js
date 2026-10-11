import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from './app.js';
import {composeOffer,inspectFlow} from '../shared/workflow.js';

async function setup(path=':memory:'){
 const {app,db}=createApp(path);const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const request=async(route,method='GET',body,headers={})=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${route}`,{method,headers:{'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 return {request,close:async()=>{await new Promise(r=>server.close(r));db.close();}};
}
const flow={name:'Fluxo teste',account:'Conta 1',source:'Origem',sourceConsent:true,platform:'Amazon',distributor:'Central',destinations:['Destino'],destinationConsent:true,days:[1,2],start:'09:00',end:'18:00',interval:10,dailyLimit:20,mode:'manual'};
test('CRUD de ofertas, validação de links e isolamento de origem',async()=>{
 const ctx=await setup();try{
 assert.equal((await ctx.request('/state')).data.offers.length,0);
 const offer={title:'Fone',price:179.9,url:'https://example.com/fone',description:'Descrição'};
 for (const url of ['javascript:alert(1)','não é um link','https://user:secret@example.com','http://example.com']) {
  assert.equal((await ctx.request('/offers','POST',{...offer,url})).status,400);
 }
 assert.equal((await ctx.request('/offers','POST',{...offer,price:-1})).status,400);
 assert.equal((await ctx.request('/offers','POST',offer,{Origin:'https://evil.example'})).status,403);
 const created=await ctx.request('/offers','POST',offer);assert.equal(created.status,201);
 assert.equal((await ctx.request('/offers/'+created.data.id,'PUT',{...offer,title:'Fone atualizado'})).status,200);
 assert.equal((await ctx.request('/state')).data.offers[0].title,'Fone atualizado');
 assert.equal((await ctx.request('/offers/'+created.data.id,'DELETE')).status,200);
 assert.equal((await ctx.request('/state')).data.offers.length,0);
 }finally{await ctx.close();}
});
test('rascunho persiste após reabrir o banco e não pode ser ativado',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ofertazap-'));let ctx=await setup(join(dir,'test.sqlite'));
 try{
 assert.equal((await ctx.request('/flows','POST',{...flow,start:'19:00'})).status,400);
 assert.equal((await ctx.request('/flows','POST',{...flow,status:'active'})).status,400);
 const created=await ctx.request('/flows','POST',flow);assert.equal(created.status,201);
 const inspection=await ctx.request('/flows/'+created.data.id+'/check');
 assert.equal(inspection.status,200);assert.equal(inspection.data.ready,false);assert.equal(inspection.data.pending,3);
 const activation=await ctx.request('/flows/'+created.data.id+'/activate','POST');
 assert.equal(activation.status,409);assert.deepEqual(activation.data.checks,inspection.data.checks);
 assert.equal((await ctx.request('/flows/not-found/check')).status,404);
 await ctx.close();ctx=await setup(join(dir,'test.sqlite'));
 const saved=(await ctx.request('/state')).data.flows[0];assert.equal(saved.name,flow.name);assert.equal(saved.status,'draft');assert.equal(saved.id,created.data.id);
 assert.equal((await ctx.request('/flows/'+saved.id,'PUT',{...flow,name:'Editado'})).status,200);
 assert.equal((await ctx.request('/flows/'+saved.id,'DELETE')).status,200);
 assert.equal((await ctx.request('/flows/'+saved.id,'DELETE')).status,404);
 }finally{await ctx.close();rmSync(dir,{recursive:true,force:true});}
});

test('checklist distingue declaração de autorização de verificação externa',()=>{
 const complete=inspectFlow(flow);
 assert.equal(complete.ready,false);
 assert.deepEqual(complete.checks.filter(c=>!c.passed).map(c=>c.code),['whatsapp','affiliate','permissions']);
 const incomplete=inspectFlow({...flow,account:' ',sourceConsent:false,destinationConsent:false,days:[],destinations:[' origem ','DESTINO','destino']});
 for(const code of ['account','source','destinations','route','schedule']) assert.equal(incomplete.checks.find(c=>c.code===code).passed,false);
 assert.equal(inspectFlow({...flow,distributor:' origem '}).checks.find(c=>c.code==='route').passed,false);
 assert.equal(inspectFlow({...flow,destinations:[' Central ']}).checks.find(c=>c.code==='route').passed,false);
});

test('mensagem inclui preço, link exato e divulgação de afiliado sem desconto inventado',()=>{
 const offer={title:'  Fone Bluetooth  ',description:'Mais música.',price:179.9,url:'https://example.com/item?tag=minha-tag&ref=abc'};
 const message=composeOffer(offer);
 assert.ok(message.startsWith('ACHADINHO DO DIA ✨\n\nFone Bluetooth'));
 assert.match(message,/179,90/);assert.ok(message.includes(offer.url));
 assert.ok(message.includes('Posso receber uma comissão'));assert.ok(message.includes('disponibilidade sujeitos a alteração'));
 assert.ok(!message.includes('%'));assert.ok(!message.includes('undefined'));
 assert.ok(!composeOffer({...offer,description:''}).includes('\n\n\n'));
});
