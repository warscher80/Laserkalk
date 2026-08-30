/**
 * app.js — Programmrahmen: Kopfzeile, Navigation, Preisleiste.
 * Kennt die Kalkulationslogik nicht — nur die Ansichten.
 */

import { store } from '../core/store.js';
import { h, leere, icon, toast, note, sheet } from './components.js';
import { eur } from '../core/money.js';

const ANSICHTEN = {};
let aktuelle = null;

/** Registriert eine Ansicht unter ihrem Routennamen. */
export function registriere(name, modul) { ANSICHTEN[name] = modul; }

/* ---------------- Kopfzeile ---------------- */

function kopf() { return document.getElementById('hdr'); }

function baueKopf({ titel, untertitel, zurueck, aktionen }) {
  const el = leere(kopf());
  if (zurueck) {
    el.appendChild(h('button.hbtn', {
      'aria-label': 'Zurück',
      onclick: () => (typeof zurueck === 'string' ? gehe(zurueck) : history.back()),
    }, icon('back', 22)));
  } else {
    el.appendChild(h('.logo', null, logoSvg()));
  }
  el.appendChild(h('.htitles', null,
    h('.ht', { text: titel || 'LaserKalk' }),
    untertitel ? h('.hs', { text: untertitel }) : null,
  ));
  for (const a of (aktionen || [])) {
    el.appendChild(h('button.hbtn', { 'aria-label': a.label, title: a.label, onclick: a.onclick }, icon(a.icon, 21)));
  }
}

function logoSvg() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20'); svg.setAttribute('height', '20');
  svg.innerHTML =
    '<path d="M12 1.6 12 9.4" stroke="#ff9330" stroke-width="2.4" stroke-linecap="round"/>' +
    '<path d="M8.6 10.2h6.8l-1.5 3.2H10.1z" fill="#ff9330"/>' +
    '<circle cx="12" cy="15.6" r="1.5" fill="#ffd7ad"/>' +
    '<path d="M3.5 20.5h17" stroke="#7b8b9b" stroke-width="2.2" stroke-linecap="round"/>';
  return svg;
}

/** Kopfzeile von außen setzen (für Ansichten, die ihren Titel ändern). */
export function setzeKopf(opts) { baueKopf({ ...(aktuelle?.kopf || {}), ...opts }); }

/* ---------------- Preisleiste ---------------- */

let preisEl = null;
function preisleisteEl() { return preisEl || (preisEl = document.getElementById('pricebar')); }

/**
 * Zeigt die dauerhaft sichtbare Preisleiste (§40).
 * @param {{nettoCent:number, proStueckCent:number, stueckzahl:number, aktion?:{label,onclick}}} d
 */
export function zeigePreis(d) {
  const el = leere(preisleisteEl());
  document.body.classList.add('haspricebar');
  el.appendChild(h('.pb.main', null,
    h('.pl', { text: 'Gesamt netto' }),
    h('.pv', { text: eur(d.nettoCent) })));
  el.appendChild(h('.pb', null,
    h('.pl', { text: `Preis/Stück (${d.stueckzahl})` }),
    h('.pv', { text: eur(d.proStueckCent) })));
  if (d.aktion) {
    el.appendChild(h('button.btn.primary.pbtn', { text: d.aktion.label, onclick: d.aktion.onclick }));
  }
}

export function versteckePreis() {
  document.body.classList.remove('haspricebar');
  leere(preisleisteEl());
}

/* ---------------- Navigation ---------------- */

export function gehe(route, ersetzen = false) {
  const ziel = '#' + (route.startsWith('/') ? route : '/' + route);
  if (location.hash === ziel) { zeichne(); return; }
  if (ersetzen) location.replace(ziel); else location.hash = ziel;
}

function routeLesen() {
  const roh = (location.hash || '#/home').replace(/^#\/?/, '');
  const teile = roh.split('/').filter(Boolean);
  return { name: teile[0] || 'home', param: teile.slice(1).map(decodeURIComponent) };
}

let verlassenPruefer = null;
/** Ansichten mit ungespeicherten Änderungen können hier eine Rückfrage anmelden. */
export function beiVerlassen(fn) { verlassenPruefer = fn; }

async function zeichne() {
  const { name, param } = routeLesen();
  const modul = ANSICHTEN[name] || ANSICHTEN.home;

  if (verlassenPruefer) {
    const pruefer = verlassenPruefer;
    verlassenPruefer = null;
    const weiter = await pruefer();
    if (!weiter) return;
  }

  const main = document.getElementById('view');
  versteckePreis();
  leere(main);

  try {
    aktuelle = await modul.render({ param, gehe, zeigePreis, versteckePreis, setzeKopf, beiVerlassen });
  } catch (e) {
    console.error(e);
    aktuelle = { kopf: { titel: 'Fehler' }, el: note('bad', String(e && e.message || e), 'Die Ansicht konnte nicht geladen werden.') };
  }
  baueKopf(aktuelle.kopf || { titel: 'LaserKalk' });
  main.appendChild(aktuelle.el);
  window.scrollTo(0, 0);
}

/* ---------------- Start ---------------- */

export async function start() {
  try {
    await store.init();
  } catch (e) {
    document.getElementById('view').appendChild(
      note('bad', 'Die Datenbank konnte nicht geöffnet werden: ' + (e.message || e), 'Start fehlgeschlagen'));
    return;
  }

  const s = store.settings;
  document.body.classList.toggle('light', s.theme === 'light');
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', s.theme === 'light' ? '#e4eaf1' : '#141c24');

  window.addEventListener('hashchange', zeichne);
  await zeichne();

  for (const hinweis of store.hinweise) toast(hinweis, 'bad');

  if (store.wiederherstellungVerfuegbar) {
    const spiegel = store.wiederherstellungVerfuegbar;
    store.wiederherstellungVerfuegbar = null;
    const anzahl = Object.values(spiegel.data).reduce((a, b) => a + (b?.length || 0), 0);
    const ja = await sheet('Daten wiederherstellen?', (schliessen) => h('div', null,
      note('warn', `Der App-Speicher war leer, es liegt aber eine automatische Sicherung mit ${anzahl} Einträgen vom ${new Date(spiegel.ts).toLocaleString('de-DE')} vor.`),
      h('p.small.muted', { text: 'Soll diese Sicherung eingespielt werden? Sonst startet die App mit den Standardwerten.' }),
      h('.sheetfoot', null,
        h('button.btn', { text: 'Nein, neu starten', onclick: () => schliessen(false) }),
        h('button.btn.primary', { text: 'Wiederherstellen', onclick: () => schliessen(true) }),
      ),
    ), { klickAussenSchliesst: false });
    if (ja) {
      for (const [name, arr] of Object.entries(spiegel.data)) {
        if (Array.isArray(arr) && arr.length) await store.bulkPut(name, arr);
      }
      toast('Sicherung eingespielt.', 'ok');
      await zeichne();
    }
  }
}

/** Theme umschalten (aus den Einstellungen). */
export async function setzeTheme(theme) {
  await store.setSettings({ theme });
  document.body.classList.toggle('light', theme === 'light');
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#e4eaf1' : '#141c24');
}
