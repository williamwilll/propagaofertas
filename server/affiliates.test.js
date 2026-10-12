import test from 'node:test';
import assert from 'node:assert/strict';
import {amazonAsin,amazonCreds,amazonSign,mlbId,mlVerify,integrationsStatus,testPlatform,PLATFORMS} from './affiliates.js';
import {createApp} from './app.js';

test('amazon: ASIN extraído e assinatura SigV4 bem formada', () => {
  assert.equal(amazonAsin('https://www.amazon.com.br/dp/B012345678?tag=x-20'), 'B012345678');
  assert.equal(amazonAsin('https://www.amazon.com.br/gp/product/B012345678'), 'B012345678');
  assert.equal(amazonAsin('https://example.com/fone'), null);
  assert.equal(amazonCreds({}).paapi, false);
  assert.equal(amazonCreds({AMAZON_PARTNER_TAG: 't', AMAZON_ACCESS_KEY: 'a', AMAZON_SECRET_KEY: 's'}).paapi, true);
  const s = amazonSign({access: 'AK', secret: 'SK', payload: '{}', now: new Date('2026-01-02T03:04:05Z')});
  assert.match(s.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=AK\/20260102\/us-east-1\/ProductAdvertisingAPI\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=[a-f0-9]{64}$/);
  assert.equal(s.amzDate, '20260102T030405Z');
});

test('mercadolivre: MLB id e verificação pública com mock', async () => {
  assert.equal(mlbId('https://produto.mercadolivre.com.br/MLB-123456789-fone'), 'MLB123456789');
  assert.equal(mlbId('https://example.com'), null);
  const ok = await mlVerify('https://x/MLB-123456789', {fetchImpl: async () => ({ok: true, status: 200, json: async () => ({title: 'Fone', price: 99, status: 'active'})})});
  assert.equal(ok.title, 'Fone');
  const gone = await mlVerify('https://x/MLB-123456789', {fetchImpl: async () => ({ok: false, status: 404})});
  assert.match(gone.error, /não existe/);
});

test('status agregado sem rede e plataformas conhecidas', () => {
  assert.deepEqual([...PLATFORMS].sort(), ['Amazon', 'Kwai', 'Mercado Livre', 'Shopee', 'TikTok'].sort());
  const st = integrationsStatus({}, [{url: 'https://shopee.com.br/product/1/2'}, {url: 'https://www.amazon.com.br/dp/B012345678'}]);
  assert.equal(st['Shopee'].offers, 1);
  assert.equal(st['Amazon'].mode, 'off');
  assert.equal(st['Mercado Livre'].mode, 'publica');
  assert.equal(st['Kwai'].mode, 'manual');
});

test('testPlatform: kwai manual, sem ofertas, tag amazon e shopee sem chaves', async () => {
  const kwai = await testPlatform('Kwai', []);
  assert.equal(kwai.manual, true);
  const empty = await testPlatform('Shopee', []);
  assert.equal(empty.code, 'NO_OFFERS');
  const tag = await testPlatform('Amazon', [{url: 'https://www.amazon.com.br/dp/B012345678?tag=minha-20'}], {env: {AMAZON_PARTNER_TAG: 'minha-20'}, fetchImpl: async () => { throw new Error('sem rede'); }});
  assert.equal(tag.ok, true);
  assert.equal(tag.checked, 1);
  const badTag = await testPlatform('Amazon', [{url: 'https://www.amazon.com.br/dp/B012345678?tag=outra-20'}], {env: {AMAZON_PARTNER_TAG: 'minha-20'}, fetchImpl: async () => { throw new Error('sem rede'); }});
  assert.equal(badTag.code, 'TAG_MISMATCH');
  const noCfg = await testPlatform('Shopee', [{url: 'https://shopee.com.br/product/1/2'}], {env: {}, fetchImpl: async () => ({ok: true, json: async () => ({})})});
  assert.equal(noCfg.code, 'NOT_CONFIGURED');
  const ml = await testPlatform('Mercado Livre', [{url: 'https://produto.mercadolivre.com.br/MLB-123456789-fone'}], {fetchImpl: async () => ({ok: true, status: 200, json: async () => ({title: 'T', price: 5, status: 'active'})})});
  assert.equal(ml.ok, true);
});

test('rotas de integração: status, teste e 404', async () => {
  const {app, db, ready} = createApp(':memory:', {});
  await ready;
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const st = await (await fetch(base + '/integrations/status')).json();
    assert.equal(st['Mercado Livre'].mode, 'publica');
    assert.equal((await fetch(base + '/integrations/Steam/test', {method: 'POST'})).status, 404);
    const kwai = await (await fetch(base + '/integrations/Kwai/test', {method: 'POST'})).json();
    assert.equal(kwai.manual, true);
    const noOffer = await fetch(base + '/integrations/Shopee/test', {method: 'POST'});
    assert.equal(noOffer.status, 409);
  } finally { await new Promise(r => server.close(r)); await db.close(); }
});
