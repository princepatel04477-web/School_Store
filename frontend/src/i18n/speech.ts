import { useEffect, useState } from 'react';
import { LANGUAGES, type Lang } from './index';

/**
 * Reads text aloud with the phone's own voice (no download, no cost).
 * A language is offered only when the phone has a voice for it: reading
 * Gujarati with an English voice would be worse than no button at all.
 */

const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

function bcp47(lang: Lang) {
  return LANGUAGES.find((l) => l.code === lang)?.bcp47 ?? 'en-IN';
}

function findVoice(lang: Lang): SpeechSynthesisVoice | undefined {
  if (!supported) return undefined;
  const prefix = lang.toLowerCase();
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang.toLowerCase().replace('_', '-') === bcp47(lang).toLowerCase()) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(prefix))
  );
}

/** True once the phone reports a voice for this language. */
export function useCanSpeak(lang: Lang): boolean {
  const [can, setCan] = useState(() => Boolean(findVoice(lang)));
  useEffect(() => {
    if (!supported) return;
    const update = () => setCan(Boolean(findVoice(lang)));
    update();
    window.speechSynthesis.addEventListener('voiceschanged', update);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update);
  }, [lang]);
  return can;
}

export function speak(text: string, lang: Lang, onEnd?: () => void) {
  if (!supported) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = bcp47(lang);
  const voice = findVoice(lang);
  if (voice) utterance.voice = voice;
  utterance.rate = 0.9; // a little slower than default, for first-time listeners
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();
  synth.speak(utterance);
}

export function stopSpeaking() {
  if (supported) window.speechSynthesis.cancel();
}
