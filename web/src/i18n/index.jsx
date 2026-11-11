import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import en from './en.js';
import fr from './fr.js';
import mfe from './mfe.js';
import ar from './ar.js';

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'mfe', label: 'Kreol Morisien' },
  { code: 'ar', label: 'العربية' },
];
const DICTS = { en, fr, mfe, ar };
const LOCALES = { en: 'en-GB', fr: 'fr-FR', mfe: 'fr-MU', ar: 'ar' };
const RTL = new Set(['ar']);

// Keys are dotted paths; a key may itself contain dots (e.g. audit actions like 'job.create').
function lookup(node, key) {
  if (node == null || typeof node !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(node, key)) return node[key];
  const i = key.indexOf('.');
  if (i < 0) return undefined;
  return lookup(node[key.slice(0, i)], key.slice(i + 1));
}

const I18nContext = createContext(null);

export function initialLang() {
  try {
    const saved = localStorage.getItem('fp-lang');
    if (saved && DICTS[saved]) return saved;
  } catch { /* storage blocked */ }
  const nav = (navigator.language || 'en').slice(0, 2);
  return DICTS[nav] ? nav : 'en';
}

export function I18nProvider({ lang, setLang, timeZone, currency, children }) {
  useEffect(() => {
    document.documentElement.lang = lang === 'mfe' ? 'mfe' : lang;
    document.documentElement.dir = RTL.has(lang) ? 'rtl' : 'ltr';
    try { localStorage.setItem('fp-lang', lang); } catch { /* storage blocked */ }
  }, [lang]);

  const t = useCallback((key, params) => {
    let s = lookup(DICTS[lang], key);
    if (s == null) s = lookup(en, key);
    if (s == null) return key;
    if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] ?? m));
    return s;
  }, [lang]);

  const value = useMemo(() => {
    const locale = LOCALES[lang];
    const tz = timeZone || undefined;
    const make = (opts) => {
      try { return new Intl.DateTimeFormat(locale, { timeZone: tz, ...opts }); } catch { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts }); }
    };
    const dateF = make({ day: 'numeric', month: 'short', year: 'numeric' });
    const dayF = make({ weekday: 'short', day: 'numeric', month: 'short' });
    const timeF = make({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const numF = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    const moneyF = (() => {
      try { return new Intl.NumberFormat(locale, { style: 'currency', currency: currency || 'MUR', maximumFractionDigits: 2 }); } catch { return numF; }
    })();
    const fmt = {
      date: (iso) => (iso ? dateF.format(new Date(iso)) : '—'),
      day: (iso) => (iso ? dayF.format(new Date(iso)) : '—'),
      time: (iso) => (iso ? timeF.format(new Date(iso)) : '—'),
      dateTime: (iso) => (iso ? `${dayF.format(new Date(iso))}, ${timeF.format(new Date(iso))}` : '—'),
      number: (n) => (n == null ? '—' : numF.format(n)),
      money: (n) => (n == null ? '—' : moneyF.format(n)),
      relative: (iso) => {
        if (!iso) return '';
        const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
        const rtf = new Intl.RelativeTimeFormat(locale === 'fr-MU' ? 'fr' : locale, { numeric: 'auto' });
        if (Math.abs(mins) < 60) return rtf.format(-mins, 'minute');
        if (Math.abs(mins) < 48 * 60) return rtf.format(-Math.round(mins / 60), 'hour');
        return rtf.format(-Math.round(mins / 1440), 'day');
      },
    };
    return { lang, setLang, t, fmt, dir: RTL.has(lang) ? 'rtl' : 'ltr', timeZone: tz };
  }, [lang, setLang, t, timeZone, currency]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);

export function useLangState() {
  const [lang, setLang] = useState(initialLang);
  return [lang, setLang];
}

/** Map an API error to a sentence in the current language. */
export function errorText(t, err) {
  if (!err) return '';
  const code = err.code || 'SERVER_ERROR';
  const s = t(`errors.${code}`);
  return s === `errors.${code}` ? t('errors.SERVER_ERROR') : s;
}
