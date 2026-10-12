import {mkdirSync, rmSync, readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {composeOffer} from '../shared/workflow.js';

// Provedor Baileys (aparelho vinculado) — port ESM da melhor forma existente.
// Sessão em disco (./data/wpp-session); sobrevive a restart local.
// Em produção sem volume, a sessão é volátil — prefira Cloud API.
const TERMINAL_CODES = new Set([401, 403, 411, 500]);

function errCode(err) {
  try {
    if (!err) return 0;
    if (err.output?.statusCode) return Number(err.output.statusCode) || 0;
    if (err.statusCode) return Number(err.statusCode) || 0;
    if (err.code && /^\d+$/.test(String(err.code))) return Number(err.code);
    if (err.data?.statusCode) return Number(err.data.statusCode) || 0;
  } catch {}
  return 0;
}

export function createBaileysProvider({sessionDir = resolve('data/wpp-session'), baileysImpl = null, qrImpl = null, logger = null} = {}) {
  let sock = null;
  let connected = false;
  let connecting = false;
  let connectingSince = 0;
  let qrDataUrl = null;
  let qrAt = 0;
  let pairCode = null;
  let pairCodeAt = 0;
  let me = null;
  let lastError = '';
  let lastErrorAt = 0;
  let retries = 0;
  let needsRepair = false;
  let retryTimer = null;
  let waVersionUsed = '';
  let baileysVersion = '';
  const bootAt = Date.now();

  async function lazyDeps() {
    const b = baileysImpl || await import('@whiskeysockets/baileys');
    try { baileysVersion = (await import('@whiskeysockets/baileys/package.json', {with: {type: 'json'}})).default?.version || ''; } catch {}
    const q = qrImpl || (await import('qrcode'));
    return {b, QRCode: q.QRCode || q.default || q};
  }

  function scheduleRetry() {
    if (retryTimer) return;
    const wait = [5000, 15000, 30000, 60000, 300000][Math.min(retries, 4)];
    retryTimer = setTimeout(() => { retryTimer = null; start().catch(() => {}); }, wait);
    retryTimer.unref?.();
  }

  async function start() {
    if (connecting && Date.now() - connectingSince < 90000 && sock) return;
    if (connecting && Date.now() - connectingSince >= 90000) {
      connecting = false;
      try { sock?.ws?.close(); } catch {}
      sock = null;
    }
    if (connecting || sock) return;
    connecting = true;
    connectingSince = Date.now();
    try {
      mkdirSync(sessionDir, {recursive: true});
      const {b, QRCode} = await lazyDeps();
      const {state, saveCreds} = await b.useMultiFileAuthState(sessionDir);
      let version;
      try {
        const v = await Promise.race([b.fetchLatestBaileysVersion(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout versão')), 10000))]);
        version = v.version;
        waVersionUsed = Array.isArray(version) ? version.join('.') : String(version || '');
      } catch {}
      const logImpl = logger || {level: 'silent', child: () => logImpl, info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, trace: () => {}};
      sock = b.makeWASocket({
        auth: state,
        version,
        logger: logImpl,
        printQRInTerminal: false,
        browser: ['PropagaOfertas', 'Chrome', '1.0'],
        syncFullHistory: false,
        markOnlineOnConnect: false
      });
      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('connection.update', async u => {
        const {connection, lastDisconnect, qr} = u || {};
        if (qr) {
          try { qrDataUrl = await QRCode.toDataURL(qr, {width: 280, margin: 1}); qrAt = Date.now(); } catch { qrDataUrl = null; }
        }
        if (connection === 'open') {
          connected = true; connecting = false;
          qrDataUrl = null; pairCode = null; pairCodeAt = 0;
          lastError = ''; lastErrorAt = 0; retries = 0; needsRepair = false;
          me = (sock.user && (sock.user.id || sock.user.jid)) || null;
        } else if (connection === 'close') {
          connected = false;
          const code = errCode(lastDisconnect?.error);
          retries++;
          lastErrorAt = Date.now();
          if (TERMINAL_CODES.has(code)) {
            needsRepair = true; connecting = false; sock = null;
            lastError = `Sessão inválida (código ${code}). Desvincular e parear de novo.`;
          } else {
            lastError = `Desconectado (código ${code || '?'}) — tentando reconectar (tentativa ${retries})`;
            sock = null; connecting = false;
            scheduleRetry();
          }
        }
      });
    } catch (e) {
      connecting = false;
      lastError = e instanceof Error ? e.message.slice(0, 200) : 'falha ao iniciar';
      lastErrorAt = Date.now();
    }
  }

  function status() {
    let sessionFiles = 0;
    try { sessionFiles = readdirSync(sessionDir).length; } catch {}
    return {
      provider: 'baileys', connected, me,
      hasQR: !!qrDataUrl, qr: qrDataUrl,
      qrAgeSec: qrDataUrl && qrAt ? Math.max(0, Math.round((Date.now() - qrAt) / 1000)) : null,
      pairCode, pairCodeAgeSec: pairCode && pairCodeAt ? Math.max(0, Math.round((Date.now() - pairCodeAt) / 1000)) : null,
      needsRepair, lastError, lastErrorAt: lastErrorAt || null, retries,
      baileysVersion, waVersionUsed, uptimeSec: Math.round((Date.now() - bootAt) / 1000),
      sessionFiles
    };
  }

  async function listGroups() {
    if (!sock || !connected) throw new Error('WhatsApp não conectado. Pareie o QR Code primeiro.');
    const all = await sock.groupFetchAllParticipating();
    return Object.values(all || {})
      .map(g => ({id: g.id, name: g.subject || g.id, size: (g.participants || []).length}))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
  }

  // Sender compatível com processDueQueue: job {destino, text?, offer?}
  async function sendJob(job) {
    if (!sock || !connected) throw new Error('WhatsApp não conectado');
    const jid = String(job.destino || '');
    if (!/^[0-9-]+\@g\.us$/.test(jid)) throw new Error('Grupo inválido. Escolha o grupo no painel.');
    const text = String(job.text || (job.offer ? composeOffer(job.offer) : '')).slice(0, 4096);
    if (!text) throw new Error('Mensagem vazia');
    const imageUrl = job.offer?.imageUrl || job.imageUrl || '';
    try {
      if (imageUrl) {
        await sock.sendMessage(jid, {image: {url: imageUrl}, caption: text});
        return;
      }
    } catch {}
    await sock.sendMessage(jid, {text});
  }

  async function sendTest(jid) {
    await sendJob({destino: jid, text: 'Mensagem de teste do PropagaOfertas. Nenhuma oferta foi enviada.'});
    return {ok: true};
  }

  async function logout() {
    try { await sock?.logout(); } catch {}
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    sock = null; connected = false; connecting = false;
    qrDataUrl = null; pairCode = null; pairCodeAt = 0; me = null;
    lastError = ''; lastErrorAt = 0; retries = 0; needsRepair = false;
    try { rmSync(sessionDir, {recursive: true, force: true}); } catch {}
    setTimeout(() => { start().catch(() => {}); }, 1500).unref?.();
    return {ok: true};
  }

  async function requestPairCode(phone) {
    const clean = String(phone || '').replace(/\D/g, '');
    if (clean.length < 10 || clean.length > 15) throw new Error('Informe o número com DDI+DDD, só dígitos (ex: 5511999999999)');
    if (!sock || typeof sock.requestPairingCode !== 'function') throw new Error('Sessão não iniciada. Aguarde o QR aparecer antes.');
    const code = await sock.requestPairingCode(clean);
    if (!code) throw new Error('O WhatsApp não devolveu o código. Tente de novo.');
    pairCode = String(code).replace('-', '');
    pairCodeAt = Date.now();
    return pairCode.slice(0, 4) + '-' + pairCode.slice(4);
  }

  function stop() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    try { sock?.ws?.close(); } catch {}
    sock = null; connecting = false;
  }

  return {start, status, listGroups, sendJob, sendTest, logout, requestPairCode, stop, isConnected: () => connected};
}
