import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { installPreloadErrorHandler } from './app/preloadError';
import { bootSettings } from './settings/boot';

bootSettings();
installPreloadErrorHandler();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
