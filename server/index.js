import {createApp} from './app.js';
import {loadConfig} from './config.js';
import {databaseDiagnostic} from './database-diagnostics.js';
let config;
try{config=loadConfig();}catch(error){console.error('Configuração inválida:',error.message);process.exit(1);}
let application;
try{application=createApp(undefined,config);}catch(error){console.error(databaseDiagnostic(error));process.exit(1);}
const {app,db,ready}=application;
try{await ready;}catch(error){console.error(databaseDiagnostic(error));try{await db.close();}catch{}process.exit(1);}
const server=app.listen(config.port,config.host,()=>console.log(`OfertaZap iniciado na porta ${config.port} (${config.production?'produção com login':'modo local'}).`));
server.on('error',()=>{console.error('Não foi possível abrir a porta do servidor.');void db.close();process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
 const timeout=setTimeout(()=>process.exit(1),10000);timeout.unref();
 server.close(async()=>{await db.close();process.exit(0);});
});
