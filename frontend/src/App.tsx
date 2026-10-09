import { lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { HashRouter, Route, Routes, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Icon } from './components/Icon';
import { ThemeToggle } from './components/ThemeToggle';
import { LoadingSplash } from './components/LoadingSplash';
import { ThemeProvider } from './context/ThemeContext';
import { LanguageProvider, useLanguage } from './i18n/LanguageContext';
import type { Language } from './i18n/translations';
import { RefreshProvider, useRefresh } from './context/RefreshContext';
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({default:m.Dashboard})));
const Recommendations = lazy(() => import('./pages/Recommendations').then(m => ({default:m.Recommendations})));
const CustomerDetail = lazy(() => import('./pages/CustomerDetail').then(m => ({default:m.CustomerDetail})));
const CallPage = lazy(() => import('./pages/CallPage').then(m => ({default:m.CallPage})));
import { ApiError, clearAccessToken, getDashboard, isDemoMode, setAccessToken } from './lib/api';
import { resetDemo } from './data/mockApi';
function AccessGate({children}:{children:ReactNode}){
  const {t,language,setLanguage}=useLanguage();
  const [hasToken,setHasToken]=useState(isDemoMode);const [value,setValue]=useState('');
  const [checking,setChecking]=useState(!isDemoMode);const [error,setError]=useState('');
  useEffect(()=>{if(isDemoMode)return;let active=true;getDashboard().then(()=>{if(active)setHasToken(true);}).catch(e=>{if(active&&!(e instanceof ApiError&&e.status===401))setError((e as Error).message);}).finally(()=>{if(active)setChecking(false);});return()=>{active=false;};},[]);
  async function connect(){setAccessToken(value);setChecking(true);setError('');try{await getDashboard();setHasToken(true);}catch(e){clearAccessToken();setError((e as Error).message);}finally{setChecking(false);}}
  if(checking)return <LoadingSplash compact/>;
  if(isDemoMode||hasToken)return <>{children}</>;
  return <div className="auth-background"><div className="auth-card"><ThemeToggle compact/><div className="language-switcher auth-language" role="group" aria-label={t('Switch language')}>{(['az','en','ru'] as Language[]).map(l=><button key={l} lang={l} type="button" className={l===language?'selected':''} aria-pressed={l===language} onClick={()=>setLanguage(l)}>{l.toUpperCase()}</button>)}</div><div className="auth-mark"><img src="/telsyai-mark.png" alt="" width="39" height="39" /></div><h1>{t('Connect to your demo workspace')}</h1><p>{t('Enter the shared demo access token configured in your FastAPI server. This gate is not a production authentication system.')}</p>{error&&<p role="alert" className="inline-error">{error}</p>}<form onSubmit={e=>{e.preventDefault();if(value.trim())void connect();}}><label htmlFor="token">{t('Demo access token')}</label><input id="token" type="password" value={value} onChange={e=>setValue(e.target.value)} placeholder={t('Enter access token')} autoComplete="off" required/><button className="btn btn-primary" type="submit">{t('Access workspace')} <Icon name="arrow-right" size={16}/></button></form></div></div>;
}
function Shell(){const {refresh}=useRefresh();const {t}=useLanguage();const [menuOpen,setMenuOpen]=useState(false);return <><Suspense fallback={<LoadingSplash compact/>}><Routes><Route element={<Layout/>}><Route index element={<Dashboard/>}/><Route path="recommendations" element={<Recommendations/>}/><Route path="customers/:customerId" element={<CustomerDetail/>}/><Route path="calls/:callId" element={<CallPage/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Route></Routes></Suspense>{isDemoMode&&<div className="demo-control"><button aria-label={t('Demo settings')} title={t('Demo settings')} onClick={()=>setMenuOpen(o=>!o)}><Icon name="refresh" size={17}/></button>{menuOpen&&<div className="demo-popover"><strong>{t('Preview controls')}</strong><p>{t('Clear demo calls and approvals, then reload the sample workspace.')}</p><button onClick={()=>{resetDemo();refresh();setMenuOpen(false);location.hash='#/';}}>{t('Reset sample data')}</button></div>}</div>}{!isDemoMode&&<button className="token-clear" title={t('Sign out of demo')} onClick={()=>{clearAccessToken();window.location.reload();}}>{t('Sign out of demo')}</button>}</>}
function AppContent() {
  const [showIntro, setShowIntro] = useState(true);
  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => setShowIntro(false), reducedMotion ? 0 : 1100);
    return () => window.clearTimeout(timer);
  }, []);
  return <><RefreshProvider><HashRouter><AccessGate><Shell/></AccessGate></HashRouter></RefreshProvider>{showIntro&&<LoadingSplash/>}</>;
}
export default function App(){return <ThemeProvider><LanguageProvider><AppContent/></LanguageProvider></ThemeProvider>}
