import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rmSync} from 'node:fs';
import {createApp} from './app.js';
import {createBaileysProvider} from './whatsapp-baileys.js';

const flow = {name: 'Fluxo', account: 'Conta 1', source: 'Origem', sourceConsent: true, platform: 'Amazon', distributor: 'Central', destinations: ['Destino A'], destinationConsent: true, days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', interval: 1, dailyLimit: 5, mode: 'manual'};
const offer = {title: 'Fone', price: 179.9, url: 'https://example.com/fone', description: 'Bom'};

function fakeBaileys(connected = true) {
  const sent = [];
  return {
    sent,
    status: () => ({provider: 'baileys', connected, me: connected ? '5511999999999@s.whatsapp.net' : null, hasQR: false, qr: null, needsRepair: false, lastError: ''}),
    listGroups: async () => { if (!connected) throw new Error('WhatsApp não conectado'); return [{id: '1@g.us', name: 'Destino A', size: 3}]; },
    sendJob: async job => { sent.push(job); },
    start: async () => {},
    stop: () => {}
  };
}

async function setup(baileysProvider) {
  const {app, db, ready} = createApp(':memory:', {baileysProvider});
  await ready;
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (path, method = 'GET', body) => {
    const r = await fetch(base + path, {method, headers: body ? {'Content-Type': 'application/json'} : undefined, body: body ? JSON.stringify(body) : undefined});
    return {status: r.status, data: await r.json()};
  };
  return {call, db, close: async () => { await new Promise(r => server.close(r)); await db.close(); }};
}

test('fluxo ativa quando WhatsApp conectado, enfileira e processa', async () => {
  const baileys = fakeBaileys(true);
  const ctx = await setup(baileys);
  try {
    await ctx.call('/offers', 'POST', offer);
    const created = await ctx.call('/flows', 'POST', flow);
    assert.equal(created.status, 201);
    const id = created.data.id;
    const check = await ctx.call(`/flows/${id}/check`);
    assert.equal(check.data.ready, true);
    assert.equal(check.data.pending, 0);
    const act = await ctx.call(`/flows/${id}/activate`, 'POST', {});
    assert.equal(act.status, 200);
    assert.equal((await ctx.call('/state')).data.flows[0].status, 'active');
    const disp = await ctx.call(`/flows/${id}/dispatch`, 'POST', {});
    assert.ok(disp.data.queued >= 1);
    const stats = await ctx.call('/queue/stats');
    assert.ok(stats.data.pending >= 1);
    const proc = await ctx.call('/queue/process', 'POST', {});
    assert.equal(proc.data.sent, disp.data.queued);
    assert.equal(baileys.sent.length, disp.data.queued);
    assert.equal(baileys.sent[0].destino, '1@g.us');
    assert.ok(baileys.sent[0].text.includes('Fone'));
    const deact = await ctx.call(`/flows/${id}/deactivate`, 'POST', {});
    assert.equal(deact.data.status, 'draft');
  } finally { await ctx.close(); }
});

test('sem provedor: ativação bloqueada e dispatch exige fluxo ativo', async () => {
  const ctx = await setup(fakeBaileys(false));
  try {
    const created = await ctx.call('/flows', 'POST', flow);
    const id = created.data.id;
    assert.equal((await ctx.call(`/flows/${id}/activate`, 'POST', {})).status, 409);
    assert.equal((await ctx.call(`/flows/${id}/dispatch`, 'POST', {})).status, 409);
    assert.equal((await ctx.call('/queue/process', 'POST', {})).status, 409);
    assert.equal((await ctx.call('/queue?status=bogus')).status, 400);
  } finally { await ctx.close(); }
});

test('provedor baileys com sock falso: QR, grupos, envio e logout', async () => {
  const events = {};
  const fakeSock = {
    user: {id: '5511@s.whatsapp.net'},
    ev: {on: (ev, fn) => { events[ev] = fn; }},
    groupFetchAllParticipating: async () => ({'1@g.us': {id: '1@g.us', subject: 'Grupo B', participants: [{}, {}]}, '2@g.us': {id: '2@g.us', subject: 'Grupo A', participants: [{}]}}),
    sendMessage: async () => {},
    requestPairingCode: async () => 'ABCD1234',
    logout: async () => {},
    ws: {close: () => {}}
  };
  const sessionDir = join(tmpdir(), 'baileys-test-' + randomUUID());
  const p = createBaileysProvider({
    sessionDir,
    baileysImpl: {
      useMultiFileAuthState: async () => ({state: {}, saveCreds: () => {}}),
      fetchLatestBaileysVersion: async () => { throw new Error('offline'); },
      makeWASocket: () => { return fakeSock; }
    },
    qrImpl: {toDataURL: async () => 'data:image/png;base64,QR'},
    logger: {level: 'silent', child() { return this; }, info() {}, error() {}, warn() {}, debug() {}, trace() {}}
  });
  try {
    await p.start();
    await events['connection.update']({qr: 'fake-qr'});
    assert.equal(p.status().hasQR, true);
    await events['connection.update']({connection: 'open'});
    assert.equal(p.status().connected, true);
    const groups = await p.listGroups();
    assert.equal(groups[0].name, 'Grupo A');
    await p.sendTest('1@g.us');
    await assert.rejects(() => p.sendTest('5511999@s.whatsapp.net'), /Grupo inválido/);
    assert.match(await p.requestPairCode('5511999999999'), /....-..../);
    await p.logout();
    assert.equal(p.status().connected, false);
    p.stop();
  } finally {
    rmSync(sessionDir, {recursive: true, force: true});
  }
});
