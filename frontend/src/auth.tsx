import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { auth, User, logout, getStoredToken, setStoredTokens } from './api';
import { storeState } from './store/storeState';

type C = {
  user: User | null;
  loading: boolean;
  /** Resolves with the signed-in user so callers can route by role. */
  signIn: (u: string, p: string) => Promise<User>;
  signUp: (x: unknown) => Promise<User>;
  /** Parent sign-in with mobile number + OTP (creates the account on first use). */
  signInWithOtp: (phone: string, otp: string) => Promise<{ user: User; childrenLinked: number }>;
  signOut: () => void;
  /** Clears tokens and local user state without forcing a /login redirect. */
  clearSession: () => void;
};

const Context = createContext<C>({
  user: null,
  loading: true,
  signIn: async () => { throw new Error('not ready'); },
  signUp: async () => { throw new Error('not ready'); },
  signInWithOtp: async () => { throw new Error('not ready'); },
  signOut: () => {},
  clearSession: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    getStoredToken('access').then((access) => {
      if (!mounted) return;
      if (access) {
        auth.me()
          .then((u) => {
            if (!mounted) return;
            setUser(u);
            storeState.mergeOnSignIn(u);
          })
          .catch(() => logout())
          .finally(() => { if (mounted) setLoading(false); });
      } else {
        setLoading(false);
      }
    });
    return () => { mounted = false; };
  }, []);

  const save = async (tokens: { access: string; refresh: string; user?: User }) => {
    await setStoredTokens({ access: tokens.access, refresh: tokens.refresh });
    const signedIn = tokens.user ?? (await auth.me());
    setUser(signedIn);
    storeState.mergeOnSignIn(signedIn);
    return signedIn;
  };

  return (
    <Context.Provider
      value={{
        user,
        loading,
        signIn: async (u, p) => save(await auth.login(u, p)),
        signUp: async (x) => save(await auth.register(x)),
        signInWithOtp: async (phone, otp) => {
          const res = await auth.verifyOtp(phone, otp);
          const signedIn = await save(res);
          return { user: signedIn, childrenLinked: res.children_linked };
        },
        signOut: () => { logout(); },
        clearSession: () => {
          localStorage.removeItem('access');
          localStorage.removeItem('refresh');
          setUser(null);
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}

export const useAuth = () => useContext(Context);
