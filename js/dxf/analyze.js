/**
 * analyze.js — Geometrie-Auswertung einer DXF-Zeichnung (§9–§16, §31).
 *
 * Ablauf:
 *   1. Polygonzüge aus geometry.js einsammeln und auf mm umrechnen
 *   2. offene Züge über ihre Endpunkte zu Konturen verketten
 *   3. geschlossene Konturen: Fläche (Gauß'sche Trapezformel) und Länge
 *   4. Verschachtelung bestimmen -> Außenkontur / Loch / Insel
 *   5. Nettofläche = Σ Fläche × (Tiefe gerade ? +1 : −1)
 *   6. Schnittlänge, Einstiche, Bauteile, Prüfmeldungen
 *
 * Grundsatz: Es wird nie stillschweigend geraten. Alles Unsichere landet in
 * `warnungen` und ist in der Oberfläche überschreibbar.
 *
 * DOM-frei, in Node testbar.
 */

import { parseDxf, einheitBestimmen, EINHEIT_FAKTOR } from './parser.js';
import { flatten } from './geometry.js';

/* ---------------- Polygon-Grundfunktionen ---------------- */

/** Vorzeichenbehaftete Fläche (Gauß'sche Trapezformel). Positiv = gegen Uhrzeigersinn. */
export function signedArea(pts) {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % n];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/** Länge eines Polygonzugs. `closed` schließt die letzte Kante mit ein. */
export function pathLength(pts, closed) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (closed && pts.length > 2) {
    const a = pts[pts.length - 1], b = pts[0];
    l += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return l;
}

export function bbox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, breite: maxX - minX, hoehe: maxY - minY };
}

/** Punkt-in-Polygon (Strahlensatz / ray casting). */
export function pointInPolygon(pt, poly) {
  const [px, py] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py)) {
      const x = ((xj - xi) * (py - yi)) / (yj - yi) + xi;
      if (px < x) inside = !inside;
    }
  }
  return inside;
}

/**
 * Ein Punkt, der garantiert INNERHALB des Polygons liegt — auch bei konkaven
 * Formen, bei denen der Schwerpunkt außerhalb liegen kann.
 * Verfahren: waagrechte Schnittlinie zwischen zwei benachbarten Eckpunkt-Höhen
 * legen, Schnittpunkte sortieren, Mitte des ersten Intervalls nehmen.
 */
export function interiorPoint(poly) {
  const ys = [...new Set(poly.map(p => p[1]))].sort((a, b) => a - b);
  if (ys.length < 2) return poly[0];
  const kandidaten = [];
  for (let i = 0; i < ys.length - 1; i++) kandidaten.push((ys[i] + ys[i + 1]) / 2);
  // Mitte zuerst probieren – dort ist die Chance auf ein breites Intervall am größten.
  kandidaten.sort((a, b) => Math.abs(a - (ys[0] + ys[ys.length - 1]) / 2) - Math.abs(b - (ys[0] + ys[ys.length - 1]) / 2));

  for (const y of kandidaten) {
    const xs = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y)) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      if (xs[k + 1] - xs[k] > 1e-9) return [(xs[k] + xs[k + 1]) / 2, y];
    }
  }
  // Rückfall: Schwerpunkt
  let sx = 0, sy = 0;
  for (const p of poly) { sx += p[0]; sy += p[1]; }
  return [sx / poly.length, sy / poly.length];
}

/* ---------------- Verkettung offener Züge ---------------- */

function key(x, y, tol) {
  return `${Math.round(x / tol)}|${Math.round(y / tol)}`;
}

/**
 * Verkettet offene Polygonzüge über gemeinsame Endpunkte zu längeren Ketten.
 * @returns {{ketten:Array<{pts:number[][], closed:boolean}>}}
 */
export function verkette(offenePolys, tol) {
  const paths = offenePolys.map(p => ({ pts: p.pts.slice(), used: false, layer: p.layer }));
  const index = new Map();
  const eintragen = (i, ende) => {
    const p = paths[i].pts;
    const pt = ende === 0 ? p[0] : p[p.length - 1];
    // 3×3-Nachbarschaft eintragen, damit Punkte knapp neben der Zellgrenze gefunden werden
    const k = key(pt[0], pt[1], tol);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push({ i, ende });
  };
  paths.forEach((_, i) => { eintragen(i, 0); eintragen(i, 1); });

  const nachbarn = (pt) => {
    const out = [];
    const cx = Math.round(pt[0] / tol), cy = Math.round(pt[1] / tol);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const arr = index.get(`${cx + dx}|${cy + dy}`);
        if (arr) out.push(...arr);
      }
    }
    return out;
  };

  const nah = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
  const ketten = [];

  for (let start = 0; start < paths.length; start++) {
    if (paths[start].used) continue;
    paths[start].used = true;
    let pts = paths[start].pts.slice();

    // nach vorne verlängern
    let weiter = true;
    while (weiter) {
      weiter = false;
      const ende = pts[pts.length - 1];
      // Schließt sich die Kette bereits? Dann NICHT weiter anhängen – sonst zerstört
      // eine doppelt gezeichnete Linie den Konturschluss.
      if (pts.length > 2 && nah(pts[0], ende)) break;
      for (const { i, ende: e } of nachbarn(ende)) {
        if (paths[i].used) continue;
        const kandidat = paths[i].pts;
        const p = e === 0 ? kandidat[0] : kandidat[kandidat.length - 1];
        if (!nah(ende, p)) continue;
        paths[i].used = true;
        const anhang = e === 0 ? kandidat.slice(1) : kandidat.slice(0, -1).reverse();
        pts = pts.concat(anhang);
        weiter = true;
        break;
      }
    }
    // nach hinten verlängern
    weiter = true;
    while (weiter) {
      weiter = false;
      const anfang = pts[0];
      if (pts.length > 2 && nah(anfang, pts[pts.length - 1])) break;
      for (const { i, ende: e } of nachbarn(anfang)) {
        if (paths[i].used) continue;
        const kandidat = paths[i].pts;
        const p = e === 0 ? kandidat[0] : kandidat[kandidat.length - 1];
        if (!nah(anfang, p)) continue;
        paths[i].used = true;
        const vorne = e === 0 ? kandidat.slice(1).reverse() : kandidat.slice(0, -1);
        pts = vorne.concat(pts);
        weiter = true;
        break;
      }
    }

    const closed = pts.length > 2 && nah(pts[0], pts[pts.length - 1]);
    if (closed) pts = pts.slice(0, -1); // Schlusspunkt nicht doppelt führen
    ketten.push({ pts, closed });
  }
  return { ketten };
}

/* ---------------- Prüfungen (§11) ---------------- */

/**
 * Prüft alle Segmente auf Zeichnungsfehler (§11).
 *
 * Doppelte Segmente: gleiche Endpunkte (in beliebiger Reihenfolge).
 *
 * Kollineare Überlappungen: Segmente werden nach ihrer GERADEN gruppiert
 * (Richtung + Abstand vom Ursprung), nicht nach ihrer Lage im Raster. Das ist
 * der entscheidende Unterschied zur naheliegenden Rasterlösung: zwei Segmente
 * derselben Geraden können beliebig weit auseinander beginnen und trotzdem
 * überlappen — ein Vergleich nur innerhalb einer Zelle übersieht genau das.
 * Innerhalb einer Geraden werden die Segmente auf die Richtung projiziert und
 * die Intervalle sortiert überstrichen; das findet jede Überlappung, auch
 * lange und mehrfach gestapelte, in O(n log n).
 */
function pruefeSegmente(polys, tol, minSegmentMm) {
  let doppelt = 0, kurz = 0, null_ = 0, gesamt = 0;
  const gesehen = new Set();
  let ueberlappend = 0;
  let ueberlappungLaengeMm = 0;
  let zuVieleSegmente = false;

  const segs = [];
  for (const p of polys) {
    const pts = p.pts;
    const n = p.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      gesamt++;
      if (len < 1e-9) { null_++; continue; }
      if (len < minSegmentMm) kurz++;
      const ka = key(a[0], a[1], tol), kb = key(b[0], b[1], tol);
      const k = ka < kb ? `${ka}#${kb}` : `${kb}#${ka}`;
      if (gesehen.has(k)) doppelt++; else gesehen.add(k);
      segs.push({ a, b, len, idx: segs.length });
    }
  }

  if (segs.length > 200000) {
    zuVieleSegmente = true;
    return { doppelt, kurz, null: null_, gesamt, ueberlappend, ueberlappungLaengeMm, zuVieleSegmente };
  }

  /* --- Nach Geraden gruppieren --- */
  // Winkelauflösung: so fein, dass über die größte vorkommende Länge der
  // Querversatz unter der Toleranz bleibt.
  let maxLen = 0;
  for (const s of segs) if (s.len > maxLen) maxLen = s.len;
  const winkelSchritt = Math.max(1e-6, Math.min(0.05, tol / Math.max(maxLen, 1)));

  const geraden = new Map();
  for (const s of segs) {
    let ux = (s.b[0] - s.a[0]) / s.len, uy = (s.b[1] - s.a[1]) / s.len;
    // Richtung eindeutig machen: eine Gerade hat zwei Richtungen, wir nehmen eine.
    if (ux < 0 || (Math.abs(ux) < 1e-12 && uy < 0)) { ux = -ux; uy = -uy; }
    const winkel = Math.atan2(uy, ux);              // 0 .. pi
    const c = -uy * s.a[0] + ux * s.a[1];           // Abstand vom Ursprung
    const wi = Math.round(winkel / winkelSchritt);
    const ci = Math.round(c / tol);
    // Nachbarschlüssel mit ablegen, damit Werte knapp neben einer Schwelle
    // nicht in getrennte Gruppen fallen.
    for (const dw of [0, 1]) {
      for (const dc of [0, 1]) {
        const k = `${wi + dw}|${ci + dc}`;
        if (!geraden.has(k)) geraden.set(k, []);
        geraden.get(k).push({ s, ux, uy });
      }
    }
  }

  const gezaehlt = new Set();
  for (const gruppe of geraden.values()) {
    if (gruppe.length < 2) continue;
    // Auf die Richtung der Gruppe projizieren
    const { ux, uy } = gruppe[0];
    const intervalle = gruppe.map(({ s }, i) => {
      const t1 = s.a[0] * ux + s.a[1] * uy;
      const t2 = s.b[0] * ux + s.b[1] * uy;
      return { von: Math.min(t1, t2), bis: Math.max(t1, t2), s, i };
    }).sort((a, b) => a.von - b.von);

    for (let i = 0; i < intervalle.length; i++) {
      for (let j = i + 1; j < intervalle.length; j++) {
        if (intervalle[j].von >= intervalle[i].bis - tol) break;   // sortiert: ab hier kein Treffer mehr
        const ueberlapp = Math.min(intervalle[i].bis, intervalle[j].bis) - intervalle[j].von;
        if (ueberlapp <= tol) continue;
        // Querabstand der beiden Geraden prüfen (die Gruppierung ist grob)
        const p = intervalle[j].s.a;
        const q = intervalle[i].s.a;
        const quer = Math.abs((p[0] - q[0]) * -uy + (p[1] - q[1]) * ux);
        if (quer > tol) continue;
        const ia = intervalle[i].s.idx, ib = intervalle[j].s.idx;
        if (ia === ib) continue;
        const paar = ia < ib ? `${ia}#${ib}` : `${ib}#${ia}`;
        if (gezaehlt.has(paar)) continue;
        gezaehlt.add(paar);
        ueberlappend++;
        ueberlappungLaengeMm += ueberlapp;
      }
    }
  }

  return { doppelt, kurz, null: null_, gesamt, ueberlappend, ueberlappungLaengeMm, zuVieleSegmente };
}

/* ---------------- Hauptanalyse ---------------- */

/**
 * Analysiert eine DXF-Datei vollständig.
 *
 * @param {string} text        Dateiinhalt
 * @param {object} opts        { einheit, standardEinheit, tolMm, flachToleranzMm, minSegmentMm }
 * @returns {object} Analyseergebnis (siehe unten)
 */
export function analysiereDxf(text, opts = {}) {
  const standardEinheit = opts.standardEinheit || 'mm';
  const parsed = parseDxf(text);

  /* --- Einheit (§12) --- */
  const auto = einheitBestimmen(parsed.header, standardEinheit);
  const einheit = opts.einheit || auto.einheit;
  const faktor = EINHEIT_FAKTOR[einheit] ?? 1;
  const einheitUnsicher = !auto.sicher && !opts.einheit;

  /* --- Abflachen --- */
  const flachTolZeichnung = (opts.flachToleranzMm ?? 0.005) / faktor;
  const flach = flatten(parsed, { tolMm: flachTolZeichnung });

  const warnungen = [];
  const meldungen = [...parsed.meldungen, ...flach.meldungen];

  // Alles auf mm bringen
  const polysMm = flach.polys.map(p => ({
    ...p,
    pts: p.pts.map(([x, y]) => [x * faktor, y * faktor]),
  })).filter(p => p.pts.length >= 2);

  if (!polysMm.length) {
    return leeresErgebnis({ einheit, faktor, einheitUnsicher, autoEinheit: auto, meldungen, warnungen: ['Die DXF-Datei enthält keine auswertbare Geometrie.'], layer: flach.ignorierteLayer });
  }

  const tol = Math.max(opts.tolMm ?? 0.01, 1e-6);
  const minSegmentMm = opts.minSegmentMm ?? 0.05;

  /* --- Konturen bilden --- */
  const geschlossenDirekt = polysMm.filter(p => p.closed);
  const offene = polysMm.filter(p => !p.closed);
  const { ketten } = verkette(offene, tol);

  const konturen = [];
  for (const p of geschlossenDirekt) {
    const pts = entdoppeln(p.pts, tol);
    if (pts.length >= 3) konturen.push({ pts, closed: true, quelle: p.type });
  }
  const offeneKetten = [];
  for (const k of ketten) {
    const pts = entdoppeln(k.pts, tol);
    if (k.closed && pts.length >= 3) konturen.push({ pts, closed: true, quelle: 'verkettet' });
    else if (pts.length >= 2) offeneKetten.push({ pts, closed: false });
  }

  /* --- Flächen und Verschachtelung --- */
  for (const k of konturen) {
    k.flaecheSigniert = signedArea(k.pts);
    k.flaeche = Math.abs(k.flaecheSigniert);
    k.laenge = pathLength(k.pts, true);
    k.bbox = bbox(k.pts);
    k.innen = interiorPoint(k.pts);
  }
  konturen.sort((a, b) => b.flaeche - a.flaeche);
  konturen.forEach((k, i) => { k.idx = i; });

  for (const k of konturen) {
    k.tiefe = 0;
    k.parent = -1;
    let kleinsterEltern = Infinity;
    for (const kandidat of konturen) {
      if (kandidat === k) continue;
      if (kandidat.flaeche <= k.flaeche) continue;
      const bb = kandidat.bbox;
      if (k.innen[0] < bb.minX - tol || k.innen[0] > bb.maxX + tol || k.innen[1] < bb.minY - tol || k.innen[1] > bb.maxY + tol) continue;
      if (!pointInPolygon(k.innen, kandidat.pts)) continue;
      k.tiefe++;
      if (kandidat.flaeche < kleinsterEltern) { kleinsterEltern = kandidat.flaeche; k.parent = kandidat.idx; }
    }
    k.rolle = k.tiefe === 0 ? 'aussen' : (k.tiefe % 2 === 1 ? 'loch' : 'insel');
  }

  /* --- Nettofläche: Löcher abziehen, Inseln wieder addieren --- */
  let nettoFlaecheMm2 = 0;
  for (const k of konturen) nettoFlaecheMm2 += (k.tiefe % 2 === 0 ? 1 : -1) * k.flaeche;
  if (nettoFlaecheMm2 < 0) nettoFlaecheMm2 = 0;

  /* --- Schnittlängen --- */
  let laengeAussen = 0, laengeInnen = 0, laengeOffen = 0;
  for (const k of konturen) {
    if (k.tiefe === 0) laengeAussen += k.laenge; else laengeInnen += k.laenge;
  }
  for (const k of offeneKetten) { k.laenge = pathLength(k.pts, false); laengeOffen += k.laenge; }
  const schnittlaengeMm = laengeAussen + laengeInnen + laengeOffen;

  /* --- Einstiche (§16) --- */
  const einstiche = konturen.length + offeneKetten.length;

  /* --- Gesamt-Bounding-Box --- */
  const alle = [];
  for (const k of konturen) alle.push(...k.pts);
  for (const k of offeneKetten) alle.push(...k.pts);
  const bb = bbox(alle);

  /* --- Bauteile (§31) --- */
  const bauteile = konturen.filter(k => k.tiefe === 0).map((k, i) => {
    const kinder = konturen.filter(c => c.parent === k.idx);
    let netto = k.flaeche;
    for (const c of kinder) netto -= c.flaeche;
    // Inseln in Löchern wieder addieren
    for (const c of kinder) {
      for (const e of konturen.filter(x => x.parent === c.idx)) netto += e.flaeche;
    }
    let laenge = k.laenge;
    let stiche = 1;
    const sammle = (parentIdx) => {
      for (const c of konturen.filter(x => x.parent === parentIdx)) {
        laenge += c.laenge; stiche++; sammle(c.idx);
      }
    };
    sammle(k.idx);
    return {
      nr: i + 1,
      konturIdx: k.idx,
      bbox: k.bbox,
      breiteMm: k.bbox.breite,
      hoeheMm: k.bbox.hoehe,
      nettoFlaecheMm2: Math.max(0, netto),
      schnittlaengeMm: laenge,
      einstiche: stiche,
      loecher: kinder.length,
      stueckzahl: 1,
    };
  });

  /* --- Prüfungen --- */
  const pruef = pruefeSegmente([...konturen.map(k => ({ pts: k.pts, closed: true })), ...offeneKetten.map(k => ({ pts: k.pts, closed: false }))], tol, minSegmentMm);

  if (offeneKetten.length) {
    warnungen.push(`Achtung: ${offeneKetten.length} offene ${offeneKetten.length === 1 ? 'Kontur' : 'Konturen'} erkannt. Flächen- und Gewichtsberechnung möglicherweise ungenau.`);
  }
  if (pruef.doppelt) warnungen.push(`${pruef.doppelt} doppelte Linien erkannt. Schnittlänge und Einstiche können dadurch zu groß sein.`);
  if (pruef.ueberlappend) {
    const l = pruef.ueberlappungLaengeMm;
    warnungen.push(
      `${pruef.ueberlappend} überlappende Linienpaare erkannt (zusammen ${l < 10 ? l.toFixed(2) : l.toFixed(0)} mm). ` +
      `Die Schnittlänge ist dadurch um bis zu diesen Betrag zu groß. Bitte die Zeichnung im CAD bereinigen.`);
  }
  if (pruef.kurz) warnungen.push(`${pruef.kurz} extrem kurze Segmente (< ${String(minSegmentMm).replace('.', ',')} mm) erkannt. Sie können am Laser zu Brandstellen führen.`);
  if (pruef.null) warnungen.push(`${pruef.null} Segmente ohne Länge erkannt und übersprungen.`);
  if (pruef.zuVieleSegmente) warnungen.push(`Sehr große Zeichnung (über 200.000 Segmente) – die Prüfung auf doppelte und überlappende Linien wurde übersprungen. Schnittlänge und Einstiche sind daher ungeprüft.`);
  if (!konturen.length) warnungen.push('Es wurde keine geschlossene Kontur gefunden. Fläche und Gewicht können nicht berechnet werden – bitte die Bounding Box als Materialbasis verwenden.');
  if (nettoFlaecheMm2 <= 0 && konturen.length) warnungen.push('Die berechnete Nettofläche ist 0. Bitte die Zeichnung prüfen.');
  if (einheitUnsicher) warnungen.push(auto.hinweis || 'Die Einheit der DXF-Datei ist nicht eindeutig. Bitte bestätigen.');
  else if (auto.sicher && bb.breite > 0 && bb.breite < 5 && einheit === 'mm') {
    meldungen.push(`Das Bauteil ist nur ${bb.breite.toFixed(2)} mm breit – für mm ungewöhnlich klein. Bitte die Einheit prüfen.`);
  }
  if (bauteile.length > 1) {
    meldungen.push(`${bauteile.length} getrennte Bauteile erkannt. Sie können die DXF als ein Teil behandeln oder die Bauteile einzeln auswerten.`);
  }

  const nettoFlaecheM2 = nettoFlaecheMm2 / 1_000_000;
  const bboxFlaecheM2 = (bb.breite * bb.hoehe) / 1_000_000;

  return {
    ok: true,
    einheit, faktor, einheitUnsicher, einheitBestaetigt: !einheitUnsicher, autoEinheit: auto,

    breiteMm: bb.breite, hoeheMm: bb.hoehe, bbox: bb,
    nettoFlaecheMm2, nettoFlaecheM2, bboxFlaecheM2,
    flaecheUnsicher: offeneKetten.length > 0 || konturen.length === 0,

    schnittlaengeMm, laengeAussenMm: laengeAussen, laengeInnenMm: laengeInnen, laengeOffenMm: laengeOffen,
    konturenAnzahl: konturen.length,
    aussenAnzahl: konturen.filter(k => k.tiefe === 0).length,
    loecherAnzahl: konturen.filter(k => k.tiefe % 2 === 1).length,
    offeneKonturenAnzahl: offeneKetten.length,
    einstiche,
    einsticheManuell: null,

    bauteile,
    konturen: konturen.map(k => ({ pts: k.pts, tiefe: k.tiefe, rolle: k.rolle, flaeche: k.flaeche, laenge: k.laenge, parent: k.parent, idx: k.idx })),
    offeneKetten: offeneKetten.map(k => ({ pts: k.pts, laenge: k.laenge })),

    pruefung: pruef,
    warnungen, meldungen,
    ignorierteLayer: flach.ignorierteLayer,

    /* Auswahl für die Kalkulation (§14) – wird von der Oberfläche gesetzt */
    flaechenBasis: opts.flaechenBasis || 'netto',
    manuelleFlaecheM2: 0,
    nestingFlaecheProStueckM2: 0,
    dateiname: opts.dateiname || '',
  };
}

function entdoppeln(pts, tol) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > tol * 0.5) out.push(p);
  }
  // geschlossene Konturen: Schlusspunkt = Startpunkt entfernen
  if (out.length > 2) {
    const a = out[0], b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol * 0.5) out.pop();
  }
  return out;
}

function leeresErgebnis(base) {
  return {
    ok: false,
    breiteMm: 0, hoeheMm: 0, bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0, breite: 0, hoehe: 0 },
    nettoFlaecheMm2: 0, nettoFlaecheM2: 0, bboxFlaecheM2: 0, flaecheUnsicher: true,
    schnittlaengeMm: 0, laengeAussenMm: 0, laengeInnenMm: 0, laengeOffenMm: 0,
    konturenAnzahl: 0, aussenAnzahl: 0, loecherAnzahl: 0, offeneKonturenAnzahl: 0,
    einstiche: 0, einsticheManuell: null,
    bauteile: [], konturen: [], offeneKetten: [],
    pruefung: { doppelt: 0, kurz: 0, null: 0, gesamt: 0, ueberlappend: 0 },
    ignorierteLayer: base.layer || [],
    flaechenBasis: 'bbox', manuelleFlaecheM2: 0, nestingFlaecheProStueckM2: 0, dateiname: '',
    ...base,
  };
}

/* ---------------- Ableitungen für die Kalkulation ---------------- */

/** §13: Gewicht je Stück aus Nettofläche, Stärke und Dichte. */
export function gewichtKg(flaecheM2, dickeMm, dichte) {
  if (!(flaecheM2 > 0) || !(dickeMm > 0) || !(dichte > 0)) return 0;
  return flaecheM2 * (dickeMm / 1000) * dichte;
}

/**
 * §18: Geschätzte Laserzeit in Minuten (je Stück).
 *   Schnittlänge / Schnittgeschwindigkeit + Einstiche × Piercing-Zeit + Nebenzeit
 */
export function laserzeitMin({ schnittlaengeMm, einstiche, vSchnittMmMin, piercingSek, nebenzeitSek = 0 }) {
  // Einheiten: Schnittlänge mm, Geschwindigkeit mm/min, Piercing und Nebenzeit
  // Sekunden. Ergebnis Minuten je Stück.
  const v = zahl(vSchnittMmMin);
  // Ohne gültige Schnittgeschwindigkeit gibt es KEINE Schätzung. Nicht 0 –
  // eine 0 sähe aus wie „geht ganz schnell" und wäre eine stille Falschangabe.
  if (!(v > 0)) return null;
  const laenge = zahl(schnittlaengeMm);
  const schneidenMin = laenge / v;
  const piercingMin = (zahl(einstiche) * zahl(piercingSek)) / 60;
  const nebenMin = zahl(nebenzeitSek) / 60;
  const min = schneidenMin + piercingMin + nebenMin;
  return Number.isFinite(min) ? min : null;
}

/** Nicht-Zahlen, Unendlich und negative Werte haben in einer Zeitschätzung nichts verloren. */
function zahl(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
