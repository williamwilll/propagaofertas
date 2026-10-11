import {CheckCircle2,AlertCircle,ArrowRight,Plug} from 'lucide-react';
import {inspectFlow,type FlowData} from '../../shared/workflow.js';

interface FlowChecklistProps {flow:FlowData;onStep:(step:number)=>void}
export function FlowChecklist({flow,onStep}:FlowChecklistProps){
 const result=inspectFlow(flow);
 return <section aria-label="Pendências do fluxo" className="space-y-4 border-t border-[var(--border)] pt-5">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">O que falta para ativar?</h3><span className="rounded bg-[var(--warning)] px-2 py-1 text-[11px] text-[var(--amber)]">{result.pending} pendências</span></div>
  <p className="text-xs leading-6 text-[var(--muted)]">Preenchimento do rascunho não comprova conexão nem autorização técnica. As verificações externas seguem pendentes.</p>
  <ul className="divide-y divide-[var(--border)]">{result.checks.map(check=><li key={check.code} className="flex items-start gap-3 py-3">{check.passed?<CheckCircle2 size={17} className="mt-0.5 shrink-0 text-[var(--green)]"/>:check.step===null?<Plug size={17} className="mt-0.5 shrink-0 text-[var(--amber)]"/>:<AlertCircle size={17} className="mt-0.5 shrink-0 text-[var(--amber)]"/>}<div className="min-w-0 flex-1"><p className="text-xs leading-5">{check.label}</p>{check.step===null&&<p className="text-[11px] leading-5 text-[var(--muted)]">Depende da integração · não configurada</p>}</div>{!check.passed&&check.step!==null&&<button type="button" onClick={()=>onStep(check.step!)} className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-[var(--green)] hover:bg-[var(--soft)]">Corrigir<ArrowRight size={13}/></button>}</li>)}</ul>
 </section>;
}
