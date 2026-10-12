import {createApp} from './app.js';
import {loadConfig} from './config.js';
import {databaseDiagnostic} from './database-diagnostics.js';
let config;
try{config=loadConfig();}catch(error){console.error('Configuração inválida:',error.message);process.exit(1);}
let application;
const enableBaileys=process.env.WHATSAPP_PROVIDER==='baileys';
try{application=createApp(undefined,{...config,enableBaileys});}catch(error){console.error(databaseDiagnostic(error));process.exit(1);}
const {app,db,ready}=application;
try{await ready;}catch(error){console.error(databaseDiagnostic(error));try{await db.close();}catch{}process.exit(1);}
const server=app.listen(config.port,config.host,()=>console.log(`PropagaOfertas iniciado na porta ${config.port} (${config.production?'produção com login':'modo local'}).`));
server.on('error',()=>{console.error('Não foi possível abrir a porta do servidor.');void db.close();process.exitCode=1;});
// Worker da fila: a cada 30s processa vencidos com o provedor resolvido (Baileys ou Cloud).
// Chamada direta (sem HTTP): sem problema de Host/Origin/auth. Silencioso sem provedor.
const workerMs=Number(process.env.QUEUE_WORKER_MS||30000);
let worker=null;
if(Number.isFinite(workerMs)&&workerMs>=5000){
 worker=setInterval(()=>{application.processQueue().catch(()=>{});},workerMs);
 worker.unref?.();
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
 const timeout=setTimeout(()=>process.exit(1),10000);timeout.unref();
 if(worker)clearInterval(worker);
 server.close(async()=>{await db.close();process.exit(0);});
});
