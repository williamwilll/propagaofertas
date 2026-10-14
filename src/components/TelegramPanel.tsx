import {useCallback, useEffect, useState} from 'react';
import {Send, RefreshCw, MessageCircle} from 'lucide-react';

async function api(path: string, method = 'GET', body?: unknown) {
  const r = await fetch('/api' + path, {method, headers: body ? {'Content-Type': 'application/json'} : undefined, body: body ? JSON.stringify(body) : undefined});
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) window.dispatchEvent(new Event('propagaofertas:session-expired'));
  if (!r.ok) throw new Error(data.error || 'Não foi possível concluir.');
  return data;
}

export function TelegramPanel() {
  const [status, setStatus] = useState<any>(null);
  const [chatId, setChatId] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    setStatus(await api('/telegram/status'));
  }, []);

  useEffect(() => { load().catch(e => setError((e as Error).message)); }, [load]);

  const btn = 'inline-flex items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-[var(--white)] px-4 py-2.5 text-xs font-semibold transition hover:bg-[var(--soft)] disabled:opacity-45';
  const primary = btn + ' !bg-[var(--green)] !text-[var(--white)] !border-[var(--green)] hover:opacity-90';
  const muted = 'text-xs leading-6 text-[var(--muted)]';
  const control = 'w-full rounded-md border border-[var(--border)] bg-[var(--white)] px-3 py-2.5 text-sm focus:border-[var(--green)]';

  return (
    <div className="space-y-5">
      <p className="text-sm leading-7">Bot oficial do Telegram: posta ofertas com foto em grupos e canais. Sem risco de bloqueio de aparelho.</p>
      {error && <p role="alert" className="rounded-lg bg-[var(--warning)] p-3 text-xs leading-6 text-[var(--amber)]">{error}</p>}
      {result && <p role="status" className="rounded-lg bg-[var(--soft)] p-3 text-xs leading-6">{result}</p>}
      {status && (
        <div className="rounded-lg bg-[var(--soft)] p-4 text-sm">
          {status.configured
            ? <p className="font-semibold"><MessageCircle size={15} className="mr-1 inline"/>Bot {status.username || status.name || 'conectado'}{status.error ? '' : ' ativo'}</p>
            : <p>Bot não configurado no servidor.</p>}
          {status.error && <p className="mt-1 text-xs text-[var(--danger)]">{status.error}</p>}
        </div>
      )}
      <ol className="list-decimal space-y-1 pl-5 text-sm leading-7">
        <li>No Telegram, fale com <strong>@BotFather</strong> → /newbot → guarde o token.</li>
        <li>Adicione o bot como <strong>administrador</strong> no grupo/canal.</li>
        <li>No servidor, defina <strong>TELEGRAM_BOT_TOKEN</strong> e reinicie.</li>
        <li>Nos fluxos, use <strong>@nomedocanal</strong> ou o ID como destino.</li>
      </ol>
      <form className="flex flex-wrap gap-2" onSubmit={e => {
        e.preventDefault(); if (!chatId.trim() || busy) return;
        setBusy(true); setError(''); setResult('');
        api('/telegram/test', 'POST', {chatId: chatId.trim()})
          .then(() => setResult('Teste enviado para ' + chatId.trim() + '.'))
          .catch(err => setError(err instanceof Error ? err.message : 'Falha no envio.'))
          .finally(() => setBusy(false));
      }}>
        <input aria-label="Canal ou grupo para teste" placeholder="@seucanal ou -100..." className={control + ' min-w-0 flex-1'} value={chatId} onChange={e => setChatId(e.target.value)}/>
        <button disabled={busy || !chatId.trim()} className={primary}><Send size={14}/>Testar envio</button>
      </form>
      <div className="border-t border-[var(--border)] pt-4">
        <button disabled={busy} className={btn} onClick={() => void load()}><RefreshCw size={14}/>Atualizar</button>
      </div>
      <p className={muted}>O token fica só no servidor. Destinos @canal vão para o Telegram; nomes de grupo vão para o WhatsApp.</p>
    </div>
  );
}
