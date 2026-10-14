import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import ipaddr from 'ipaddr.js';
import {supportedProductUrl} from '../shared/product-policy.js';

export class ProductError extends Error{
 constructor(code,message,status=422){super(message);this.code=code;this.status=status;}
}
export function validateProductUrl(value){
 if(typeof value!=='string'||value.length>2000||!supportedProductUrl(value))throw new ProductError('UNSUPPORTED_LINK','Use um link HTTPS de loja parceira (Amazon, Shopee, Mercado Livre, TikTok, Temu, Nike e outras). Outras lojas podem ser cadastradas manualmente.',400);
 return new URL(value);
}
export function isPublicAddress(address){
 try{return ipaddr.process(address).range()==='unicast';}catch{return false;}
}
export async function resolvePublicHost(host,resolver=lookup){
 const addresses=await resolver(host,{all:true,verbatim:true});
 if(!addresses.length||addresses.some(a=>!isPublicAddress(a.address)))throw new ProductError('BLOCKED_ADDRESS','Não foi possível acessar esse endereço com segurança.');
 return addresses;
}
const MAX_BYTES=2*1024*1024;
function download(url,addresses,signal){
 return new Promise((resolve,reject)=>{
  const req=request(url,{method:'GET',agent:false,signal,lookup:(_host,options,callback)=>{
   if(options.all)callback(null,addresses);else callback(null,addresses[0].address,addresses[0].family);
  },headers:{'User-Agent':'PropagaOfertas/1.0 (public product metadata preview)','Accept':'text/html,application/xhtml+xml','Accept-Language':'pt-BR,pt;q=0.9','Accept-Encoding':'identity'}},res=>{
   const status=res.statusCode||0;
   if([301,302,303,307,308].includes(status)){res.destroy();resolve({status,location:res.headers.location});return;}
   if(status<200||status>=300){res.destroy();reject(new ProductError('STORE_BLOCKED','A loja recusou a leitura ou o produto está indisponível. Preencha os dados manualmente.'));return;}
   const type=String(res.headers['content-type']||'');
   if(!/text\/html|application\/xhtml\+xml/i.test(type)||!['identity',''].includes(String(res.headers['content-encoding']||''))){res.destroy();reject(new ProductError('UNSUPPORTED_PAGE','A loja não forneceu uma página HTML legível. Preencha manualmente.'));return;}
   let size=0;const chunks=[];
   res.on('data',chunk=>{size+=chunk.length;if(size>MAX_BYTES){const error=new ProductError('PAGE_TOO_LARGE','A página é grande demais para leitura automática. Preencha manualmente.');reject(error);res.destroy();req.destroy();}else chunks.push(chunk);});
   res.on('end',()=>resolve({status,html:Buffer.concat(chunks)}));
   res.on('error',reject);
  });
  req.on('error',reject);req.end();
 });
}
export async function fetchProductPage(value,{resolver=lookup,transport=download,timeoutMs=15000}={}){
 let url=validateProductUrl(value);
 const controller=new AbortController();
 let timer;
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ProductError('IMPORT_TIMEOUT','A loja demorou para responder. Tente novamente ou preencha manualmente.'));},timeoutMs);timer.unref?.();});
 const work=(async()=>{
  const visited=new Set();
  for(let hop=0;hop<=4;hop++){
   if(controller.signal.aborted)throw new ProductError('IMPORT_TIMEOUT','A loja demorou para responder.');
   validateProductUrl(url.href);
   if(visited.has(url.href))break;visited.add(url.href);
   const addresses=await resolvePublicHost(url.hostname,resolver);
   if(controller.signal.aborted)throw new ProductError('IMPORT_TIMEOUT','A loja demorou para responder.');
   const result=await transport(url,addresses,controller.signal);
   if(result.location){url=new URL(result.location,url);continue;}
   return {html:result.html,finalUrl:url.href};
  }
  throw new ProductError('TOO_MANY_REDIRECTS','O link tem redirecionamentos demais. Use o link direto do produto.');
 })();
 try{return await Promise.race([work,timeout]);}
 catch(error){if(error instanceof ProductError)throw error;throw new ProductError('STORE_UNAVAILABLE','Não foi possível ler a página da loja. Tente novamente ou preencha os campos manualmente.');}
 finally{clearTimeout(timer);controller.abort();}
}
