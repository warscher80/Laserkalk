/**
 * money.js — Geldrechnung ohne Floating-Point-Fehler (§42).
 *
 * Grundregeln des gesamten Projekts:
 *  - Jeder Geldbetrag ist ein ganzzahliger Wert in CENT.
 *  - Jeder Stundensatz ist CENT PRO STUNDE (ganzzahlig).
 *  - Jeder Prozentsatz ist ein BASISPUNKT-Wert (bp): 25 % = 2500, 0,5 % = 50.
 *  - Gerundet wird kaufmännisch (halb vom Nullpunkt weg).
 *
 * Dieses Modul ist DOM-frei und in Node testbar.
 */

/** Kaufmännische Rundung, halb vom Nullpunkt weg. Math.round rundet -0.5 auf -0 → falsch. */
export function roundHalf(x) {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/**
 * Wandelt eine Benutzereingabe in eine Zahl.
 * Akzeptiert deutsches ("1.234,56") und englisches ("1234.56") Format.
 * Leere/ungültige Eingabe -> fallback.
 */
export function parseNum(input, fallback = 0) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : fallback;
  if (input === null || input === undefined) return fallback;
  let s = String(input).trim();
  if (!s) return fallback;
  s = s.replace(/[\s '€]/g, '');
  const komma = s.lastIndexOf(',');
  const punkt = s.lastIndexOf('.');
  if (komma >= 0 && punkt >= 0) {
    // Das zuletzt stehende Zeichen ist das Dezimaltrennzeichen.
    if (komma > punkt) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (komma >= 0) {
    // Ein einzelnes Komma ist immer Dezimaltrennzeichen.
    s = s.replace(',', '.');
  } else if (punkt >= 0) {
    // "1.234" mit genau 3 Nachkommastellen und weiteren Punkten = Tausendertrenner.
    const teile = s.split('.');
    const tausender = teile.length > 2 || (teile.length === 2 && teile[1].length === 3 && teile[0].length <= 3 && /^\d+$/.test(teile[0]) && teile[0] !== '0');
    if (tausender) s = teile.join('');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Normalisiert eine Eingabe zu einer reinen Dezimalzeichenkette ("-1234.56").
 * Rückgabe null, wenn keine Zahl erkennbar ist.
 */
function dezimalString(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    // toFixed rundet die tatsächliche Gleitkommazahl korrekt; 12 Stellen sind
    // weit mehr als jeder Geldbetrag braucht.
    return input.toFixed(12);
  }
  if (input === null || input === undefined) return null;
  let s = String(input).trim();
  if (!s) return null;
  s = s.replace(/[\s '€]/g, '');
  const neg = s.startsWith('-');
  if (neg || s.startsWith('+')) s = s.slice(1);

  const komma = s.lastIndexOf(',');
  const punkt = s.lastIndexOf('.');
  if (komma >= 0 && punkt >= 0) {
    if (komma > punkt) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (komma >= 0) {
    s = s.replace(',', '.');
  } else if (punkt >= 0) {
    const teile = s.split('.');
    const tausender = teile.length > 2 ||
      (teile.length === 2 && teile[1].length === 3 && teile[0].length <= 3 && /^\d+$/.test(teile[0]) && teile[0] !== '0');
    if (tausender) s = teile.join('');
  }
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
  return (neg ? '-' : '') + s;
}

/**
 * Eingabe (Euro als Text oder Zahl) -> ganze Cent.
 *
 * WICHTIG (§42): Die Umrechnung läuft über die Ziffern der Eingabe, NICHT über
 * `wert * 100`. Sonst ergäbe z. B. "1,005" wegen der Gleitkomma-Darstellung
 * 100,49999… und damit 100 statt der kaufmännisch korrekten 101 Cent.
 */
export function toCent(input, fallback = 0) {
  const s = dezimalString(input);
  if (s === null) return fallback;
  const neg = s.startsWith('-');
  const [ganz, bruch = ''] = (neg ? s.slice(1) : s).split('.');
  const ganzZahl = ganz === '' ? 0 : Number(ganz);
  if (!Number.isFinite(ganzZahl)) return fallback;

  const cent2 = (bruch + '00').slice(0, 2);
  const rest = bruch.slice(2);
  let cent = ganzZahl * 100 + Number(cent2);
  // Kaufmännisch runden: die erste weggelassene Stelle entscheidet.
  if (rest && rest.charCodeAt(0) >= 53) cent += 1;
  return neg ? -cent : cent;
}

/** Cent -> Euro als Gleitkommazahl. Nur für Anzeige/Export, nie zum Weiterrechnen. */
export function centToEuro(cent) {
  return roundHalf(cent) / 100;
}

/** Eingabe (Prozent als Text oder Zahl) -> Basispunkte. */
export function toBp(input, fallback = 0) {
  const n = parseNum(input, NaN);
  if (!Number.isFinite(n)) return fallback;
  return roundHalf(n * 100);
}

/** Basispunkte -> Prozentzahl. */
export function bpToPct(bp) {
  return bp / 100;
}

/** Prozentualer Anteil eines Betrags: 30000 Cent, 2500 bp -> 7500 Cent. */
export function pctOf(cent, bp) {
  return roundHalf((cent * bp) / 10000);
}

/** Betrag zuzüglich Prozentaufschlag. */
export function addPct(cent, bp) {
  return cent + pctOf(cent, bp);
}

/** Kosten aus Minuten und Stundensatz (Cent/h). */
export function costFromMinutes(minuten, satzCent) {
  if (!Number.isFinite(minuten) || !Number.isFinite(satzCent)) return 0;
  return roundHalf((minuten * satzCent) / 60);
}

/** Kosten aus einer Menge und einem Einzelpreis in Cent. */
export function costFromQty(menge, einzelCent) {
  if (!Number.isFinite(menge) || !Number.isFinite(einzelCent)) return 0;
  return roundHalf(menge * einzelCent);
}

/** Betrag durch eine Stückzahl teilen (gerundet auf ganze Cent). */
export function divCent(cent, teiler) {
  if (!Number.isFinite(teiler) || teiler === 0) return 0;
  return roundHalf(cent / teiler);
}

const NF2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NF0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

/** Cent -> "1.234,56" (ohne Währungszeichen). */
export function centStr(cent) {
  return NF2.format(centToEuro(cent));
}

/** Cent -> "1.234,56 €". */
export function eur(cent) {
  return centStr(cent) + ' €';
}

/** Stundensatz in Cent/h -> "70,00 €/h". */
export function eurH(satzCent) {
  return centStr(satzCent) + ' €/h';
}

/** Prozent aus Basispunkten -> "25 %" bzw. "12,5 %". */
export function pct(bp) {
  const v = bpToPct(bp);
  const s = Number.isInteger(v) ? NF0.format(v) : new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(v);
  return s + ' %';
}

/** Beliebige Zahl mit n Nachkommastellen deutsch formatieren. */
export function num(value, dez = 2) {
  if (!Number.isFinite(value)) return '–';
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: dez, maximumFractionDigits: dez }).format(value);
}
