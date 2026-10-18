import { useEffect, useState } from 'react';
import { Popup } from './Popup';
import { useLang } from '../i18n';

const SEEN_KEY = 'schoolstore_welcome_seen';

function alreadySeen(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    sessionStorage.setItem(SEEN_KEY, '1');
  } catch {
    // storage blocked: the note may show again next visit, which is harmless
  }
}

/**
 * A small welcome note, shown once per browser session. It waits while
 * another dialog (the first-visit language chooser) is open, so the two never
 * stack, and it opens after the page has painted, so it never holds up loading.
 */
export function WelcomePopup({ blocked }: { blocked: boolean }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (blocked || alreadySeen()) return;
    markSeen();
    setOpen(true);
  }, [blocked]);

  return (
    <Popup
      isOpen={open}
      onClose={() => setOpen(false)}
      message={t('welcome.message')}
      confirmLabel={t('common.close')}
      cancelLabel={null}
    />
  );
}
