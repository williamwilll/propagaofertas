import {validateDatabaseUrl} from './database-diagnostics.js';

export function loadConfig(env=process.env){
 const production=env.NODE_ENV==='production'||env.RENDER==='true';
 const port=Number(env.PORT||3001);
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT inválida.');
 const config={production,port,host:env.HOST||(production?'0.0.0.0':'127.0.0.1'),allowLan:env.ALLOW_LAN==='1',publicHost:String(env.PUBLIC_HOST||'').trim().toLowerCase()||null,databaseUrl:env.DATABASE_URL,appOrigin:env.APP_ORIGIN||env.RENDER_EXTERNAL_URL,adminEmail:env.ADMIN_EMAIL?.trim().toLowerCase(),adminPassword:env.ADMIN_PASSWORD,whatsappVerifyToken:env.WHATSAPP_VERIFY_TOKEN,whatsappAppSecret:env.WHATSAPP_APP_SECRET,whatsappToken:env.WHATSAPP_TOKEN,whatsappPhoneNumberId:env.WHATSAPP_PHONE_NUMBER_ID};
 if(production){
  if(!config.databaseUrl)throw new Error('Configure DATABASE_URL no Render. SQLite não é permitido em produção.');
  config.databaseUrl=validateDatabaseUrl(config.databaseUrl);
  validateProduction(config);
 }
 return config;
}
export function validateProduction(config){
 if(!config.appOrigin)throw new Error('Configure APP_ORIGIN ou RENDER_EXTERNAL_URL.');
 const origin=new URL(config.appOrigin);
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('APP_ORIGIN deve ser apenas a origem HTTPS do aplicativo.');
 if(!config.adminEmail||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.adminEmail))throw new Error('Configure ADMIN_EMAIL com seu e-mail.');
 if(!config.adminPassword||config.adminPassword.length<16||config.adminPassword.length>256)throw new Error('ADMIN_PASSWORD deve ter de 16 a 256 caracteres.');
}
