import {load,loadBuffer} from 'cheerio';
import {allowedImageUrl,detectStore} from '../shared/product-policy.js';
import {fetchProductPage,ProductError} from './product-fetch.js';
import {fetchShopeeOfficial} from './shopee.js';

function plain(value,max){
 if(typeof value!=='string')return '';
 const $=load(value);$('script,style').remove();
 return $.text().replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}
export function readPrice(value){
 if(typeof value==='number')return Number.isFinite(value)&&value>0&&value<=10000000?Math.round(value*100)/100:null;
 if(typeof value!=='string')return null;
 let text=value.replace(/^\s*R\$\s*/,'').replace(/\s/g,'');
 if(!/^\d[\d.,]*$/.test(text))return null;
 if(text.includes(',')&&text.includes('.')){
  if(text.lastIndexOf(',')>text.lastIndexOf('.')){if(!/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(text))return null;text=text.replace(/\./g,'').replace(',','.');}
  else{if(!/^\d{1,3}(,\d{3})*\.\d{1,2}$/.test(text))return null;text=text.replace(/,/g,'');}
 }else if(text.includes(',')){if(!/^\d+,\d{1,2}$/.test(text))return null;text=text.replace(',','.');}
 else if(/^\d{1,3}(\.\d{3})+$/.test(text))text=text.replace(/\./g,'');
 if(!/^\d+(\.\d{1,2})?$/.test(text))return null;
 return readPrice(Number(text));
}
export function cleanTitle(t){
 let s=String(t||'').trim();
 if(!s)return '';
 const cleared=s.replace(/\s*[-–—|]\s*[^-–—|]{2,}$/,'');
 if(cleared.trim().length>=8)s=cleared.trim();
 return s;
}
export function findProductInLd(node){
 if(!node||typeof node!=='object')return null;
 if(Array.isArray(node)){for(const item of node){const f=findProductInLd(item);if(f)return f;}return null;}
 const types=Array.isArray(node['@type'])?node['@type']:[node['@type']];
 if(types.includes('Product'))return node;
 if(node['@graph'])return findProductInLd(node['@graph']);
 for(const [key,val] of Object.entries(node)){
  if(key==='@context'||key==='@id')continue;
  const f=findProductInLd(val);
  if(f)return f;
 }
 return null;
}
function buildIdMap(node,map=new Map()){
 if(!node||typeof node!=='object')return map;
 if(Array.isArray(node)){node.forEach(n=>buildIdMap(n,map));return map;}
 if(node['@id'])map.set(node['@id'],node);
 Object.values(node).forEach(v=>buildIdMap(v,map));
 return map;
}
function priceFromSpec(spec){
 const list=Array.isArray(spec)?spec:[spec];
 for(const s of list){
  if(s&&typeof s==='object'&&s.price!==undefined&&s.price!==null&&s.price!=='')return {price:s.price,currency:s.priceCurrency};
 }
 return null;
}
function offersPrice(offers,idMap,hint){
 const list=Array.isArray(offers)?offers:[offers];
 if(Array.isArray(offers)&&offers.length!==1&&!(hint>0))return null;
 const found=[];
 for(const o of list){
  if(!o||typeof o!=='object')continue;
  let target=o;
  if(o['@id']&&idMap.has(o['@id']))target=idMap.get(o['@id']);
  if(String(target['@type']||'').includes('AggregateOffer'))continue;
  const spec=target.priceSpecification?priceFromSpec(target.priceSpecification):null;
  const raws=[
   target.price!==undefined?{price:target.price,currency:target.priceCurrency}:null,
   spec,
   target.lowPrice!==undefined?{price:target.lowPrice,currency:target.priceCurrency}:null
  ].filter(Boolean);
  for(const r of raws){
   const price=readPrice(r.price);
   if(price)found.push({price,currency:r.currency||'BRL'});
  }
 }
 if(!found.length)return null;
 if(hint>0&&found.length>1)found.sort((a,b)=>Math.abs(a.price-hint)-Math.abs(b.price-hint));
 return found[0];
}
export function parseShopeeIds(u){
 const s=String(u||'');
 let m=s.match(/\/opaanlp\/(\d+)\/(\d+)/);
 if(m)return {shopid:m[1],itemid:m[2]};
 m=s.match(/\/product\/(\d+)\/(\d+)/);
 if(m)return {shopid:m[1],itemid:m[2]};
 m=s.match(/-i\.(\d+)\.(\d+)(?:[?#]|$)/);
 if(m)return {shopid:m[1],itemid:m[2]};
 return null;
}
export function shopeeImage(hash){
 if(!hash)return '';
 return `https://down-br.img.susercontent.com/file/${hash}`;
}
export function parseShopeeItem(j){
 const item=j?.data&&(j.data.item_basic||j.data.item);
 if(!item||!item.name)return null;
 const div=v=>{const n=Number(v)/100000;return Number.isFinite(n)&&n>=0.01&&n<=1000000?n:null;};
 const price=div(item.price_min??item.price)??div(item.price_max);
 if(!price)return null;
 const cats=Array.isArray(item.categories)?item.categories:[];
 const last=cats[cats.length-1];
 const rawImg=typeof item.image==='string'?item.image:(Array.isArray(item.image)?item.image[0]:'');
 return {name:cleanTitle(String(item.name)),price,currency:item.currency||'BRL',image:shopeeImage(rawImg),category:(last&&typeof last.display_name==='string')?last.display_name.trim():''};
}
export function tiktokItemId(u){
 const s=String(u||'');
 let m=s.match(/\/video\/(\d+)/);
 if(m)return {id:m[1],kind:'video'};
 m=s.match(/\/photo\/(\d+)/);
 if(m)return {id:m[1],kind:'photo'};
 m=s.match(/[?&]share_item_id=(\d+)/);
 if(m)return {id:m[1],kind:'video'};
 return null;
}
const WALL_TITLES=/^(entrar|login|log\s?in|sign\s?up|cadastre-se|verify|verifying|verifica|verifica[cç][aã]o|security\s*check|attention|access\s*denied|acesso\s*negado|just\s*a\s*moment|un\s*momento|robots?|rob[oô]|humano?|captcha|cloudflare|oops|tiktok)(\s*[-–—|:|]\s*tiktok\s*)?$/i;
const WALL_PHRASES=['security check','verify you are','verify to continue','please verify','prove you are human','just a moment','attention required','access denied','acesso negado','are you a robot','sou humano','confirme que você','un momento'];
export function isWallResult(g){
 if(!g)return true;
 const t=String(g.name||'').trim();
 if(!t)return !g.price&&!g.image;
 if(g.price||g.image)return false;
 if(WALL_TITLES.test(t))return true;
 const low=t.toLowerCase();
 return WALL_PHRASES.some(p=>low.includes(p));
}
function decodeText(s){
 return String(s||'').replace(/\\u([0-9a-fA-F]{4})/g,(_,h)=>String.fromCharCode(parseInt(h,16))).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}
export function extractMercadoLivreSocial(html){
 const out={price:null,old_price:null,currency:'BRL'};
 try{
  const decoded=decodeText(html);
  const ogTitleM=decoded.match(/<meta property="og:title" content="([^"]{4,200})"/);
  if(!ogTitleM)return null;
  const escTitle=ogTitleM[1].replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  let anchor=decoded.search(new RegExp(`"title":\\{"text":"${escTitle}"`));
  if(anchor===-1){
   const ogImgM=decoded.match(/D_NQ_NP_[^"\\]*?(MLB\d{6,})/);
   if(!ogImgM)return null;
   anchor=decoded.indexOf(ogImgM[1]);
   if(anchor===-1)return null;
  }
  const win=decoded.slice(anchor,anchor+3000);
  const cur=win.match(/"current_price":\{"value":([0-9]+(?:\.[0-9]+)?)/);
  if(!cur)return null;
  out.price=readPrice(Number(cur[1]));
  if(!out.price)return null;
  const prev=win.match(/"previous_price":\{"value":([0-9]+(?:\.[0-9]+)?)/);
  if(prev){const old=readPrice(Number(prev[1]));if(old&&old>out.price)out.old_price=old;}
  const cur2=win.match(/"currency":"([A-Z]{3})"/);
  if(cur2)out.currency=cur2[1];
  return out;
 }catch{return null;}
}
function productsFrom($){
 const products=[];
 $('script[type="application/ld+json"]').each((_i,node)=>{try{const f=findProductInLd(JSON.parse($(node).text()));if(f)products.push(f);}catch{}});
 return products;
}
export function extractProduct(html,finalUrl){
 const $=Buffer.isBuffer(html)?loadBuffer(html):load(html);
 const meta=key=>$('meta').filter((_i,node)=>($(node).attr('property')||$(node).attr('name'))?.toLowerCase()===key).first().attr('content')||'';
 const products=productsFrom($);
 const product=products.length?products[0]:null;
 const ogTitle=meta('og:title');
 const title=plain(cleanTitle(product?.name)||cleanTitle(ogTitle)||cleanTitle($('title').first().text()),300);
 const isProduct=!!product||meta('og:type').toLowerCase().includes('product')||!!meta('product:price:amount')||/\/dp\/[A-Z0-9]{10}|\/gp\/product\/[A-Z0-9]{10}|MLB-?\d{6,}|-i\.\d+\.\d+|\/product\/\d+\/\d+|aliexpress.*\/item\/|shein.*product|magazineluiza.*\/p\/|kabum.*\/produto\/|banggood|tiktok.*\/video\//i.test(finalUrl);
 const blocked=$('form[action*="validateCaptcha"],#captchacharacters,iframe[src*="captcha"]').length||/robot check|access denied|verifique se você é humano|captcha|página não encontrada/i.test(title);
 if(blocked)throw new ProductError('STORE_BLOCKED','A loja exige verificação ou bloqueou a leitura automática. Complete os dados manualmente.');
 if(!isProduct||!title||/^(amazon(\.com(\.br)?)?|shopee|mercado livre)$/i.test(title)){
  if(/tiktok/i.test(finalUrl))throw new ProductError('NO_PRODUCT_DATA','O TikTok exige login para ver o anúncio. Copie nome, preço e foto manualmente ou use link de vídeo (vt.tiktok.com).');
  throw new ProductError('NO_PRODUCT_DATA','Não encontrei dados públicos suficientes desse produto. Use o link direto ou preencha manualmente.');
 }
 if(isWallResult({name:title})&&!product&&!meta('product:price:amount'))throw new ProductError('NO_PRODUCT_DATA',/tiktok/i.test(finalUrl)?'O TikTok exibiu verificação (muro) em vez do produto. Use link de vídeo (vt.tiktok.com) ou preencha manualmente.':'A página exibiu verificação (muro) em vez do produto. Preencha manualmente.');
 const idMap=buildIdMap(product||{});
 const hint=readPrice(meta('product:price:amount')||meta('og:price:amount'))||0;
 const found=offersPrice(product?.offers,idMap,hint);
 const rawPrice=found?.price??(meta('product:price:amount')||meta('og:price:amount'));
 const currency=String(found?.currency||meta('product:price:currency')||meta('og:price:currency')||(/^\s*R\$/.test(String(rawPrice))?'BRL':'')).toUpperCase();
 const price=currency==='BRL'?readPrice(rawPrice):null;
 let social=null;
 try{
  const rawHtml=Buffer.isBuffer(html)?html.toString('utf8'):html;
  if(/meli\.la|mercadolivre\.com(\.br)?\/social|mercadolivre\.com\/social/i.test(finalUrl))social=extractMercadoLivreSocial(rawHtml);
 }catch{social=null;}
 const finalPrice=social?.price??price;
 const description=plain(typeof product?.description==='string'?product.description:(meta('og:description')||meta('description')),2000);
 const images=[product?.image].flat();
 const imageValue=typeof images[0]==='string'?images[0]:images[0]?.url||images[0]?.contentUrl;
 let imageUrl='';
 try{const candidate=new URL(imageValue||meta('og:image:secure_url')||meta('og:image'),finalUrl).href;if(allowedImageUrl(candidate))imageUrl=candidate;}catch{}
 const store=detectStore('',finalUrl);
 const warnings=[];
 if(finalPrice===null)warnings.push('Preço em reais não encontrado com segurança. Informe o valor atual manualmente.');
 if(!description)warnings.push('Descrição não disponível na página.');
 if(!imageUrl)warnings.push('Imagem não disponível para importação.');
 warnings.push('Confira os dados antes de salvar. A leitura da página não verifica seu vínculo de afiliado.');
 return {title,description,price:finalPrice,imageUrl,warnings,store,sourceHost:new URL(finalUrl).hostname,fetchedAt:new Date().toISOString()};
}
async function fetchShopeePdp(ids,{fetchImpl=fetch,timeoutMs=10000}={}){
 const api=`https://shopee.com.br/api/v4/pdp/get_pc?shopid=${encodeURIComponent(ids.shopid)}&itemid=${encodeURIComponent(ids.itemid)}`;
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const r=await fetchImpl(api,{headers:{'User-Agent':'PropagaOfertas/1.0 (public product metadata preview)','Accept':'application/json','Referer':'https://shopee.com.br/','X-Requested-With':'XMLHttpRequest'},signal:controller.signal});
  if(!r.ok)return null;
  return parseShopeeItem(await r.json().catch(()=>null));
 }catch{return null;}
 finally{clearTimeout(timer);}
}
async function fetchTiktokOembed(rawUrl,{fetchImpl=fetch,timeoutMs=10000}={}){
 const item=tiktokItemId(rawUrl);
 if(!item)return null;
 const canonical=`https://www.tiktok.com/@/${item.kind}/${item.id}`;
 for(let attempt=0;attempt<2;attempt++){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const r=await fetchImpl('https://www.tiktok.com/oembed?url='+encodeURIComponent(canonical),{headers:{'User-Agent':'PropagaOfertas/1.0 (public product metadata preview)'},signal:controller.signal});
   clearTimeout(timer);
   if(r.status===429){await new Promise(r2=>setTimeout(r2,1200));continue;}
   if(!r.ok)break;
   const j=await r.json().catch(()=>null);
   if(j&&(j.title||j.thumbnail_url))return {title:cleanTitle(String(j.title||'')),description:j.author_name?`Vídeo de @${j.author_name}`:'',price:null,imageUrl:j.thumbnail_url||'',store:'TikTok Shop',partial:true};
   break;
  }catch{clearTimeout(timer);break;}
 }
 return null;
}
function partialResult({store,notice}){
 return {title:'',description:'',price:null,imageUrl:'',store,warnings:[notice,'Confira os dados antes de salvar. A leitura da página não verifica seu vínculo de afiliado.'],partial:true,sourceHost:'',fetchedAt:new Date().toISOString()};
}
export async function importProduct(url,options={}){
 const {resolver,transport,timeoutMs,fetchImpl=fetch,shopeeFetcher=fetchShopeeOfficial,shopeePdpFetcher=fetchShopeePdp,tiktokFetcher=fetchTiktokOembed,env=process.env}=options;
 const host=String(new URL(url).hostname||'').toLowerCase();
 if(/shopee\.|shope\.ee/i.test(host)){
  try{
   const ids=parseShopeeIds(url);
   if(ids){
    try{
     const off=await shopeeFetcher(ids,{fetchImpl,env});
     if(off&&off.name&&off.price){
      let imageUrl='';
      try{if(off.image&&allowedImageUrl(off.image))imageUrl=off.image;}catch{}
      return {title:plain(cleanTitle(off.name),300),description:'',price:readPrice(off.price),imageUrl,store:'Shopee',warnings:['Dados da API oficial Shopee. Confira o preço e seu vínculo de afiliado antes de salvar.'],sourceHost:host,fetchedAt:new Date().toISOString()};
     }
    }catch{}
    try{
     const pdp=await shopeePdpFetcher(ids,{fetchImpl});
     if(pdp&&pdp.name&&pdp.price){
      let imageUrl='';
      try{if(pdp.image&&allowedImageUrl(pdp.image))imageUrl=pdp.image;}catch{}
      return {title:plain(pdp.name,300),description:'',price:readPrice(pdp.price),imageUrl,store:'Shopee',warnings:['Dados da página Shopee. Confira o preço e seu vínculo de afiliado antes de salvar.'],sourceHost:host,fetchedAt:new Date().toISOString()};
     }
    }catch{}
   }
  }catch{}
  try{
   const page=await fetchProductPage(url,{resolver,transport,timeoutMs});
   return extractProduct(page.html,page.finalUrl);
  }catch(error){
   if(error instanceof ProductError)throw error;
   return partialResult({store:'Shopee',notice:'A Shopee bloqueou a leitura automática deste anúncio. Complete nome, preço e foto manualmente.'});
  }
 }
 if(/tiktok\./i.test(host)){
  try{
   const page=await fetchProductPage(url,{resolver,transport,timeoutMs});
   try{
    const g=extractProduct(page.html,page.finalUrl);
    if(g&&(g.price||(g.title&&g.imageUrl)))return {...g,store:g.store||'TikTok Shop'};
   }catch{}
  }catch{}
  try{
   const tk=await tiktokFetcher(url,{fetchImpl});
   if(tk&&tk.title)return {...tk,warnings:['TikTok: preenchi título e foto do vídeo. Complete o preço manualmente.','Confira os dados antes de salvar. A leitura da página não verifica seu vínculo de afiliado.'],sourceHost:host,fetchedAt:new Date().toISOString()};
  }catch{}
  return partialResult({store:'TikTok Shop',notice:'O TikTok bloqueou a leitura automática (muro de verificação deles). Complete nome, preço e foto manualmente.'});
 }
 const page=await fetchProductPage(url,{resolver,transport,timeoutMs});
 return extractProduct(page.html,page.finalUrl);
}
