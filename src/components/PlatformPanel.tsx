import {useCallback, useEffect, useState} from 'react';
import {Plug, RefreshCw, FlaskConical} from 'lucide-react';

async function api(path: string, method = 'GET', body?: unknown) {
  const r = await fetch('/api' + path, {method, headers: body ? {'Content-Type': 'application/json'} : undefined, body: body ? JSON.stringify(body) : undefined});
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) window.dispatchEvent(new Event('propagaofertas:session-expired'));
  if (!r.ok) throw new Error(data.error || 'Não foi possível concluir.');
  return data;
}

const HELP: Record<string, {about: string; steps: string[]}> = {
  'Shopee': {about: 'API oficial de afiliados (dados exatos + link com tracking). Sem chaves, o importador usa PDP e página.', steps: ['No portal de afiliados Shopee, gere App ID e App Secret.', 'No servidor, defina SHOPEE_APP_ID e SHOPEE_APP_SECRET e reinicie.', 'Volte aqui e clique em Testar agora.']},
  'Amazon': {about: 'Tag de afiliado verificada nas suas ofertas. Com as chaves, a PA-API valida o anúncio.', steps: ['Use seus links com ?tag=SUA-TAG-20 em todas as ofertas.', 'Opcional (validação completa): defina AMAZON_PARTNER_TAG, AMAZON_ACCESS_KEY e AMAZON_SECRET_KEY no servidor.', 'Clique em Testar agora.']},
  'Mercado Livre': {about: 'API pública para conferir anúncios; com sua conta conectada, publica ofertas como anúncios.', steps: ['Cadastre ofertas com o link do anúncio (contendo MLB123…).', 'Clique em Testar agora — sem configuração.', 'Para publicar: crie o app, conecte a conta abaixo e use Anunciar na oferta.']},
  'TikTok': {about: 'Leitura parcial oficial (oEmbed): título e foto de vídeos. Preço sempre manual.', steps: ['Prefira links de vídeo (vt.tiktok.com) aos da loja.', 'Clique em Testar agora.']},
  'Kwai': {about: 'Sem API pública: cadastro e envio manuais com o texto da oferta.', steps: ['Cadastre título, preço e link manualmente.', 'Compartilhe pela prévia da oferta.']}
};

export function PlatformPanel({platform}: {platform: string}) {
  const [status, setStatus] = useState<any>(null);
  const [ml, setMl] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const help = HELP[platform] || {about: '', steps: []};

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
    <div className="space-y-5">
      <p className="text-sm leading-7">{help.about}</p>
      {error && <p role="alert" className="rounded-lg bg-[var(--warning)] p-3 text-xs leading-6 text-[var(--amber)]">{error}</p>}
      {status && (
        <div className="rounded-lg bg-[var(--soft)] p-4 text-sm">
          <p><strong>Modo:</strong> {status.mode === 'api' ? 'API oficial' : status.mode === 'tag' ? 'Tag verificada' : status.mode === 'publica' ? 'API pública' : status.mode === 'parcial' ? 'Parcial' : status.mode === 'manual' ? 'Manual' : 'Desligada'} · <strong>Ofertas:</strong> {status.offers ?? 0}</p>
          {status.needs?.length > 0 && <p className={muted}>Variáveis no servidor: {status.needs.join(', ')}</p>}
        </div>
      )}
      <ol className="list-decimal space-y-1 pl-5 text-sm leading-7">{help.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      {platform === 'Mercado Livre' && (
        <div className="space-y-3 rounded-lg border border-[var(--border)] p-4">
          <h3 className="text-sm font-semibold">Conta de vendedor (para publicar anúncios)</h3>
          {ml && ml.redirectUri && <p className={muted}>Registre este retorno no seu app em developers.mercadolivre.com.br → Redirect URI: <span className="break-all font-mono">{ml.redirectUri}</span></p>}
          <p className="text-sm">{ml ? (ml.connected ? `Conectada${ml.userId ? ' (usuário ' + ml.userId + ')' : ''}.` : 'App configurado, conta não conectada.') : 'Verificando…'}</p>
          <div className="flex flex-wrap gap-2">
            {ml && !ml.connected && ml.configured !== false && (
              <button disabled={busy} className={primary} onClick={() => {
                setBusy(true); setError('');
                api('/ml/auth-url').then(r => window.open(r.url, '_blank', 'noopener')).catch(e => setError(e instanceof Error ? e.message : 'Falha.')).finally(() => setBusy(false));
              }}>Conectar conta</button>
            )}
            {ml?.connected && (
              <button disabled={busy} className={btn} onClick={() => {
                if (!confirm('Desconectar a conta do Mercado Livre?')) return;
                setBusy(true); api('/ml/disconnect', 'POST', {}).then(() => void load()).catch(e => setError(e instanceof Error ? e.message : 'Falha.')).finally(() => setBusy(false));
              }}>Desconectar</button>
            )}
            <button disabled={busy} className={btn} onClick={() => void load().catch(e => setError((e as Error).message))}>Verificar conexão</button>
          </div>
        </div>
      )}
      {result && (
        <div className="rounded-lg bg-[var(--soft)] p-4 text-sm">
          {result.manual
            ? <p>{result.message}</p>
            : <><p className="font-semibold">Verificado: {result.title || result.tag || 'ok'}</p>
              {result.price != null && <p>Preço na plataforma: {Number(result.price).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</p>}
              {result.asin && <p>ASIN: {result.asin}</p>}
              {result.id && <p>ID: {result.id}</p>}
              {result.tracking != null && <p>Link com tracking: {result.tracking ? 'sim' : 'não'}</p>}
              {result.message && <p className={muted}>{result.message}</p>}</>}
        </div>
      )}
      <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-4">
        <button disabled={busy} className={primary} onClick={() => { setBusy(true); setError(''); setResult(null); api(`/integrations/${platform}/test`, 'POST', {}).then(setResult).catch(e => setError((e as Error).message)).finally(() => { setBusy(false); void load(); }); }}><FlaskConical size={14}/>{busy ? 'Testando…' : 'Testar agora'}</button>
        <button disabled={busy} className={btn} onClick={() => void load()}><RefreshCw size={14}/>Atualizar</button>
      </div>
      <p className={muted}><Plug size={13} className="mr-1 inline"/>Credenciais ficam só no servidor. A página nunca as exibe.</p>
    </div>
  );
}
