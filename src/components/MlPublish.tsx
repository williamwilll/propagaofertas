import {useState} from 'react';
import {X, Wand2, ExternalLink} from 'lucide-react';
import {Modal} from './Modal';

async function api(path: string, method = 'GET', body?: unknown) {
  const r = await fetch('/api' + path, {method, headers: body ? {'Content-Type': 'application/json'} : undefined, body: body ? JSON.stringify(body) : undefined});
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) window.dispatchEvent(new Event('propagaofertas:session-expired'));
  if (!r.ok) throw new Error(data.error || 'Não foi possível concluir.');
  return data;
}

interface Offer {id: string; title: string; price: number; url: string; description: string; imageUrl?: string}

export function MlPublish({offer, onClose, onDone}: {offer: Offer; onClose: () => void; onDone: () => void}) {
  const [price, setPrice] = useState(offer.price || 0);
  const [quantity, setQuantity] = useState(1);
  const [categoryId, setCategoryId] = useState('');
  const [listingType, setListingType] = useState('gold_special');
  const [busy, setBusy] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);

  const control = 'w-full rounded-md border border-[var(--border)] bg-[var(--white)] px-3 py-2.5 text-sm focus:border-[var(--green)]';
  const btn = 'inline-flex items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-[var(--white)] px-4 py-2.5 text-xs font-semibold transition hover:bg-[var(--soft)] disabled:opacity-45';
  const primary = btn + ' !bg-[var(--green)] !text-[var(--white)] !border-[var(--green)] hover:opacity-90';
  const muted = 'text-xs leading-6 text-[var(--muted)]';

  return (
    <Modal labelledBy="ml-publish-title" onClose={onClose}>
      <div className="w-full space-y-5 p-5 sm:p-7">
        <header className="flex items-center justify-between gap-3">
          <div><h2 id="ml-publish-title" className="text-xl font-bold">Anunciar no Mercado Livre</h2><p className={muted}>Cria um anúncio na sua conta de vendedor a partir desta oferta.</p></div>
          <button type="button" aria-label="Fechar" onClick={onClose} className="rounded p-2 hover:bg-[var(--soft)]"><X size={20}/></button>
        </header>
        {error && <p role="alert" className="rounded-lg bg-[var(--warning)] p-3 text-xs leading-6 text-[var(--amber)]">{error}</p>}
        {result
          ? <div className="space-y-3 rounded-lg bg-[var(--soft)] p-4 text-sm">
              <p className="font-semibold">Anúncio criado: {result.id}</p>
              {result.permalink && <a className="inline-flex items-center gap-1 text-xs font-semibold underline" href={result.permalink} target="_blank" rel="noopener noreferrer">Abrir anúncio <ExternalLink size={13}/></a>}
              {result.warnings?.map((w: string, i: number) => <p key={i} className={muted}>{w}</p>)}
              <div><button className={primary} onClick={() => { onDone(); onClose(); }}>Concluir</button></div>
            </div>
          : <div className="space-y-4">
              <p className="break-words text-sm font-semibold">{offer.title}</p>
              {!offer.imageUrl && <p className="rounded-lg bg-[var(--warning)] p-3 text-xs text-[var(--amber)]">Sem imagem: o ML exige ao menos uma foto. Edite a oferta antes.</p>}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-2 text-xs font-semibold">Preço (R$)<input type="number" min="0.01" step="0.01" className={control} value={price || ''} onChange={e => setPrice(Number(e.target.value))}/></label>
                <label className="flex flex-col gap-2 text-xs font-semibold">Quantidade<input type="number" min="1" max="100000" step="1" className={control} value={quantity} onChange={e => setQuantity(Number(e.target.value))}/></label>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-2 text-xs font-semibold">Categoria (ID ex: MLB1051)<input className={control} placeholder="MLB..." value={categoryId} onChange={e => setCategoryId(e.target.value)}/></label>
                <button disabled={detecting || busy} className={btn} onClick={() => {
                  setDetecting(true); setError('');
                  api('/ml/predict', 'POST', {title: offer.title}).then(r => setCategoryId(r.categoryId)).catch(e => setError(e instanceof Error ? e.message : 'Falha.')).finally(() => setDetecting(false));
                }}><Wand2 size={14}/>{detecting ? 'Detectando…' : 'Detectar'}</button>
              </div>
              <label className="flex flex-col gap-2 text-xs font-semibold">Tipo de anúncio
                <select className={control} value={listingType} onChange={e => setListingType(e.target.value)}>
                  <option value="gold_special">Clássico (comissão na venda)</option>
                  <option value="gold_pro">Premium (mensalidade + comissão menor)</option>
                  <option value="free">Grátis (alcance menor)</option>
                </select>
              </label>
              <p className={muted}>Título limitado a 60 caracteres no ML. Taxas e regras são do Mercado Livre — confira o anúncio após publicar.</p>
              <button disabled={busy || !offer.imageUrl} className={primary + ' w-full'} onClick={() => {
                if (!confirm('Publicar este anúncio na sua conta do Mercado Livre?')) return;
                setBusy(true); setError('');
                api('/ml/publish', 'POST', {offerId: offer.id, categoryId: categoryId.trim() || undefined, price: price || undefined, quantity, listingType})
                  .then(setResult).catch(e => setError(e instanceof Error ? e.message : 'Falha.')).finally(() => setBusy(false));
              }}>{busy ? 'Publicando…' : 'Publicar anúncio'}</button>
            </div>}
      </div>
    </Modal>
  );
}
