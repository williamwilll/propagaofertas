import { createApp } from './app.js';
const {app,db}=createApp();
const server=app.listen(3001,'127.0.0.1',()=>console.log('OfertaZap: http://127.0.0.1:3001 (API local; interface de desenvolvimento na porta 5173)'));
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
