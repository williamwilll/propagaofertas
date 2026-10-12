import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanTitle,findProductInLd,parseShopeeIds,parseShopeeItem,tiktokItemId,isWallResult,extractMercadoLivreSocial,extractProduct,importProduct} from './product-import.js';
import {parseShopeeNodes,shopeeSign,shopeeProductQuery} from './shopee.js';
import {supportedProductUrl,allowedImageUrl,detectStore} from '../shared/product-policy.js';

test('cleanTitle remove sufixo de site sem destruir nome', () => {
  assert.equal(cleanTitle('Fone Bluetooth - Loja Oficial'), 'Fone Bluetooth');
  assert.equal(cleanTitle('Fone & som'), 'Fone & som');
  assert.equal(cleanTitle('Cafeteira | Magazine'), 'Cafeteira');
});

test('findProductInLd resolve @graph e ignora contexto', () => {
  const p = {'@type': 'Product', name: 'X'};
  assert.equal(findProductInLd({'@graph': [p]}).name, 'X');
  assert.equal(findProductInLd([{name: 'nada'}, p]).name, 'X');
  assert.equal(findProductInLd({nada: 1}), null);
});

test('shopee: ids nos 3 formatos, PDP /100000 e assinatura oficial', () => {
  assert.deepEqual(parseShopeeIds('https://shopee.com.br/opaanlp/11/22'), {shopid: '11', itemid: '22'});
  assert.deepEqual(parseShopeeIds('https://shopee.com.br/product/33/44'), {shopid: '33', itemid: '44'});
  assert.deepEqual(parseShopeeIds('https://shopee.com.br/abc-i.55.66?x=1'), {shopid: '55', itemid: '66'});
  assert.equal(parseShopeeIds('https://shopee.com.br/search'), null);
  const item = parseShopeeItem({data: {item_basic: {name: 'Camisa', price_min: 299900000, currency: 'BRL', image: 'abc123', categories: [{display_name: 'Moda'}]}}});
  assert.equal(item.price, 2999);
  assert.equal(item.image, 'https://down-br.img.susercontent.com/file/abc123');
  const {timestamp, auth} = shopeeSign('id1', 'sec', '{"q":1}', 10);
  assert.equal(timestamp, '10');
  assert.match(auth, /SHA256 Credential=id1/);
  assert.match(shopeeProductQuery({itemId: '5', shopId: '6'}), /itemId:5.*shopId:6/);
  const nodes = parseShopeeNodes({data: {productOfferV2: {nodes: [{itemId: 5, productName: 'A', priceMin: 10}, {itemId: 6, productName: 'B', priceMin: 20}]}}}, '6');
  assert.equal(nodes.name, 'B');
  assert.equal(parseShopeeNodes({data: {productOfferV2: {nodes: [{itemId: 5, productName: 'A', priceMin: 10}]}}}, '9'), null);
});

test('tiktok: ids e muro nunca viram produto', () => {
  assert.deepEqual(tiktokItemId('https://www.tiktok.com/@x/video/123'), {id: '123', kind: 'video'});
  assert.deepEqual(tiktokItemId('https://www.tiktok.com/@x/photo/456'), {id: '456', kind: 'photo'});
  assert.equal(tiktokItemId('https://tiktok.com/qualquer'), null);
  assert.equal(isWallResult({name: 'Entrar | TikTok'}), true);
  assert.equal(isWallResult({name: 'Security Check'}), true);
  assert.equal(isWallResult({name: 'Fone Top', price: 10}), false);
  assert.equal(isWallResult({name: 'Fone Top', image: 'x'}), false);
});

test('allowlist expandida cobre 9 lojas e detectStore classifica', () => {
  for (const u of ['https://www.aliexpress.com/item/1.html', 'https://www.tiktok.com/@x/video/1', 'https://www.shein.com/product-1.html', 'https://www.magazineluiza.com.br/p/1/', 'https://www.kabum.com.br/produto/1', 'https://www.banggood.com/p-1.html']) assert.equal(supportedProductUrl(u), true, u);
  assert.equal(supportedProductUrl('https://evil.test/item'), false);
  assert.equal(detectStore('https://s.shopee.com.br/x', ''), 'Shopee');
  assert.equal(detectStore('', 'https://www.aliexpress.com/item/1'), 'AliExpress');
  assert.equal(allowedImageUrl('https://down-br.img.susercontent.com/file/x'), true);
  assert.equal(allowedImageUrl('https://evil.test/x.jpg'), false);
});

test('ML social extrai current/previous do JSON embutido', () => {
  const html = '<meta property="og:title" content="Fone Top"><script>"title":{"text":"Fone Top"} "current_price":{"value":99.9} "previous_price":{"value":129.9} "currency":"BRL"</script>';
  const r = extractMercadoLivreSocial(html);
  assert.equal(r.price, 99.9);
  assert.equal(r.old_price, 129.9);
  assert.equal(extractMercadoLivreSocial('<html></html>'), null);
});

test('extractProduct usa @graph, hint de variação e rejeita muro', () => {
  const prod = {'@context': 'https://schema.org', '@graph': [{'@type': 'Product', name: 'Fone & som', image: 'https://m.media-amazon.com/images/I/t.jpg', offers: {'@type': 'Offer', price: '1299.90', priceCurrency: 'BRL'}}]};
  const html = `<html><head><script type="application/ld+json">${JSON.stringify(prod).replace(/</g, '\\u003c')}</script></head></html>`;
  const r = extractProduct(html, 'https://www.amazon.com.br/dp/B012345678');
  assert.equal(r.title, 'Fone & som');
  assert.equal(r.price, 1299.9);
  assert.equal(r.store, 'Amazon');
  assert.throws(() => extractProduct('<html><head><title>Entrar | TikTok</title></head></html>', 'https://www.tiktok.com/@x/video/1'), /TikTok/);
});

test('importProduct em cascata com mocks (sem rede)', async () => {
  const fakeOfficial = async () => ({name: 'Produto Oficial', price: 42.5, image: '', link: 'https://shopee.com.br/product/1/2'});
  const r1 = await importProduct('https://shopee.com.br/product/1/2', {shopeeFetcher: fakeOfficial, shopeePdpFetcher: async () => null});
  assert.equal(r1.title, 'Produto Oficial');
  assert.equal(r1.price, 42.5);
  const fakePdp = async () => ({name: 'Via PDP', price: 15, image: '', currency: 'BRL'});
  const r2 = await importProduct('https://shopee.com.br/product/1/2', {shopeeFetcher: async () => null, shopeePdpFetcher: fakePdp});
  assert.equal(r2.title, 'Via PDP');
  const fakeTk = async () => ({title: 'Vídeo Legal', description: '', price: null, imageUrl: '', store: 'TikTok Shop', partial: true});
  const r3 = await importProduct('https://www.tiktok.com/@x/video/123', {
    resolver: async () => { throw new Error('sem rede'); },
    tiktokFetcher: fakeTk
  });
  assert.equal(r3.title, 'Vídeo Legal');
});
