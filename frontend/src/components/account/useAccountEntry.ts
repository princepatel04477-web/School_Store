import { useAuth } from '../../auth';
import { homeFor } from '../../App';
import { useLang } from '../../i18n';

export interface AccountEntry {
  label: string;
  ariaLabel: string;
  to: string;
  isSignedIn: boolean;
}

/**
 * Shared hook determining the account link destination, label, and signed-in state.
 * While auth is loading or user is signed out:
 *   - label: 'Sign in', to: '/login', isSignedIn: false
 * When signed in as PARENT:
 *   - label: 'My account', to: '/parent', isSignedIn: true
 * When signed in as staff (TEACHER, ADMIN, BOSS, RETAILER, SCHOOL_ADMIN):
 *   - label: 'My account', to: homeFor(role, city), isSignedIn: true
 */
export function useAccountEntry(): AccountEntry {
  const { user, loading } = useAuth();
  const { t } = useLang();

  if (loading || !user) {
    return {
      label: t('nav.signIn'),
      ariaLabel: t('nav.signIn'),
      to: '/login',
      isSignedIn: false,
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
