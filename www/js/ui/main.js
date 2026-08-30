/** main.js — Einstiegspunkt: Ansichten registrieren und App starten. */

import { registriere, start } from './app.js';
import * as home from './home.js';
import * as calcview from './calcview.js';
import * as quick from './quick.js';
import * as materials from './materials.js';
import * as history from './history.js';
import * as settings from './settings.js';

registriere('home', home);
registriere('calc', calcview);
registriere('dxf', calcview.dxfAnsicht);
registriere('quick', quick);
registriere('materials', materials);
registriere('history', history);
registriere('settings', settings);

start();

/* Offline-Betrieb: Service Worker registrieren (nur über http/https, nicht bei file://). */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(e => console.warn('Service Worker nicht registriert:', e));
  });
}
