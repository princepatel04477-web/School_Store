import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { auth, User, logout, getStoredToken, setStoredTokens, isRefusedSession, rememberSignedInRole } from './api';
import { storeState } from './store/storeState';

type C = {
  user: User | null;
  loading: boolean;
  /**
   * The device holds a sign-in but the server could not be reached to confirm it
   * (no network, server down). The sign-in is kept; pages offer Retry.
   */
  offline: boolean;
  /** Asks the server again who is signed in, after `offline`. */
  retry: () => void;
  /** Resolves with the signed-in user so callers can route by role. */
  signIn: (u: string, p: string) => Promise<User>;
  signUp: (x: unknown) => Promise<User>;
  /** Parent sign-in with mobile number + OTP (creates the account on first use). */
  signInWithOtp: (phone: string, otp: string) => Promise<{ user: User; childrenLinked: number }>;
  signOut: () => void;
};

const Context = createContext<C>({
  user: null,
  loading: true,
  offline: false,
  retry: () => {},
  signIn: async () => { throw new Error('not ready'); },
  signUp: async () => { throw new Error('not ready'); },
  signInWithOtp: async () => { throw new Error('not ready'); },
  signOut: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const mounted = useRef(true);

  const loadMe = useCallback(async () => {
    const access = await getStoredToken('access');
    if (!mounted.current) return;
    if (!access) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const u = await auth.me();
      if (!mounted.current) return;
      setUser(u);
      setOffline(false);
      rememberSignedInRole(u.role);
      storeState.mergeOnSignIn(u);
    } catch (err) {
      if (!mounted.current) return;
      // Only a refused sign-in ends the session. A network error or a server
      // fault keeps the tokens, so the parent is not thrown out by a bad connection.
      if (isRefusedSession(err)) {
        // Stay on the loading screen: logout() is moving to the right page, and
        // letting Guard render now would race it to /login.
        await logout();
        return;
      }
      setOffline(true);
    }
    if (mounted.current) setLoading(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void loadMe();
    return () => { mounted.current = false; };
  }, [loadMe]);

  const save = async (tokens: { access: string; refresh: string; user?: User }) => {
    await setStoredTokens({ access: tokens.access, refresh: tokens.refresh });
    const signedIn = tokens.user ?? (await auth.me());
    rememberSignedInRole(signedIn.role);
    setUser(signedIn);
    setOffline(false);
    storeState.mergeOnSignIn(signedIn);
    return signedIn;
  };

  return (
    <Context.Provider
      value={{
        user,
        loading,
        offline,
        retry: () => { void loadMe(); },
        signIn: async (u, p) => save(await auth.login(u, p)),
        signUp: async (x) => save(await auth.register(x)),
        signInWithOtp: async (phone, otp) => {
          const res = await auth.verifyOtp(phone, otp);
          const signedIn = await save(res);
          return { user: signedIn, childrenLinked: res.children_linked };
        },
        signOut: () => { void logout(); },
      }}
    >
      {children}
    </Context.Provider>
  );
}

export const useAuth = () => useContext(Context);
