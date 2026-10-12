import {createHash} from 'node:crypto';

// Shopee Affiliate Open API (GraphQL) — ESM port da melhor forma existente.
// Credenciais via ambiente (nunca no código): SHOPEE_APP_ID / SHOPEE_APP_SECRET.
// Sem credenciais retorna null e o importador usa as reservas (PDP -> genérico).

export const SHOPEE_ENDPOINT = 'https://open-api.affiliate.shopee.com.br/graphql';

export function shopeeCreds(env = process.env) {
  const appId = String(env.SHOPEE_APP_ID || '').trim();
  const secret = String(env.SHOPEE_APP_SECRET || '').trim();
  return appId && secret ? {appId, secret} : null;
}

// Assinatura: SHA256(AppId + Timestamp(segundos) + Payload + Secret)
export function shopeeSign(appId, secret, payload, ts) {
  const timestamp = String(ts ?? Math.floor(Date.now() / 1000));
  const signature = createHash('sha256').update(appId + timestamp + payload + secret).digest('hex');
  return {timestamp, auth: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`};
}

export function shopeeProductQuery({itemId, shopId}) {
  const args = [];
  if (itemId) args.push(`itemId:${Number(itemId)}`);
  if (shopId) args.push(`shopId:${Number(shopId)}`);
  args.push('limit:5');
  return `{productOfferV2(${args.join(',')} ){nodes{itemId productName productLink offerLink imageUrl priceMin priceMax priceDiscountRate commissionRate shopId shopName}pageInfo{hasNextPage}}}`;
}

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v || '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseShopeeNodes(json, wantItemId) {
  const nodes = json?.data?.productOfferV2?.nodes;
  if (!Array.isArray(nodes) || !nodes.length) return null;
  const valid = nodes.filter(n => n && n.productName);
  // Com itemId do link: SÓ aceita o nó exato — nunca devolve produto errado.
  let n = valid[0] || null;
  if (wantItemId != null && wantItemId !== '') {
    n = valid.find(x => String(x.itemId) === String(wantItemId)) || null;
    if (!n) return null;
  }
  if (!n) return null;
  const price = num(n.priceMin) ?? num(n.priceMax);
  if (!price) return null;
  return {
    name: String(n.productName).trim(),
    price,
    image: n.imageUrl || '',
    // offerLink já vem com tracking de afiliado.
    link: n.offerLink || n.productLink || '',
    store: 'Shopee'
  };
}

export async function fetchShopeeOfficial({itemId, shopId}, {fetchImpl = fetch, env = process.env, timeoutMs = 15000} = {}) {
  const c = shopeeCreds(env);
  if (!c) return null;
  const payload = JSON.stringify({query: shopeeProductQuery({itemId, shopId})});
  const {auth} = shopeeSign(c.appId, c.secret, payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetchImpl(SHOPEE_ENDPOINT, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: auth},
      body: payload,
      signal: controller.signal
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) return {error: `Shopee: HTTP ${r.status}`};
    if (j?.errors?.length) return {error: `Shopee: ${j.errors[0].message || 'erro na consulta'}`};
    const data = parseShopeeNodes(j, itemId);
    if (!data) return {error: 'Shopee: anúncio não encontrado na API'};
    return data;
  } finally { clearTimeout(timer); }
}
