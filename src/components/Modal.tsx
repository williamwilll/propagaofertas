import {useEffect,useRef,type ReactNode} from 'react';

interface ModalProps {labelledBy:string;onClose:()=>void;children:ReactNode}
export function Modal({labelledBy,onClose,children}:ModalProps){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const dialog=ref.current;
  const previous=document.activeElement as HTMLElement|null;
  const overflow=document.body.style.overflow;
  dialog?.showModal();
  return ()=>{dialog?.close();document.body.style.overflow=overflow;previous?.focus();};
 },[]);
 return <dialog ref={ref} aria-modal="true" aria-labelledby={labelledBy} onCancel={e=>{e.preventDefault();onClose();}} className="fixed inset-0 m-auto max-h-[92dvh] w-[calc(100%-2rem)] max-w-2xl overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--white)] p-0 text-[var(--text)] shadow-2xl backdrop:bg-[var(--sidebar)]/60 backdrop:backdrop-blur-sm modal-anim">{children}</dialog>;
}
