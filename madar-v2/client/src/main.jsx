import React from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import App from './App.jsx';
import './styles/tokens.css';
import './styles/base.css';
import './styles/auth.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator && !Capacitor.isNativePlatform()) {
  window.addEventListener('load', () => {
    let refreshing = false;
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(__MADAR_BUILD_VERSION__)}`, { scope: '/' }).catch((error) => {
      console.warn('MADAR offline shell could not be installed:', error);
    });
  }, { once: true });
}
