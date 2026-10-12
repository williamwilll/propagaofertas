import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Link,LoaderCircle,Search,X} from 'lucide-react';
import type {OfferData} from '../../shared/workflow.js';
import {supportedProductUrl} from '../../shared/product-policy.js';
import {Modal} from './Modal';
import {ProductImage} from './ProductImage';

interface OfferEditorProps {initial:OfferData;editing:boolean;onClose:()=>void;onSave:(offer:OfferData)=>Promise<void>}
type Imported=Partial<Pick<OfferData,'title'|'description'|'price'|'imageUrl'>>;
const control='w-full rounded-md border border-[var(--border)] bg-[var(--white)] px-3 py-2.5 text-sm focus:border-[var(--green)]';
function Field({label,children}:{label:string;children:ReactNode}){return <label className="flex flex-col gap-2 text-xs font-semibold">{label}{children}</label>}
export function OfferEditor({initial,editing,onClose,onSave}:OfferEditorProps){
 const [draft,setDraft]=useState<OfferData>({...initial,imageUrl:initial.imageUrl||''});
 const [searching,setSearching]=useState(false);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 const [importMessage,setImportMessage]=useState('');
 const [warnings,setWarnings]=useState<string[]>([]);
 const [needsReview,setNeedsReview]=useState(false);
 const [reviewed,setReviewed]=useState(false);
 const [retry,setRetry]=useState(0);
 const imported=useRef<Imported>({});
 const generation=useRef(0);
 const initialUrl=useRef(initial.url);
 const cancellation=useRef<AbortController|null>(null);
 const update=(patch:Partial<OfferData>)=>{setReviewed(false);setDraft(d=>({...d,...patch}));};
 const changeUrl=(value:string)=>{
  generation.current++;cancellation.current?.abort();
  setImportMessage('');setWarnings([]);setNeedsReview(false);setReviewed(false);setError('');
  setSearching(supportedProductUrl(value.trim()));
  const previousImported=imported.current;imported.current={};
  setDraft(d=>{
   const next={...d,url:value};
   if(previousImported.title===d.title)next.title='';
   if(previousImported.description===d.description)next.description='';
   if(previousImported.price===d.price)next.price=0;
   if(previousImported.imageUrl===d.imageUrl)next.imageUrl='';
   return next;
  });
 };
 useEffect(()=>{
  const url=draft.url.trim();
  const version=++generation.current;
  const controller=new AbortController();cancellation.current=controller;
  if((url===initialUrl.current&&retry===0)||!url){setSearching(false);return ()=>controller.abort();}
  if(!supportedProductUrl(url)){setSearching(false);setImportMessage('Busca automática disponível para Amazon, Shopee e Mercado Livre. Para outras lojas, preencha manualmente.');return ()=>controller.abort();}
  setSearching(true);setImportMessage('Buscando dados públicos do produto…');setWarnings([]);setReviewed(false);
  const timer=setTimeout(async()=>{
   try{
    const response=await fetch('/api/offers/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url}),signal:controller.signal});
    if(response.status===401){window.dispatchEvent(new Event('propagaofertas:session-expired'));return;}
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'Não foi possível buscar o produto.');
    if(controller.signal.aborted||generation.current!==version)return;
    setDraft(current=>{
     if(current.url.trim()!==url)return current;
     const next={...current};const values:Imported={};
     if(!current.title.trim()&&result.title){next.title=result.title;values.title=result.title;}
     if(!current.description.trim()&&result.description){next.description=result.description;values.description=result.description;}
     if(!current.price&&typeof result.price==='number'&&result.price>0){next.price=result.price;values.price=result.price;}
     if(!current.imageUrl&&result.imageUrl){next.imageUrl=result.imageUrl;values.imageUrl=result.imageUrl;}
     imported.current={...imported.current,...values};return next;
    });
    setNeedsReview(true);setImportMessage('Dados encontrados. Preenchi os campos vazios; suas edições e seu link foram preservados.');setWarnings(result.warnings||[]);
   }catch(e){if(!controller.signal.aborted&&generation.current===version)setImportMessage((e instanceof Error?e.message:'A busca falhou.')+' Você pode completar os campos manualmente.');}
   finally{if(!controller.signal.aborted&&generation.current===version)setSearching(false);}
  },800);
  return ()=>{clearTimeout(timer);controller.abort();};
 },[draft.url,retry]);
 return <Modal labelledBy="offer-title" onClose={()=>{if(!saving)onClose();}}><form className="w-full space-y-5 p-5 sm:p-7" onSubmit={async e=>{
  e.preventDefault();if(searching||saving)return;if(needsReview&&!reviewed){setError('Revise os dados importados antes de salvar.');return;}
  setSaving(true);setError('');try{await onSave({...draft,url:draft.url.trim()});}catch(e){setError(e instanceof Error?e.message:'Não foi possível salvar.');}finally{setSaving(false);}
 }}>
  <header className="flex items-center justify-between gap-3"><div><h2 id="offer-title" className="text-xl font-bold">{editing?'Editar oferta':'Nova oferta'}</h2><p className="mt-1 text-xs leading-6 text-[var(--muted)]">Cole o link. Revise o produto. Salve sua oferta.</p></div><button disabled={saving} type="button" aria-label="Fechar" onClick={onClose} className="rounded p-2 hover:bg-[var(--soft)]"><X size={20}/></button></header>
  {error&&<p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
  <section className="space-y-3 rounded-lg bg-[var(--soft)] p-4">
   <Field label="Seu link de afiliado (HTTPS)"><input autoFocus type="url" required maxLength={2000} className={control} value={draft.url} onChange={e=>changeUrl(e.target.value)} placeholder="https://…"/></Field>
   <div className="flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-1 text-[11px] text-[var(--muted)]"><Link size={13}/>Amazon · Shopee · Mercado Livre</p><button type="button" disabled={searching||saving||!supportedProductUrl(draft.url.trim())} onClick={()=>setRetry(n=>n+1)} className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--white)] px-3 py-2 text-xs font-semibold disabled:opacity-50">{searching?<LoaderCircle size={14} className="animate-spin"/>:<Search size={14}/>} {searching?'Buscando…':'Buscar produto'}</button></div>
   {importMessage&&<p role="status" className="text-xs leading-6">{importMessage}</p>}
  </section>
  {warnings.length>0&&<ul className="space-y-1 rounded-lg bg-[var(--warning)] p-3 text-xs leading-5 text-[var(--amber)]">{warnings.map((w,i)=><li key={i}>{w}</li>)}</ul>}
  {draft.imageUrl&&<div className="space-y-2"><ProductImage url={draft.imageUrl} title={draft.title}/><div className="flex items-center justify-between"><span className="text-[11px] text-[var(--muted)]">Imagem externa da loja · pode ficar indisponível</span><button type="button" onClick={()=>update({imageUrl:''})} className="text-xs underline">Remover imagem</button></div></div>}
  <div className="grid gap-4 sm:grid-cols-[1fr_150px]"><Field label="Nome do produto"><input required maxLength={300} className={control} value={draft.title} onChange={e=>update({title:e.target.value})}/></Field><Field label="Preço (R$)"><input type="number" min="0.01" max="10000000" step="0.01" required className={control} value={draft.price||''} onChange={e=>update({price:Number(e.target.value)})}/></Field></div>
  <Field label="Descrição"><textarea rows={3} maxLength={2000} className={control} value={draft.description} onChange={e=>update({description:e.target.value})}/></Field>
  {needsReview&&<label className="flex items-start gap-3 text-xs leading-6"><input required type="checkbox" className="mt-1.5" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>Revisei o produto, o preço e o meu link antes de salvar.</label>}
  <p className="text-xs leading-6 text-[var(--muted)]">A busca lê informações públicas quando a loja permite. Não converte links de afiliado, não confirma comissão e não envia mensagens.</p>
  <button disabled={saving||searching||(needsReview&&!reviewed)} className="w-full rounded-md bg-[var(--green)] px-4 py-3 text-xs font-semibold text-[var(--white)] disabled:opacity-45">{saving?'Salvando…':'Salvar oferta'}</button>
 </form></Modal>;
}
