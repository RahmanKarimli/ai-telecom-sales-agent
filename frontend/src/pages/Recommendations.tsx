import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getRecommendations } from '../lib/api';
import { useRefresh } from '../context/RefreshContext';
import { useLanguage } from '../i18n/LanguageContext';
import { money } from '../lib/format';
import type { RecommendationRow } from '../types';
import { Icon } from '../components/Icon';
import { Avatar, Badge, EmptyState, ErrorState, Loading } from '../components/UI';

type Filter='all'|'pending'|'approved'|'contacted';
export function Recommendations(){
  const navigate=useNavigate();const {revision}=useRefresh();const {t}=useLanguage();
  const [rows,setRows]=useState<RecommendationRow[]>([]);const [search,setSearch]=useState('');const [filter,setFilter]=useState<Filter>('all');
  const [error,setError]=useState('');const [loading,setLoading]=useState(true);
  useEffect(()=>{let active=true;setLoading(true);getRecommendations().then(r=>{if(active){setRows(r);setError('');}}).catch(e=>{if(active)setError((e as Error).message);}).finally(()=>{if(active)setLoading(false);});return ()=>{active=false;};},[revision]);
  const filtered=useMemo(()=>rows.filter(r=>r.customer_name.toLowerCase().includes(search.trim().toLowerCase())&&(filter==='all'||r.status===filter)),[rows,search,filter]);
  const approved=rows.filter(r=>r.status==='approved').length;const pending=rows.filter(r=>r.status==='pending').length;
  return <div className="page-body">
    <div className="page-title-row"><div><p className="eyebrow">{t('CUSTOMER OPPORTUNITIES')}</p><h1>{t('Recommendations')}</h1><p className="page-subtitle">{t('Explainable matches ranked by potential benefit and usage fit.')}</p></div><div className="count-pill"><Icon name="users" size={16}/>{t('{count} qualified customers',{count:rows.length})}</div></div>
    <div className="recs-summary"><div><div className="summary-icon"><Icon name="chart"/></div><span>{t('Eligible recommendations')}</span><strong>{rows.length}</strong></div><div><div className="summary-icon"><Icon name="clock"/></div><span>{t('Awaiting approval')}</span><strong>{pending}</strong></div><div><div className="summary-icon"><Icon name="check-circle"/></div><span>{t('Approved for contact')}</span><strong>{approved}</strong></div></div>
    <section className="surface-panel list-panel"><div className="list-toolbar"><div className="filter-tabs">{([['all','All customers'],['pending','Pending'],['approved','Approved'],['contacted','Contacted']] as const).map(([k,l])=><button key={k} className={filter===k?'active':''} onClick={()=>setFilter(k)}>{t(l)}</button>)}</div><label className="search-box"><Icon name="search" size={18}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder={t('Search customer name…')} aria-label={t('Search customers')}/></label></div>
      {loading?<Loading/>:error?<ErrorState message={error}/>:filtered.length===0?<EmptyState title={t('No customers found')} description={t('Try another search or switch the status filter.')}/>:<div className="table-wrap"><table className="data-table rec-table"><thead><tr><th>{t('Customer')}</th><th>{t('Current plan')}</th><th>{t('Recommended plan')}</th><th>{t('Match score')}</th><th>{t('Est. savings / mo')}</th><th>{t('Approval status')}</th><th/></tr></thead><tbody>{filtered.map(r=><tr key={r.id} className="clickable-row" onClick={()=>navigate(`/customers/${r.customer_id}`)}><td><div className="person-cell"><Avatar name={r.customer_name} seed={r.customer_id}/><div><strong>{r.customer_name}</strong><span className="table-hint">ID #{String(r.customer_id).padStart(4,'0')}</span></div></div></td><td>{r.current_package}</td><td><span className="plan-name">{r.proposed_package}</span></td><td><div className="score-cell"><span className="score-line"><i style={{width:`${r.score}%`}}/></span><strong>{r.score}<small>/100</small></strong></div></td><td className="savings-cell">+{money(r.estimated_savings_minor)}</td><td><Badge status={r.status}/></td><td><span className="row-go"><Icon name="chevron-right" size={18}/></span></td></tr>)}</tbody></table></div>}
      <div className="table-bottom"><span>{t('Showing {shown} of {total} opportunities',{shown:filtered.length,total:rows.length})}</span><span>{t('Sorted by rule-based match score')} <Icon name="arrow-right" size={13}/></span></div></section>
    <p className="recs-disclaimer"><Icon name="info" size={15}/>{t('Scores rank explainable fit (not conversion probability). Estimated savings compare historical average charges with proposed plan price.')}</p>
  </div>;
}
