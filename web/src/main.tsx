import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { installPreloadErrorHandler } from './app/preloadError';
import { applyTheme, readStoredMode } from './app/theme';

applyTheme(readStoredMode());
installPreloadErrorHandler();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
