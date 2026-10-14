import {useEffect,useState,type ReactNode} from 'react';
import {LockKeyhole,MessageSquare,ArrowRight,ShieldCheck,Eye,EyeOff} from 'lucide-react';

export interface Session {authenticated:boolean;mode:'local'|'production';email:string|null;storage:'sqlite'|'postgres'}
interface AuthGateProps {children:(session:Session,logout:()=>Promise<void>)=>ReactNode}
const control='w-full rounded-md border border-[var(--border)] bg-[var(--white)] px-3 py-3 text-sm focus:border-[var(--green)]';
export function AuthGate({children}:AuthGateProps){
 const [session,setSession]=useState<Session|null>(null);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [email,setEmail]=useState('');
 const [password,setPassword]=useState('');
 const [showPassword,setShowPassword]=useState(false);
 const check=async()=>{
  setLoading(true);setError('');
  try{const response=await fetch('/api/auth/session',{cache:'no-store'});if(!response.ok)throw new Error('Não foi possível verificar o acesso. Tente novamente.');setSession(await response.json());}
  catch{setError('Não foi possível conectar ao servidor. Aguarde e tente novamente.');}
  finally{setLoading(false);}
 };
 useEffect(()=>{
  void check();
  const expired=()=>{setSession(s=>s?{...s,authenticated:false,email:null}:s);setPassword('');setError('Sua sessão expirou. Entre novamente. Alterações não salvas precisam ser refeitas.');};
  window.addEventListener('propagaofertas:session-expired',expired);
  return ()=>window.removeEventListener('propagaofertas:session-expired',expired);
 },[]);
 const logout=async()=>{
  const response=await fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  if(!response.ok&&response.status!==401)throw new Error('Não foi possível sair. Tente novamente.');
  setSession(s=>s?{...s,authenticated:false,email:null}:s);setPassword('');setError('');
 };
 if(session?.authenticated&&!loading)return children(session,logout);
 return <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-5 py-10">
  <section className="w-full max-w-[440px] space-y-7 rounded-xl border border-[var(--border)] bg-[var(--white)] p-6 sm:p-9">
   <div className="flex items-center gap-2 text-[25px] font-bold"><MessageSquare className="text-[var(--green)]"/>PropagaOfertas</div>
   <div><div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--soft)]"><LockKeyhole size={22}/></div><h1 className="text-2xl font-bold">Seu workspace, protegido.</h1><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Entre com a conta de administrador para gerenciar suas ofertas e fluxos.</p></div>
   {error&&<p role="alert" className="rounded-lg bg-[var(--warning)] p-3 text-xs leading-6 text-[var(--amber)]">{error}</p>}
   {loading?<p role="status" className="text-sm text-[var(--muted)]">Verificando acesso…</p>:!session?<button onClick={()=>void check()} className="w-full rounded-md bg-[var(--green)] p-3 text-sm font-semibold text-[var(--white)]">Tentar novamente</button>:<form className="space-y-5" onSubmit={async e=>{
    e.preventDefault();if(busy)return;setBusy(true);setError('');
    try{const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Não foi possível entrar.');setPassword('');setSession(result);}
    catch(e){setPassword('');setError(e instanceof Error?e.message:'Não foi possível entrar.');}
    finally{setBusy(false);}
   }}>
    <label className="flex flex-col gap-2 text-xs font-semibold">E-mail do administrador<input autoFocus type="email" required maxLength={254} autoComplete="username" className={control} value={email} onChange={e=>setEmail(e.target.value)}/></label>
    <label className="flex flex-col gap-2 text-xs font-semibold">Senha<div className="relative"><input type={showPassword?'text':'password'} required maxLength={256} autoComplete="current-password" className={control+' pr-12'} value={password} onChange={e=>setPassword(e.target.value)}/><button type="button" onClick={()=>setShowPassword(s=>!s)} aria-label={showPassword?'Ocultar senha':'Mostrar senha'} aria-pressed={showPassword} className="absolute inset-y-0 right-0 flex items-center px-3 text-[var(--muted)] hover:text-[var(--text)]">{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>
    <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-md bg-[var(--green)] p-3 text-sm font-semibold text-[var(--white)] disabled:opacity-50">{busy?'Entrando…':'Entrar no PropagaOfertas'}<ArrowRight size={16}/></button>
   </form>}
   <div className="flex items-start gap-2 border-t border-[var(--border)] pt-5 text-xs leading-6 text-[var(--muted)]"><ShieldCheck size={17} className="mt-1 shrink-0"/><p>Acesso privado, sem cadastro público. O administrador configura as credenciais no servidor.</p></div>
  </section>
 </main>;
}
