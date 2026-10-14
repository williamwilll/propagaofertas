import {useCallback, useEffect, useState} from 'react';
import {Plug, RefreshCw, FlaskConical, Check, Link2} from 'lucide-react';

async function api(path: string, method = 'GET', body?: unknown) {
  const r = await fetch('/api' + path, {method, headers: body ? {'Content-Type': 'application/json'} : undefined, body: body ? JSON.stringify(body) : undefined});
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) window.dispatchEvent(new Event('propagaofertas:session-expired'));
  if (!r.ok) throw new Error(data.error || 'Não foi possível concluir.');
  return data;
}

const HELP: Record<string, {about: string; ready: string; steps: string[]}> = {
  'Shopee': {about: 'Traz dados exatos do produto e o seu link com tracking.', ready: 'Já funciona sem chave: puxe seus produtos e use o seu link.', steps: ['Com chave: seus produtos importam com o link de afiliado pronto.', 'Sem chave: o app tenta as páginas da loja e preenche o que conseguir.', 'Para tudo exato: cole suas chaves abaixo e clique em Testar.']},
  'Amazon': {about: 'Confere sua tag de afiliado nas ofertas.', ready: 'Sem chave, apenas confere se o seu link tem sua tag.', steps: ['Sem chave: clico em Testar e vejo se sua tag está nos seus links.', 'Com chave completa: confirmo o produto direto na Amazon.', 'Para validar tudo: cole suas chaves abaixo.']},
  'Mercado Livre': {about: 'Confere seus anúncios; com a conta conectada, publica ofertas no seu perfil.', ready: 'Sem chaves, só confere se o anúncio existe.', steps: ['Cole suas duas chaves do app aqui embaixo.', 'Depois clique em Conectar conta e autorize.', 'Use Anunciar em cada oferta.']},
  'TikTok': {about: 'Pega título e foto de vídeos. Preço você escreve.', ready: 'Sem chaves, testa com suas ofertas.', steps: ['Prefira links de vídeo (vt.tiktok.com).', 'Clique em Testar.']},
  'Kwai': {about: 'Você escreve título, preço e link e compartilha.', ready: 'Não usa chave: comece a divulgar agora.', steps: ['Cadastre a oferta com seu link.', 'Use as Sugestões e a Prévia para copiar e enviar.']}
};

const FIELDS: Record<string, {name: string; key: string; placeholder: string}[]> = {
  'Shopee': [
    {name: 'App ID', key: 'shopee_app_id', placeholder: 'ex: 123456'},
    {name: 'App Secret', key: 'shopee_app_secret', placeholder: 'cole aqui'}
  ],
  'Amazon': [
    {name: 'Access Key', key: 'amazon_access', placeholder: 'cole aqui'},
    {name: 'Secret Key', key: 'amazon_secret', placeholder: 'cole aqui'}
  ],
  'Mercado Livre': [
    {name: 'App ID', key: 'ml_app_id', placeholder: 'ex: 123456'},
    {name: 'App Secret', key: 'ml_app_secret', placeholder: 'cole aqui'}
  ],
  'Telegram': [{name: 'Token do bot', key: 'telegram_token', placeholder: 'ex: 123:ABC...'}]
};

export function PlatformPanel({platform}: {platform: string}) {
  const [status, setStatus] = useState<any>(null);
  const [ml, setMl] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const help = HELP[platform] || {about: '', ready: '', steps: []};
  const fields = FIELDS[platform] || [];

  const load = useCallback(async () => {
    const s = await api('/integrations/status');
    setStatus(s[platform]);
    if (platform === 'Mercado Livre') {
      try { setMl(await api('/ml/status')); } catch { setMl(null); }
    }
  }, [platform]);

  useEffect(() => { load().catch(e => setError((e as Error).message)); }, [load]);

  const btn = 'inline-flex items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-[var(--white)] px-4 py-2.5 text-xs font-semibold transition hover:bg-[var(--soft)] disabled:opacity-45';
  const primary = btn + ' !bg-[var(--green)] !text-[var(--white)] !border-[var(--green)] hover:opacity-90';
  const muted = 'text-xs leading-6 text-[var(--muted)]';

  return (
    <div className="space-y-4">
      <p className="text-sm leading-7">{help.about}</p>
      {error && <p role="alert" className="rounded-lg bg-[var(--warning)] p-3 text-xs leading-6 text-[var(--amber)]">{error}</p>}
      {status && (
        <div className="rounded-lg bg-[var(--soft)] p-4 text-sm">
          <p>{help.ready}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{status.offers ?? 0} oferta(s) desta loja</p>
        </div>
      )}
      <ol className="list-decimal space-y-1 pl-5 text-sm leading-7">{help.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      {fields.length > 0 && (
        <div className="space-y-3 rounded-lg border border-[var(--border)] p-4">
          <h3 className="text-sm font-semibold">Suas chaves (cole aqui)</h3>
          {fields.map(f => (
            <label key={f.key} className="flex flex-col gap-2 text-xs font-semibold">
              {f.name}
              <input aria-label={f.name} type="password" autoComplete="off" placeholder={f.placeholder} className="w-full rounded-md border border-[var(--border)] bg-[var(--white)] px-3 py-2.5 text-sm" value={secrets[f.key] || ''} onChange={e => setSecrets(s => ({...s, [f.key]: e.target.value}))}/>
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} className={btn} onClick={() => {
              setBusy(true); setError('');
              Promise.all(fields.filter(f => secrets[f.key]?.trim()).map(f => api('/integrations/secret', 'POST', {key: f.key, value: secrets[f.key].trim()})))
                .then(() => { setSecrets({}); void load(); })
                .catch(e => setError(e instanceof Error ? e.message : 'Falha.'))
                .finally(() => setBusy(false));
            }}>Salvar</button>
          </div>
        </div>
      )}
      {platform === 'Mercado Livre' && ml && (
        <div className="space-y-2 rounded-lg border border-[var(--border)] p-4">
          <p className="text-sm">{ml.connected ? 'Conta conectada. Pronto para publicar.' : 'Para publicar, conecte sua conta:'}</p>
          <p className="break-all rounded bg-[var(--white)] px-2 py-1 font-mono text-[11px]">{ml.redirectUri}</p>
          <div className="flex flex-wrap gap-2">
            {!ml.connected && (
              <button disabled={busy} className={btn} onClick={() => {
                setBusy(true); setError('');
                api('/ml/auth-url').then(r => window.open(r.url, '_blank', 'noopener')).catch(e => setError(e instanceof Error ? e.message : 'Falha.')).finally(() => setBusy(false));
              }}><Link2 size={14}/>Conectar conta</button>
            )}
            {ml.connected && <p className="text-xs font-semibold text-[var(--green)]"><Check size={14} className="mr-1 inline"/>Conectada</p>}
          </div>
        </div>
      )}
      {result && (
        <div className="space-y-1 rounded-lg bg-[var(--soft)] p-4 text-sm">
          <p className="font-semibold">Tudo certo: {result.title || result.tag || 'ok'}</p>
          {result.price != null && <p>Preço: {Number(result.price).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</p>}
          {result.asin && <p>ASIN: {result.asin}</p>}
          {result.id && <p>ID: {result.id}</p>}
          {result.tracking != null && <p>Link com tracking: {result.tracking ? 'sim' : 'não'}</p>}
          {result.message && <p className={muted}>{result.message}</p>}
        </div>
      )}
      <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-4">
        <button disabled={busy} className={primary} onClick={() => {
          setBusy(true); setError(''); setResult(null);
          api(`/integrations/${platform}/test`, 'POST', {}).then(setResult).catch(e => setError(e instanceof Error ? e.message : 'Falha.')).finally(() => { setBusy(false); void load(); });
        }}><FlaskConical size={14}/>{busy ? 'Testando…' : 'Testar'}</button>
        <button disabled={busy} className={btn} onClick={() => void load()}><RefreshCw size={14}/>Atualizar</button>
      </div>
      <p className={muted}><Plug size={13} className="mr-1 inline"/>Chaves ficam salvas só no servidor deste app. A página nunca as mostra de volta.</p>
    </div>
  );
}
