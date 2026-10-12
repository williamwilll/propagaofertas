import test from 'node:test';
import assert from 'node:assert/strict';
import {extractProduct,readPrice,importProduct} from './product-import.js';
import {fetchProductPage,resolvePublicHost,isPublicAddress,validateProductUrl} from './product-fetch.js';
import {allowedImageUrl} from '../shared/product-policy.js';
import {createApp} from './app.js';

const url='https://www.amazon.com.br/dp/B012345678?tag=original-20';
const product={ '@context':'https://schema.org','@type':'Product',name:'Fone & som',description:'<b>Descrição</b><script>alert(1)</script>',image:'https://m.media-amazon.com/images/I/test.jpg',offers:{'@type':'Offer',price:'1299.90',priceCurrency:'BRL'}};
const html=value=>`<html><head><script type="application/ld+json">${JSON.stringify(value).replace(/</g,'\\u003c')}</script></head></html>`;
const publicResolver=async()=>[{address:'93.184.216.34',family:4}];

test('extrai produto JSON-LD, preço e imagem e remove HTML da descrição',()=>{
 const result=extractProduct(html(product),url);
 assert.equal(result.title,'Fone & som');assert.equal(result.price,1299.9);assert.equal(result.description,'Descrição');
 assert.equal(result.imageUrl,product.image);assert.ok(result.warnings.some(w=>w.includes('afiliado')));
 assert.equal(extractProduct(html({'@graph':[product]}),url).title,product.name);
});
test('preços ausentes, estrangeiros e intervalos não são inventados',()=>{
 for(const value of [null,{}, {price:'19',priceCurrency:'USD'}, {'@type':'AggregateOffer',lowPrice:10,highPrice:100,priceCurrency:'BRL'},[{price:10,priceCurrency:'BRL'},{price:20,priceCurrency:'BRL'}]]){
  const result=extractProduct(html({...product,offers:value}),url);assert.equal(result.price,null);assert.ok(result.warnings.some(w=>w.includes('Preço')));
 }
 for(const [value,expected] of [['R$ 1.299,90',1299.9],['1299.90',1299.9],['1,299.90',1299.9],['129,9',129.9],['1.299',1299],['12x 9,90',null],['99 - 129',null],['1,2,3',null],[-1,null]])assert.equal(readPrice(value),expected);
});
test('Open Graph funciona e páginas de bloqueio ou categoria não viram produtos',()=>{
 const result=extractProduct('<meta property="og:type" content="product"><meta property="og:title" content="Cafeteira"><meta property="product:price:amount" content="299,90"><meta property="product:price:currency" content="BRL"><meta property="og:image" content="https://http2.mlstatic.com/test.jpg">','https://www.mercadolivre.com.br/produto');
 assert.equal(result.title,'Cafeteira');assert.equal(result.price,299.9);
 assert.throws(()=>extractProduct('<title>Robot Check</title>',url),/bloqueou/);
 assert.throws(()=>extractProduct('<title>Loja de ofertas</title>','https://shopee.com.br/search'),/Não encontrei/);
 assert.equal(extractProduct(html({...product,image:'http://127.0.0.1/image.jpg'}),url).imageUrl,'');
});
test('URL e DNS bloqueiam destinos internos, credenciais, portas e domínios falsos',async()=>{
 for(const value of ['http://amazon.com.br/dp/a','https://amazon.com.br.evil.test','https://amazon.com.br@127.0.0.1/','https://amazon.com.br:8443/','https://127.0.0.1/','https://user:pass@amazon.com.br/'])assert.throws(()=>validateProductUrl(value));
 for(const address of ['127.0.0.1','10.0.0.1','172.16.1.1','192.168.0.1','169.254.169.254','100.64.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1'])assert.equal(isPublicAddress(address),false,address);
 assert.equal(isPublicAddress('8.8.8.8'),true);
 await assert.rejects(()=>resolvePublicHost('amazon.com.br',async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]),/segurança/);
 assert.equal(allowedImageUrl('https://mlstatic.com.evil.test/a.jpg'),false);
});
test('link curto resolve com validação de cada salto e preserva o link original fora da busca',async()=>{
 const visited=[];
 const result=await importProduct('https://amzn.to/example',{resolver:publicResolver,transport:async(target,addresses)=>{
  visited.push(target.href);assert.equal(addresses[0].address,'93.184.216.34');
  return visited.length===1?{status:302,location:url}:{status:200,html:html(product)};
 }});
 assert.equal(result.title,product.name);assert.equal(visited.length,2);
 let calls=0;
 await assert.rejects(()=>fetchProductPage(url,{resolver:publicResolver,transport:async()=>{calls++;return {status:302,location:'https://127.0.0.1/admin'};}}),/HTTPS/);
 assert.equal(calls,1);
 await assert.rejects(()=>fetchProductPage(url,{resolver:async()=>[{address:'127.0.0.1',family:4}],transport:async()=>{throw new Error('Nunca deve ser chamado');}}),/segurança/);
});
test('loop de redirecionamento termina sem requisições ilimitadas',async()=>{
 await assert.rejects(()=>fetchProductPage(url,{resolver:publicResolver,transport:async()=>({status:302,location:url})}),/redirecionamentos/);
});
test('API importa sem persistir e salva a imagem apenas em cadastro explícito',async()=>{
 let received;
 const {app,db,ready}=createApp(':memory:',{productImporter:async input=>{received=input;return extractProduct(html(product),url);}});await ready;
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const base=`http://127.0.0.1:${server.address().port}/api`;
 try{
  const response=await fetch(base+'/offers/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
  assert.equal(response.status,200);assert.equal(received,url);
  assert.equal((await (await fetch(base+'/state')).json()).offers.length,0);
  const input={title:'Fone',description:'',price:99,url,imageUrl:product.image};
  const save=await fetch(base+'/offers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(save.status,201);
  const saved=(await (await fetch(base+'/state')).json()).offers[0];assert.equal(saved.url,url);assert.equal(saved.imageUrl,product.image);
  const bad=await fetch(base+'/offers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,imageUrl:'https://evil.test/x.jpg'})});assert.equal(bad.status,400);
 }finally{await new Promise(r=>server.close(r));await db.close();}
});
