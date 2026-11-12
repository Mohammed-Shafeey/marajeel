import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './ar';
import en from './en';

export type Lang = 'ar' | 'en';
export type Digits = 'latn' | 'arab';
export type Theme = 'light' | 'dark' | 'auto';
export interface Prefs {
  lang: Lang;
  digits: Digits;
  theme: Theme;
}

const KEY = 'marajeel.prefs';
export function loadPrefs(): Prefs {
  let p: Partial<Prefs> = {};
  try {
    p = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    /* private mode etc. */
  }
  return { lang: p.lang === 'en' ? 'en' : 'ar', digits: p.digits === 'arab' ? 'arab' : 'latn', theme: p.theme ?? 'auto' };
}
export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

let digits: Digits = loadPrefs().digits;
export const setDigits = (d: Digits) => (digits = d);

/** BCP-47 locale with Gregorian calendar and the chosen digits, e.g. "ar-u-ca-gregory-nu-latn". */
export const locale = (lang = i18n.language) => `${lang === 'en' ? 'en' : 'ar'}-u-ca-gregory-nu-${digits}`;

export const fmtNum = (n: number, opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale(), opts).format(n);
export const fmtPct = (x: number) => fmtNum(x, { style: 'percent', maximumFractionDigits: 0 });
export const fmtSigned = (n: number, digitsAfter = 0) =>
  (n > 0 ? '+' : n < 0 ? '−' : '') + fmtNum(Math.abs(n), { maximumFractionDigits: digitsAfter, minimumFractionDigits: digitsAfter });
export const fmtDate = (iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) =>
  new Intl.DateTimeFormat(locale(), opts).format(new Date(iso.length === 10 ? `${iso}T12:00:00` : iso));
export const fmtWeekday = (iso: string) => fmtDate(iso, { weekday: 'long' });

void i18n.use(initReactI18next).init({
  resources: { ar: { translation: ar }, en: { translation: en } },
  lng: loadPrefs().lang,
  fallbackLng: 'ar',
  interpolation: { escapeValue: false },
  returnNull: false,
});
i18n.services.formatter?.add('num', (value) => (typeof value === 'number' ? fmtNum(value) : String(value)));

export function applyDocument(p: Prefs) {
  const el = document.documentElement;
  el.lang = p.lang;
  el.dir = p.lang === 'ar' ? 'rtl' : 'ltr';
  const dark = p.theme === 'dark' || (p.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  el.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#111116' : '#D81B5C');
}

export default i18n;
