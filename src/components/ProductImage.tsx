import {useEffect,useState} from 'react';
import {ImageOff} from 'lucide-react';
import {allowedImageUrl} from '../../shared/product-policy.js';
export function ProductImage({url,title,compact=false}:{url?:string;title:string;compact?:boolean}){
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[url]);
 return <div className={'flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--white)] '+(compact?'h-16 w-16':'h-40 w-full')}>
 {url&&allowedImageUrl(url)&&!failed?<img src={url} alt={title||'Imagem do produto'} referrerPolicy="no-referrer" loading="lazy" onError={()=>setFailed(true)} className="h-full w-full object-contain p-2"/>:<div className="flex items-center gap-2 text-xs text-[var(--muted)]"><ImageOff size={20}/>{!compact&&'Imagem indisponível'}</div>}
 </div>;
}
