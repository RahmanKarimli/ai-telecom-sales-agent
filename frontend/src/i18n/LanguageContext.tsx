import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { dictionary } from './translations';
import type { Language } from './translations';

const STORAGE_KEY = 'telsyai-ui-language';
const LEGACY_STORAGE_KEY = 'orbit-ui-language';
const SUPPORTED: Language[] = ['az','en','ru'];
function initialLanguage(): Language {
  try {
    const stored=localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if(stored && SUPPORTED.includes(stored as Language))return stored as Language;
  } catch { /* restricted browsers */ }
  // Default to Azerbaijani for the hackathon, without relying on geolocation.
  return 'az';
}
function interpolate(s:string, vars?:Record<string,string|number>):string{
  return s.replace(/\{(\w+)\}/g,(_,key:string)=>String(vars?.[key]??`{${key}}`));
}
type LangContext={language:Language;setLanguage:(l:Language)=>void;t:(key:string,vars?:Record<string,string|number>)=>string;dateLocale:string};
const Context=createContext<LangContext|undefined>(undefined);
export function LanguageProvider({children}:{children:ReactNode}){
  const [language,setLanguageState]=useState<Language>(initialLanguage);
  const setLanguage=(l:Language)=>{setLanguageState(l);try{localStorage.setItem(STORAGE_KEY,l);}catch{/* storage unavailable */}};
  useEffect(()=>{document.documentElement.lang=language;document.title=language==='az'?'TelsyAİ — Tarif tövsiyələri':language==='ru'?'TelsyAİ — Рекомендации тарифов':'TelsyAİ — Telecom Recommendations';},[language]);
  const value=useMemo<LangContext>(()=>({language,setLanguage,t:(key,vars)=>interpolate(language==='en'?key:(dictionary[key]?.[language]??key),vars),dateLocale:language==='az'?'az-AZ':language==='ru'?'ru-RU':'en-US'}),[language]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useLanguage(){const context=useContext(Context);if(!context)throw new Error('useLanguage must be inside LanguageProvider');return context;}
