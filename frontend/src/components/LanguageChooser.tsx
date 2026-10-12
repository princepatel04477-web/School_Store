import { useEffect } from 'react';
import { LANGUAGES, useLang, type Lang } from '../i18n';
import './languageChooser.css';

/**
 * Three big buttons, each written in its own script, so a parent who reads only
 * Gujarati or only Hindi finds theirs without reading anything else.
 * Shown on the first visit and from the header's language button.
 */
export function LanguageChooser({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { lang, hasChosen, setLang } = useLang();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const choose = (code: Lang) => {
    setLang(code);
    onClose();
  };

  return (
    <div className="lang-backdrop" onClick={onClose}>
      <div
        className="lang-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="ભાષા પસંદ કરો · भाषा चुनें · Choose language"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="lang-prompt" lang="gu">ભાષા પસંદ કરો</p>
        <p className="lang-prompt" lang="hi">भाषा चुनें</p>
        <p className="lang-prompt" lang="en">Choose language</p>
        <div className="lang-options">
          {LANGUAGES.map((option) => (
            <button
              key={option.code}
              type="button"
              lang={option.code}
              className={`lang-option ${hasChosen && option.code === lang ? 'is-current' : ''}`}
              onClick={() => choose(option.code)}
            >
              <span className="lang-letter" aria-hidden="true">
                {option.code === 'gu' ? 'અ' : option.code === 'hi' ? 'अ' : 'A'}
              </span>
              <span className="lang-name">{option.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The letter shown on the header button for the current language. */
export function languageLetter(lang: Lang) {
  return lang === 'gu' ? 'અ' : lang === 'hi' ? 'अ' : 'A';
}
