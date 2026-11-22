import { useAuth } from '../../auth';
import { homeFor } from '../../App';
import { useLang } from '../../i18n';
import { useAccountSheet } from './AccountSheetContext';
import type { MouseEvent } from 'react';

export interface AccountEntry {
  label: string;
  ariaLabel: string;
  to: string;
  isSignedIn: boolean;
  onClick?: (e: MouseEvent) => void;
}

/**
 * Shared hook determining the account link destination, label, signed-in state,
 * and click handler (opens the mobile OTP sign-in sheet when signed out).
 */
export function useAccountEntry(): AccountEntry {
  const { user, loading } = useAuth();
  const { t } = useLang();
  const { openSheet } = useAccountSheet();

  if (loading || !user) {
    return {
      label: t('nav.signIn'),
      ariaLabel: t('nav.signIn'),
      to: '/login',
      isSignedIn: false,
      onClick: (e: MouseEvent) => {
        e.preventDefault();
        openSheet();
      },
    };
  }

  const destination = user.role === 'PARENT' ? '/parent' : homeFor(user.role, user.city);

  return {
    label: t('nav.myAccount'),
    ariaLabel: t('nav.myAccount'),
    to: destination,
    isSignedIn: true,
  };
}
