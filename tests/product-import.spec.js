import {test,expect} from '@playwright/test';
const first='https://www.amazon.com.br/dp/B012345678?tag=meu-link-20';
const second='https://shopee.com.br/product/123/456?affiliate_id=original';
const result={title:'Importação teste · Cafeteira elétrica',description:'Café fresco para começar o dia.',price:179.9,imageUrl:'https://m.media-amazon.com/images/I/test.jpg',warnings:['Confira o preço e seu vínculo de afiliado.'],sourceHost:'www.amazon.com.br'};
async function open(page){await page.goto('/');await page.getByRole('button',{name:'Minhas ofertas',exact:true}).click();await page.getByRole('button',{name:'Nova oferta',exact:true}).click();return page.getByRole('dialog');}
test.afterEach(async({request})=>{const state=await(await request.get('/api/state')).json();for(const offer of state.offers.filter(o=>o.title.startsWith('Importação teste')))await request.delete('/api/offers/'+offer.id);});

test('colar link importa, exige revisão e salva imagem sem trocar afiliado',async({page,request})=>{
 await page.route('https://m.media-amazon.com/**',route=>route.abort());
 await page.route('**/api/offers/import',route=>route.fulfill({json:result}));
 const dialog=await open(page);
 await dialog.getByLabel('Seu link de afiliado (HTTPS)').fill(first);
 await expect(dialog.getByLabel('Nome do produto')).toHaveValue(result.title);
 await expect(dialog.getByLabel('Preço (R$)')).toHaveValue('179.9');
 await expect(dialog.getByRole('textbox',{name:'Descrição',exact:true})).toHaveValue(result.description);
 await expect(dialog.getByLabel('Seu link de afiliado (HTTPS)')).toHaveValue(first);
 await expect(dialog.getByRole('button',{name:'Salvar oferta',exact:true})).toBeDisabled();
 await dialog.getByRole('checkbox').check();
 await dialog.evaluate(d=>{d.scrollTop=0;});await page.screenshot({path:'test-results/product-import-desktop.png'});
 await dialog.getByRole('button',{name:'Salvar oferta',exact:true}).click();await expect(dialog).toHaveCount(0);
 const state=await(await request.get('/api/state')).json();const saved=state.offers.find(o=>o.title===result.title);
 expect(saved.url).toBe(first);expect(saved.imageUrl).toBe(result.imageUrl);
 await page.reload();await page.getByRole('button',{name:'Minhas ofertas',exact:true}).click();await expect(page.getByRole('heading',{name:result.title,exact:true})).toBeVisible();
});

test('trocar link limpa dados automáticos, mas preserva alterações manuais',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('https://m.media-amazon.com/**',route=>route.abort());
 await page.route('**/api/offers/import',route=>route.fulfill({json:route.request().postDataJSON().url===first?result:{...result,title:'Segundo produto',description:'Outra descrição',price:89.9,imageUrl:''}}));
 const dialog=await open(page);await dialog.getByLabel('Seu link de afiliado (HTTPS)').fill(first);
 await expect(dialog.getByLabel('Nome do produto')).toHaveValue(result.title);
 await dialog.getByLabel('Nome do produto').fill('Meu título manual');
 await dialog.getByLabel('Seu link de afiliado (HTTPS)').fill(second);
 await expect(dialog.getByLabel('Preço (R$)')).toHaveValue('89.9');
 await expect(dialog.getByRole('textbox',{name:'Descrição',exact:true})).toHaveValue('Outra descrição');
 await expect(dialog.getByLabel('Nome do produto')).toHaveValue('Meu título manual');
 await expect(dialog.getByRole('checkbox')).not.toBeChecked();
 await dialog.evaluate(d=>{d.scrollTop=0;});await page.screenshot({path:'test-results/product-import-mobile.png'});
});

test('preço ausente fica vazio e bloqueio da loja mantém cadastro manual',async({page})=>{
 let fail=false;
 await page.route('**/api/offers/import',route=>fail?route.fulfill({status:422,json:{error:'A loja bloqueou a leitura.'}}):route.fulfill({json:{...result,price:null,imageUrl:'',warnings:['Preço não disponível.']}}));
 const dialog=await open(page);await dialog.getByLabel('Seu link de afiliado (HTTPS)').fill(first);
 await expect(dialog.getByLabel('Nome do produto')).toHaveValue(result.title);
 await expect(dialog.getByLabel('Preço (R$)')).toHaveValue('');
 fail=true;await dialog.getByLabel('Seu link de afiliado (HTTPS)').fill(second);
 await expect(dialog.getByRole('status')).toContainText('A loja bloqueou a leitura.');
 await expect(dialog.getByLabel('Nome do produto')).toHaveValue('');
 await dialog.getByLabel('Nome do produto').fill('Importação teste · Cadastro manual');
 await dialog.getByLabel('Preço (R$)').fill('25');
 await dialog.getByRole('button',{name:'Salvar oferta',exact:true}).click();await expect(dialog).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Importação teste · Cadastro manual'})).toBeVisible();
});

test('resposta atrasada de outro link não sobrescreve o produto atual',async({page})=>{
 let release;const delayed=new Promise(resolve=>{release=resolve;});
 await page.route('**/api/offers/import',async route=>{
  const url=route.request().postDataJSON().url;
  if(url===first)await delayed;
  try{await route.fulfill({json:{...result,title:url===first?'Produto antigo':'Produto atual',imageUrl:''}});}catch{}
 });
 const dialog=await open(page);const started=page.waitForRequest(r=>r.url().endsWith('/api/offers/import'));
 await dialog.getByLabel('Seu link de afiliado (HTTPS)').fill(first);await started;
 await dialog.getByLabel('Seu link de afiliado (HTTPS)').fill(second);await expect(dialog.getByLabel('Nome do produto')).toHaveValue('Produto atual');
 release();await page.waitForTimeout(100);
 await expect(dialog.getByLabel('Nome do produto')).toHaveValue('Produto atual');
});
