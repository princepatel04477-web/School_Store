import { useEffect, useState } from 'react';
import { useLang } from '../i18n';
import { speak, stopSpeaking, useCanSpeak } from '../i18n/speech';
import './listenButton.css';

/**
 * Reads a screen's instructions aloud in the parent's language. Hidden when the
 * phone has no voice for that language.
 */
export function ListenButton({ text }: { text: string }) {
  const { lang, t } = useLang();
  const canSpeak = useCanSpeak(lang);
  const [speaking, setSpeaking] = useState(false);

  // Stop when the screen changes or the button goes away.
  useEffect(() => () => stopSpeaking(), [text]);

  if (!canSpeak) return null;

  return (
    <button
      type="button"
      className={`listen-btn ${speaking ? 'is-speaking' : ''}`}
      aria-label={speaking ? t('listen.stop') : t('listen.play')}
      onClick={() => {
        if (speaking) {
          stopSpeaking();
          setSpeaking(false);
          return;
        }
        setSpeaking(true);
        speak(text, lang, () => setSpeaking(false));
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
        {speaking ? (
          <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        ) : (
          <path
            d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        )}
      </svg>
      <span>{speaking ? t('listen.stop') : t('listen.play')}</span>
    </button>
  );
}
