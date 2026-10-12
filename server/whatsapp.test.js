import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {createApp} from './app.js';
import {verifySignature,parseWebhookPayload,isStale,processDueQueue} from './whatsapp.js';

const secret = 'segredo-de-teste-1234567890';
const sign = body => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

async function setup(options = {}) {
  const {app, db, ready} = createApp(':memory:', {
    whatsappVerifyToken: 'verify-test',
    whatsappAppSecret: secret,
    whatsappToken: 'token-test',
    whatsappPhoneNumberId: '12345',
    ...options
  });
  await ready;
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {base, db, close: async () => { await new Promise(r => server.close(r)); await db.close(); }};
}

test('assinatura HMAC rejeita corpo adulterado e formato inválido', () => {
  const body = Buffer.from(JSON.stringify({object: 'whatsapp_business_account'}));
  assert.equal(verifySignature(body, sign(body), secret), true);
  assert.equal(verifySignature(body, sign(Buffer.from('outro')), secret), false);
  assert.equal(verifySignature(body, 'sha256=zzz', secret), false);
  assert.equal(verifySignature(body, null, secret), false);
  assert.equal(verifySignature(body, sign(body), ''), false);
});

test('webhook GET verifica challenge apenas com token correto', async () => {
  const ctx = await setup();
  try {
    const ok = await fetch(ctx.base + '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-test&hub.challenge=ABC123');
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), 'ABC123');
    const bad = await fetch(ctx.base + '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=ABC');
    assert.equal(bad.status, 403);
  } finally { await ctx.close(); }
});

test('webhook POST exige assinatura, é idempotente e ignora objeto estranho', async () => {
  const ctx = await setup();
  try {
    const payload = {object: 'whatsapp_business_account', entry: [{changes: [{value: {messages: [{id: 'wamid-1', from: '5511999999999', type: 'text', text: {body: 'oi'}, timestamp: String(Math.floor(Date.now() / 1000))}]}}]}]};
    const raw = JSON.stringify(payload);
    const noSig = await fetch(ctx.base + '/api/whatsapp/webhook', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: raw});
    assert.equal(noSig.status, 401);
    const headers = {'Content-Type': 'application/json', 'x-hub-signature-256': sign(Buffer.from(raw))};
    const first = await fetch(ctx.base + '/api/whatsapp/webhook', {method: 'POST', headers, body: raw});
    assert.equal(first.status, 200);
    assert.equal((await first.json()).received, 1);
    const second = await fetch(ctx.base + '/api/whatsapp/webhook', {method: 'POST', headers, body: raw});
    assert.equal(second.status, 200);
    const rows = (await ctx.db.query('SELECT * FROM whatsapp_messages')).rows;
    assert.equal(rows.length, 1);
    const otherRaw = JSON.stringify({object: 'outro'});
    const other = await fetch(ctx.base + '/api/whatsapp/webhook', {method: 'POST', headers: {'Content-Type': 'application/json', 'x-hub-signature-256': sign(Buffer.from(otherRaw))}, body: otherRaw});
    assert.equal(other.status, 200);
    assert.equal((await other.json()).ignored, true);
  } finally { await ctx.close(); }
});

test('mensagem fora da janela de 24h é registrada mas não dispara fluxo', () => {
  assert.equal(isStale(Date.now() - 25 * 60 * 60 * 1000), true);
  assert.equal(isStale(Date.now()), false);
  assert.equal(parseWebhookPayload({entry: [{changes: [{value: {messages: [{id: 'a'}], statuses: [{id: 's'}]}}]}]}).messages.length, 1);
});

test('fila processa vencidos, conta tentativas e manda para dead após 5 falhas', async () => {
  const ctx = await setup();
  try {
    const now = new Date().toISOString();
    await ctx.db.enqueueSend({id: randomUUID(), flowId: 'f1', destino: '5511999999999', scheduledFor: now});
    await ctx.db.enqueueSend({id: randomUUID(), flowId: 'f1', destino: '5511888888888', scheduledFor: now});
    assert.equal(await ctx.db.queueDepth(), 2);
    let calls = 0;
    const flaky = async job => { calls++; if (job.destino.endsWith('8888')) throw new Error('graph-500'); };
    const r1 = await processDueQueue(ctx.db, flaky, {now, limit: 10, maxAttempts: 2});
    assert.equal(r1.sent, 1);
    assert.equal(r1.failed, 1);
    const r2 = await processDueQueue(ctx.db, flaky, {now, limit: 10, maxAttempts: 2});
    assert.equal(r2.dead, 1);
    assert.equal(await ctx.db.queueDepth(), 0);
    assert.equal(calls, 3);
  } finally { await ctx.close(); }
});

test('status exige login em produção (com host/https/origem válidos)', async () => {
  const {request: httpRequest} = await import('node:http');
  const {createSqliteStore} = await import('./store.js');
  const store = createSqliteStore(':memory:');
  const prod = {production: true, appOrigin: 'https://x.example.test', adminEmail: 'a@x.test', adminPassword: 'senha-forte-12345678', whatsappToken: 't', whatsappPhoneNumberId: 'n', store};
  const {app, ready} = createApp(':memory:', prod);
  await ready;
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const status = await new Promise((resolve, reject) => {
      const req = httpRequest({hostname: '127.0.0.1', port: server.address().port, path: '/api/whatsapp/status', method: 'GET', headers: {Host: 'x.example.test', 'X-Forwarded-Proto': 'https', Origin: 'https://x.example.test'}}, res => {
        let text = ''; res.setEncoding('utf8'); res.on('data', p => { text += p; }); res.on('end', () => resolve({status: res.statusCode, data: JSON.parse(text)}));
      });
      req.on('error', reject); req.end();
    });
    assert.equal(status.status, 401);
  } finally { await new Promise(r => server.close(r)); await store.close(); }
});
