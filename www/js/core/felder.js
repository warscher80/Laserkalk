/**
 * felder.js — fachliche Regeln für Eingabefelder (§41).
 *
 * WARUM ES DIESE DATEI GIBT
 *
 * `pruefeZahl()` in money.js beantwortet nur: „Ist das überhaupt eine Zahl?"
 * Das reicht nicht. „0" ist eine einwandfreie Zahl — als Stückzahl ist sie
 * trotzdem falsch. „−1" ist eine einwandfreie Zahl — als Laserzeit ist sie
 * trotzdem falsch.
 *
 * Bisher hat die Oberfläche solche Werte stillschweigend ersetzt
 * (`Math.max(1, …)`, `Math.max(0, …)`): im Feld stand weiter 0 bzw. −1, im
 * Modell landete 1 bzw. 0, und der Preis sah dabei völlig plausibel aus.
 * Für eine Kalkulation, aus der ein Angebot wird, ist das unzulässig.
 *
 * Deshalb: Jedes Zahlenfeld bekommt eine REGEL. Verstößt die Eingabe dagegen,
 * wird sie ABGELEHNT — der Wert im Modell bleibt unverändert, das Feld wird
 * als fehlerhaft gekennzeichnet und das Ergebnis wird gesperrt.
 *
 * DOM-frei und in Node testbar.
 */

import { pruefeZahl } from './money.js';

/**
 * Regelkatalog. Jede Regel beschreibt einen fachlichen Wertebereich.
 *
 *   min / max      zulässiger Bereich
 *   offen          true = min ist ausgeschlossen (Wert muss echt größer sein)
 *   ganz           true = nur ganze Zahlen
 *   text           Meldung bei Verstoß, in ganzen deutschen Sätzen
 *
 * Die Obergrenzen sind keine Schikane: sie fangen Tippfehler ab, die sonst
 * erst in einem Angebot auffallen (1000 % Gewinn, 5 Millionen Stück).
 */
export const REGELN = {
  /* --- Mengen --- */
  stueckzahl: {
    min: 1, max: 1_000_000, ganz: true,
    text: 'Die Stückzahl muss eine ganze Zahl ab 1 sein.',
    zuGross: 'Die Stückzahl ist unplausibel hoch (über 1.000.000).',
  },
  anzahl: {
    min: 0, max: 1_000_000, ganz: true,
    text: 'Hier ist nur eine ganze Zahl ab 0 möglich.',
  },

  /* --- Zeit --- */
  zeit: {
    min: 0, max: 100_000,
    text: 'Eine Zeit darf nicht negativ sein.',
    zuGross: 'Diese Zeit ist unplausibel hoch (über 100.000 Minuten).',
  },
  sekunden: {
    min: 0, max: 36_000,
    text: 'Eine Zeit darf nicht negativ sein.',
    zuGross: 'Diese Zeit ist unplausibel hoch (über 10 Stunden).',
  },

  /* --- Geld --- */
  preis: {
    min: 0, max: 100_000_000,
    text: 'Ein Preis darf nicht negativ sein.',
    zuGross: 'Dieser Betrag ist unplausibel hoch.',
  },
  satz: {
    min: 0, max: 100_000,
    text: 'Ein Stundensatz darf nicht negativ sein.',
    zuGross: 'Dieser Stundensatz ist unplausibel hoch.',
  },
  /** Zusatzkosten dürfen negativ sein – das ist eine Gutschrift. */
  betrag: {
    min: -100_000_000, max: 100_000_000,
    text: 'Dieser Betrag ist unplausibel.',
  },

  /* --- Maße --- */
  mass: {
    min: 0, offen: true, max: 1_000_000,
    text: 'Dieses Maß muss größer als 0 sein.',
    zuGross: 'Dieses Maß ist unplausibel groß.',
  },
  massOptional: {
    min: 0, max: 1_000_000,
    text: 'Ein Maß darf nicht negativ sein.',
    zuGross: 'Dieses Maß ist unplausibel groß.',
  },
  dichte: {
    min: 0, offen: true, max: 30_000,
    text: 'Die Dichte muss größer als 0 sein (Stahl: 7850 kg/m³).',
    zuGross: 'Die Dichte ist unplausibel hoch (über 30.000 kg/m³).',
  },
  menge: {
    min: 0, max: 1_000_000,
    text: 'Diese Menge darf nicht negativ sein.',
    zuGross: 'Diese Menge ist unplausibel hoch.',
  },
  geschwindigkeit: {
    min: 0, offen: true, max: 200_000,
    text: 'Die Schnittgeschwindigkeit muss größer als 0 sein.',
    zuGross: 'Die Schnittgeschwindigkeit ist unplausibel hoch.',
  },
  toleranz: {
    min: 0, offen: true, max: 100,
    text: 'Die Toleranz muss größer als 0 sein.',
    zuGross: 'Die Toleranz ist unplausibel groß (über 100 mm).',
  },

  /* --- Prozente. Bereiche fachlich, nicht willkürlich. --- */
  prozentVerschnitt: {
    min: 0, max: 100,
    text: 'Der Verschnitt muss zwischen 0 und 100 % liegen.',
    zuGross: 'Mehr als 100 % Verschnitt ist nicht möglich.',
  },
  prozentAufschlag: {
    min: 0, max: 500,
    text: 'Ein Aufschlag darf nicht negativ sein.',
    zuGross: 'Ein Aufschlag über 500 % ist unplausibel.',
  },
  prozentMwst: {
    min: 0, max: 100,
    text: 'Die MwSt. muss zwischen 0 und 100 % liegen.',
    zuGross: 'Ein MwSt.-Satz über 100 % ist nicht möglich.',
  },
  prozentAnteil: {
    min: 0, max: 100,
    text: 'Dieser Wert muss zwischen 0 und 100 % liegen.',
    zuGross: 'Mehr als 100 % ist hier nicht möglich.',
  },
};

/**
 * Prüft eine Benutzereingabe vollständig: erst Zahlenformat und Einheit,
 * dann den fachlichen Wertebereich.
 *
 * @param {string|number} eingabe  Rohtext aus dem Feld
 * @param {object} opts
 * @param {string} [opts.einheit]  Einheit des Feldes ('mm', '€/h', …)
 * @param {string} [opts.regel]    Name aus REGELN
 * @param {boolean} [opts.pflicht] true = leer ist nicht erlaubt
 * @returns {{ok:boolean, wert:number|null, text:string, leer:boolean, grund:string}}
 */
export function pruefeFeld(eingabe, { einheit = '', regel = '', pflicht = false } = {}) {
  const p = pruefeZahl(eingabe, { einheit });
  if (!p.ok) return p;

  if (p.leer) {
    if (pflicht) {
      return { ok: false, wert: null, text: '', leer: true, grund: 'Dieses Feld muss ausgefüllt werden.' };
    }
    // Leer bedeutet 0 – aber nur, wenn 0 nach der Regel auch erlaubt ist.
    if (!regel) return p;
  }

  const r = REGELN[regel];
  if (!r) return p;

  const w = p.wert;
  if (r.ganz && !Number.isInteger(w)) {
    return {
      ...p, ok: false, wert: null,
      grund: `${r.text} „${String(w).replace('.', ',')}" ist keine ganze Zahl.`,
    };
  }
  const unterMin = r.offen ? !(w > r.min) : w < r.min;
  if (unterMin) return { ...p, ok: false, wert: null, grund: r.text };
  if (r.max !== undefined && w > r.max) {
    return { ...p, ok: false, wert: null, grund: r.zuGross || r.text };
  }
  return p;
}

/**
 * Prüft einen fertigen Modellwert gegen eine Regel — für Fälle, in denen die
 * Eingabe nicht mehr vorliegt (geladene Kalkulation, importiertes Backup).
 * @returns {string} leerer Text = in Ordnung, sonst die Begründung
 */
export function pruefeWert(wert, regel) {
  const r = REGELN[regel];
  if (!r) return '';
  if (!Number.isFinite(wert)) return 'Kein gültiger Zahlenwert.';
  if (r.ganz && !Number.isInteger(wert)) return r.text;
  if (r.offen ? !(wert > r.min) : wert < r.min) return r.text;
  if (r.max !== undefined && wert > r.max) return r.zuGross || r.text;
  return '';
}
