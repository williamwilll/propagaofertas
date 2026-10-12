import {useRef,useState} from 'react';
import {Check,Copy,MessageSquare,X} from 'lucide-react';
import {composeOffer,type OfferData} from '../../shared/workflow.js';
import {Modal} from './Modal';
import {ProductImage} from './ProductImage';

interface MessagePreviewProps {offer:OfferData;onClose:()=>void}
export function MessagePreview({offer,onClose}:MessagePreviewProps){
 const [confirmed,setConfirmed]=useState(false);
 const [status,setStatus]=useState('');
 const [copying,setCopying]=useState(false);
 const [copied,setCopied]=useState(false);
 const text=composeOffer(offer);
 const fallback=useRef<HTMLTextAreaElement>(null);
 const copy=async()=>{
  if(!confirmed||copying)return;
  setCopying(true);setCopied(false);setStatus('');
  try{
   if(!navigator.clipboard?.writeText)throw new Error('Clipboard indisponível');
   await navigator.clipboard.writeText(text);
   setCopied(true);setStatus('Mensagem copiada. Nenhum envio foi realizado.');
  }catch{
   const details=fallback.current?.closest('details');
   if(details)details.open=true;
   fallback.current?.focus();fallback.current?.select();
   setStatus('Não foi possível copiar automaticamente. O texto foi selecionado: use Ctrl+C ou a opção Copiar do seu dispositivo.');
  }finally{setCopying(false);}
 };
 return <Modal labelledBy="message-title" onClose={onClose}><section className="space-y-5 p-5 sm:p-7">
  <header className="flex items-start justify-between gap-3"><div><p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">Compartilhamento manual</p><h2 id="message-title" className="flex items-center gap-2 text-xl font-bold"><MessageSquare size={22}/>Prévia da mensagem</h2></div><button type="button" onClick={onClose} aria-label="Fechar prévia" className="rounded p-2 hover:bg-[var(--soft)]"><X size={20}/></button></header>
  <p className="rounded-lg bg-[var(--warning)] p-4 text-xs leading-6 text-[var(--amber)]">Link manual, não verificado. Confira o produto, o preço e se o link pertence à sua conta antes de compartilhar. Copiar não envia nem adiciona à fila.</p>
  <div className="rounded-xl bg-[var(--soft)] p-4 sm:p-6"><div className="space-y-4 rounded-lg rounded-tl-none border border-[var(--border)] bg-[var(--white)] p-5">{offer.imageUrl&&<ProductImage url={offer.imageUrl} title={offer.title}/>}<p className="whitespace-pre-wrap break-words text-sm leading-7">{text}</p><p className="mt-4 text-right text-[10px] text-[var(--muted)]">Prévia · não enviada</p></div></div>
  {offer.imageUrl&&<p className="text-xs text-[var(--muted)]">Copiar mensagem copia somente o texto, não a imagem.</p>}
  <details className="text-xs"><summary className="cursor-pointer font-semibold">Texto para seleção manual</summary><textarea ref={fallback} aria-label="Texto da oferta para copiar manualmente" readOnly value={text} rows={7} className="mt-3 w-full rounded-md border border-[var(--border)] p-3 leading-6"/></details>
  <label className="flex items-start gap-3 text-xs leading-6"><input type="checkbox" className="mt-1.5 shrink-0" checked={confirmed} onChange={e=>{setConfirmed(e.target.checked);setCopied(false);setStatus('');}}/>Conferi o produto e meu link. Compartilharei apenas com destinatários que autorizaram receber ofertas.</label>
  {status&&<p role="status" className="rounded-lg bg-[var(--soft)] p-3 text-xs leading-6">{status}</p>}
  <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4"><button className="rounded-md border border-[var(--border)] px-4 py-2.5 text-xs font-semibold" onClick={onClose}>Voltar às ofertas</button><button disabled={!confirmed||copying} onClick={()=>void copy()} className="inline-flex items-center gap-2 rounded-md bg-[var(--green)] px-4 py-2.5 text-xs font-semibold text-[var(--white)] disabled:cursor-not-allowed disabled:opacity-45">{copied?<Check size={16}/>:<Copy size={16}/>} {copying?'Copiando…':copied?'Copiada':'Copiar mensagem'}</button></footer>
 </section></Modal>;
}
