import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './design/tokens.css';
import './design/base.css';
import './design/extra.css';
import { App } from './app/App';
import { setupServiceWorker } from './lib/sw';

setupServiceWorker();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Emulator-only test hook: lets browser tests sign in with a custom token minted by the Admin SDK.
if (import.meta.env.VITE_USE_EMULATORS === '1') {
  import('firebase/auth').then(({ signInWithCustomToken }) => import('./lib/firebase').then(({ auth }) => {
    (window as unknown as { __qareebSignIn?: (t: string) => Promise<void> }).__qareebSignIn = async (t: string) => { await signInWithCustomToken(auth, t); };
  }));
}
