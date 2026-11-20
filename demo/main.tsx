import { createRoot } from 'react-dom/client';
import Home from '../app/page';
import '../app/globals.css';
import './demo.css';

// GitHub Pages serves static files only; the service worker (sw.js) answers the app's /api
// requests in the browser. Wait until it controls this page before the app starts fetching.
async function start() {
  let ok = false;
  try {
    if ('serviceWorker' in navigator) {
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller)
        await new Promise(r => { navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }); setTimeout(r, 4000); });
      ok = !!navigator.serviceWorker.controller;
    }
  } catch { ok = false; }
  createRoot(document.getElementById('root')!).render(
    <>
      <div className="demobar" role="note">
        <strong>Public demo</strong>
        {ok
          ? ' · Includes the 12,967-record reference molecule library. Photos you upload and results you save stay in this browser only. Research use only.'
          : ' · This browser blocked the demo’s offline storage (for example in private browsing), so saving and the molecule library are unavailable. Plate reading still works.'}
      </div>
      <Home />
    </>,
  );
}
start();
