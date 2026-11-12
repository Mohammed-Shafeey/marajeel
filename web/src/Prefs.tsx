import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import i18n, { applyDocument, loadPrefs, savePrefs, setDigits, type Prefs } from './i18n';

const Ctx = createContext<{ prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void } | null>(null);

/** Per-viewer display preferences (language, digits, theme), kept in localStorage. */
export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, set] = useState<Prefs>(loadPrefs);

  useEffect(() => {
    setDigits(prefs.digits);
    void i18n.changeLanguage(prefs.lang);
    applyDocument(prefs);
    savePrefs(prefs);
    if (prefs.theme !== 'auto') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyDocument(prefs);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [prefs]);

  const setPrefs = useCallback((p: Partial<Prefs>) => set((old) => ({ ...old, ...p })), []);
  return <Ctx.Provider value={{ prefs, setPrefs }}>{children}</Ctx.Provider>;
}

export function usePrefs() {
  const v = useContext(Ctx);
  if (!v) throw new Error('PrefsProvider missing');
  return v;
}
