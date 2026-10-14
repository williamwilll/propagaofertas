import test from 'node:test';
import assert from 'node:assert/strict';
import {mlAppCreds,mlRedirectUri,mlAuthUrl,mlTokenExpired,mlPredictCategory,mlPublishOffer,mlExchangeCode,mlRefresh} from './ml.js';
import {createApp} from './app.js';

const offer = {title: 'Fone Bluetooth Top', price: 179.9, url: 'https://example.com/f', description: 'Som bom.', imageUrl: 'https://m.media-amazon.com/images/I/t.jpg'};

test('auth url, creds e expiração', () => {
  assert.equal(mlAppCreds({}), null);
  assert.equal(mlAppCreds({ML_APP_ID: 'a', ML_APP_SECRET: 's'}).appId, 'a');
  assert.equal(mlRedirectUri({}), 'http://127.0.0.1:3001/api/ml/callback');
  assert.equal(mlRedirectUri({APP_ORIGIN: 'https://x.test/'}), 'https://x.test/api/ml/callback');
  const url = mlAuthUrl({appId: 'a', redirectUri: 'http://127.0.0.1:3001/api/ml/callback'});
  assert.match(url, /auth\.mercadolivre\.com\.br\/authorization\?/);
  assert.match(url, /client_id=a/);
  assert.equal(mlTokenExpired(null), true);
  assert.equal(mlTokenExpired({accessToken: 't', expiresAt: Date.now() + 3600000}), false);
  assert.equal(mlTokenExpired({accessToken: 't', expiresAt: Date.now() - 1000}), true);
});

test('exchange/refresh fazem parse com fetch global mocado', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ok: true, status: 200, json: async () => ({access_token: 'a1', refresh_token: 'r1', user_id: 42, expires_in: 21600})});
  try {
    const ex = await mlExchangeCode({appId: 'a', secret: 's', code: 'c', redirectUri: 'http://x/cb'});
    assert.equal(ex.accessToken, 'a1');
    assert.equal(ex.userId, '42');
    assert.ok(ex.expiresAt > Date.now());
    const rf = await mlRefresh({appId: 'a', secret: 's', refreshToken: 'r1'});
    assert.equal(rf.refreshToken, 'r1');
  } finally { globalThis.fetch = real; }
});

test('publish valida tudo antes de chamar a API', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => { calls.push(url); return {ok: true, status: 200, json: async () => ({id: 'MLB1', permalink: 'https://p', status: 'active'})}; };
  await assert.rejects(() => mlPublishOffer({...offer, title: '  '}, {categoryId: 'MLB1'}, {accessToken: 't'}, {fetchImpl}), /título/i);
  await assert.rejects(() => mlPublishOffer(offer, {categoryId: 'MLB1', price: -5}, {accessToken: 't'}, {fetchImpl}), /Preço/);
  await assert.rejects(() => mlPublishOffer({...offer, imageUrl: ''}, {categoryId: 'MLB1'}, {accessToken: 't'}, {fetchImpl}), /imagem/i);
  await assert.rejects(() => mlPublishOffer(offer, {}, {accessToken: 't'}, {fetchImpl}), /Categoria/);
  assert.equal(calls.length, 0);
  const long = await mlPublishOffer({...offer, title: 'x'.repeat(100)}, {categoryId: 'MLB1'}, {accessToken: 't'}, {fetchImpl});
  assert.equal(long.title.length, 60);
  assert.ok(long.warnings.some(w => /60/i.test(w)));
  assert.equal(long.permalink, 'https://p');
});

test('predict lê categoria e publish tenta renovar no 401', async () => {
  const pred = await mlPredictCategory('Fone', 't', {fetchImpl: async () => ({ok: true, status: 200, json: async () => ({id: 'MLB1051', name: 'Fones', path_from_root: [{name: 'Eletrônicos'}, {name: 'Fones'}]})})});
  assert.equal(pred.categoryId, 'MLB1051');
  assert.equal(pred.path, 'Eletrônicos > Fones');
  let n = 0;
  const flaky = async () => (++n === 1
    ? {ok: false, status: 401, json: async () => ({message: 'expired'})}
    : {ok: true, status: 200, json: async () => ({id: 'MLB2', permalink: 'https://p2', status: 'active'})});
  await assert.rejects(() => mlPublishOffer(offer, {categoryId: 'MLB1'}, {accessToken: 'old'}, {fetchImpl: flaky}), e => e.code === 'ML_UNAUTHORIZED');
});

test('rotas ml: status, publish e disconnect', async () => {
  const mlFetch = async (url, options = {}) => {
    const u = String(url);
    if (u.endsWith('/items') && options.method === 'POST') return {ok: true, status: 200, json: async () => ({id: 'MLB9', permalink: 'https://ml/9', status: 'active'})};
    if (/\/items\/[^/]+\/description$/.test(u)) return {ok: true, status: 200, json: async () => ({})};
    return {ok: false, status: 404, json: async () => ({})};
  };
  const prevId = process.env.ML_APP_ID, prevSec = process.env.ML_APP_SECRET;
  process.env.ML_APP_ID = 'app'; process.env.ML_APP_SECRET = 'sec';
  const {app, db, ready} = createApp(':memory:', {mlFetch});
  await ready;
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (path, method = 'GET', body) => {
    const r = await fetch(base + path, {method, headers: body ? {'Content-Type': 'application/json'} : undefined, body: body ? JSON.stringify(body) : undefined});
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = {html: text.slice(0, 60)}; }
    return {status: r.status, data};
  };
  try {
    assert.equal((await call('/ml/status')).data.connected, false);
    assert.equal((await call('/ml/publish', 'POST', {offerId: 'x'})).status, 409);
    const created = await call('/offers', 'POST', offer);
    await db.saveMlAuth({accessToken: 'tok', refreshToken: 'ref', userId: '7', expiresAt: Date.now() + 3600000});
    assert.equal((await call('/ml/status')).data.connected, true);
    const pub = await call('/ml/publish', 'POST', {offerId: created.data.id, categoryId: 'MLB1051', quantity: 2});
    assert.equal(pub.status, 200);
    assert.equal(pub.data.id, 'MLB9');
    assert.equal((await call('/ml/disconnect', 'POST', {})).data.ok, true);
    assert.equal((await call('/ml/status')).data.connected, false);
    assert.equal((await call('/ml/callback?code=')).status, 400);
  } finally {
    await new Promise(r => server.close(r)); await db.close();
    if (prevId === undefined) delete process.env.ML_APP_ID; else process.env.ML_APP_ID = prevId;
    if (prevSec === undefined) delete process.env.ML_APP_SECRET; else process.env.ML_APP_SECRET = prevSec;
  }
});
