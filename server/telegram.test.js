import test from 'node:test';
import assert from 'node:assert/strict';
import {telegramDestino,telegramGetMe,telegramGetChat,createTelegramSender,telegramTest,telegramCreds} from './telegram.js';
import {createApp} from './app.js';

const okFetch = routes => async (url, options = {}) => {
  const method = String(url).split('/').pop();
  const body = JSON.parse(options.body || '{}');
  const handler = routes[method];
  if (!handler) return {ok: false, status: 404, json: async () => ({ok: false, description: 'not found'})};
  return handler(body);
};
const ok = result => ({ok: true, status: 200, json: async () => ({ok: true, result})});

test('destino telegram: @canal e IDs, resto não', () => {
  assert.equal(telegramDestino('@ofertas123'), '@ofertas123');
  assert.equal(telegramDestino('-1001234567890'), '-1001234567890');
  assert.equal(telegramDestino('1234567'), null);
  assert.equal(telegramDestino('Grupo da Família'), null);
  assert.equal(telegramDestino('5511999999'), null);
  assert.equal(telegramDestino(''), null);
  assert.equal(telegramCreds({TELEGRAM_BOT_TOKEN: 'x'}).token, 'x');
  assert.equal(telegramCreds({}), null);
});

test('getMe/getChat propagam erro da API', async () => {
  const fetchImpl = okFetch({getMe: () => ok({id: 1, username: 'lojabot', first_name: 'Loja'})});
  const me = await telegramGetMe('t', {fetchImpl});
  assert.equal(me.username, '@lojabot');
  const errFetch = async () => ({ok: false, status: 401, json: async () => ({ok: false, description: 'Unauthorized'})});
  await assert.rejects(() => telegramGetMe('bad', {fetchImpl: errFetch}), /Unauthorized/);
});

test('sender: foto com legenda, teto 1024 e fallback texto', async () => {
  const calls = [];
  const fetchImpl = okFetch({
    sendPhoto: body => { calls.push(['photo', body]); return ok(true); },
    sendMessage: body => { calls.push(['message', body]); return ok(true); }
  });
  const send = createTelegramSender({token: 't', fetchImpl});
  await send({destino: '@canal', text: 'Oi', offer: {imageUrl: 'https://x/y.jpg'}});
  assert.equal(calls[0][0], 'photo');
  assert.equal(calls[0][1].caption, 'Oi');
  const long = 'x'.repeat(2000);
  await send({destino: '@canal', text: long, offer: {imageUrl: 'https://x/y.jpg'}});
  assert.ok(calls[1][1].caption.length <= 1024);
  assert.equal(calls[2][0], 'message');
  await send({destino: '@canal', text: 'Só texto'});
  assert.equal(calls[3][0], 'message');
  await assert.rejects(() => send({destino: 'Grupo X', text: 'oi'}), /inválido/);
  await assert.rejects(() => send({destino: '@canal', text: '  '}), /vazia/);
  await assert.rejects(() => telegramTest('t', 'Grupo X', {fetchImpl}), /@canal/);
});

test('dispatch roteia @canal para o Telegram e grupo para o WhatsApp', async () => {
  const prev = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  const sentTg = [];
  const sentWa = [];
  const fakeBaileys = {
    status: () => ({provider: 'baileys', connected: true, me: 'x', hasQR: false, qr: null, needsRepair: false, lastError: ''}),
    listGroups: async () => [{id: '9@g.us', name: 'Grupo VIP', size: 2}],
    sendJob: async job => { sentWa.push(job); },
    start: async () => {},
    stop: () => {}
  };
  const tgFetch = async (url, options = {}) => {
    const body = JSON.parse(options.body || '{}');
    if (String(url).endsWith('/getMe')) return {ok: true, status: 200, json: async () => ({ok: true, result: {id: 1, username: 'b', first_name: 'B'}})};
    if (String(url).endsWith('/getChat')) return {ok: true, status: 200, json: async () => ({ok: true, result: {id: body.chat_id, title: 'Canal', type: 'channel'}})};
    if (String(url).endsWith('/sendPhoto') || String(url).endsWith('/sendMessage')) { sentTg.push(body); return {ok: true, status: 200, json: async () => ({ok: true, result: true})}; }
    return {ok: false, status: 404, json: async () => ({ok: false})};
  };
  const {app, db, ready} = createApp(':memory:', {baileysProvider: fakeBaileys, telegramFetch: tgFetch});
  await ready;
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (path, method = 'GET', body) => {
    const r = await fetch(base + path, {method, headers: body ? {'Content-Type': 'application/json'} : undefined, body: body ? JSON.stringify(body) : undefined});
    return {status: r.status, data: await r.json()};
  };
  try {
    await call('/offers', 'POST', {title: 'Fone', price: 99, url: 'https://example.com/f', description: ''});
    const flow = {name: 'F', account: 'A', source: 'S', sourceConsent: true, platform: 'Amazon', distributor: 'D', destinations: ['Grupo VIP', '@canalofertas'], destinationConsent: true, days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', interval: 1, dailyLimit: 5, mode: 'manual'};
    const created = await call('/flows', 'POST', flow);
    const id = created.data.id;
    assert.equal((await call(`/flows/${id}/check`)).data.ready, true);
    assert.equal((await call(`/flows/${id}/activate`, 'POST', {})).status, 200);
    const disp = await call(`/flows/${id}/dispatch`, 'POST', {});
    assert.equal(disp.data.queued, 2);
    await db.query('UPDATE send_queue SET scheduled_for=?', [new Date(Date.now() - 1000).toISOString()]);
    const proc = await call('/queue/process', 'POST', {});
    assert.equal(proc.data.sent, 2);
    assert.equal(sentTg.length, 1);
    assert.equal(sentTg[0].chat_id, '@canalofertas');
    assert.equal(sentWa.length, 1);
    assert.equal(sentWa[0].destino, '9@g.us');
  } finally { await new Promise(r => server.close(r)); await db.close(); if (prev === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = prev; }
});
test('rotas telegram: sem token 409, com mock ok', async () => {
  const {app, db, ready} = createApp(':memory:', {
    telegramFetch: okFetch({
      getMe: () => ok({id: 7, username: 'bot', first_name: 'B'}),
      sendMessage: () => ok(true)
    })
  });
  await ready;
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const st = await (await fetch(base + '/telegram/status')).json();
    assert.equal(st.configured, false);
    assert.equal((await fetch(base + '/telegram/test', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'})).status, 409);
  } finally { await new Promise(r => server.close(r)); await db.close(); }
  const prev = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  const app2 = createApp(':memory:', {
    telegramFetch: okFetch({
      getMe: () => ok({id: 7, username: 'bot', first_name: 'B'}),
      sendMessage: () => ok(true)
    })
  });
  await app2.ready;
  const server2 = await new Promise(resolve => { const s = app2.app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base2 = `http://127.0.0.1:${server2.address().port}/api`;
  try {
    const st2 = await (await fetch(base2 + '/telegram/status')).json();
    assert.equal(st2.configured, true);
    assert.equal(st2.username, '@bot');
    const t2 = await (await fetch(base2 + '/telegram/test', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({chatId: '@canal'})})).json();
    assert.equal(t2.ok, true);
  } finally { await new Promise(r => server2.close(r)); await app2.db.close(); if (prev === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = prev; }
});
