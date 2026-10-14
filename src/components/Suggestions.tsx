import {useState} from 'react';
import {Check, Copy, X, Search, MessageSquare} from 'lucide-react';
import {keywordVariants, messageVariants} from '../../shared/hunt.js';
import type {OfferData} from '../../shared/workflow.js';
import {Modal} from './Modal';

export function Suggestions({offer, onClose}: {offer: OfferData & {id: string}; onClose: () => void}) {
  const keys = keywordVariants(offer.title + ' ' + (offer.description || '').split(' ').slice(0, 6).join(' '));
  const messages = messageVariants(offer);
  const [copied, setCopied] = useState('');
  const copy = async (text: string, id: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('sem clipboard');
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(''), 2000);
    } catch { setCopied(''); }
  };
  const muted = 'text-xs leading-6 text-[var(--muted)]';
  const btn = 'inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--white)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--soft)]';
  return (
    <Modal labelledBy="suggest-title" onClose={onClose}>
      <div className="w-full space-y-6 p-5 sm:p-7">
        <header className="flex items-center justify-between gap-3">
          <div><h2 id="suggest-title" className="text-xl font-bold">Sugestões de divulgação</h2><p className={muted}>Geradas dos dados reais da oferta. Nada aqui inventa preço ou desconto.</p></div>
          <button type="button" aria-label="Fechar" onClick={onClose} className="rounded p-2 hover:bg-[var(--soft)]"><X size={20}/></button>
        </header>
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Search size={16}/>Buscar como</h3>
          <div className="flex flex-wrap gap-2">
            {keys.map(k => (
              <button key={k} className={btn} onClick={() => void copy(k, 'k:' + k)} aria-label={'Copiar busca ' + k}>
                {copied === 'k:' + k ? <Check size={14}/> : <Copy size={14}/>}{k}
              </button>
            ))}
          </div>
        </section>
        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><MessageSquare size={16}/>Mensagens (3 tons)</h3>
          {messages.map(m => (
            <div key={m.tone} className="space-y-2 rounded-lg border border-[var(--border)] p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wide">{m.label}</span>
                <button className={btn} onClick={() => void copy(m.text, 'm:' + m.tone)}>{copied === 'm:' + m.tone ? <><Check size={14}/>Copiada</> : <><Copy size={14}/>Copiar</>}</button>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm leading-7">{m.text}</p>
            </div>
          ))}
        </section>
      </div>
    </Modal>
  );
}
