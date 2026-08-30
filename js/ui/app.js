/**
 * app.js — Programmrahmen: Kopfzeile, Navigation, Preisleiste.
 * Kennt die Kalkulationslogik nicht — nur die Ansichten.
 */

import { store } from '../core/store.js';
import { h, leere, icon, toast, note, sheet } from './components.js';
import { eur } from '../core/money.js';
import { APP_VERSION, versionText } from '../core/version.js';
import { pruefeUpdate, STATUS } from '../core/update.js';

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
  el.classList.toggle('unsicher', !!d.unsicher);

  if (d.unsicher) {
    // Kein belastbarer Preis: die Zahlen werden bewusst NICHT gezeigt, damit
    // niemand sie versehentlich an einen Kunden weitergibt.
    el.appendChild(h('.pb.main', null,
      h('.pl', { text: 'Preis nicht verlässlich' }),
      h('.pv', { text: d.unsicherGrund || 'Eingangsdaten ungeklärt' })));
  } else {
    el.appendChild(h('.pb.main', null,
      h('.pl', { text: 'Gesamt netto' }),
      h('.pv', { text: eur(d.nettoCent) })));
    el.appendChild(h('.pb', null,
      h('.pl', { text: `Preis/Stück (${d.stueckzahl})` }),
      h('.pv', { text: eur(d.proStueckCent) })));
  }
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

/* ---------------- Hinweisbanner ---------------- */

const offeneBanner = new Map();

/**
 * Zeigt einen Hinweis über der Ansicht. Bleibt beim Wechsel der Ansicht stehen,
 * weil er außerhalb von #view lebt.
 * @param {string} schluessel  ein Banner je Schlüssel, ein zweiter ersetzt ihn
 */
export function zeigeBanner(schluessel, { titel, text, knoepfe = [], zeichen = '↑' }) {
  const wurzel = document.getElementById('banners');
  if (!wurzel) return;
  schliesseBanner(schluessel);

  const el = h('.banner', null,
    h('span.bi', { text: zeichen }),
    h('.bt', null, h('b', { text: titel }), text ? h('small', { text }) : null),
    h('.bb', null, ...knoepfe.map(k => h('button.btn' + (k.primaer ? '.primary' : ''), {
      text: k.text,
      onclick: () => { if (k.schliesst !== false) schliesseBanner(schluessel); k.onclick?.(); },
    }))),
  );
  wurzel.appendChild(el);
  offeneBanner.set(schluessel, el);
}

export function schliesseBanner(schluessel) {
  const el = offeneBanner.get(schluessel);
  if (el) { el.remove(); offeneBanner.delete(schluessel); }
}

/* ---------------- Update der Web-Version ---------------- */

/** Läuft die App als installierte Android-/iOS-App (Capacitor) oder im Browser? */
export function istNativeApp() {
  try {
    return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function'
      && window.Capacitor.isNativePlatform());
  } catch { return false; }
}

/**
 * Registriert den Service Worker und behandelt neue Versionen.
 * Der neue Worker übernimmt erst, wenn der Benutzer zustimmt — sonst würde
 * unter einer geöffneten Kalkulation der Code ausgetauscht.
 */
async function serviceWorkerStarten() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;

  // In der installierten App liegen alle Dateien im Installationspaket: der
  // Worker brächte keine Offline-Fähigkeit dazu, würde aber nach jedem
  // App-Update ein zweites Mal „Neue Version verfügbar" melden. Ein evtl.
  // früher registrierter Worker wird abgeräumt.
  if (istNativeApp()) {
    try {
      for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
    } catch { /* egal */ }
    return;
  }

  try {
    const reg = await navigator.serviceWorker.register('./sw.js');

    const anbieten = () => {
      if (!reg.waiting) return;
      zeigeBanner('web-update', {
        titel: 'Neue Version verfügbar',
        text: 'Die App wurde aktualisiert. Zum Übernehmen einmal neu laden.',
        knoepfe: [
          { text: 'Später' },
          {
            text: 'Jetzt laden', primaer: true,
            onclick: () => reg.waiting?.postMessage('SKIP_WARTEN'),
          },
        ],
      });
    };

    if (reg.waiting) anbieten();
    reg.addEventListener('updatefound', () => {
      const neu = reg.installing;
      if (!neu) return;
      neu.addEventListener('statechange', () => {
        // controller vorhanden = es lief schon eine Version, also ein echtes
        // Update und keine Erstinstallation.
        if (neu.state === 'installed' && navigator.serviceWorker.controller) anbieten();
      });
    });

    let laedtNeu = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (laedtNeu) return;
      laedtNeu = true;
      location.reload();
    });

    // Stündlich und beim Zurückholen der App nachsehen.
    const nachsehen = () => reg.update().catch(() => {});
    setInterval(nachsehen, 60 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) nachsehen(); });
  } catch (e) {
    console.warn('Service Worker nicht registriert:', e);
  }
}

/* ---------------- Update der App (Installationspaket) ---------------- */

/**
 * Fragt die hinterlegte Update-Datei ab und meldet eine neuere Version.
 * Installiert nichts selbst — der Benutzer lädt das Paket und installiert es
 * auf dem normalen Weg.
 * @param {boolean} erzwingen  true = Prüfabstand ignorieren (Knopf in den Einstellungen)
 */
export async function appUpdatePruefen(erzwingen = false) {
  const s = store.settings;
  const ergebnis = await pruefeUpdate({
    url: s.updateUrl,
    aktiv: s.updateAktiv !== false,
    letztePruefung: s.letzteUpdatePruefung,
    intervallStunden: s.updateIntervallStunden,
    erzwingen,
    aktuellerCode: APP_VERSION.code,
  });

  if (ergebnis.gepruektAm) {
    try { await store.setSettings({ letzteUpdatePruefung: ergebnis.gepruektAm }); } catch { /* egal */ }
  }

  if (ergebnis.status === STATUS.NEU) {
    const info = ergebnis.info;
    const uebersprungen = !info.pflicht && Number(s.ignorierteVersionCode) === info.versionCode;
    if (!uebersprungen) {
      const knoepfe = [];
      if (!info.pflicht) {
        knoepfe.push({
          text: 'Überspringen',
          onclick: () => store.setSettings({ ignorierteVersionCode: info.versionCode }).catch(() => {}),
        });
      }
      if (info.apkUrl) {
        knoepfe.push({
          text: 'Herunterladen', primaer: true,
          onclick: () => { try { window.open(info.apkUrl, '_blank', 'noopener'); } catch { location.href = info.apkUrl; } },
        });
      }
      zeigeBanner('app-update', {
        titel: `Version ${info.versionName} verfügbar`,
        text: (info.hinweise || `Installiert ist ${versionText()}.`) +
          (info.apkUrl ? '' : ' Es ist keine Downloadadresse hinterlegt.'),
        knoepfe,
      });
    }
  }
  return ergebnis;
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

  farbschemaAnwenden(store.settings.theme);

  tastaturHilfe();
  window.addEventListener('hashchange', zeichne);
  await zeichne();

  for (const hinweis of store.hinweise) toast(hinweis, 'bad');

  // Updates im Hintergrund – ein Fehler dabei darf die App nie aufhalten.
  serviceWorkerStarten();
  appUpdatePruefen(false).catch(e => console.warn('Update-Prüfung fehlgeschlagen:', e));

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

/** Setzt das Farbschema und spiegelt die Wahl für den nächsten Start. */
function farbschemaAnwenden(theme) {
  const hell = theme === 'light';
  document.body.classList.toggle('light', hell);
  document.documentElement.classList.toggle('vorab-hell', hell);
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', hell ? '#e4eaf1' : '#141c24');
  try { localStorage.setItem('laserkalk_theme', hell ? 'light' : 'dark'); } catch { /* egal */ }
}

/** Theme umschalten (aus den Einstellungen). */
export async function setzeTheme(theme) {
  await store.setSettings({ theme });
  farbschemaAnwenden(theme);
}

/**
 * Tastatur-Hilfe: Auf dem Handy schiebt die eingeblendete Tastatur ein Feld
 * gern hinter die feste Preisleiste am unteren Rand — man tippt dann blind.
 * Deshalb nach dem Anfassen eines Feldes prüfen, ob es noch im sichtbaren
 * Bereich liegt, und es andernfalls in die Mitte scrollen.
 *
 * Gemessen wird mit visualViewport (kennt die Tastatur); fehlt das, dient
 * die Fensterhöhe als Rückfallebene.
 */
function tastaturHilfe() {
  const sichtbareHoehe = () =>
    (window.visualViewport ? window.visualViewport.height : window.innerHeight);

  const pruefe = (el) => {
    if (!el || !el.getBoundingClientRect) return;
    const bar = document.getElementById('pricebar');
    const barHoehe = bar && getComputedStyle(bar).display !== 'none' ? bar.offsetHeight : 0;
    const r = el.getBoundingClientRect();
    const unten = sichtbareHoehe() - barHoehe - 8;
    if (r.bottom > unten || r.top < 8) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };

  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!el || !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
    // Zweimal nachsehen: einmal sofort, einmal wenn die Tastatur oben ist.
    pruefe(el);
    setTimeout(() => pruefe(el), 350);
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const el = document.activeElement;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) pruefe(el);
    });
  }
}

