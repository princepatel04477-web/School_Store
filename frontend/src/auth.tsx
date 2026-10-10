import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { auth, User, logout } from './api';
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
};

const Context = createContext<C>({
  user: null,
  loading: true,
  signIn: async () => { throw new Error('not ready'); },
  signUp: async () => { throw new Error('not ready'); },
  signInWithOtp: async () => { throw new Error('not ready'); },
  signOut: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (localStorage.getItem('access')) {
      auth.me()
        .then((u) => {
          setUser(u);
          storeState.mergeOnSignIn(u);
        })
        .catch(() => logout())
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const save = async (tokens: { access: string; refresh: string; user?: User }) => {
    localStorage.setItem('access', tokens.access);
    localStorage.setItem('refresh', tokens.refresh);
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
      }}
    >
      {children}
    </Context.Provider>
  );
}

export const useAuth = () => useContext(Context);
