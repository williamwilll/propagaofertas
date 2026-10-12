const clean = value => String(value ?? '').trim();
const key = value => clean(value).normalize('NFKC').toLocaleLowerCase('pt-BR');

export function inspectFlow(flow, integrations = {}) {
  const destinations = flow.destinations.map(clean).filter(Boolean);
  const destinationKeys = destinations.map(key);
  const distinct = new Set(destinationKeys).size === destinationKeys.length;
  const routeSafe = !destinationKeys.includes(key(flow.source)) && !destinationKeys.includes(key(flow.distributor)) && (!clean(flow.source) || key(flow.source) !== key(flow.distributor));
  const checks = [
    {code:'name',label:'Nome do fluxo informado',passed:!!clean(flow.name),step:0},
    {code:'account',label:'Remetente identificado no rascunho',passed:!!clean(flow.account),step:0},
    {code:'source',label:'Origem informada e autorização declarada',passed:!!clean(flow.source) && flow.sourceConsent,step:1},
    {code:'distributor',label:'Grupo distribuidor informado',passed:!!clean(flow.distributor),step:3},
    {code:'destinations',label:'Destinos informados e autorização declarada',passed:destinations.length > 0 && flow.destinationConsent,step:3},
    {code:'route',label:'Rota sem destinos repetidos ou retorno à origem',passed:distinct && routeSafe,step:3},
    {code:'schedule',label:'Dias e janela de envio definidos',passed:flow.days.length > 0 && flow.start < flow.end,step:4},
    {code:'whatsapp',label:'Conexão e suporte do provedor WhatsApp verificados',passed:!!integrations.whatsapp,step:null},
    {code:'affiliate',label:'API de afiliados e vínculo dos links verificados',passed:!!integrations.affiliate,step:null},
    {code:'permissions',label:'Acesso à origem e aos destinos verificado pela integração',passed:!!integrations.permissions,step:null}
  ];
  const pending = checks.filter(c=>!c.passed).length;
  return {ready:pending === 0,checks,pending};
}

const WHATSAPP_LIMIT = 4096;
export function composeOffer(offer) {
  const price = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(offer.price);
  const message = [
    'ACHADINHO DO DIA ✨',
    clean(offer.title),
    clean(offer.description),
    `Por ${price}`,
    `Confira: ${String(offer.url || '').trim()}`,
    'Link de afiliado. Posso receber uma comissão pela compra. Preço e disponibilidade sujeitos a alteração.'
  ].filter(Boolean).join('\n\n');
  return message.length > WHATSAPP_LIMIT ? message.slice(0, WHATSAPP_LIMIT - 1).trimEnd() + '…' : message;
}
