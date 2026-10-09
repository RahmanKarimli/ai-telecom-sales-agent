import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../i18n/LanguageContext';
import { Icon } from './Icon';

export function ThemeToggle({compact = false}: {compact?: boolean}) {
  const {theme, setTheme} = useTheme();
  const {t} = useLanguage();
  return <div className={`theme-switcher ${compact ? 'theme-switcher-compact' : ''}`} role="group" aria-label={t('Theme')}>
    <button type="button" aria-pressed={theme === 'light'} title={t('Light theme')} aria-label={t('Light theme')}
      className={theme === 'light' ? 'selected' : ''} onClick={() => setTheme('light')}><Icon name="sun" size={15}/><span>{t('Light')}</span></button>
    <button type="button" aria-pressed={theme === 'dark'} title={t('Dark theme')} aria-label={t('Dark theme')}
      className={theme === 'dark' ? 'selected' : ''} onClick={() => setTheme('dark')}><Icon name="moon" size={15}/><span>{t('Dark')}</span></button>
  </div>;
}
