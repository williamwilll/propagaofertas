import {composeOffer} from './workflow.js';

// Ajudantes determinísticos de divulgação (sem "IA" de fachada): variações
// de busca para caçar ofertas e tons de mensagem a partir da oferta real.
// Nada aqui inventa preço, desconto ou estoque — só reformata o que existe.

const clean = value => String(value ?? '').trim();
const fold = value => clean(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');

function sing(word) {
  const w = String(word || '');
  // Paroxítonas em -is de consoante (tênis, lápis) já estão no singular.
  if (w.length > 4 && /[bcdfghjklmnpqrtvxz]is$/i.test(w)) return w;
  if (w.length > 3 && /s$/i.test(w) && !/ss$/i.test(w)) return w.slice(0, -1);
  return w;
}

// Variações de busca: original, sem acento, singularizada e recortes úteis.
export function keywordVariants(term) {
  const base = clean(term).replace(/\s+/g, ' ');
  if (!base) return [];
  const out = [];
  const push = v => {
    const s = clean(v);
    if (s && s.length >= 2 && !out.includes(s)) out.push(s);
  };
  const words = base.split(' ');
  push(base);
  push(fold(base));
  push(words.map(sing).join(' '));
  if (words.length >= 3) {
    push(words.slice(-2).join(' '));
    push(words.slice(0, 2).join(' '));
  }
  if (words.length >= 2) push(words[words.length - 1]);
  return out.slice(0, 8);
}

function brl(price) {
  return new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'}).format(price);
}

const DISCLOSURE = 'Link de afiliado. Posso receber uma comissão pela compra. Preço e disponibilidade sujeitos a alteração.';

// 3 tons a partir dos dados reais da oferta. Sem desconto inventado.
export function messageVariants(offer) {
  const title = clean(offer.title);
  const desc = clean(offer.description);
  const price = `Por ${brl(offer.price)}`;
  const link = `Confira: ${String(offer.url || '').trim()}`;
  const achadinho = composeOffer(offer);
  const relampago = ['OFERTA RELÂMPAGO ⚡', title, price, link, DISCLOSURE].filter(Boolean).join('\n\n');
  const ultimas = ['RESTAM POUCAS ⏰', title, desc, `${price} — enquanto durar`, link, DISCLOSURE].filter(Boolean).join('\n\n');
  return [
    {tone: 'achadinho', label: 'Achadinho do dia', text: achadinho},
    {tone: 'relampago', label: 'Oferta relâmpago', text: relampago},
    {tone: 'ultimas', label: 'Últimas unidades', text: ultimas}
  ];
}
