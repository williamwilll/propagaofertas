import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';

// WhatsApp Cloud API — base com fila em DB (sem Redis) para tier free single-instance.
// Produção com escala deve trocar enqueue/process por BullMQ+Redis; a interface abaixo é compatível.

export function verifySignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret || typeof signatureHeader !== 'string') return false;
  const prefix = 'sha256=';
  if (!signatureHeader.startsWith(prefix)) return false;
  const hex = signatureHeader.slice(prefix.length);
  if (!/^[a-f0-9]{64}$/i.test(hex)) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const received = Buffer.from(hex, 'hex');
  if (expected.length !== received.length) return false;
  try { return timingSafeEqual(expected, received); } catch { return false; }
}

export function parseWebhookPayload(payload) {
  const messages = [];
  const statuses = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      for (const m of value?.messages || []) {
        messages.push({
          remoteId: String(m.id || ''),
          from: String(m.from || ''),
          type: String(m.type || ''),
          text: m.text?.body || m.interactive?.body?.text || '',
          timestampMs: Number(value?.metadata?.timestamp || m.timestamp) * 1000 || Date.now(),
          raw: m
        });
      }
      for (const s of value?.statuses || []) statuses.push(s);
    }
  }
  return {messages, statuses};
}

export function isStale(timestampMs, now = Date.now()) {
  return !Number.isFinite(timestampMs) || now - timestampMs > 24 * 60 * 60 * 1000;
}

// Enfileira envio respeitando janela do fluxo. Não envia aqui — worker processa.
export async function enqueueFlowSends(db, flow, offers) {
  const now = new Date();
  const day = now.getDay();
  if (!flow.days.includes(day)) return {queued: 0, reason: 'fora-da-janela'};
  const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  if (!(flow.start <= hhmm && hhmm <= flow.end)) return {queued: 0, reason: 'fora-da-janela'};
  const destinations = [...new Set((flow.destinations || []).map(d => String(d || '').trim()).filter(Boolean))].slice(0, 50);
  const picked = offers.slice(0, Math.max(1, Math.min(flow.dailyLimit || 1, 50)));
  let queued = 0;
  for (const destino of destinations) {
    for (const [i, offer] of picked.entries()) {
      const scheduledFor = new Date(now.getTime() + (queued * (flow.interval || 1) * 60 * 1000)).toISOString();
      await db.enqueueSend({id: randomUUID(), flowId: flow.id, offerId: offer.id, destino, scheduledFor});
      queued++;
      void i;
    }
  }
  return {queued};
}

// Worker: processa vencidos com concorrência limitada e backoff. Sender injetável para testes.
export async function processDueQueue(db, sender, options = {}) {
  const {now = new Date().toISOString(), limit = 10, maxAttempts = 5} = options;
  const due = await db.listDueQueue(now, limit);
  const result = {processed: 0, sent: 0, failed: 0, dead: 0};
  for (const job of due) {
    result.processed++;
    try {
      await sender(job);
      await db.markQueue(job.id, 'sent', (job.attempts || 0) + 1, null);
      result.sent++;
    } catch (error) {
      const attempts = (job.attempts || 0) + 1;
      const dead = attempts >= maxAttempts;
      await db.markQueue(job.id, dead ? 'dead' : 'pending', attempts, error instanceof Error ? error.message.slice(0, 300) : 'falha');
      if (dead) result.dead++; else result.failed++;
    }
  }
  return result;
}

export function createGraphSender({token, phoneNumberId, version = 'v21.0', fetchImpl = fetch, timeoutMs = 15000}) {
  return async job => {
    const text = String(job.text || job.destino || '').slice(0, 4096);
    if (!text) throw new Error('mensagem vazia');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
        method: 'POST',
        signal: controller.signal,
        headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({messaging_product: 'whatsapp', to: job.destino, type: 'text', body: text})
      });
      if (res.status === 429) throw new Error('rate-limited');
      if (!res.ok) throw new Error('graph-' + res.status);
    } finally { clearTimeout(timer); }
  };
}
