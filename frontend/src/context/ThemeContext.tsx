import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

type Theme = 'light' | 'dark';
type ThemeContextValue = { theme: Theme; setTheme: (next: Theme) => void; toggleTheme: () => void };
const STORAGE_KEY = 'telsyai-theme';
const LEGACY_STORAGE_KEY = 'azercell-advisor-theme';
const ThemeContext = createContext<ThemeContextValue | null>(null);

function initialTheme(): Theme {
  try { return (localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)) === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, update] = useState<Theme>(initialTheme);
  const setTheme = (next: Theme) => {
    update(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* private browser */ }
  };
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0D0A12' : '#FFFFFF');
  }, [theme]);
  const value = useMemo(() => ({theme, setTheme, toggleTheme: () => setTheme(theme === 'light' ? 'dark' : 'light')}), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be inside ThemeProvider');
  return context;
}
