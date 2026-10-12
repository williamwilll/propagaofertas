import {useCallback, useEffect, useState} from 'react';
import {Plug, RefreshCw, Send, LogOut, Smartphone} from 'lucide-react';

async function api(path: string, method = 'GET', body?: unknown) {
  const r = await fetch('/api' + path, {method, headers: body ? {'Content-Type': 'application/json'} : undefined, body: body ? JSON.stringify(body) : undefined});
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) window.dispatchEvent(new Event('propagaofertas:session-expired'));
  if (!r.ok) throw new Error(data.error || 'Não foi possível concluir.');
  return data;
}

interface Group {id: string; name: string; size: number}
interface Status {connected: boolean; me: string | null; hasQR: boolean; qr: string | null; qrAgeSec: number | null; pairCode: string | null; needsRepair: boolean; lastError: string}

export function BaileysPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api('/whatsapp/baileys/status');
      setStatus(s);
      if (s.connected) {
        try { setGroups((await api('/whatsapp/baileys/groups')).groups || []); } catch { setGroups([]); }
      } else setGroups([]);
    } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (status && !status.connected) {
      const t = setInterval(() => { void load(); }, 8000);
      return () => clearInterval(t);
    }
  }, [status, load]);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true); setError(''); setInfo('');
    try { await fn(); setInfo(ok); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const btn = 'inline-flex items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-[var(--white)] px-4 py-2.5 text-xs font-semibold transition hover:bg-[var(--soft)] disabled:opacity-45';
  const muted = 'text-xs leading-6 text-[var(--muted)]';

  return (
    <div className="space-y-5">
      {error && <p role="alert" className="rounded-lg bg-[var(--warning)] p-3 text-xs leading-6 text-[var(--amber)]">{error}</p>}
      {info && <p role="status" className="rounded-lg bg-[var(--soft)] p-3 text-xs leading-6">{info}</p>}
      {!status && <p className={muted}>Verificando aparelho…</p>}
      {status && status.connected && (
        <div className="rounded-lg bg-[var(--soft)] p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold"><Smartphone size={16}/>Conectado{status.me ? ` como ${status.me}` : ''}</p>
          <p className={muted}>Envios automáticos ativos para os grupos abaixo.</p>
        </div>
      )}
      {status && !status.connected && (
        <div className="space-y-3">
          {status.needsRepair && <p className="rounded-lg bg-[var(--warning)] p-3 text-xs leading-6 text-[var(--amber)]">Sessão inválida ({status.lastError}). Desvincular e parear de novo.</p>}
          {status.qr
            ? <div className="flex flex-col items-center gap-2"><img src={status.qr} alt="QR Code para vincular o WhatsApp" className="h-56 w-56 rounded-lg border border-[var(--border)]"/>{status.qrAgeSec != null && <span className={muted}>QR gerado há {status.qrAgeSec}s — atualiza sozinho</span>}</div>
            : <p className={muted}>Gerando QR Code… aguarde alguns segundos.</p>}
          <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); void run(async () => { const r = await api('/whatsapp/baileys/pair-code', 'POST', {phone}); setInfo('Código: ' + r.code + ' — digite no WhatsApp em Aparelhos vinculados.'); }, ''); }}>
            <input className="min-w-0 flex-1 rounded-md border border-[var(--border)] px-3 py-2.5 text-sm" placeholder="5511999999999 (plano B sem QR)" value={phone} onChange={e => setPhone(e.target.value)}/>
            <button disabled={busy || !phone} className={btn}>Gerar código</button>
          </form>
          {status.pairCode && <p className="text-sm font-bold tracking-widest">{status.pairCode}</p>}
        </div>
      )}
      {groups.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Grupos ({groups.length})</h3>
          {groups.map(g => (
            <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] py-3">
              <div className="text-sm font-semibold">{g.name}<p className={muted}>{g.size} participantes</p></div>
              <button disabled={busy} className={btn} onClick={() => void run(() => api('/whatsapp/baileys/test', 'POST', {groupId: g.id}), 'Teste enviado para ' + g.name + '.')}><Send size={14}/>Teste</button>
            </div>
          ))}
          <p className={muted}>Os nomes acima precisam ser iguais aos Destinos do fluxo para a ativação liberar.</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-4">
        <button disabled={busy} className={btn} onClick={() => void run(load, 'Atualizado.')}><RefreshCw size={14}/>Atualizar</button>
        <button disabled={busy} className={btn} onClick={() => { if (confirm('Desvincular o aparelho? Será preciso parear de novo.')) void run(() => api('/whatsapp/baileys/logout', 'POST', {}), 'Aparelho desvinculado.'); }}><LogOut size={14}/>Desvincular</button>
      </div>
      <p className={muted}><Plug size={13} className="mr-1 inline"/>Aparelho vinculado (Baileys). Risco de bloqueio pelo WhatsApp em uso intenso — respeite os intervalos do fluxo.</p>
    </div>
  );
}
