export const productDomains=['amazon.com.br','amazon.com','amzn.to','a.co','shopee.com.br','shope.ee','mercadolivre.com.br','mercadolivre.com','mercadolibre.com','meli.la'];
export const imageDomains=['media-amazon.com','ssl-images-amazon.com','images-amazon.com','mlstatic.com','shopee.com.br','shopee.com','shopeemobile.com','shp.ee'];
const belongs=(host,domains)=>domains.some(domain=>host===domain||host.endsWith('.'+domain));
export function supportedProductUrl(value){
 try{const u=new URL(value);return u.protocol==='https:'&&(!u.port||u.port==='443')&&!u.username&&!u.password&&belongs(u.hostname,productDomains);}catch{return false;}
}
export function allowedImageUrl(value){
 if(typeof value!=='string'||value.length>2000)return false;
 try{const u=new URL(value);return u.protocol==='https:'&&(!u.port||u.port==='443')&&!u.username&&!u.password&&belongs(u.hostname,imageDomains);}catch{return false;}
}
