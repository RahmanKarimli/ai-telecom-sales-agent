import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { isDemoMode } from '../lib/api';
import { useLanguage } from '../i18n/LanguageContext';
import type { Language } from '../i18n/translations';
import { Icon } from './Icon';
import { ThemeToggle } from './ThemeToggle';

export function Layout(){
  const [mobileOpen,setMobileOpen]=useState(false);
  const {t,language,setLanguage}=useLanguage();
  const {pathname}=useLocation();
  const items=[{to:'/',label:'Overview',icon:'grid' as const,end:true},{to:'/recommendations',label:'Recommendations',icon:'users' as const,end:false}];
  const activeArea=pathname.startsWith('/calls')?'Call workspace':pathname.startsWith('/customers')?'Customer intelligence':'Workspace';
  return <div className="app-shell">
    {mobileOpen&&<button aria-label="Close menu" className="scrim" onClick={()=>setMobileOpen(false)}/>}
    <aside className={`sidebar ${mobileOpen?'sidebar-open':''}`}>
      <div className="brand"><img className="brand-symbol" src="/telsyai-mark.png" alt="" width="54" height="54"/><div className="brand-name">TelsyAİ<small>TELECOM INTELLIGENCE</small></div></div>
      <div className="side-divider"/>
      <div className="sidebar-content">
        <p className="side-label">{t('MAIN WORKSPACE')}</p>
        <nav aria-label="Main navigation">{items.map(item=><NavLink key={item.to} to={item.to} end={item.end} onClick={()=>setMobileOpen(false)} className={({isActive})=>`nav-item ${isActive?'nav-active':''}`}><Icon name={item.icon}/><span>{t(item.label)}</span><Icon name="arrow-right" size={13}/></NavLink>)}</nav>
        <p className="side-label side-label-secondary">{t('OPERATIONS')}</p>
        <div className="side-info"><Icon name="headset" size={18}/><span>{t('Employee-assisted outreach')}</span></div>
      </div>
      <div className="sidebar-bottom"><div className="side-help"><div className="help-icon"><Icon name="shield" size={18}/></div><strong>{t('Human in control')}</strong><p>{t('Every customer contact requires employee approval before a demo call.')}</p></div><div className="side-profile"><div className="staff-avatar">OP</div><div><strong>{t('Demo operator')}</strong><span>{t('Employee workspace')}</span></div><Icon name="more" size={18}/></div></div>
    </aside>
    <div className="main-column">
      <header className="topbar"><div className="topbar-left"><button className="icon-button menu-toggle" aria-label="Open menu" onClick={()=>setMobileOpen(true)}><Icon name="menu"/></button><span className="topbar-path">{t('Workspace')}</span><Icon name="chevron-right" size={15}/><span>{t(activeArea)}</span></div><div className="topbar-right">
        <ThemeToggle/><div className="language-switcher" role="group" aria-label={t('Switch language')} title={t('Language')}>
          {(['az','en','ru'] as Language[]).map(l=><button key={l} type="button" className={l===language?'selected':''} lang={l} aria-pressed={l===language} onClick={()=>setLanguage(l)}>{l.toUpperCase()}</button>)}
        </div>
        <span className={`environment-pill ${isDemoMode?'environment-preview':'environment-connected'}`}><i/>{t(isDemoMode?'PREVIEW MODE':'API CONNECTED')}</span><span className="topbar-divider"/><div className="top-avatar">OP</div></div></header>
      <main className="main-content" key={pathname}><Outlet/></main>
      <footer className="main-footer"><span>{t('TelsyAİ · Synthetic data · Hackathon demo')}</span><span>{t('The right offer, smart choice, real savings.')}</span></footer>
    </div>
  </div>;
}
