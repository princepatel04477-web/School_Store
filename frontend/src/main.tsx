import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { AuthProvider } from './auth';
import App from './App';
import './tokens.css';
import './base.css';
import './styles.css';
import './components/ui/ui.css';
import './motion/interactions.css';

// A new release replaces the page's code files. A page opened before it can then fail to load a
// screen; reload once to pick up the new release instead of showing an error.
window.addEventListener('vite:preloadError', (event) => {
  const key = 'schoolstore_reloaded_for_release';
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});
// Once the page has run fine for a while, a later release may reload it again.
window.setTimeout(() => {
  try {
    sessionStorage.removeItem('schoolstore_reloaded_for_release');
  } catch {
    // storage unavailable: nothing to clear
  }
}, 15000);

const client = new QueryClient({ defaultOptions: { queries: { staleTime: 5 * 60 * 1000, retry: 1 } } });
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <AuthProvider>
          <MotionConfig reducedMotion="user">
            <App />
          </MotionConfig>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
