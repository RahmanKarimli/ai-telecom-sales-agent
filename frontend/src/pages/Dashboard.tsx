import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getDashboard, getRecommendations, isDemoMode } from '../lib/api';
import { money, moneyShort } from '../lib/format';
import { useRefresh } from '../context/RefreshContext';
import { useLanguage } from '../i18n/LanguageContext';
import type { DashboardMetrics, RecommendationRow } from '../types';
import { Icon } from '../components/Icon';
import { Avatar, Badge, ErrorState, Loading, SectionTitle } from '../components/UI';

export function Dashboard(){
  const {revision}=useRefresh();const navigate=useNavigate();const {t}=useLanguage();
  const [metrics,setMetrics]=useState<DashboardMetrics|null>(null);
  const [rows,setRows]=useState<RecommendationRow[]>([]);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  useEffect(()=>{let active=true;setLoading(true);Promise.all([getDashboard(),getRecommendations()]).then(([m,r])=>{if(active){setMetrics(m);setRows(r);setError('');}}).catch(e=>{if(active)setError((e as Error).message);}).finally(()=>{if(active)setLoading(false);});return ()=>{active=false;};},[revision]);
  if(loading)return <Loading/>;
  if(error||!metrics)return <ErrorState message={error||'Dashboard unavailable'} />;
  const total=metrics.calls_completed;
  const acceptance=total?Math.round(metrics.accepted_offers/total*100):0;
  const outcomes=[{label:'Accepted',value:metrics.accepted_offers,className:'outcome-accepted'},{label:'Rejected',value:metrics.rejected_offers,className:'outcome-rejected'},{label:'Follow-up',value:metrics.follow_up_requests,className:'outcome-followup'},{label:'Human requested',value:metrics.human_requests,className:'outcome-human'}];
  return <div className="page-body dashboard-page">
    <div className="page-title-row"><div><p className="eyebrow">{t('GOOD MORNING, OPERATOR')}</p><h1>{t('Overview')}<span className="title-spark" aria-hidden="true">✳</span></h1><p className="page-subtitle">{t('Your customer opportunities, conversations, and outcomes in one place.')}</p></div><Link to="/recommendations" className="btn btn-primary"><Icon name="users" size={16}/> {t('View recommendations')} <Icon name="arrow-right" size={16}/></Link></div>
    <section className="hero-signal" aria-label={t('AI-assisted intelligence')}>
      <div className="hero-copy"><div className="hero-live"><span className="hero-live-dot"/>{t('LIVE DEMO SYSTEM')}<span className="hero-live-divider"/>{t('AI-assisted intelligence')}</div>
        <p className="hero-kicker">{t('Your next best conversation')}</p>
        <h2>{t('The right offer, smart choice, real savings.')}</h2>
        <p className="hero-description">{t('Turn real usage insights into personal, employee-approved conversations.')}</p>
        <Link className="hero-action" to="/recommendations">{t('Explore opportunities')} <Icon name="arrow-up-right" size={16}/></Link>
      </div>
      <div className="hero-art" aria-hidden="true">
        <div className="orbit-circle orbit-circle-outer"/><div className="orbit-circle orbit-circle-middle"/><div className="orbit-circle orbit-circle-inner"/>
        <div className="orbital-spin"><i/></div><div className="orbit-core"><span className="core-bars"><i/><i/><i/><i/><i/></span></div>
        <div className="orbit-float float-top"><span className="float-dot"/>{t('Smart matching')}</div>
        <div className="orbit-float float-bottom"><Icon name="shield" size={15}/>{t('Verified conversation')}</div>
      </div>
    </section>
    {isDemoMode&&<div className="notice notice-demo"><Icon name="info" size={17}/><span><strong>{t('Interactive preview.')}</strong> {t('All customers, prices, decisions, and metrics use fictional demo data. AI and voice generation are not running until the backend is connected.')}</span></div>}
    <div className="metric-grid">
      <div className="metric-card"><div className="metric-top"><span>{t('Recommended customers')}</span><span className="metric-icon"><Icon name="users"/></span></div><div className="metric-value">{metrics.recommended_customers}<span className="metric-unit">{t('customers')}</span></div><div className="metric-footer"><span className="metric-indicator green"><Icon name="check-circle" size={14}/>{t('Eligible')}</span><span>{t('Rule-based matches')}</span></div></div>
      <div className="metric-card"><div className="metric-top"><span>{t('Potential monthly savings')}</span><span className="metric-icon"><Icon name="chart"/></span></div><div className="metric-value">{moneyShort(metrics.potential_monthly_savings_minor)}<span className="metric-unit">{t('AZN / mo')}</span></div><div className="metric-footer"><span className="metric-indicator green"><Icon name="arrow-up-right" size={14}/>{t('Estimated')}</span><span>{t('Across all recommendations')}</span></div></div>
      <div className="metric-card"><div className="metric-top"><span>{t('Completed conversations')}</span><span className="metric-icon"><Icon name="phone"/></span></div><div className="metric-value">{metrics.calls_completed}<span className="metric-unit">{t('of {count} started',{count:metrics.calls_started})}</span></div><div className="metric-footer"><span className="metric-indicator blue"><Icon name="activity" size={14}/>{t('Tracked')}</span><span>{t('Saved interaction results')}</span></div></div>
      <div className="metric-card"><div className="metric-top"><span>{t('Acceptance rate')}</span><span className="metric-icon"><Icon name="check-check"/></span></div><div className="metric-value">{acceptance}<span className="metric-unit">%</span></div><div className="metric-footer"><span className="metric-indicator neutral">{metrics.accepted_offers} / {total||0}</span><span>{t('Confirmed interest only')}</span></div></div>
    </div>
    <div className="dashboard-grid">
      <section className="surface-panel opportunities-panel"><SectionTitle eyebrow={t('PRIORITIZED BY MATCH')} title={t('Top opportunities')} action={<Link className="text-link" to="/recommendations">{t('View all')} <Icon name="arrow-right" size={15}/></Link>}/>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>{t('Customer')}</th><th>{t('Suggested offer')}</th><th>{t('Match score')}</th><th>{t('Savings / mo')}</th><th>{t('Status')}</th><th/></tr></thead><tbody>{rows.slice(0,5).map(r=><tr key={r.id} className="clickable-row" onClick={()=>navigate(`/customers/${r.customer_id}`)}><td><div className="person-cell"><Avatar name={r.customer_name} seed={r.customer_id}/><strong>{r.customer_name}</strong></div></td><td>{r.proposed_package}</td><td><div className="score-cell"><span className="score-line"><i style={{width:`${r.score}%`}}/></span><strong>{r.score}</strong></div></td><td className="savings-cell">+{money(r.estimated_savings_minor)}</td><td><Badge status={r.status}/></td><td><Icon name="chevron-right" size={17}/></td></tr>)}</tbody></table></div>
      </section>
      <section className="surface-panel outcomes-panel"><SectionTitle eyebrow={t('LIVE WORKFLOW RESULTS')} title={t('Conversation outcomes')}/><div className="outcome-intro"><span>{t('Resolved interactions')}</span><strong>{total}</strong></div><div className="outcome-stacked">{outcomes.map(o=><span key={o.label} className={o.className} style={{width:total?`${o.value/total*100}%`:'0%'}} />)}{!total&&<span className="stack-empty"/>}</div><div className="outcome-list">{outcomes.map(o=><div key={o.label} className="outcome-item"><span><i className={`legend-dot ${o.className}`}/>{t(o.label)}</span><strong>{o.value}</strong></div>)}</div><div className="outcome-secondary"><div><span>{t('Est. staff time saved')}</span><strong>{metrics.estimated_staff_time_saved_minutes} {t('min')}</strong></div><div><span>{t('Accepted offer savings / mo')}</span><strong>{money(metrics.estimated_savings_on_accepted_minor)}</strong></div></div><div className="outcomes-foot"><Icon name="info" size={16}/><span>{t('Accepted means confirmed interest for employee processing, not package activation.')}</span></div></section>
    </div>
    <div className="insights-band"><div className="insight-icon"><Icon name="shield" size={20}/></div><div><strong>{t('Explainable recommendations. Employee-controlled outreach.')}</strong><p>{t('Offer ranking uses observed usage and pricing rules. Conversations only start after an employee approves the contact.')}</p></div><Link className="btn btn-outline" to="/recommendations">{t('Review opportunities')} <Icon name="arrow-right" size={16}/></Link></div>
  </div>;
}
