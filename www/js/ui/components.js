/**
 * components.js — kleine DOM-Bausteine.
 * Kein Framework: die App ist klein genug, dass direkte DOM-Erzeugung
 * übersichtlicher (und schneller) ist als eine Abstraktionsschicht.
 */

import { parseNum, toCent, centStr, toBp, bpToPct } from '../core/money.js';
import { pruefeFeld, REGELN } from '../core/felder.js';

/** Mini-Hyperscript: h('div.card', {onclick}, kind1, kind2) */
export function h(sel, props = null, ...kinder) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(sel);
  if (!m) {
    // Lieber laut scheitern als still ein Element ohne Klassen erzeugen –
    // genau so verschwinden sonst Styles, ohne dass es jemand merkt.
    throw new Error(`Ungültiger Element-Selektor: "${sel}"`);
  }
  const tag = m[1] || 'div';
  const el = document.createElement(tag);
  for (const t of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (t[0] === '.') el.classList.add(t.slice(1)); else el.id = t.slice(1);
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
      else el.setAttribute(k, v);
    }
  }
  // Anklickbare Bereiche, die technisch keine Schaltfläche sind (Listeneintrag,
  // Ablagefeld, Schalter), müssen mit Tastatur und Screenreader bedienbar sein.
  if (props && typeof props.onclick === 'function' && KLICKBAR.some(k => el.classList.contains(k))) {
    if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
    if (!el.hasAttribute('role')) el.setAttribute('role', el.classList.contains('switch') ? 'switch' : 'button');
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
    });
  }

  anhaengen(el, kinder);
  return el;
}

/** Klassen, deren Elemente bei einem onclick tastaturbedienbar werden. */
const KLICKBAR = ['item', 'drop', 'switch'];

function anhaengen(el, kinder) {
  for (const k of kinder.flat(4)) {
    if (k === null || k === undefined || k === false || k === '') continue;
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export function leere(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

/** SVG-Symbol aus dem eingebauten Satz. */
export function icon(name, size = 22) {
  const p = ICONS[name] || ICONS.dot;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = p;
  return svg;
}

const ICONS = {
  dot: '<circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  down: '<path d="M12 3v14M5 12l7 7 7-7"/>',
  up: '<path d="M12 21V7M5 12l7-7 7 7"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
};

/* ---------------- Formularbausteine ---------------- */

/*
 * BARRIEREFREIHEIT DER FORMULARE
 *
 * Jedes Eingabefeld bekommt eine eigene ID, eine echte <label for="…">
 * Beschriftung und über aria-describedby die Einheit, den Hilfetext und —
 * falls vorhanden — die Fehlermeldung. Vorher hingen die Beschriftungen nur
 * optisch daneben; ein Screenreader las „Eingabefeld, leer" und sonst nichts.
 */

let idZaehler = 0;
/** Eindeutige, stabile ID innerhalb einer Seite. */
export function feldId(praefix = 'f') { return `${praefix}-${++idZaehler}`; }

/** Fügt eine ID zur Beschreibungsliste eines Feldes hinzu (ohne Dubletten). */
function beschreibe(inp, id) {
  if (!inp || !id) return;
  const liste = (inp.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  if (!liste.includes(id)) { liste.push(id); inp.setAttribute('aria-describedby', liste.join(' ')); }
}
function beschreibungWeg(inp, id) {
  if (!inp || !id) return;
  const liste = (inp.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).filter(x => x !== id);
  if (liste.length) inp.setAttribute('aria-describedby', liste.join(' '));
  else inp.removeAttribute('aria-describedby');
}

/** Das eigentliche Bedienelement in einem (evtl. verpackten) Steuerelement. */
function steuerelement(control) {
  if (!control || !control.tagName) return null;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName)) return control;
  return control.querySelector ? control.querySelector('input, select, textarea') : null;
}

/**
 * Beschriftetes Feld mit optionalem Hinweis.
 * Verbindet Beschriftung, Einheit und Hilfetext mit dem Bedienelement.
 */
export function field(label, control, hint, hintKlasse = '') {
  const inp = steuerelement(control);
  if (inp && !inp.id) inp.id = feldId('feld');

  const box = h('.field');
  if (label) {
    const lb = h('label', { text: label });
    if (inp) lb.setAttribute('for', inp.id);
    box.appendChild(lb);
  }
  box.appendChild(control);

  // Die Einheit gehört mit vorgelesen: „70 … Euro pro Stunde".
  if (inp && control && control.classList && control.classList.contains('unit')) {
    const u = control.querySelector('.u');
    if (u) { if (!u.id) u.id = feldId('einheit'); beschreibe(inp, u.id); }
  }
  if (hint) {
    const hl = h('.hint' + (hintKlasse ? '.' + hintKlasse : ''), { text: hint, id: feldId('hinweis') });
    box.appendChild(hl);
    beschreibe(inp, hl.id);
  }
  return box;
}

/**
 * Sicherheitsnetz für Beschriftungen.
 *
 * Die meisten Felder entstehen über `field()` und sind damit sauber verknüpft.
 * An einigen Stellen ist ein `.field`-Block aber von Hand gebaut (weil er
 * mehrere Bedienelemente enthält). Dort blieben Beschriftung und Feld nur
 * optisch nebeneinander — ein Screenreader las „Eingabefeld, leer".
 *
 * Diese Funktion läuft einmal nach jedem Zeichnen über die fertige Ansicht und
 * verbindet, was noch offen ist: label ↔ Feld, Einheit und Hinweis als
 * Beschreibung. Sie ändert nichts, was bereits verknüpft ist.
 */
export function beschriftungenVerknuepfen(wurzel) {
  if (!wurzel || !wurzel.querySelectorAll) return 0;
  let ergaenzt = 0;
  for (const block of wurzel.querySelectorAll('.field')) {
    const felder = [...block.querySelectorAll('input, select, textarea')]
      .filter(f => f.type !== 'hidden');
    if (!felder.length) continue;
    const lb = block.querySelector(':scope > label');

    for (const f of felder) {
      if (!f.id) { f.id = feldId('feld'); ergaenzt++; }
    }
    // Ein label gehört genau zu EINEM Feld. Enthält der Block mehrere,
    // bekommen die übrigen den Text als aria-label.
    if (lb) {
      if (!lb.getAttribute('for')) { lb.setAttribute('for', felder[0].id); ergaenzt++; }
      for (const f of felder.slice(1)) {
        if (!f.getAttribute('aria-label') && !f.getAttribute('aria-labelledby')) {
          f.setAttribute('aria-label', lb.textContent.trim());
          ergaenzt++;
        }
      }
    }
    // Einheit und Hilfetext anhängen, sofern noch nicht geschehen.
    for (const f of felder) {
      const einheit = f.closest('.unit')?.querySelector('.u');
      if (einheit) { if (!einheit.id) einheit.id = feldId('einheit'); beschreibe(f, einheit.id); }
    }
    for (const hinweis of block.querySelectorAll(':scope > .hint')) {
      if (!hinweis.textContent.trim()) continue;
      if (!hinweis.id) hinweis.id = feldId('hinweis');
      beschreibe(felder[0], hinweis.id);
    }
  }
  return ergaenzt;
}

/** Textfeld. */
export function text(value, onInput, props = {}) {
  return h('input', {
    type: 'text', value: value ?? '', ...props,
    oninput: e => onInput(e.target.value),
  });
}

/**
 * Meldet ein Feld als ungültig — sichtbar, vorlesbar und mit Begründung.
 * Ohne Grund wird die Meldung wieder entfernt.
 *
 * Wichtig: Ein ungültiger Eintrag ändert den gespeicherten Wert NICHT.
 * Weder ein vertippter Preis noch eine 0 als Stückzahl darf stillschweigend
 * durch einen Ersatzwert ersetzt werden (§41).
 */
function ungueltig(inp, grund) {
  const box = inp.closest('.unit') || inp;
  const traeger = box.parentElement || box;
  let meldung = traeger.querySelector(':scope > .hint.feldfehler');
  const vorher = inp.getAttribute('aria-invalid') === 'true';

  if (grund) {
    inp.setAttribute('aria-invalid', 'true');
    inp.classList.add('ungueltig');
    if (!meldung) {
      meldung = h('.hint.bad.feldfehler', { id: feldId('fehler'), role: 'alert' });
      box.insertAdjacentElement('afterend', meldung);
    }
    meldung.textContent = grund;
    beschreibe(inp, meldung.id);
  } else {
    inp.removeAttribute('aria-invalid');
    inp.classList.remove('ungueltig');
    if (meldung) { beschreibungWeg(inp, meldung.id); meldung.remove(); }
  }
  if (vorher !== !!grund) {
    // Die Ansicht darf daraufhin Ergebnis und Speichern sperren bzw. freigeben.
    inp.dispatchEvent(new CustomEvent('feld-geprueft', { bubbles: true, detail: { gueltig: !grund } }));
  }
}

/**
 * Kennzeichnet ein Feld als NOCH NICHT AUSGEFÜLLT.
 *
 * Unterschied zu `ungueltig`: Hier hat der Benutzer nichts falsch gemacht, er
 * ist nur noch nicht fertig. Deshalb gelb statt rot und KEIN aria-invalid —
 * eine leere Pflichtangabe ist keine fehlerhafte Eingabe. Das Ergebnis wird
 * trotzdem gesperrt, denn rechnen lässt sich damit nicht.
 */
function unvollstaendig(inp, grund) {
  const box = inp.closest('.unit') || inp;
  const traeger = box.parentElement || box;
  let meldung = traeger.querySelector(':scope > .hint.feldoffen');
  const vorher = inp.classList.contains('unvollstaendig');
  if (grund) {
    inp.classList.add('unvollstaendig');
    if (!meldung) {
      meldung = h('.hint.warn.feldoffen', { id: feldId('offen') });
      box.insertAdjacentElement('afterend', meldung);
    }
    meldung.textContent = grund;
    beschreibe(inp, meldung.id);
  } else {
    inp.classList.remove('unvollstaendig');
    if (meldung) { beschreibungWeg(inp, meldung.id); meldung.remove(); }
  }
  if (vorher !== !!grund) {
    inp.dispatchEvent(new CustomEvent('feld-geprueft', { bubbles: true, detail: { gueltig: !grund } }));
  }
}

/**
 * Felder, die einer Berechnung im Weg stehen: fehlerhaft ODER noch offen.
 * @returns {{fehler: HTMLElement[], offen: HTMLElement[]}}
 */
export function formularFehler(wurzel) {
  if (!wurzel || !wurzel.querySelectorAll) return { fehler: [], offen: [] };
  return {
    fehler: [...wurzel.querySelectorAll('[aria-invalid="true"]')],
    offen: [...wurzel.querySelectorAll('.unvollstaendig')],
  };
}

/** Kurzfassung: darf aus diesem Bereich ein Preis entstehen? */
export function formularGueltig(wurzel) {
  const f = formularFehler(wurzel);
  return f.fehler.length === 0 && f.offen.length === 0;
}

/**
 * „Speichern" für einen Dialog: schließt erst, wenn alle Felder darin in
 * Ordnung sind. Ein Schnittparameter mit Geschwindigkeit 0 oder ein Blech mit
 * Stärke 0 darf nicht in den Stammdaten landen — von dort verfälschte er
 * später jede Kalkulation, ohne dass jemand die Ursache sieht.
 */
export function dialogSpeichern(schliessen, beschriftung = 'Speichern') {
  return h('button.btn.primary', {
    text: beschriftung,
    onclick: (e) => {
      const wurzel = e.target.closest('.sheet') || e.target.parentElement;
      const { fehler, offen } = formularFehler(wurzel);
      if (fehler.length || offen.length) {
        const namen = [...new Set([...fehler, ...offen].map(feldName))].join(', ');
        toast(`Bitte zuerst berichtigen: ${namen}.`, 'bad');
        return;
      }
      schliessen(true);
    },
  });
}

/** Beschriftung eines Feldes, für Sammelmeldungen im Ergebnisbereich. */
export function feldName(inp) {
  // Bewusst über getRootNode() statt document: beim ersten Zeichnen hängt die
  // Ansicht noch nicht im Dokument, und document.querySelector fände nichts —
  // dann stünde im Ergebnisbereich „Es fehlt noch: Feld".
  const wurzel = inp.getRootNode ? inp.getRootNode() : document;
  const lb = inp.id && wurzel.querySelector ? wurzel.querySelector(`label[for="${CSS.escape(inp.id)}"]`) : null;
  return (lb ? lb.textContent.trim() : '') || inp.getAttribute('aria-label') || 'Feld';
}

/**
 * Ruft `fn` bei jeder Änderung des Prüfzustands in diesem Bereich auf.
 * Zusätzlich einmal sofort, damit der Anfangszustand stimmt.
 */
export function beiFeldpruefung(wurzel, fn) {
  wurzel.addEventListener('feld-geprueft', () => fn(formularFehler(wurzel)));
  fn(formularFehler(wurzel));
}

/**
 * Sperrt Ergebnis und Schaltflächen, solange Felder fehlerhaft oder offen
 * sind, und nennt konkret, welche. Gibt zurück, ob gerechnet werden darf.
 *
 * @param {HTMLElement} wurzel     Bereich mit den Feldern
 * @param {HTMLElement} anzeigeBox Ergebnisbereich
 * @param {HTMLElement[]} knoepfe  Schaltflächen, die gesperrt werden
 */
export function ergebnisSperre(wurzel, anzeigeBox, knoepfe = []) {
  const { fehler, offen } = formularFehler(wurzel);
  const namen = (liste) => [...new Set(liste.map(feldName))].join(', ');
  const gueltig = !fehler.length && !offen.length;

  for (const b of knoepfe) if (b) { b.disabled = !gueltig; b.setAttribute('aria-disabled', String(!gueltig)); }
  if (gueltig) return true;

  leere(anzeigeBox);
  anzeigeBox.appendChild(h('.pruefhinweis', { role: 'status' },
    h('.ph-titel', { text: 'Eingaben prüfen' }),
    fehler.length ? h('p', { text: `Fehlerhaft: ${namen(fehler)}. Bitte oben die rot markierten Felder berichtigen.` }) : null,
    offen.length ? h('p', { text: `Es fehlt noch: ${namen(offen)}.` }) : null,
    h('p.ph-fuss', { text: 'Solange wird kein Preis angezeigt — ein Preis aus unvollständigen Angaben wäre nicht belastbar.' }),
  ));
  return false;
}

/**
 * Gemeinsames Verhalten aller Zahlenfelder: prüfen statt raten.
 *
 * @param {HTMLInputElement} inp
 * @param {object} opts  { einheit, regel, pflicht }
 * @param {(p:object)=>void} uebernehmen  nur bei GÜLTIGER Eingabe
 * @param {(p:object)=>string} anzeige    Formatierung beim Verlassen
 */
function zahlenfeld(inp, opts, uebernehmen, anzeige) {
  let letzterGueltiger = null;
  const pruefe = () => pruefeFeld(inp.value, opts);

  inp.addEventListener('input', () => {
    const p = pruefe();
    unvollstaendig(inp, '');   // ab jetzt hat der Benutzer angefasst
    if (!p.ok) { ungueltig(inp, p.grund); return; }
    ungueltig(inp, '');
    letzterGueltiger = p;
    uebernehmen(p);
  });
  inp.addEventListener('blur', () => {
    const p = pruefe();
    if (p.ok) {
      ungueltig(inp, '');
      inp.value = anzeige(p);
    }
    // Bei ungültiger Eingabe bleibt sie STEHEN, samt Begründung. Sie
    // wegzuräumen würde den Fehler verstecken, und der Benutzer bekäme
    // wieder einen Preis zu sehen, der nicht zu dem passt, was er eingab.
  });

  // Anfangszustand prüfen. Zwei verschiedene Fälle:
  //  - Feld noch leer oder 0, obwohl ein Wert gebraucht wird  → offen (gelb)
  //  - gespeicherter Unsinn aus einer alten Kalkulation       → Fehler (rot)
  const start = pruefe();
  if (!start.ok) {
    const nochNichtsEingetragen = inp.value.trim() === '' || inp.value.trim() === '0';
    if (nochNichtsEingetragen) unvollstaendig(inp, 'Dieser Wert wird für die Berechnung gebraucht.');
    else ungueltig(inp, start.grund);
  }
  return inp;
}

/** Ganzzahlfelder bekommen die Zifferntastatur, alles andere die Dezimaltastatur. */
function tastatur(regel) {
  const r = REGELN[regel];
  return r && r.ganz ? 'numeric' : 'decimal';
}

/**
 * Zahlenfeld mit deutscher Eingabe.
 * @param {object} props  unit, regel, pflicht, leerBei0, id, …
 */
export function num(value, onInput, props = {}) {
  const { unit, regel = '', pflicht = false, leerBei0, ...rest } = props;
  const inp = h('input', {
    type: 'text', inputmode: tastatur(regel), autocomplete: 'off',
    value: value === 0 && leerBei0 ? '' : formatEingabe(value),
    ...rest,
  });
  if (!inp.id) inp.id = feldId('zahl');
  zahlenfeld(inp, { einheit: unit || '', regel, pflicht },
    (p) => onInput(p.wert, inp.value),
    (p) => (p.wert === 0 && leerBei0 ? '' : formatEingabe(p.wert)));
  return unit ? h('.unit', null, inp, h('span.u', { text: unit })) : inp;
}

/** Geldfeld: zeigt Euro, liefert Cent. */
export function money(cent, onInput, props = {}) {
  const { einheit, regel = 'preis', pflicht = false, ...rest } = props;
  const inp = h('input', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off',
    value: cent ? centStr(cent) : '',
    placeholder: '0,00',
    ...rest,
  });
  if (!inp.id) inp.id = feldId('geld');
  // Der Cent-Wert entsteht aus den ZIFFERN, nicht aus der Gleitkommazahl (§42).
  zahlenfeld(inp, { einheit: einheit || '€', regel, pflicht },
    (p) => onInput(toCent(p.text, 0)),
    (p) => { const c = toCent(p.text, 0); return c ? centStr(c) : ''; });
  return h('.unit', null, inp, h('span.u', { text: einheit || '€' }));
}

/** Prozentfeld: zeigt Prozent, liefert Basispunkte. */
export function prozent(bp, onInput, props = {}) {
  const { regel = 'prozentAufschlag', pflicht = false, ...rest } = props;
  const inp = h('input', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off',
    value: fmtPct(bp), ...rest,
  });
  if (!inp.id) inp.id = feldId('prozent');
  zahlenfeld(inp, { einheit: '%', regel, pflicht },
    (p) => onInput(toBp(p.text, 0)),
    (p) => fmtPct(toBp(p.text, 0)));
  return h('.unit', null, inp, h('span.u', { text: '%' }));
}

function fmtPct(bp) {
  const v = bpToPct(Number(bp) || 0);
  return Number.isInteger(v) ? String(v) : String(v).replace('.', ',');
}
function formatEingabe(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  if (n === 0) return '0';
  return String(Math.round(n * 10000) / 10000).replace('.', ',');
}

/** Auswahlliste. options: [{value,label}] oder [[value,label]] */
export function select(options, value, onChange, props = {}) {
  const opts = options.map(o => Array.isArray(o) ? { value: o[0], label: o[1] } : o);
  return h('select', {
    ...props,
    onchange: e => onChange(e.target.value),
  }, ...opts.map(o => h('option', { value: o.value, selected: String(o.value) === String(value), text: o.label, disabled: o.disabled })));
}

/** Segmentierter Umschalter. */
export function seg(options, value, onChange, klasse = '') {
  const opts = options.map(o => Array.isArray(o) ? { value: o[0], label: o[1] } : o);
  const box = h('.seg');
  for (const k of String(klasse).split(/\s+/)) if (k) box.classList.add(k);
  for (const o of opts) {
    box.appendChild(h('button', {
      type: 'button', text: o.label,
      class: String(o.value) === String(value) ? 'on' : '',
      onclick: () => onChange(o.value),
    }));
  }
  return box;
}

/** Ein/Aus-Schalter. */
export function switchRow(label, an, onChange, unterzeile) {
  const el = h('.switch' + (an ? '.on' : ''), {
    role: 'switch', 'aria-checked': an ? 'true' : 'false',
    onclick: () => onChange(!an),
  },
    h('.lab', null, h('span', { text: label }), unterzeile ? h('small', { text: unterzeile }) : null),
    h('.track', null, h('.knob')),
  );
  return el;
}

/**
 * „Powered by NIVOX" — Herstellerzeile.
 *
 * Betriebsvorgabe: gehört in JEDE App. Verwendet wird ausschließlich das
 * Originallogo (`icons/nivox.png`, Zuschnitt aus dem Key-Visual). Es wird
 * NICHT als SVG nachgezeichnet und nicht eingefärbt — das Logo hat seinen
 * eigenen dunklen Hintergrund, deshalb sitzt es auf einer dunklen Fläche und
 * sieht in beiden Farbschemata gleich aus.
 */
export function nivox(zusatz = '') {
  return h('.nivox', null,
    h('span.nv-lab', { text: 'powered by' }),
    h('img.nv-logo', {
      src: './icons/nivox.png',
      alt: 'NIVOX — Apps, Web, Software',
      width: 400, height: 113, loading: 'lazy', decoding: 'async',
    }),
    zusatz ? h('span.nv-add', { text: zusatz }) : null,
  );
}

/** Karte mit Titel. */
export function card(titel, ...inhalt) {
  return h('.card', null, titel ? h('h3', null, titel) : null, ...inhalt);
}

/** Ergebniskachel. */
export function res(label, wert, einheit, sub, primary = false) {
  return h('.res' + (primary ? '.primary' : ''), null,
    h('.rl', { text: label }),
    h('.rv', null, wert, einheit ? h('span.ru', { text: einheit }) : null),
    sub !== undefined && sub !== null ? h('.rs', { text: sub }) : null,
  );
}

/** Hinweis-/Warnbox. */
export function note(typ, inhalt, titel) {
  const zeichen = { info: 'ℹ', warn: '⚠', bad: '✕', ok: '✓' }[typ] || 'ℹ';
  const body = Array.isArray(inhalt)
    ? h('div', null, titel ? h('b', { text: titel }) : null,
        h('ul', null, ...inhalt.map(t => h('li', { text: t }))))
    : h('div', null, titel ? h('b', { text: titel + ' ' }) : null, document.createTextNode(String(inhalt)));
  return h('.note.' + typ, null, h('span.ni', { text: zeichen }), body);
}

export function empty(titel, text2, aktion) {
  return h('.empty', null, h('.e1', { text: titel }), h('.e2', { text: text2 }), aktion ? h('div.mt', null, aktion) : null);
}

/* ---------------- Dialog & Toast ---------------- */

let modalEl = null;
function modalRoot() {
  if (!modalEl) modalEl = document.getElementById('modal');
  return modalEl;
}

/**
 * Modales Blatt. `bauInhalt(schliessen)` liefert den Inhalt.
 * @returns {Promise<any>} Wert, mit dem geschlossen wurde
 */
export function sheet(titel, bauInhalt, opts = {}) {
  return new Promise(resolve => {
    const root = modalRoot();
    leere(root);
    let fertig = false;
    const schliessen = (wert) => {
      if (fertig) return;
      fertig = true;
      root.classList.remove('on');
      leere(root);
      document.body.style.overflow = '';
      resolve(wert);
    };
    const box = h('.sheet', { onclick: e => e.stopPropagation() }, h('h2', { text: titel }));
    const inhalt = bauInhalt(schliessen);
    anhaengen(box, [inhalt]);
    root.appendChild(box);
    // Auch in Dialogen müssen Beschriftung und Feld verbunden sein.
    beschriftungenVerknuepfen(box);
    root.classList.add('on');
    document.body.style.overflow = 'hidden';
    if (opts.klickAussenSchliesst !== false) root.onclick = () => schliessen(undefined);
    else root.onclick = null;
  });
}

/** Ja/Nein-Rückfrage. */
export function bestaetige(titel, frage, okText = 'Ja', gefaehrlich = false) {
  return sheet(titel, (schliessen) => h('div', null,
    h('p', { text: frage, style: { margin: '0 0 4px', fontSize: '14.5px', lineHeight: '1.5' } }),
    h('.sheetfoot', null,
      h('button.btn', { text: 'Abbrechen', onclick: () => schliessen(false) }),
      h('button.btn' + (gefaehrlich ? '.bad' : '.primary'), { text: okText, onclick: () => schliessen(true) }),
    ),
  ));
}

/** Kurze Rückmeldung. */
export function toast(text2, typ = '') {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = h('.toast' + (typ ? '.' + typ : ''), { text: text2 });
  box.appendChild(t);
  setTimeout(() => t.remove(), typ === 'bad' ? 5200 : 2900);
}

/* ---------------- Sonstiges ---------------- */

/** Verzögert ausgeführte Funktion (für Live-Neuberechnung während der Eingabe). */
export function entprellt(fn, ms = 90) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
