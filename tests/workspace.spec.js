import {test,expect} from '@playwright/test';

const sample={title:'Fone Bluetooth · teste',description:'Mais música, menos distrações.',price:179.9,url:'https://example.com/item?tag=teste'};
let offerId;
test.beforeEach(async({request})=>{const response=await request.post('/api/offers',{data:sample});expect(response.status()).toBe(201);offerId=(await response.json()).id;});
test.afterEach(async({request})=>{await request.delete('/api/offers/'+offerId);});

async function openPreview(page){await page.goto('/');await page.getByRole('button',{name:'Minhas ofertas',exact:true}).click();await page.getByRole('button',{name:'Prévia de '+sample.title,exact:true}).click();}

test('prévia copia texto exato após confirmação sem enviar',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 await openPreview(page);
 const dialog=page.getByRole('dialog');
 await expect(dialog).toBeVisible();expect(await dialog.evaluate(d=>d.matches(':modal'))).toBe(true);
 await expect(dialog.getByRole('button',{name:'Copiar mensagem',exact:true})).toBeDisabled();
 await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Copiar mensagem',exact:true}).click();
 await expect(dialog.getByRole('status')).toContainText('Mensagem copiada. Nenhum envio foi realizado.');
 const copied=await page.evaluate(()=>navigator.clipboard.readText());
 expect(copied).toContain(sample.url);expect(copied).toContain('Posso receber uma comissão');expect(copied).toContain('179,90');
 await page.screenshot({path:'test-results/preview-desktop.png'});
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Prévia de '+sample.title,exact:true})).toBeFocused();
});

test('prévia em celular oferece seleção quando clipboard falha',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw new Error('Negado');}}}));
 await openPreview(page);const dialog=page.getByRole('dialog');
 await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Copiar mensagem',exact:true}).click();
 await expect(dialog.getByRole('status')).toContainText('Não foi possível copiar automaticamente');
 const textarea=dialog.getByRole('textbox',{name:'Texto da oferta para copiar manualmente'});
 await expect(textarea).toBeVisible();await expect(textarea).toBeFocused();
 expect(await textarea.evaluate(t=>t.selectionEnd-t.selectionStart)).toBeGreaterThan(100);
 const box=await dialog.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);
 await dialog.evaluate(d=>{d.scrollTop=0;});await page.screenshot({path:'test-results/preview-mobile.png'});
});

test('pendências levam à etapa correta e ativação permanece bloqueada',async({page,request})=>{
 const response=await request.post('/api/flows',{data:{name:'Fluxo de teste',account:'',source:'Origem',sourceConsent:false,platform:'Amazon',distributor:'Central',destinations:['Origem'],destinationConsent:false,days:[],start:'09:00',end:'18:00',interval:10,dailyLimit:20,mode:'manual'}});
 const {id}=await response.json();
 try{
  await page.goto('/');await page.getByRole('button',{name:'8 pendências',exact:true}).click();
  await expect(page.getByRole('heading',{name:'O que falta para ativar?'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Ativar fluxo',exact:true})).toBeDisabled();
  await page.screenshot({path:'test-results/checklist-desktop.png',fullPage:true});
  await page.getByRole('region',{name:'Pendências do fluxo'}).getByRole('button',{name:'Corrigir',exact:true}).first().click();
  await expect(page.getByRole('heading',{name:'Qual conta enviará as ofertas?'})).toBeVisible();
  expect((await request.post('/api/flows/'+id+'/activate')).status()).toBe(409);
 }finally{await request.delete('/api/flows/'+id);}
});
