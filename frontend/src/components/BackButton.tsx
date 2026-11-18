import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from './ui/icons';
import { useLang } from '../i18n';

/** Fired on window when the round back button is tapped. A page that can go back
 *  inside itself (the shop's state > city > school picker) cancels it and steps back. */
export const BACK_EVENT = 'schoolstore:back';

/**
 * Lets a page take the back button while `enabled` is true. The handler runs
 * instead of leaving the page.
 */
export function useBackHandler(handler: () => void, enabled: boolean) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return undefined;
    const onBack = (event: Event) => {
      event.preventDefault();
      handlerRef.current();
    };
    window.addEventListener(BACK_EVENT, onBack);
    return () => window.removeEventListener(BACK_EVENT, onBack);
  }, [enabled]);
}

/** Was this page reached from another page of the store in this tab? */
function hasStoreHistory(): boolean {
  const state = window.history.state as { idx?: number } | null;
  return typeof state?.idx === 'number' && state.idx > 0;
}

/**
 * Round back button for phones: a circle with a back arrow. Goes one step back
 * inside a page when the page offers that, otherwise to the previous page, and
 * home when the store was opened straight on this page.
 */
export function BackButton({ className = '' }: { className?: string }) {
  const navigate = useNavigate();
  const { t } = useLang();

  const goBack = () => {
    const event = new Event(BACK_EVENT, { cancelable: true });
    const notHandled = window.dispatchEvent(event);
    if (!notHandled) return;
    if (hasStoreHistory()) navigate(-1);
    else navigate('/');
  };

  return (
    <button type="button" className={`round-back-btn ${className}`.trim()} onClick={goBack} aria-label={t('nav.back')}>
      <ArrowLeft width={20} height={20} strokeWidth={2.25} />
    </button>
  );
}
