import {randomBytes,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {rateLimit} from 'express-rate-limit';
const scrypt=promisify(scryptCallback);
const hash=value=>createHash('sha256').update(value).digest('hex');
const cookieName='__Host-ofertazap';
const cookieOptions={httpOnly:true,secure:true,sameSite:'strict',path:'/'};
const lifetime=12*60*60*1000;
function tokenFrom(req){
 const value=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 return value&&/^[a-f0-9]{64}$/.test(value)?value:null;
}
export function installAuth(app,db,config){
 const mode=config.production?'production':'local';
 const email=config.adminEmail?.toLowerCase();
 const salt='ofertazap-owner-v1:'+email;
 const keyReady=config.production?scrypt(config.adminPassword,salt,64):Promise.resolve(null);
 const loginLimit=rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-7',legacyHeaders:false,skipSuccessfulRequests:true,message:{error:'Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.'}});
 async function session(req){
  const token=tokenFrom(req);if(!token)return null;
  const key=await keyReady;
  const result=await db.query('SELECT session_key FROM sessions WHERE session_key=? AND expires_at>? AND owner_key=?',[hash(token),new Date().toISOString(),hash(key)]);
  return result.rows[0]||null;
 }
 app.get('/api/auth/session',async(req,res)=>{
  const authenticated=!config.production||!!await session(req);
  res.json({authenticated,mode,email:authenticated&&config.production?email:null,storage:db.kind});
 });
 app.post('/api/auth/login',loginLimit,async(req,res)=>{
  if(!config.production)return res.status(400).json({error:'O modo local não exige login.'});
  const input=req.body;
  if(typeof input?.email!=='string'||typeof input?.password!=='string'||input.email.length>254||input.password.length>256)return res.status(400).json({error:'Informe e-mail e senha válidos.'});
  const expected=await keyReady;
  const candidate=await scrypt(input.password,salt,64);
  const valid=timingSafeEqual(expected,candidate)&&input.email.trim().toLowerCase()===email;
  if(!valid)return res.status(401).json({error:'E-mail ou senha incorretos.'});
  const now=new Date().toISOString();
  await db.query('DELETE FROM sessions WHERE expires_at<=? OR owner_key<>?',[now,hash(expected)]);
  const oldToken=tokenFrom(req);
  if(oldToken)await db.query('DELETE FROM sessions WHERE session_key=?',[hash(oldToken)]);
  const token=randomBytes(32).toString('hex');
  await db.query('INSERT INTO sessions (session_key,expires_at,owner_key) VALUES (?,?,?)',[hash(token),new Date(Date.now()+lifetime).toISOString(),hash(expected)]);
  res.cookie(cookieName,token,{...cookieOptions,maxAge:lifetime});
  res.json({authenticated:true,mode,email,storage:db.kind});
 });
 app.use('/api',async(req,res,next)=>{
  if(!config.production)return next();
  if(!await session(req))return res.status(401).json({error:'Sua sessão expirou. Entre novamente.'});
  next();
 });
 app.post('/api/auth/logout',async(req,res)=>{
  const token=tokenFrom(req);if(token)await db.query('DELETE FROM sessions WHERE session_key=?',[hash(token)]);
  res.clearCookie(cookieName,cookieOptions);res.json({ok:true});
 });
 return keyReady;
}
