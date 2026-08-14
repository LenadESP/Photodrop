import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import './index.css';
import { App } from './App';
import { AuthProvider } from './context/auth';
import { ToastProvider } from './components/Toast';
import { I18nProvider, applyLocale, resolveInitialLocale } from './i18n';

// Apply a saved theme choice before first paint. With no saved choice we fall
// through to the prefers-color-scheme default in CSS (no flash, and no inline
// script — which the CSP would block anyway).
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'dark') document.documentElement.classList.add('theme-dark');
else if (savedTheme === 'light') document.documentElement.classList.add('theme-light');

// Same deal for language: resolve it (saved choice → device language → English)
// and set <html lang> before React mounts, so the first paint is already in the
// right language and assistive tech never sees the wrong one.
applyLocale(resolveInitialLocale());

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
);
