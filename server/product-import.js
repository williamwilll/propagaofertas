import {load,loadBuffer} from 'cheerio';
import {allowedImageUrl} from '../shared/product-policy.js';
import {fetchProductPage,ProductError} from './product-fetch.js';

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
function productsFrom($){
 const products=[];let count=0;
 const visit=(value,depth=0)=>{
  if(!value||typeof value!=='object'||depth>10||++count>2000)return;
  if(Array.isArray(value)){for(const item of value)visit(item,depth+1);return;}
  const types=[value['@type']].flat();
  if(types.some(t=>typeof t==='string'&&/(^|[/#])Product$/.test(t)))products.push(value);
  for(const [key,child] of Object.entries(value))if(key!=='offers')visit(child,depth+1);
 };
 $('script[type="application/ld+json"]').each((_i,node)=>{try{visit(JSON.parse($(node).text()));}catch{}});
 return products;
}
export function extractProduct(html,finalUrl){
 const $=Buffer.isBuffer(html)?loadBuffer(html):load(html);
 const meta=key=>$('meta').filter((_i,node)=>($(node).attr('property')||$(node).attr('name'))?.toLowerCase()===key).first().attr('content')||'';
 const products=productsFrom($);
 const product=products.length===1?products[0]:null;
 const ogTitle=meta('og:title');
 const title=plain(product?.name||ogTitle||$('title').first().text(),300);
 const isProduct=!!product||meta('og:type').toLowerCase().includes('product')||!!meta('product:price:amount')||/\/dp\/[A-Z0-9]{10}|\/gp\/product\/[A-Z0-9]{10}|MLB-?\d{6,}|-i\.\d+\.\d+|\/product\/\d+\/\d+/i.test(finalUrl);
 const blocked=$('form[action*="validateCaptcha"],#captchacharacters,iframe[src*="captcha"]').length||/robot check|access denied|verifique se você é humano|captcha|página não encontrada/i.test(title);
 if(blocked)throw new ProductError('STORE_BLOCKED','A loja exige verificação ou bloqueou a leitura automática. Complete os dados manualmente.');
 if(!isProduct||!title||/^(amazon(\.com(\.br)?)?|shopee|mercado livre)$/i.test(title))throw new ProductError('NO_PRODUCT_DATA','Não encontrei dados públicos suficientes desse produto. Use o link direto ou preencha manualmente.');
 const offers=[product?.offers].flat().filter(v=>v&&typeof v==='object');
 const offer=offers.length===1&&!String(offers[0]['@type']).includes('AggregateOffer')?offers[0]:null;
 const rawPrice=offer?.price??(meta('product:price:amount')||meta('og:price:amount'));
 const currency=String(offer?.priceCurrency||meta('product:price:currency')||meta('og:price:currency')||(/^\s*R\$/.test(String(rawPrice))?'BRL':'')).toUpperCase();
 const price=currency==='BRL'?readPrice(rawPrice):null;
 const description=plain(product?.description||meta('og:description')||meta('description'),2000);
 const images=[product?.image].flat();
 const imageValue=typeof images[0]==='string'?images[0]:images[0]?.url||images[0]?.contentUrl;
 let imageUrl='';
 try{const candidate=new URL(imageValue||meta('og:image:secure_url')||meta('og:image'),finalUrl).href;if(allowedImageUrl(candidate))imageUrl=candidate;}catch{}
 const warnings=[];
 if(price===null)warnings.push('Preço em reais não encontrado com segurança. Informe o valor atual manualmente.');
 if(!description)warnings.push('Descrição não disponível na página.');
 if(!imageUrl)warnings.push('Imagem não disponível para importação.');
 warnings.push('Confira os dados antes de salvar. A leitura da página não verifica seu vínculo de afiliado.');
 return {title,description,price,imageUrl,warnings,sourceHost:new URL(finalUrl).hostname,fetchedAt:new Date().toISOString()};
}
export async function importProduct(url,options){const page=await fetchProductPage(url,options);return extractProduct(page.html,page.finalUrl);}
