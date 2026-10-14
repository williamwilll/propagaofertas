import {readPrice} from './product-import.js';

// Mercado Livre — publicador de anúncios (conta do vendedor via OAuth2).
// Leitura pública (verificação) não exige chave; PUBLICAR exige app
// (ML_APP_ID/ML_APP_SECRET) + consentimento do vendedor. Tokens ficam no
// banco do servidor e nunca vão para a UI. Sem dependências novas.

const AUTH_HOST = 'https://auth.mercadolivre.com.br';
const API = 'https://api.mercadolibre.com';

export function mlAppCreds(env = process.env) {
  const appId = String(env.ML_APP_ID || '').trim();
  const secret = String(env.ML_APP_SECRET || '').trim();
  return appId && secret ? {appId, secret} : null;
}

export function mlRedirectUri(env = process.env) {
  const origin = String(env.APP_ORIGIN || env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '');
  if (origin) return origin + '/api/ml/callback';
  return 'http://127.0.0.1:3001/api/ml/callback';
}

export function mlAuthUrl({appId, redirectUri}) {
  const q = new URLSearchParams({response_type: 'code', client_id: appId, redirect_uri: redirectUri});
  return `${AUTH_HOST}/authorization?${q}`;
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  timer.unref?.();
  return {signal: controller.signal, done: () => clearTimeout(timer)};
}

async function postForm(url, params, {timeoutMs = 15000} = {}) {
  const t = withTimeout(timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'},
      body: new URLSearchParams(params),
      signal: t.signal
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(j?.message || j?.error || `Mercado Livre: HTTP ${r.status}`);
    return j;
  } finally { t.done(); }
}

async function apiCall(token, method, path, body, {fetchImpl = fetch, timeoutMs = 15000} = {}) {
  const t = withTimeout(timeoutMs);
  try {
    const r = await fetchImpl(API + path, {
      method,
      headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'PropagaOfertas/1.0'},
      body: body ? JSON.stringify(body) : undefined,
      signal: t.signal
    });
    const j = await r.json().catch(() => null);
    if (r.status === 401) {
      const err = new Error(j?.message || 'Token inválido ou expirado.');
      err.code = 'ML_UNAUTHORIZED';
      throw err;
    }
    if (!r.ok) {
      const cause = j?.cause?.[0];
      const err = new Error(cause?.message || j?.message || `Mercado Livre: HTTP ${r.status}`);
      err.code = cause?.code || j?.error || 'ML_API_ERROR';
      err.cause = j?.cause || null;
      err.status = r.status;
      throw err;
    }
    return j;
  } finally { t.done(); }
}

export async function mlExchangeCode({appId, secret, code, redirectUri}) {
  const j = await postForm(`${API}/oauth/token`, {
    grant_type: 'authorization_code', client_id: appId, client_secret: secret, code, redirect_uri: redirectUri
  });
  if (!j?.access_token) throw new Error('Resposta inesperada ao conectar.');
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token || '',
    userId: j.user_id != null ? String(j.user_id) : '',
    expiresAt: Date.now() + Number(j.expires_in || 21600) * 1000
  };
}

export async function mlRefresh({appId, secret, refreshToken}) {
  if (!refreshToken) throw new Error('Sem refresh token. Conecte de novo.');
  const j = await postForm(`${API}/oauth/token`, {
    grant_type: 'refresh_token', client_id: appId, client_secret: secret, refresh_token: refreshToken
  });
  if (!j?.access_token) throw new Error('Resposta inesperada ao renovar.');
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token || refreshToken,
    userId: j.user_id != null ? String(j.user_id) : '',
    expiresAt: Date.now() + Number(j.expires_in || 21600) * 1000
  };
}

export function mlTokenExpired(auth, skewMs = 60000) {
  if (!auth?.accessToken) return true;
  return Date.now() + skewMs >= Number(auth.expiresAt || 0);
}

export async function mlPredictCategory(title, token, {fetchImpl = fetch} = {}) {
  const t = String(title || '').trim().slice(0, 255);
  if (!t) throw new Error('Título vazio para detectar categoria.');
  const j = await apiCall(token, 'GET', `/sites/MLB/category_predictor/predict?title=${encodeURIComponent(t)}`, null, {fetchImpl});
  const best = j?.categories?.[0] || j?.category_id ? {category_id: j.category_id || j.categories[0]} : null;
  const id = best?.category_id || j?.id;
  if (!id) throw new Error('Não identifiquei a categoria. Informe o ID (ex: MLB1234).');
  return {categoryId: String(id), name: j?.name || '', path: (j?.path_from_root || []).map(n => n?.name).filter(Boolean).join(' > ')};
}

function cleanTitle60(title) {
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  if (!t) throw new Error('Oferta sem título.');
  if (t.length <= 60) return {title: t, truncated: false};
  return {title: t.slice(0, 60).trimEnd(), truncated: true};
}

export async function mlPublishOffer(offer, input, auth, {fetchImpl = fetch} = {}) {
  const {title, truncated} = cleanTitle60(offer.title);
  const price = readPrice(input.price ?? offer.price);
  if (!price) throw new Error('Preço inválido. Informe em R$.');
  const quantity = Math.trunc(Number(input.quantity ?? 1));
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) throw new Error('Quantidade deve ser inteiro de 1 a 100000.');
  const image = String(offer.imageUrl || input.imageUrl || '').trim();
  if (!image || !/^https:/i.test(image)) throw new Error('Oferta sem imagem HTTPS pública. O ML exige ao menos uma foto.');
  const categoryId = String(input.categoryId || '').trim();
  if (!categoryId) throw new Error('Categoria obrigatória. Use Detectar ou informe o ID.');
  const listingType = String(input.listingType || 'gold_special').trim() || 'gold_special';
  const warnings = [];
  if (truncated) warnings.push('Título cortado em 60 caracteres (limite do ML).');
  const body = {
    title,
    category_id: categoryId,
    price,
    currency_id: 'BRL',
    available_quantity: quantity,
    buying_mode: 'buy_it_now',
    listing_type_id: listingType,
    condition: 'new',
    pictures: [{source: image}]
  };
  const created = await apiCall(auth.accessToken, 'POST', '/items', body, {fetchImpl});
  const description = String(offer.description || '').trim().slice(0, 50000);
  if (description) {
    try { await apiCall(auth.accessToken, 'POST', `/items/${created.id}/description`, {plain_text: description}, {fetchImpl}); }
    catch { warnings.push('Anúncio criado, mas a descrição falhou. Edite no painel do ML.'); }
  }
  return {id: created.id, permalink: created.permalink || '', title, price, categoryId, status: created.status || '', warnings};
}
