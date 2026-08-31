/* sw.js — Service Worker: die App läuft vollständig offline.
 *
 * Update-Ablauf (das ist der Teil, der leicht schiefgeht):
 *   1. Der Browser lädt diese Datei bei jedem Start neu. Ändert sich auch nur
 *      ein Zeichen — hier die CACHE-Kennung —, gilt der Worker als neu.
 *   2. Der neue Worker installiert sich und legt seinen eigenen Cache an,
 *      wartet danach aber ABSICHTLICH (kein skipWaiting beim Installieren).
 *      Sonst tauschte er die Dateien unter einer geöffneten Seite aus und die
 *      App liefe mit halb altem, halb neuem Code weiter.
 *   3. Die App meldet dem Benutzer „Neue Version verfügbar".
 *   4. Erst auf seinen Knopfdruck schickt die App SKIP_WARTEN, der neue Worker
 *      übernimmt und die Seite lädt genau einmal neu.
 *
 * WICHTIG: CACHE muss bei jeder Veröffentlichung erhöht werden. Ein Test
 * (tests/version.test.js) vergleicht die Kennung mit core/version.js.
 */

const CACHE = 'laserkalk-1.0.6-7';

const DATEIEN = [
  './', './index.html', './manifest.webmanifest',
  './css/app.css',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/nivox.png',
  './js/ui/main.js', './js/ui/app.js', './js/ui/components.js', './js/ui/home.js',
  './js/ui/calcview.js', './js/ui/quick.js', './js/ui/materials.js', './js/ui/history.js',
  './js/ui/settings.js', './js/ui/matpicker.js', './js/ui/dxfcard.js',
  './js/core/money.js', './js/core/util.js', './js/core/db.js', './js/core/defaults.js',
  './js/core/material.js', './js/core/store.js', './js/core/version.js', './js/core/update.js',
  './js/core/felder.js',
  './js/calc/engine.js', './js/calc/nesting.js', './js/calc/machine.js',
  './js/dxf/parser.js', './js/dxf/geometry.js', './js/dxf/analyze.js', './js/dxf/render.js',
  './js/dxf/worker.js',
  './js/io/backup.js', './js/io/files.js',
];

self.addEventListener('install', e => {
  // Kein skipWaiting: der neue Worker wartet, bis der Benutzer zustimmt.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(DATEIEN)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WARTEN' || e.data?.typ === 'SKIP_WARTEN') self.skipWaiting();
  if (e.data?.typ === 'VERSION') {
    e.source?.postMessage({ typ: 'VERSION', cache: CACHE });
  }
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;   // fremde Adressen nie abfangen

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.ok) {
          const kopie = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, kopie)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
