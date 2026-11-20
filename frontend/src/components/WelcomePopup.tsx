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
      className="popup--welcome"
      title={t('welcome.title')}
      message={t('welcome.body')}
      confirmLabel={t('welcome.start')}
      cancelLabel={null}
    />
  );
}
