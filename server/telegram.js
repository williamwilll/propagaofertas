import {composeOffer} from '../shared/workflow.js';

// Telegram Bot API (oficial, HTTPS, sem sessão/QR): o bot posta em grupos e
// canais onde foi adicionado como administrador. Token via env (servidor).
// Destinos Telegram: @nomedocanal ou ID (-100... / número). Demais destinos
// seguem para o WhatsApp. Nenhuma dependência nova (fetch nativo).

const API = 'https://api.telegram.org';

export function telegramCreds(env = process.env) {
  const token = String(env.TELEGRAM_BOT_TOKEN || '').trim();
  return token ? {token} : null;
}

// Reconhece destino Telegram: @canal ou ID de grupo/canal (-100...).
// Números positivos sem @ são telefones (Cloud WhatsApp), nunca Telegram.
export function telegramDestino(value) {
  const s = String(value || '').trim();
  if (/^@[A-Za-z0-9_]{5,}$/.test(s)) return s;
  if (/^-\d{5,15}$/.test(s)) return s;
  return null;
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  timer.unref?.();
  return {signal: controller.signal, done: () => clearTimeout(timer)};
}

async function callApi(token, method, params, {fetchImpl = fetch, timeoutMs = 10000} = {}) {
  const t = withTimeout(timeoutMs);
  try {
    const r = await fetchImpl(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(params),
      signal: t.signal
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) throw new Error(j?.description || `Telegram: HTTP ${r.status}`);
    return j.result;
  } finally { t.done(); }
}

export async function telegramGetMe(token, opts = {}) {
  const me = await callApi(token, 'getMe', {}, opts);
  return {id: me.id, username: me.username ? '@' + me.username : '', name: me.first_name || ''};
}

export async function telegramGetChat(token, chatId, opts = {}) {
  const chat = await callApi(token, 'getChat', {chat_id: chatId}, opts);
  return {id: String(chat.id), title: chat.title || chat.username || String(chat.id), type: chat.type || ''};
}

export function telegramCaption(offer) {
  return composeOffer(offer);
}

export function createTelegramSender({token, fetchImpl = fetch} = {}) {
  return async job => {
    const chatId = telegramDestino(job.destino);
    if (!chatId) throw new Error('Destino Telegram inválido. Use @canal ou o ID.');
    const text = String(job.text || (job.offer ? telegramCaption(job.offer) : '')).trim();
    if (!text) throw new Error('Mensagem vazia.');
    const imageUrl = job.offer?.imageUrl || job.imageUrl || '';
    // Legenda de foto no Telegram: teto de 1024; mensagem: 4096.
    if (imageUrl) {
      const caption = text.length > 1024 ? text.slice(0, 1023).trimEnd() + '…' : text;
      try {
        await callApi(token, 'sendPhoto', {chat_id: chatId, photo: imageUrl, caption}, {fetchImpl});
        if (text.length > 1024) await callApi(token, 'sendMessage', {chat_id: chatId, text: text.slice(1024)}, {fetchImpl});
        return;
      } catch {}
    }
    await callApi(token, 'sendMessage', {chat_id: chatId, text: text.slice(0, 4096)}, {fetchImpl});
  };
}

export async function telegramTest(token, chatId, {fetchImpl = fetch} = {}) {
  const id = telegramDestino(chatId);
  if (!id) throw new Error('Informe @canal ou o ID do grupo/canal.');
  await callApi(token, 'sendMessage', {chat_id: id, text: 'Mensagem de teste do PropagaOfertas. Nenhuma oferta foi enviada.'}, {fetchImpl});
  return {ok: true};
}
