import { useLanguage } from '../i18n/LanguageContext';

export function LoadingSplash({compact = false}: {compact?: boolean}) {
  const {t} = useLanguage();
  return <div className={`loading-screen ${compact ? 'loading-screen-compact' : ''}`} role="status" aria-live="polite" aria-label={t('Loading workspace')}>
    <div className="loading-aura loading-aura-one" aria-hidden="true"/><div className="loading-aura loading-aura-two" aria-hidden="true"/>
    <div className="loading-content">
      <div className="loading-mark-frame"><img src="/telsyai-mark.png" alt="" className="loading-brand-mark" width={69} height={69}/></div>
      <div className="loading-wordmark">TelsyAİ <span>TELECOM INTELLIGENCE</span></div>
      <p className="loading-caption">{t('Preparing your workspace')}</p>
      <div className="loading-track" aria-hidden="true"><div className="loading-indicator"/></div>
      <span className="loading-footer">{t('The right offer, smart choice, real savings.')}</span>
    </div>
  </div>;
}
