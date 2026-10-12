import {test,expect} from '@playwright/test';

// UI contract tests. Production authentication itself is exercised by server/production.test.js.
async function mockAuth(page){
 let authenticated=false;
 await page.route('**/api/auth/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const session=()=>({authenticated,mode:'production',email:authenticated?'owner@example.test':null,storage:'postgres'});
  if(path.endsWith('/login')){
   const input=route.request().postDataJSON();
   if(input.password!=='test-password-for-ui-only')return route.fulfill({status:401,json:{error:'E-mail ou senha incorretos.'}});
   authenticated=true;
  }
  if(path.endsWith('/logout'))authenticated=false;
  return route.fulfill({json:session()});
 });
}
async function login(page){
 await page.getByLabel('E-mail do administrador').fill('owner@example.test');
 await page.getByLabel('Senha',{exact:true}).fill('test-password-for-ui-only');
 await page.getByRole('button',{name:'Entrar no OfertaZap'}).click();
 await expect(page.getByRole('heading',{name:'Seu centro de distribuição'})).toBeVisible();
}

test('login privado, erro de credenciais e logout limpam o workspace',async({page})=>{
 await mockAuth(page);await page.goto('/');
 await expect(page.getByRole('heading',{name:'Seu workspace, protegido.'})).toBeVisible();
 await page.screenshot({path:'test-results/login-desktop.png'});
 await page.getByLabel('E-mail do administrador').fill('owner@example.test');
 await page.getByLabel('Senha',{exact:true}).fill('wrong-password');
 await page.getByRole('button',{name:'Entrar no OfertaZap'}).click();
 await expect(page.getByRole('alert')).toContainText('E-mail ou senha incorretos.');
 await expect(page.getByLabel('Senha',{exact:true})).toHaveValue('');
 await login(page);await expect(page.getByText('Dados reais salvos no PostgreSQL. Nenhum envio realizado.')).toBeVisible();
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Sair',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Seu workspace, protegido.'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Seu centro de distribuição'})).toHaveCount(0);
});

test('sessão expirada fecha formulário e exige novo login em celular',async({page})=>{
 await page.setViewportSize({width:390,height:844});await mockAuth(page);await page.goto('/');
 await expect(page.getByRole('heading',{name:'Seu workspace, protegido.'})).toBeVisible();
 await page.screenshot({path:'test-results/login-mobile.png'});
 await login(page);await page.getByRole('button',{name:'Minhas ofertas',exact:true}).click();
 await page.getByRole('button',{name:'Nova oferta',exact:true}).click();
 const modal=page.getByRole('dialog');
 await modal.getByLabel('Nome do produto').fill('Não deve ser salvo');
 await modal.getByLabel('Preço (R$)').fill('10');
 await modal.getByLabel('Seu link de afiliado (HTTPS)').fill('https://example.com/item');
 await page.route('**/api/offers',route=>route.fulfill({status:401,json:{error:'Sua sessão expirou. Entre novamente.'}}));
 await modal.getByRole('button',{name:'Salvar oferta',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Seu workspace, protegido.'})).toBeVisible();
 await expect(page.getByRole('alert')).toContainText('Sua sessão expirou');
 await expect(page.getByRole('dialog')).toHaveCount(0);
});
