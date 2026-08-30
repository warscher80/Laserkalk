/* sw.js — Service Worker: die App läuft vollständig offline.
   Strategie: beim Installieren alles in den Cache; im Betrieb zuerst das Netz
   (damit Updates ankommen), bei Fehler der Cache. */

const CACHE = 'laserkalk-v1';
const DATEIEN = [
  './', './index.html', './manifest.webmanifest',
  './css/app.css',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './js/ui/main.js', './js/ui/app.js', './js/ui/components.js', './js/ui/home.js',
  './js/ui/calcview.js', './js/ui/quick.js', './js/ui/materials.js', './js/ui/history.js',
  './js/ui/settings.js', './js/ui/matpicker.js', './js/ui/dxfcard.js',
  './js/core/money.js', './js/core/util.js', './js/core/db.js', './js/core/defaults.js',
  './js/core/material.js', './js/core/store.js',
  './js/calc/engine.js', './js/calc/nesting.js', './js/calc/machine.js',
  './js/dxf/parser.js', './js/dxf/geometry.js', './js/dxf/analyze.js', './js/dxf/render.js',
  './js/io/backup.js', './js/io/files.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.ok && new URL(e.request.url).origin === location.origin) {
          const kopie = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, kopie)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
