import type { ReactNode } from 'react';
import type { CallOutcome, RecommendationStatus } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { Icon } from './Icon';
export function Badge({status,children}:{status?:RecommendationStatus|CallOutcome|'active'|'completed';children?:ReactNode}){
  const {t}=useLanguage();
  const names:Record<string,string>={pending:'Pending approval',approved:'Approved',contacted:'Contacted',accepted:'Accepted',rejected:'Rejected',follow_up_requested:'Follow-up',human_requested:'Human requested',unresolved:'Unresolved',active:'In progress',completed:'Completed'};
  const value=status||'';
  return <span className={`badge badge-${value||'neutral'}`}><i className="badge-dot"/>{children||t(names[value]||value)}</span>;
}
export function SectionTitle({eyebrow,title,action}:{eyebrow?:string;title:string;action?:ReactNode}){
  return <div className="section-heading"><div>{eyebrow&&<p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div>{action}</div>;
}
export function Loading(){const {t}=useLanguage();return <div className="page-loading"><div className="spinner"/>{t('Loading workspace…')}</div>}
export function ErrorState({message,onRetry}:{message:string;onRetry?:()=>void}){
  const {t}=useLanguage();return <div className="error-panel"><Icon name="alert-circle" size={23}/><div><strong>{t('Something went wrong')}</strong><p>{message}</p></div>{onRetry&&<button className="btn btn-outline" onClick={onRetry}><Icon name="refresh" size={15}/>{t('Retry')}</button>}</div>;
}
export function EmptyState({title,description}:{title:string;description:string}){
  return <div className="empty"><Icon name="search" size={27}/><strong>{title}</strong><span>{description}</span></div>;
}
export function Avatar({name,seed=0,size='md'}:{name:string;seed?:number;size?:'sm'|'md'|'lg'}){
  return <span className={`avatar avatar-${size} avatar-tone-${seed%5}`}>{name.split(' ').slice(0,2).map(n=>n[0]).join('')}</span>;
}
