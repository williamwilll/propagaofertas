import {createHash, createHmac} from 'node:crypto';
import {detectStore} from '../shared/product-policy.js';
import {fetchShopeeOfficial} from './shopee.js';
import {parseShopeeIds, fetchTiktokOembed} from './product-import.js';

// Verificação real das 5 plataformas (sem mock): cada teste usa a API pública
// ou oficial da plataforma com as ofertas já cadastradas. Credenciais ficam
// no servidor (env); a UI nunca as recebe.

export const PLATFORMS = ['Shopee', 'Amazon', 'Mercado Livre', 'TikTok', 'Kwai'];

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  timer.unref?.();
  return {signal: controller.signal, done: () => clearTimeout(timer)};
}

async function readJson(res) {
  try { return await res.json(); } catch { return null; }
}

// ---------- Amazon PA-API 5.0 (SigV4) ----------
export function amazonAsin(url) {
  const s = String(url || '');
  let m = s.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
  if (m) return m[1];
  m = s.match(/[?&]asin=([A-Z0-9]{10})/i);
  return m ? m[1].toUpperCase() : null;
}

export function amazonCreds(env = process.env) {
  const tag = String(env.AMAZON_PARTNER_TAG || '').trim();
  const access = String(env.AMAZON_ACCESS_KEY || '').trim();
  const secret = String(env.AMAZON_SECRET_KEY || '').trim();
  return {tag, access, secret, paapi: !!(tag && access && secret)};
}

function amzDate(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  const stamp = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return {amz: stamp, date: stamp.slice(0, 8)};
}

function hmac(key, data) { return createHmac('sha256', key).update(data).digest(); }

export function amazonSign({access, secret, region = 'us-east-1', service = 'ProductAdvertisingAPI', host = 'webservices.amazon.com.br', target = 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems', payload = '', now = new Date()}) {
  const {amz, date} = amzDate(now);
  const hashed = createHash('sha256').update(payload).digest('hex');
  const headers = {'content-type': 'application/json; charset=utf-8', host, 'x-amz-date': amz, 'x-amz-target': target};
  const signedNames = Object.keys(headers).sort();
  const canonicalHeaders = signedNames.map(k => `${k}:${headers[k]}\n`).join('');
  const canonical = ['POST', '/paapi5/getitems', '', canonicalHeaders, signedNames.join(';'), hashed].join('\n');
  const scope = `${date}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, createHash('sha256').update(canonical).digest('hex')].join('\n');
  const kDate = hmac('AWS4' + secret, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSign = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSign).update(toSign).digest('hex');
  return {
    headers: {...headers, Authorization: `AWS4-HMAC-SHA256 Credential=${access}/${scope}, SignedHeaders=${signedNames.join(';')}, Signature=${signature}`},
    amzDate: amz
  };
}

export async function amazonGetItem(asin, {fetchImpl = fetch, env = process.env, timeoutMs = 15000, now = new Date()} = {}) {
  const c = amazonCreds(env);
  if (!c.paapi) return {error: 'Configure AMAZON_PARTNER_TAG, AMAZON_ACCESS_KEY e AMAZON_SECRET_KEY no servidor.'};
  const payload = JSON.stringify({
    PartnerTag: c.tag, PartnerType: 'Associates', Marketplace: 'www.amazon.com.br',
    ItemIds: [asin], Resources: ['ItemInfo.Title', 'OffersV1.Listings.Price', 'Images.Primary.Medium']
  });
  const signed = amazonSign({access: c.access, secret: c.secret, payload, now});
  const t = withTimeout(timeoutMs);
  try {
    const r = await fetchImpl('https://webservices.amazon.com.br/paapi5/getitems', {
      method: 'POST', headers: {...signed.headers, 'Content-Encoding': 'amz-1.0'}, body: payload, signal: t.signal
    });
    const j = await readJson(r);
    if (!r.ok) return {error: `Amazon PA-API: HTTP ${r.status}${j?.Errors?.[0]?.Message ? ' — ' + j.Errors[0].Message : ''}`};
    const item = j?.ItemsResult?.Items?.[0];
    if (!item) return {error: 'Amazon PA-API: item não encontrado.'};
    return {title: item.ItemInfo?.Title?.DisplayValue || '', asin};
  } finally { t.done(); }
}

// ---------- Mercado Livre (API pública, sem chave) ----------
export function mlbId(url) {
  const m = String(url || '').match(/MLB-?(\d{6,})/i);
  return m ? 'MLB' + m[1] : null;
}

export async function mlVerify(url, {fetchImpl = fetch, timeoutMs = 10000} = {}) {
  const id = mlbId(url);
  if (!id) return {error: 'Link sem ID MLB (ex: MLB123456789).'};
  const t = withTimeout(timeoutMs);
  try {
    const r = await fetchImpl(`https://api.mercadolibre.com/items/${id}`, {headers: {'User-Agent': 'PropagaOfertas/1.0'}, signal: t.signal});
    if (r.status === 404) return {error: 'Anúncio não existe mais no Mercado Livre.'};
    if (!r.ok) return {error: `Mercado Livre: HTTP ${r.status}`};
    const j = await readJson(r);
    if (!j?.title) return {error: 'Resposta inesperada do Mercado Livre.'};
    return {title: j.title, price: j.price ?? null, status: j.status || '', id};
  } finally { t.done(); }
}

// ---------- Status agregado (sem rede) ----------
export function integrationsStatus(env = process.env, offers = []) {
  const counts = {};
  for (const o of offers) {
    const s = detectStore(o.url || '', '') || 'Outros';
    counts[s] = (counts[s] || 0) + 1;
  }
  const shopeeCfg = !!(String(env.SHOPEE_APP_ID || '').trim() && String(env.SHOPEE_APP_SECRET || '').trim());
  const amz = amazonCreds(env);
  return {
    'Shopee': {configured: shopeeCfg, mode: shopeeCfg ? 'api' : 'off', offers: counts['Shopee'] || 0, needs: ['SHOPEE_APP_ID', 'SHOPEE_APP_SECRET']},
    'Amazon': {configured: !!amz.tag, paapi: amz.paapi, mode: amz.paapi ? 'api' : amz.tag ? 'tag' : 'off', offers: counts['Amazon'] || 0, needs: ['AMAZON_PARTNER_TAG', 'AMAZON_ACCESS_KEY', 'AMAZON_SECRET_KEY']},
    'Mercado Livre': {configured: true, mode: 'publica', offers: counts['Mercado Livre'] || 0, needs: []},
    'TikTok': {configured: true, mode: 'parcial', offers: counts['TikTok Shop'] || 0, needs: []},
    'Kwai': {configured: false, mode: 'manual', offers: 0, needs: []}
  };
}

// ---------- Teste por plataforma (usa ofertas reais) ----------
export async function testPlatform(platform, offers, {fetchImpl = fetch, env = process.env} = {}) {
  const mine = offers.filter(o => {
    const s = detectStore(o.url || '', '');
    if (platform === 'TikTok') return s === 'TikTok Shop';
    return s === platform;
  });
  if (platform === 'Kwai') return {ok: true, manual: true, message: 'Kwai é manual: cadastre título, preço e link; o envio usa o texto da oferta.'};
  if (!mine.length) return {error: `Cadastre ao menos uma oferta da ${platform} para testar.`, code: 'NO_OFFERS', status: 409};
  if (platform === 'Shopee') {
    const ids = parseShopeeIds(mine[0].url);
    if (!ids) return {error: 'Link Shopee sem IDs (use o link do produto).'};
    const r = await fetchShopeeOfficial(ids, {fetchImpl, env});
    if (!r) return {error: 'Configure SHOPEE_APP_ID e SHOPEE_APP_SECRET no servidor.', code: 'NOT_CONFIGURED', status: 409};
    if (r.error) return {error: r.error};
    return {ok: true, title: r.name, price: r.price, tracking: !!r.link};
  }
  if (platform === 'Amazon') {
    const c = amazonCreds(env);
    const withAsin = mine.map(o => ({o, asin: amazonAsin(o.url)})).find(x => x.asin);
    if (c.paapi) {
      if (!withAsin) return {error: 'Nenhuma oferta Amazon com ASIN válido.'};
      const r = await amazonGetItem(withAsin.asin, {fetchImpl, env});
      if (r.error) return {error: r.error};
      return {ok: true, title: r.title, asin: r.asin};
    }
    if (!c.tag) return {error: 'Configure AMAZON_PARTNER_TAG no servidor.', code: 'NOT_CONFIGURED', status: 409};
    const bad = mine.filter(o => !new RegExp(`[?&]tag=${c.tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:&|$)`).test(o.url));
    if (bad.length) return {error: `${bad.length} oferta(s) sem sua tag (${c.tag}). Troque os links pelos seus de afiliado.`, code: 'TAG_MISMATCH', status: 409};
    return {ok: true, tag: c.tag, checked: mine.length, message: 'Todas as ofertas carregam sua tag. PA-API completa exige ACCESS_KEY/SECRET.'};
  }
  if (platform === 'Mercado Livre') {
    const r = await mlVerify(mine[0].url, {fetchImpl});
    if (r.error) return {error: r.error};
    return {ok: true, title: r.title, price: r.price, id: r.id};
  }
  if (platform === 'TikTok') {
    const tk = await fetchTiktokOembed(mine[0].url, {fetchImpl});
    if (!tk?.title) return {error: 'TikTok bloqueou a leitura deste link (muro). Preço sempre manual.'};
    return {ok: true, title: tk.title, partial: true, message: 'Título/foto ok. Preço sempre manual no TikTok.'};
  }
  return {error: 'Plataforma desconhecida.'};
}
