import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
const Context = createContext<{revision:number;refresh:()=>void}|null>(null);
export function RefreshProvider({children}:{children:ReactNode}){
  const [revision,setRevision]=useState(0);
  const refresh=useCallback(()=>setRevision(v=>v+1),[]);
  const value=useMemo(()=>({revision,refresh}),[revision,refresh]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useRefresh(){const v=useContext(Context);if(!v)throw new Error('RefreshProvider missing');return v;}
