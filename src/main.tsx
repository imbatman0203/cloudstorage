import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './style.css'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then(registration => {
        // Warm-cache all same-origin JS/CSS bundles from visit #1 so offline works immediately.
        const assetUrls = Array.from(
          document.querySelectorAll('script[src], link[rel="stylesheet"][href]')
        )
          .map(el => el.getAttribute('src') || el.getAttribute('href'))
          .filter((url): url is string => Boolean(url && url.startsWith('/')))
        registration.active?.postMessage({ type: 'CACHE_URLS', urls: ['/', ...assetUrls] })
      })
      .catch(() => {
        // Service worker registration optional
      })
  })
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
