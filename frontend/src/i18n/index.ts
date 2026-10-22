import { useCallback, useSyncExternalStore } from 'react';
import { messages, type MessageKey } from './messages';

/**
 * The parent's language: English by default, or Gujarati or Hindi when the parent
 * switches; the choice is remembered on the phone. Staff pages stay in English.
 */
export type Lang = 'en' | 'gu' | 'hi';
export type { MessageKey };

/** English first: it is the default. */
export const LANGUAGES: { code: Lang; name: string; bcp47: string }[] = [
  { code: 'en', name: 'English', bcp47: 'en-IN' },
  { code: 'gu', name: 'ગુજરાતી', bcp47: 'gu-IN' },
  { code: 'hi', name: 'हिन्दी', bcp47: 'hi-IN' },
];

const LANG_KEY = 'schoolstore_lang';

function readSaved(): Lang | null {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    return saved === 'en' || saved === 'gu' || saved === 'hi' ? saved : null;
  } catch {
    return null;
  }
}

let chosen: Lang | null = readSaved();
const listeners = new Set<() => void>();

function applyToDocument(lang: Lang) {
  document.documentElement.lang = LANGUAGES.find((l) => l.code === lang)?.bcp47 ?? 'en-IN';
}
applyToDocument(chosen ?? 'en');

export function setLang(lang: Lang) {
  chosen = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Private mode: the choice lasts until the page closes.
  }
  applyToDocument(lang);
  listeners.forEach((listener) => listener());
}

/** Whether the parent has picked a language yet (read now, not from an old render). */
export function hasChosenLanguage() {
  return chosen !== null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Fills {name}-style blanks in a message. */
function fill(text: string, vars?: Record<string, string | number>) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>) {
  const entry = messages[key];
  return fill(entry[lang] || entry.en, vars);
}

export function useLang() {
  const saved = useSyncExternalStore(subscribe, () => chosen, () => chosen);
  const lang: Lang = saved ?? 'en';
  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang],
  );
  return { lang, t, hasChosen: saved !== null, setLang };
}
