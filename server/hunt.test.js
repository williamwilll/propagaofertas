import test from 'node:test';
import assert from 'node:assert/strict';
import {keywordVariants,messageVariants} from '../shared/hunt.js';
import {supportedProductUrl,detectStore} from '../shared/product-policy.js';

test('20+ lojas passam na allowlist e classificam', () => {
  const cases = [
    ['https://www.temu.com/xxx-1.html', 'Temu'],
    ['https://www.nike.com.br/t/tenis-123', 'Nike'],
    ['https://www.adidas.com.br/tenis-abc.html', 'Adidas'],
    ['https://br.puma.com/tenis-1.html', 'Puma'],
    ['https://www.underarmour.com.br/p/1', 'Under Armour'],
    ['https://www.asics.com.br/tenis', 'Asics'],
    ['https://www.fastshop.com.br/p/1', 'FastShop'],
    ['https://www.evino.com.br/vinho-1', 'Evino'],
    ['https://www.artwalk.com.br/tenis', 'ArtWalk'],
    ['https://www.granado.com.br/sabonete', 'Granado'],
    ['https://www.lego.com/pt-br/product/1', 'Lego'],
    ['https://www.avon.com.br/produto-1', 'Avon'],
    ['https://www.centauro.com.br/tenis', 'Centauro'],
    ['https://www.riachuelo.com.br/camisa', 'Riachuelo'],
    ['https://www.lacoste.com.br/camisa', 'Lacoste']
  ];
  for (const [url, store] of cases) {
    assert.equal(supportedProductUrl(url), true, url);
    assert.equal(detectStore(url, ''), store, url);
  }
  assert.equal(supportedProductUrl('https://falsa-temu.exemplo.test/x'), false);
});

test('keywordVariants: original, sem acento, singular e recortes', () => {
  const v = keywordVariants('Tênis Nike Air Zoom');
  assert.ok(v.includes('Tênis Nike Air Zoom'));
  assert.ok(v.includes('tenis nike air zoom'));
  assert.ok(v.some(x => /tenis nike/i.test(x)));
  assert.ok(v.length <= 8);
  assert.deepStrictEqual(keywordVariants('  '), []);
  assert.equal(keywordVariants('Fone')[0], 'Fone');
});

test('messageVariants: 3 tons sem inventar desconto', () => {
  const offer = {title: 'Fone X', description: 'Som top.', price: 199.9, url: 'https://example.com/f?tag=a-20'};
  const ms = messageVariants(offer);
  assert.equal(ms.length, 3);
  assert.deepEqual(ms.map(m => m.tone), ['achadinho', 'relampago', 'ultimas']);
  for (const m of ms) {
    assert.ok(m.text.includes('Fone X'));
    assert.ok(m.text.includes('199,90'));
    assert.ok(m.text.includes(offer.url));
    assert.ok(m.text.includes('comissão'));
    assert.ok(!m.text.includes('%'));
  }
  assert.match(ms[1].text, /RELÂMPAGO/);
});
