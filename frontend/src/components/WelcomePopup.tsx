import { useEffect, useState } from 'react';
import { Popup } from './Popup';
import { useLang } from '../i18n';

// Memory only (nothing is saved on the phone): the note shows once per page load or app open.
let seen = false;

function alreadySeen(): boolean {
  return seen;
}

function markSeen() {
  seen = true;
}

/**
 * A small welcome note, shown once per browser session. It waits while
 * another dialog (the first-visit language chooser) is open, so the two never
 * stack, and it opens after the page has painted, so it never holds up loading.
 */
export function WelcomePopup({ blocked, skip = false }: { blocked: boolean; skip?: boolean }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (alreadySeen()) return;
    // Only the home page greets. A parent who opens the shop, the checkout or the
    // payment return page directly (or refreshes there) goes straight to the page.
    if (skip) {
      markSeen();
      return;
    }
    if (blocked) return;
    markSeen();
    setOpen(true);
  }, [blocked, skip]);

  return (
    <Popup
      isOpen={open}
      onClose={() => setOpen(false)}
      className="popup--welcome"
      title={t('welcome.title')}
      message={t('welcome.body')}
      confirmLabel={t('welcome.start')}
      cancelLabel={null}
    />
  );
}
