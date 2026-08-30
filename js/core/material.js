/**
 * material.js — Ableitungen rund um ein Blech (§4, §5).
 * Rein rechnend, DOM-frei, testbar.
 *
 *   Gewicht/Tafel = Länge × Breite × Stärke × Dichte
 *   Preis/kg und Preis/m² werden – soweit möglich – aus dem Tafelpreis abgeleitet.
 *
 * Welcher Preis die QUELLE ist, entscheidet `preisQuelle`:
 *   'tafel' → Einkaufspreis je Tafel ist führend
 *   'kg'    → Einkaufspreis je kg ist führend
 *   'm2'    → Preis je m² ist führend
 * Die jeweils anderen beiden Werte werden berechnet und sind als abgeleitet markiert.
 */

import { roundHalf } from './money.js';

/** Tafelfläche in m². 0 wenn kein Tafelmaß hinterlegt ist. */
export function tafelFlaecheM2(mat) {
  const l = Number(mat.tafelLaengeMm) || 0;
  const b = Number(mat.tafelBreiteMm) || 0;
  if (l <= 0 || b <= 0) return 0;
  return (l * b) / 1_000_000;
}

/** Gewicht einer ganzen Tafel in kg: L[m] × B[m] × t[m] × ρ[kg/m³]. */
export function gewichtProTafelKg(mat) {
  const flaeche = tafelFlaecheM2(mat);
  const d = Number(mat.dickeMm) || 0;
  const rho = Number(mat.dichte) || 0;
  if (flaeche <= 0 || d <= 0 || rho <= 0) return 0;
  return flaeche * (d / 1000) * rho;
}

/** Flächengewicht in kg/m²: t[m] × ρ[kg/m³]. Basis für Preis/m² ⇄ Preis/kg. */
export function flaechengewichtKgProM2(mat) {
  const d = Number(mat.dickeMm) || 0;
  const rho = Number(mat.dichte) || 0;
  if (d <= 0 || rho <= 0) return 0;
  return (d / 1000) * rho;
}

/**
 * Berechnet alle abgeleiteten Werte eines Materials.
 * Gibt ein NEUES Objekt zurück (Eingabe bleibt unverändert) und dazu eine Liste,
 * welche Felder abgeleitet wurden — die Oberfläche kennzeichnet das.
 */
export function materialAbleiten(matIn) {
  const mat = { ...matIn };
  const abgeleitet = [];

  const flaeche = tafelFlaecheM2(mat);
  const kgProM2 = flaechengewichtKgProM2(mat);
  const kgProTafel = gewichtProTafelKg(mat);

  mat.tafelFlaecheM2 = flaeche;
  mat.gewichtProTafelKg = kgProTafel;
  mat.flaechengewichtKgProM2 = kgProM2;

  const quelle = mat.preisQuelle || 'tafel';
  const ekTafel = Number(mat.ekTafelCent) || 0;
  const ekKg = Number(mat.ekProKgCent) || 0;
  const ekM2 = Number(mat.preisProM2Cent) || 0;

  if (quelle === 'tafel' && ekTafel > 0) {
    if (flaeche > 0) { mat.preisProM2Cent = roundHalf(ekTafel / flaeche); abgeleitet.push('preisProM2Cent'); }
    if (kgProTafel > 0) { mat.ekProKgCent = roundHalf(ekTafel / kgProTafel); abgeleitet.push('ekProKgCent'); }
  } else if (quelle === 'kg' && ekKg > 0) {
    if (kgProM2 > 0) { mat.preisProM2Cent = roundHalf(ekKg * kgProM2); abgeleitet.push('preisProM2Cent'); }
    if (kgProTafel > 0) { mat.ekTafelCent = roundHalf(ekKg * kgProTafel); abgeleitet.push('ekTafelCent'); }
  } else if (quelle === 'm2' && ekM2 > 0) {
    if (flaeche > 0) { mat.ekTafelCent = roundHalf(ekM2 * flaeche); abgeleitet.push('ekTafelCent'); }
    if (kgProM2 > 0) { mat.ekProKgCent = roundHalf(ekM2 / kgProM2); abgeleitet.push('ekProKgCent'); }
  }

  mat.abgeleitet = abgeleitet;
  return mat;
}

/** Anzeigename eines Materials für Listen und Kalkulationen. */
export function materialLabel(mat) {
  if (!mat) return '—';
  if (mat.bezeichnung) return mat.bezeichnung;
  const d = Number(mat.dickeMm) || 0;
  return `${mat.werkstoff || 'Material'} ${String(d).replace('.', ',')} mm`;
}

/**
 * Prüft ein Material auf sinnvolle Werte (§41).
 * Gibt ein Array von Klartextmeldungen zurück; leer = in Ordnung.
 */
export function materialPruefen(mat) {
  const f = [];
  if (!mat.groupId) f.push('Bitte eine Materialgruppe wählen.');
  if (!String(mat.werkstoff || '').trim()) f.push('Bitte einen Werkstoff angeben (z. B. S235JR).');
  const d = Number(mat.dickeMm);
  if (!Number.isFinite(d) || d <= 0) f.push('Die Blechstärke muss größer als 0 sein.');
  if (d > 200) f.push('Die Blechstärke ist unplausibel groß (über 200 mm).');
  const l = Number(mat.tafelLaengeMm), b = Number(mat.tafelBreiteMm);
  if (l < 0 || b < 0) f.push('Tafelmaße dürfen nicht negativ sein.');
  if ((l > 0 && b <= 0) || (b > 0 && l <= 0)) f.push('Bitte Tafellänge UND Tafelbreite angeben.');
  const rho = Number(mat.dichte);
  if (!Number.isFinite(rho) || rho <= 0) f.push('Die Dichte muss größer als 0 sein.');
  else if (rho < 500 || rho > 25000) f.push('Die Dichte ist unplausibel (erwartet 500–25.000 kg/m³).');
  for (const [feld, name] of [['ekTafelCent', 'Tafelpreis'], ['ekProKgCent', 'Preis je kg'], ['preisProM2Cent', 'Preis je m²']]) {
    if (Number(mat[feld]) < 0) f.push(`${name} darf nicht negativ sein.`);
  }
  return f;
}

/**
 * §17: Sucht den bestpassenden Schnittparametersatz.
 * Bewertung: Werkstoff > Gruppe > Gas > Maschine, Blechstärke möglichst nahe.
 * Gibt { param, exakt, hinweis } zurück — `exakt:false` heißt: die App hat
 * einen Nachbarwert benutzt und sagt das auch (nie stillschweigend raten).
 */
export function findeSchnittparameter(params, { groupId, werkstoff, dickeMm, gas, maschineId } = {}) {
  if (!Array.isArray(params) || !params.length) {
    return { param: null, exakt: false, hinweis: 'Keine Schnittparameter hinterlegt.' };
  }
  const wNorm = String(werkstoff || '').toLowerCase().trim();
  const gNorm = String(gas || '').toLowerCase().trim();
  const d = Number(dickeMm) || 0;

  let best = null, bestScore = -Infinity;
  for (const p of params) {
    let score = 0;
    const pw = String(p.werkstoff || '').toLowerCase().trim();
    if (wNorm && pw === wNorm) score += 100;
    else if (p.groupId && groupId && p.groupId === groupId) score += 40;
    else if (wNorm && pw) score -= 30;

    const pg = String(p.gas || '').toLowerCase().trim();
    if (gNorm && pg === gNorm) score += 30;
    else if (gNorm && pg) score -= 25;

    if (maschineId && p.maschineId === maschineId) score += 10;

    const pd = Number(p.dickeMm) || 0;
    const diff = Math.abs(pd - d);
    if (diff < 1e-9) score += 60;
    else score += Math.max(0, 50 - diff * 12);

    if (score > bestScore) { bestScore = score; best = p; }
  }
  if (!best) return { param: null, exakt: false, hinweis: 'Kein passender Schnittparameter gefunden.' };

  const bestDicke = Number(best.dickeMm) || 0;
  const bestW = String(best.werkstoff || '').toLowerCase().trim();

  const exakt =
    Math.abs(bestDicke - d) < 1e-9 &&
    (!wNorm || bestW === wNorm) &&
    (!gNorm || String(best.gas || '').toLowerCase().trim() === gNorm);

  /*
   * AUSSERHALB DER TABELLE: Die Punktevergabe oben findet IMMER einen
   * „besten" Satz – auch wenn er gar nicht passt. Eine 20-mm-Platte würde
   * sonst mit den Werten für 3 mm gerechnet und die geschätzte Laserzeit
   * wäre um ein Vielfaches zu kurz. Das wäre genau das stillschweigende
   * Raten, das die App nicht tun darf. Deshalb wird ein solcher Treffer
   * ausdrücklich als „außerhalb" gekennzeichnet; die Oberfläche übernimmt
   * ihn dann nicht mehr von selbst.
   */
  const dickeAbw = d > 0 ? Math.abs(bestDicke - d) : 0;
  const dickeWeit = d > 0 && dickeAbw > 0.5 && dickeAbw > d * 0.5;
  const werkstoffFremd = !!wNorm && !!bestW && bestW !== wNorm &&
    !(groupId && best.groupId && best.groupId === groupId);
  const ausserhalb = dickeWeit || werkstoffFremd;

  const gefunden = `${best.werkstoff} ${String(best.dickeMm).replace('.', ',')} mm / ${best.gas}`;
  const gesucht = `${werkstoff || '?'} ${String(d).replace('.', ',')} mm / ${gas || '?'}`;

  return {
    param: best,
    exakt,
    /** true = der Treffer liegt außerhalb der hinterlegten Tabelle, nur als Anhalt brauchbar */
    ausserhalb,
    hinweis: exakt ? '' : ausserhalb
      ? `Für ${gesucht} ist KEIN Schnittparameter hinterlegt. Der nächstliegende Eintrag ` +
        `(${gefunden}) passt nicht dazu – die Laserzeit lässt sich daraus nicht schätzen. ` +
        `Bitte den Parameter anlegen oder die Zeit von Hand eintragen.`
      : `Kein exakter Schnittparameter für ${gesucht}. ` +
        `Verwendet wird ${gefunden}. Bitte prüfen.`,
  };
}
