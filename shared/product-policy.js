export const productDomains=['amazon.com.br','amazon.com','amzn.to','a.co','shopee.com.br','shope.ee','mercadolivre.com.br','mercadolivre.com','mercadolibre.com','meli.la','tiktok.com','aliexpress.com','magazineluiza.com.br','magazineluiza.com','magalu.com','shein.com.br','shein.com','banggood.com','kabum.com.br'];
export const imageDomains=['media-amazon.com','ssl-images-amazon.com','images-amazon.com','mlstatic.com','shopee.com.br','shopee.com','shopeemobile.com','shp.ee','susercontent.com','tiktokcdn.com','alicdn.com','magazineluiza.com.br','magazineluiza.com','kabum.com.br','shein.com','banggood.com'];
// Import automático com reservas em cascata (melhor forma existente):
// Shopee oficial -> PDP -> genérico; TikTok genérico -> oEmbed -> parcial;
// demais lojas via JSON-LD/Open Graph. Kwai segue manual (sem parser validado).
export const autoImportPlatforms=['Amazon','Shopee','Mercado Livre','TikTok Shop','AliExpress','Magalu','SHEIN','Banggood','KaBuM!'];
export const manualOnlyPlatforms=['Kwai'];
export const supportsAutoImport=platform=>autoImportPlatforms.includes(platform);
const belongs=(host,domains)=>domains.some(domain=>{const h=String(host||'').toLowerCase();const d=String(domain||'').toLowerCase();return h===d||h.endsWith('.'+d);});
export function supportedProductUrl(value){
 try{const u=new URL(value);return u.protocol==='https:'&&(!u.port||u.port==='443')&&!u.username&&!u.password&&belongs(u.hostname.toLowerCase(),productDomains);}catch{return false;}
}
export function detectStore(rawUrl,finalUrl){
 const hay=`${rawUrl||''} ${finalUrl||''}`.toLowerCase();
 if(/mercadolivre|mercadolibre|meli\.la/.test(hay))return 'Mercado Livre';
 if(/shopee|shope\.ee/.test(hay))return 'Shopee';
 if(/tiktok/.test(hay))return 'TikTok Shop';
 if(/amazon|amzn|a\.co/.test(hay))return 'Amazon';
 if(/aliexpress/.test(hay))return 'AliExpress';
 if(/magazineluiza|magalu/.test(hay))return 'Magalu';
 if(/shein/.test(hay))return 'SHEIN';
 if(/banggood/.test(hay))return 'Banggood';
 if(/kabum/.test(hay))return 'KaBuM!';
 return '';
}
export function allowedImageUrl(value){
 if(typeof value!=='string'||value.length>2000)return false;
 try{const u=new URL(value);return u.protocol==='https:'&&(!u.port||u.port==='443')&&!u.username&&!u.password&&belongs(u.hostname.toLowerCase(),imageDomains);}catch{return false;}
}
