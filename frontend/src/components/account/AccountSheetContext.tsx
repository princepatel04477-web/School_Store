import { createContext, useContext, useState, type ReactNode } from 'react';

interface AccountSheetContextType {
  open: boolean;
  returnTo: string | null;
  openSheet: (returnTo?: string) => void;
  closeSheet: () => void;
}

const AccountSheetContext = createContext<AccountSheetContextType>({
  open: false,
  returnTo: null,
  openSheet: () => {},
  closeSheet: () => {},
});

export function AccountSheetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [returnTo, setReturnTo] = useState<string | null>(null);

  const openSheet = (path?: string) => {
    setReturnTo(path || null);
    setOpen(true);
  };

  const closeSheet = () => {
    setOpen(false);
    setReturnTo(null);
  };

  return (
    <AccountSheetContext.Provider value={{ open, returnTo, openSheet, closeSheet }}>
      {children}
    </AccountSheetContext.Provider>
  );
}

export function useAccountSheet() {
  return useContext(AccountSheetContext);
}
