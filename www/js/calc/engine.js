/**
 * engine.js — Kalkulationskern.
 *
 * REINE FUNKTION: gleicher Input ⇒ gleicher Output. Kein DOM, kein Date.now(),
 * kein Zugriff auf die Datenbank. Alles, was in die Rechnung eingeht, steht im
 * übergebenen Kalkulationsdokument (inkl. Material-Snapshot und Stundensätzen).
 * Genau das macht eine Kalkulation Monate später reproduzierbar (§36).
 *
 * Alle Beträge sind ganze Cent, alle Prozente Basispunkte (§42).
 */

import { pctOf, costFromMinutes, costFromQty, divCent, roundHalf } from '../core/money.js';
import { flaechengewichtKgProM2, tafelFlaecheM2 } from '../core/material.js';

/* ------------------------------------------------------------------ */
/* Leeres Dokument                                                     */
/* ------------------------------------------------------------------ */

/** Erzeugt ein neues, vollständiges Kalkulationsdokument aus den Einstellungen. */
export function neueKalkulation(settings, overrides = {}) {
  return {
    id: null,
    nummer: '',
    kunde: '', projekt: '', bauteil: '', angebotsnummer: '',
    datum: '', notiz: '',
    stueckzahl: 1,
    materialId: '', material: null,
    verbrauch: {
      methode: 'rechteck',
      laengeMm: 0, breiteMm: 0,
      flaecheM2: 0, gewichtKg: 0, tafeln: 0, kostenCent: 0,
      proStueck: true,
    },
    dxf: null,
    verschnittBp: settings.verschnittBp,
    materialAufschlagBp: settings.materialAufschlagBp,
    zeiten: [],
    gas: { gasId: settings.standardGasId, name: '', modus: 'inklusive', preisCent: 0, proStueck: false },
    zusatz: [],
    gewinnBp: settings.gewinnBp,
    gewinnAktiv: settings.gewinnModus === 'aufschlag',
    mwstBp: settings.mwstBp,
    mindestwertCent: settings.mindestwertCent,
    mindestwertAktiv: settings.mindestwertAktiv,
    ...overrides,
  };
}

/** Standard-Zeitposition. */
export function neueZeit(art, name, satzCent, modus = 'proStueck') {
  return { art, name, minuten: 0, satzCent, modus, quelle: 'manuell', prozessId: '' };
}

/* ------------------------------------------------------------------ */
/* Material                                                            */
/* ------------------------------------------------------------------ */

export const METHODEN = {
  rechteck: 'Rechteckfläche (L × B)',
  kosten:   'Materialkosten direkt',
  tafeln:   'Ganze Tafeln',
  gewicht:  'Gewicht in kg',
  flaeche:  'Fläche in m²',
  dxf:      'Aus DXF-Analyse',
};

export const DXF_BASIS = {
  netto:   'Netto-Bauteilfläche',
  bbox:    'Umschließendes Rechteck (Bounding Box)',
  manuell: 'Manuelle Materialfläche',
  tafel:   'Komplette Tafel',
  nesting: 'Nesting-Ergebnis',
};

/**
 * Ermittelt die Materialfläche je Stück (m²) für die DXF-Methode (§14).
 * Gibt null zurück, wenn die gewählte Basis nicht verfügbar ist.
 */
export function dxfFlaecheM2(calc) {
  const d = calc.dxf;
  if (!d) return null;
  const basis = d.flaechenBasis || 'netto';
  const mat = calc.material || {};
  switch (basis) {
    case 'netto':
      return Number.isFinite(d.nettoFlaecheM2) ? d.nettoFlaecheM2 : null;
    case 'bbox':
      return Number.isFinite(d.bboxFlaecheM2) ? d.bboxFlaecheM2 : null;
    case 'manuell':
      return Number(d.manuelleFlaecheM2) > 0 ? Number(d.manuelleFlaecheM2) : null;
    case 'tafel': {
      const f = tafelFlaecheM2(mat);
      return f > 0 ? f : null;
    }
    case 'nesting':
      return Number(d.nestingFlaecheProStueckM2) > 0 ? Number(d.nestingFlaecheProStueckM2) : null;
    default:
      return null;
  }
}

/**
 * Berechnet den Material-Einkaufspreis vor Verschnitt und Aufschlag.
 * Liefert zusätzlich Fläche und Gewicht für die Anzeige.
 */
export function berechneMaterialBasis(calc) {
  const n = Math.max(1, Math.trunc(Number(calc.stueckzahl) || 1));
  const v = calc.verbrauch || {};
  const mat = calc.material || {};
  const warnungen = [];

  const kgProM2 = flaechengewichtKgProM2(mat);
  const preisM2 = Number(mat.preisProM2Cent) || 0;
  const preisKg = Number(mat.ekProKgCent) || 0;
  const preisTafel = Number(mat.ekTafelCent) || 0;

  let flaecheEinzelM2 = 0;   // Materialfläche je Stück
  let gewichtEinzelKg = 0;   // Materialgewicht je Stück
  let ekCent = 0;            // Gesamt-Einkaufspreis für den Auftrag
  let basisText = '';
  let proStueck = v.proStueck !== false;

  const methode = v.methode || 'rechteck';

  const flaecheZuKosten = (flaecheM2, text) => {
    flaecheEinzelM2 = flaecheM2;
    gewichtEinzelKg = kgProM2 > 0 ? flaecheM2 * kgProM2 : 0;
    if (preisM2 <= 0) {
      warnungen.push('Für dieses Material ist kein Preis je m² hinterlegt – die Materialkosten sind 0 €. Bitte Einkaufspreis im Material pflegen.');
      ekCent = 0;
    } else {
      const gesamtFlaeche = proStueck ? flaecheM2 * n : flaecheM2;
      ekCent = roundHalf(gesamtFlaeche * preisM2);
    }
    basisText = text;
  };

  switch (methode) {
    case 'rechteck': {
      const l = Number(v.laengeMm) || 0, b = Number(v.breiteMm) || 0;
      flaecheZuKosten((l * b) / 1_000_000, `${fmtMm(l)} × ${fmtMm(b)} mm`);
      break;
    }
    case 'flaeche': {
      flaecheZuKosten(Number(v.flaecheM2) || 0, 'manuelle Fläche');
      break;
    }
    case 'dxf': {
      const f = dxfFlaecheM2(calc);
      if (f === null) {
        warnungen.push('Die gewählte DXF-Flächenbasis liefert keinen Wert. Bitte eine andere Basis oder eine manuelle Fläche wählen.');
        flaecheZuKosten(0, 'DXF (kein Wert)');
      } else {
        flaecheZuKosten(f, `DXF – ${DXF_BASIS[calc.dxf.flaechenBasis || 'netto'] || 'Netto-Bauteilfläche'}`);
      }
      break;
    }
    case 'gewicht': {
      gewichtEinzelKg = Number(v.gewichtKg) || 0;
      flaecheEinzelM2 = kgProM2 > 0 ? gewichtEinzelKg / kgProM2 : 0;
      if (preisKg <= 0) {
        warnungen.push('Für dieses Material ist kein Preis je kg hinterlegt – die Materialkosten sind 0 €.');
        ekCent = 0;
      } else {
        const gesamtKg = proStueck ? gewichtEinzelKg * n : gewichtEinzelKg;
        ekCent = roundHalf(gesamtKg * preisKg);
      }
      basisText = `${fmtNum(gewichtEinzelKg, 3)} kg`;
      break;
    }
    case 'tafeln': {
      proStueck = v.proStueck === true; // Tafeln sind normalerweise Gesamtmenge
      const t = Number(v.tafeln) || 0;
      const tf = tafelFlaecheM2(mat);
      flaecheEinzelM2 = n > 0 ? (t * tf) / n : 0;
      gewichtEinzelKg = kgProM2 > 0 ? flaecheEinzelM2 * kgProM2 : 0;
      if (preisTafel <= 0) {
        warnungen.push('Für dieses Material ist kein Tafelpreis hinterlegt – die Materialkosten sind 0 €.');
        ekCent = 0;
      } else {
        ekCent = roundHalf((proStueck ? t * n : t) * preisTafel);
      }
      basisText = `${fmtNum(t, 2)} Tafel(n)`;
      break;
    }
    case 'kosten': {
      proStueck = v.proStueck === true; // Direkteingabe ist normalerweise Gesamtbetrag
      const c = Math.max(0, Math.trunc(Number(v.kostenCent) || 0));
      ekCent = proStueck ? c * n : c;
      basisText = 'direkt eingegeben';
      // Fläche/Gewicht lassen sich hier nicht ableiten.
      break;
    }
    default:
      warnungen.push(`Unbekannte Verbrauchsmethode "${methode}".`);
  }

  if (ekCent < 0) ekCent = 0;

  return {
    methode,
    basisText,
    proStueck,
    flaecheEinzelM2,
    flaecheGesamtM2: proStueck ? flaecheEinzelM2 * n : flaecheEinzelM2,
    gewichtEinzelKg,
    gewichtGesamtKg: proStueck ? gewichtEinzelKg * n : gewichtEinzelKg,
    ekCent,
    warnungen,
  };
}

/* ------------------------------------------------------------------ */
/* Hauptberechnung                                                     */
/* ------------------------------------------------------------------ */

/**
 * Vollständige Kalkulation.
 * @param {object} calc  Kalkulationsdokument
 * @returns {object} Ergebnis mit allen Zwischenschritten für die Detailansicht (§36)
 */
export function berechne(calc) {
  const n = Math.max(1, Math.trunc(Number(calc.stueckzahl) || 1));
  const warnungen = [];
  const positionen = [];

  /* --- 1. Material --- */
  const matBasis = berechneMaterialBasis(calc);
  warnungen.push(...matBasis.warnungen);

  const verschnittBp = Math.max(0, Number(calc.verschnittBp) || 0);
  const aufschlagBp = Math.max(0, Number(calc.materialAufschlagBp) || 0);

  const verschnittCent = pctOf(matBasis.ekCent, verschnittBp);
  const nachVerschnittCent = matBasis.ekCent + verschnittCent;
  const aufschlagCent = pctOf(nachVerschnittCent, aufschlagBp);
  const materialVkCent = nachVerschnittCent + aufschlagCent;

  const material = {
    ...matBasis,
    verschnittBp, verschnittCent,
    nachVerschnittCent,
    aufschlagBp, aufschlagCent,
    vkCent: materialVkCent,
    name: calc.material ? (calc.material.bezeichnung || `${calc.material.werkstoff || ''} ${calc.material.dickeMm || ''} mm`) : '',
  };

  if (materialVkCent > 0) {
    positionen.push({ gruppe: 'Material', label: 'Material Verkaufspreis', detail: material.basisText, cent: materialVkCent });
  }

  /* --- 2. Zeiten (§28: einmalig / pro Stück / Gesamtzeit) --- */
  const zeiten = [];
  let zeitenSummeCent = 0;
  let laserMinutenGesamt = 0;

  for (const z of (calc.zeiten || [])) {
    const min = Math.max(0, Number(z.minuten) || 0);
    const satz = Math.max(0, Math.trunc(Number(z.satzCent) || 0));
    const modus = z.modus || 'proStueck';
    const minutenGesamt = modus === 'proStueck' ? min * n : min;
    const kostenCent = costFromMinutes(minutenGesamt, satz);
    const row = {
      art: z.art, name: z.name || z.art, quelle: z.quelle || 'manuell',
      minuten: min, modus, minutenGesamt, satzCent: satz, kostenCent,
    };
    zeiten.push(row);
    zeitenSummeCent += kostenCent;
    if (z.art === 'laser') laserMinutenGesamt += minutenGesamt;
    if (kostenCent > 0 || min > 0) {
      positionen.push({
        gruppe: gruppeVonArt(z.art),
        label: row.name,
        detail: `${fmtNum(minutenGesamt, minutenGesamt % 1 === 0 ? 0 : 1)} min × ${fmtNum(satz / 100, 2)} €/h${modus === 'proStueck' ? ` (${fmtNum(min, min % 1 === 0 ? 0 : 1)} min × ${n} Stk)` : modus === 'einmalig' ? ' (einmalig)' : ' (Gesamtzeit)'}`,
        cent: kostenCent,
      });
    }
  }

  /* --- 3. Gas (§23) --- */
  const g = calc.gas || { modus: 'inklusive', preisCent: 0 };
  let gasKostenCent = 0;
  const gasModus = g.modus || 'inklusive';
  const gasPreis = Math.max(0, Math.trunc(Number(g.preisCent) || 0));
  if (gasModus === 'proStunde') gasKostenCent = costFromMinutes(laserMinutenGesamt, gasPreis);
  else if (gasModus === 'proMinute') gasKostenCent = roundHalf(laserMinutenGesamt * gasPreis);
  else if (gasModus === 'pauschal') gasKostenCent = g.proStueck ? gasPreis * n : gasPreis;
  const gas = { name: g.name || '', modus: gasModus, preisCent: gasPreis, minuten: laserMinutenGesamt, kostenCent: gasKostenCent };
  if (gasKostenCent > 0) {
    positionen.push({
      gruppe: 'Gas',
      label: gas.name || 'Schneidgas',
      detail: gasModus === 'proStunde' ? `${fmtNum(laserMinutenGesamt, 1)} min × ${fmtNum(gasPreis / 100, 2)} €/h`
        : gasModus === 'proMinute' ? `${fmtNum(laserMinutenGesamt, 1)} min × ${fmtNum(gasPreis / 100, 2)} €/min`
        : g.proStueck ? `Pauschale × ${n} Stk` : 'Pauschale',
      cent: gasKostenCent,
    });
  }

  /* --- 4. Zusätzliche Kosten (§24) --- */
  const zusatz = [];
  let zusatzSummeCent = 0;
  for (const z of (calc.zusatz || [])) {
    const menge = Number(z.menge) || 0;
    const einzel = Math.trunc(Number(z.einzelpreisCent) || 0);
    const modus = z.modus || 'einmalig';
    const mengeGesamt = modus === 'proStueck' ? menge * n : menge;
    const kostenCent = costFromQty(mengeGesamt, einzel);
    zusatz.push({ bezeichnung: z.bezeichnung || 'Position', menge, mengeGesamt, einheit: z.einheit || 'Stk', einzelpreisCent: einzel, modus, kostenCent });
    zusatzSummeCent += kostenCent;
    if (kostenCent !== 0) {
      positionen.push({
        gruppe: 'Zusatzkosten',
        label: z.bezeichnung || 'Position',
        detail: `${fmtNum(mengeGesamt, mengeGesamt % 1 === 0 ? 0 : 2)} ${z.einheit || 'Stk'} × ${fmtNum(einzel / 100, 2)} €`,
        cent: kostenCent,
      });
    }
  }

  /* --- 5. Summen (§25) --- */
  const kalkulationCent = materialVkCent + zeitenSummeCent + gasKostenCent + zusatzSummeCent;

  const gewinnAktiv = calc.gewinnAktiv === true;
  const gewinnBp = Math.max(0, Number(calc.gewinnBp) || 0);
  const gewinnCent = gewinnAktiv ? pctOf(kalkulationCent, gewinnBp) : 0;

  let vkNettoCent = kalkulationCent + gewinnCent;
  const vkVorMindestCent = vkNettoCent;

  const mindestwertCent = Math.max(0, Math.trunc(Number(calc.mindestwertCent) || 0));
  const mindestwertAktiv = calc.mindestwertAktiv === true && mindestwertCent > 0;
  let mindestwertAngewendet = false;
  if (mindestwertAktiv && vkNettoCent < mindestwertCent) {
    vkNettoCent = mindestwertCent;
    mindestwertAngewendet = true;
  }

  const mwstBp = Math.max(0, Number(calc.mwstBp) || 0);
  const mwstCent = pctOf(vkNettoCent, mwstBp);
  const vkBruttoCent = vkNettoCent + mwstCent;

  const vkProStueckCent = divCent(vkNettoCent, n);
  const vkProStueckBruttoCent = divCent(vkBruttoCent, n);

  // Deckungsbeitrag: Verkaufspreis abzüglich direkt zugekaufter Kosten.
  const deckungsbeitragCent = vkNettoCent - matBasis.ekCent - zusatzSummeCent;

  if (matBasis.ekCent === 0 && !['kosten'].includes(matBasis.methode) && !calc.material) {
    warnungen.push('Es ist kein Material gewählt – die Materialkosten sind 0 €.');
  }

  return {
    stueckzahl: n,
    material, zeiten, zeitenSummeCent, gas, zusatz, zusatzSummeCent,
    laserMinutenGesamt,
    kalkulationCent,
    gewinnAktiv, gewinnBp, gewinnCent,
    vkVorMindestCent,
    mindestwertAktiv, mindestwertCent, mindestwertAngewendet,
    vkNettoCent,
    mwstBp, mwstCent, vkBruttoCent,
    vkProStueckCent, vkProStueckBruttoCent,
    deckungsbeitragCent,
    positionen,
    warnungen,
  };
}

/**
 * §-Verbesserung: Preisstaffel. Rechnet dieselbe Kalkulation für andere Stückzahlen.
 * Einmalige Positionen (CAD, Rüsten) bleiben einmalig — genau darum sinkt der Stückpreis.
 */
export function staffel(calc, mengen = [1, 5, 10, 25, 50, 100]) {
  return mengen.map(m => {
    const r = berechne({ ...calc, stueckzahl: m });
    return { stueckzahl: m, proStueckCent: r.vkProStueckCent, gesamtCent: r.vkNettoCent };
  });
}

/* ------------------------------------------------------------------ */
/* Validierung (§41)                                                   */
/* ------------------------------------------------------------------ */

/** Prüft ein Kalkulationsdokument. Rückgabe: { fehler:[], hinweise:[] } */
export function pruefeKalkulation(calc) {
  const fehler = [];
  const hinweise = [];

  const nRaw = Number(calc.stueckzahl);
  if (!Number.isFinite(nRaw) || nRaw < 1) fehler.push('Die Stückzahl muss mindestens 1 betragen.');
  else if (!Number.isInteger(nRaw)) hinweise.push('Die Stückzahl wird auf eine ganze Zahl abgerundet.');
  else if (nRaw > 1_000_000) fehler.push('Die Stückzahl ist unplausibel hoch (über 1.000.000).');

  const v = calc.verbrauch || {};
  if (v.methode === 'rechteck') {
    const l = Number(v.laengeMm) || 0, b = Number(v.breiteMm) || 0;
    if (l < 0 || b < 0) fehler.push('Blechabmessungen dürfen nicht negativ sein.');
    if (l > 0 && b > 0 && calc.material) {
      const tl = Number(calc.material.tafelLaengeMm) || 0, tb = Number(calc.material.tafelBreiteMm) || 0;
      if (tl > 0 && tb > 0) {
        const passt = (l <= tl && b <= tb) || (l <= tb && b <= tl);
        if (!passt) hinweise.push(`Die Fläche ${fmtMm(l)} × ${fmtMm(b)} mm ist größer als eine Tafel (${fmtMm(tl)} × ${fmtMm(tb)} mm).`);
      }
    }
  }
  if (v.methode === 'gewicht' && Number(v.gewichtKg) < 0) fehler.push('Das Gewicht darf nicht negativ sein.');
  if (v.methode === 'flaeche' && Number(v.flaecheM2) < 0) fehler.push('Die Fläche darf nicht negativ sein.');
  if (v.methode === 'tafeln' && Number(v.tafeln) < 0) fehler.push('Die Tafelanzahl darf nicht negativ sein.');
  if (v.methode === 'kosten' && Number(v.kostenCent) < 0) fehler.push('Die Materialkosten dürfen nicht negativ sein.');

  if (!calc.material && v.methode !== 'kosten') {
    hinweise.push('Es ist kein Material gewählt. Ohne Material werden keine Materialkosten berechnet.');
  }

  for (const z of (calc.zeiten || [])) {
    if (Number(z.minuten) < 0) fehler.push(`Negative Zeit bei „${z.name || z.art}" ist nicht möglich.`);
    if (Number(z.satzCent) < 0) fehler.push(`Negativer Stundensatz bei „${z.name || z.art}" ist nicht möglich.`);
  }
  for (const z of (calc.zusatz || [])) {
    if (Number(z.einzelpreisCent) < 0) hinweise.push(`Die Position „${z.bezeichnung || 'Zusatzkosten'}" hat einen negativen Preis (Gutschrift?).`);
  }
  if (Number(calc.verschnittBp) < 0) fehler.push('Der Verschnitt darf nicht negativ sein.');
  if (Number(calc.materialAufschlagBp) < 0) fehler.push('Der Materialaufschlag darf nicht negativ sein.');
  if (Number(calc.gewinnBp) < 0) fehler.push('Der Gewinnaufschlag darf nicht negativ sein.');
  if (Number(calc.mwstBp) < 0) fehler.push('Die MwSt. darf nicht negativ sein.');

  if (calc.dxf && calc.dxf.einheitUnsicher && !calc.dxf.einheitBestaetigt) {
    fehler.push('Die Einheit der DXF-Datei ist nicht eindeutig. Bitte oben bestätigen.');
  }

  return { fehler, hinweise };
}

/* ------------------------------------------------------------------ */

function gruppeVonArt(art) {
  switch (art) {
    case 'laser': return 'Laser';
    case 'cad': return 'CAD / Programmierung';
    case 'bediener': return 'Bediener / Rüsten';
    default: return 'Nachbearbeitung';
  }
}

function fmtNum(v, dez = 2) {
  if (!Number.isFinite(v)) return '–';
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: dez, maximumFractionDigits: dez }).format(v);
}
function fmtMm(v) { return fmtNum(v, v % 1 === 0 ? 0 : 1); }
