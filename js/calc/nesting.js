/**
 * nesting.js — Vorbereitung für die spätere Nesting-Funktion (§32).
 *
 * Version 1 kann bewusst nur RECHTECK-Nesting (Bounding Box, 0°/90°, Raster).
 * Das ist ehrlich beschriftet: es ersetzt kein Form-Nesting, liefert aber für
 * Blechteile eine brauchbare Abschätzung von Tafelbedarf und Ausnutzung.
 *
 * Die Schnittstelle ist so geschnitten, dass ein echter Nesting-Algorithmus
 * später dieselbe Rückgabestruktur liefern kann — Kalkulation und Oberfläche
 * müssen dafür nicht angefasst werden.
 *
 * DOM-frei, in Node testbar.
 */

/**
 * @param {object} p
 * @param {number} p.tafelLaengeMm  Tafellänge
 * @param {number} p.tafelBreiteMm  Tafelbreite
 * @param {number} p.teilBreiteMm   Bauteil-Bounding-Box Breite
 * @param {number} p.teilHoeheMm    Bauteil-Bounding-Box Höhe
 * @param {number} [p.randMm=10]    Randabstand zur Tafelkante
 * @param {number} [p.stegMm=5]     Steg zwischen zwei Teilen
 * @param {boolean} [p.drehenErlaubt=true] 90°-Drehung zulassen
 * @param {number} [p.menge=1]      Benötigte Stückzahl
 */
export function rasterNesting(p) {
  const L = Number(p.tafelLaengeMm) || 0;
  const B = Number(p.tafelBreiteMm) || 0;
  const w = Number(p.teilBreiteMm) || 0;
  const h = Number(p.teilHoeheMm) || 0;
  const rand = Math.max(0, Number(p.randMm ?? 10));
  const steg = Math.max(0, Number(p.stegMm ?? 5));
  const menge = Math.max(1, Math.trunc(Number(p.menge) || 1));

  if (!(L > 0 && B > 0 && w > 0 && h > 0)) {
    return { ok: false, grund: 'Tafelmaß oder Bauteilmaß fehlt.', proTafel: 0, tafeln: 0 };
  }

  const nutzL = L - 2 * rand;
  const nutzB = B - 2 * rand;

  const zaehle = (tw, th) => {
    if (tw > nutzL + 1e-9 || th > nutzB + 1e-9) return { spalten: 0, reihen: 0, stueck: 0 };
    const spalten = Math.floor((nutzL + steg) / (tw + steg));
    const reihen = Math.floor((nutzB + steg) / (th + steg));
    return { spalten, reihen, stueck: Math.max(0, spalten * reihen) };
  };

  const varianten = [{ dreh: 0, ...zaehle(w, h) }];
  if (p.drehenErlaubt !== false) varianten.push({ dreh: 90, ...zaehle(h, w) });
  varianten.sort((a, b) => b.stueck - a.stueck);
  const best = varianten[0];

  if (!best.stueck) {
    return {
      ok: false,
      grund: `Das Bauteil (${fmt(w)} × ${fmt(h)} mm) passt mit ${fmt(rand)} mm Rand nicht auf die Tafel (${fmt(L)} × ${fmt(B)} mm).`,
      proTafel: 0, tafeln: 0,
    };
  }

  const tafelFlaecheMm2 = L * B;
  const teilFlaecheMm2 = w * h;
  const tafeln = Math.ceil(menge / best.stueck);
  const belegtMm2 = best.stueck * teilFlaecheMm2;
  const ausnutzung = belegtMm2 / tafelFlaecheMm2;

  // Materialfläche je Stück, wenn die angebrochene Tafel voll bezahlt wird
  const flaecheProStueckM2 = (tafeln * tafelFlaecheMm2) / menge / 1_000_000;

  return {
    ok: true,
    proTafel: best.stueck,
    spalten: best.spalten,
    reihen: best.reihen,
    drehung: best.dreh,
    tafeln,
    menge,
    ausnutzung,                                   // 0..1 bezogen auf eine volle Tafel
    ausnutzungProzent: ausnutzung * 100,
    verschnittProzent: (1 - ausnutzung) * 100,
    restflaecheM2: (tafeln * tafelFlaecheMm2 - menge * teilFlaecheMm2) / 1_000_000,
    flaecheProStueckM2,
    teilFlaecheM2: teilFlaecheMm2 / 1_000_000,
    hinweis: 'Rechteck-Nesting über die Bounding Box (0°/90°). Echtes Form-Nesting kann mehr Teile unterbringen.',
  };
}

/**
 * Restblech, das nach dem Raster-Nesting auf der letzten Tafel übrig bleibt (§33).
 * Nur die beiden großen Reststreifen — bewusst konservativ.
 */
export function restStreifen(nest, tafelLaengeMm, tafelBreiteMm, teilBreiteMm, teilHoeheMm, randMm = 10, stegMm = 5) {
  if (!nest?.ok) return [];
  const w = nest.drehung === 90 ? teilHoeheMm : teilBreiteMm;
  const h = nest.drehung === 90 ? teilBreiteMm : teilHoeheMm;
  const belegtL = nest.spalten * w + Math.max(0, nest.spalten - 1) * stegMm;
  const belegtB = nest.reihen * h + Math.max(0, nest.reihen - 1) * stegMm;
  const out = [];
  const restL = tafelLaengeMm - 2 * randMm - belegtL;
  const restB = tafelBreiteMm - 2 * randMm - belegtB;
  if (restL > 50) out.push({ laengeMm: restL, breiteMm: tafelBreiteMm - 2 * randMm });
  if (restB > 50) out.push({ laengeMm: belegtL, breiteMm: restB });
  return out;
}

function fmt(v) {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(v);
}
