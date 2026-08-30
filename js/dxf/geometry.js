/**
 * geometry.js — wandelt DXF-Entitäten in Polygonzüge (Punktlisten) um.
 *
 * Bögen, Kreise, Ellipsen und Splines werden mit einer Sehnenhöhen-Toleranz
 * abgeflacht. Bei 0,02 mm liegt der Flächenfehler weit unter jeder Blechtoleranz.
 *
 * DOM-frei, in Node testbar.
 */

import { g, gAll, GEOMETRIE_TYPEN, IGNORIERTE_TYPEN, IGNORIERTE_LAYER } from './parser.js';

/* ---------------- 2D-Transformation ---------------- */

export const IDENT = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** Wendet die Matrix auf einen Punkt an: (x,y) -> (a x + c y + e, b x + d y + f). */
export function applyM(m, x, y) {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}

/** Verkettung: erst `inner`, dann `outer`. */
export function mulM(outer, inner) {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

export function translateM(tx, ty) { return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }; }
export function scaleM(sx, sy) { return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }; }
export function rotateM(rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  return { a: c, b: s, c: -s, d: c, e: 0, f: 0 };
}
/** Grober Maßstab der Matrix – für die Abflachungstoleranz im Blockinneren. */
function scaleOfM(m) {
  return Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d)) || 1;
}

/* ---------------- Abflachen ---------------- */

/**
 * Anzahl Segmente, damit die Sehnenhöhe (Pfeilhöhe) <= tol bleibt.
 * Pfeilhöhe eines Kreisbogenstücks: h = r (1 - cos(dα/2)).
 */
export function segmenteFuerBogen(radius, sweepRad, tol) {
  const r = Math.abs(radius), s = Math.abs(sweepRad);
  if (!(r > 0) || !(s > 0)) return 1;
  if (tol >= r) return Math.max(2, Math.ceil(s / (Math.PI / 4)));
  const dAlpha = 2 * Math.acos(1 - tol / r);
  if (!Number.isFinite(dAlpha) || dAlpha <= 0) return 256;
  return Math.min(2048, Math.max(2, Math.ceil(s / dAlpha)));
}

/** Punkte eines Kreisbogens (CCW für positives sweep). */
export function bogenPunkte(cx, cy, r, startRad, sweepRad, tol, inklStart = true) {
  const n = segmenteFuerBogen(r, sweepRad, tol);
  const pts = [];
  for (let i = inklStart ? 0 : 1; i <= n; i++) {
    const t = startRad + (sweepRad * i) / n;
    pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return pts;
}

/**
 * Bogen aus einem Bulge-Wert zwischen zwei Polylinienpunkten.
 * bulge = tan(θ/4), θ = eingeschlossener Winkel, positiv = gegen den Uhrzeigersinn.
 */
export function bulgePunkte(p1, p2, bulge, tol) {
  const [x1, y1] = p1, [x2, y2] = p2;
  const dist = Math.hypot(x2 - x1, y2 - y1);
  if (!(dist > 0) || !bulge) return [p2];
  const theta = 4 * Math.atan(bulge);
  const halb = theta / 2;
  const sinHalb = Math.sin(halb);
  if (Math.abs(sinHalb) < 1e-12) return [p2];
  const r = dist / 2 / sinHalb;
  const a = Math.atan2(y2 - y1, x2 - x1);
  const cx = x1 + r * Math.cos(a + (Math.PI - theta) / 2);
  const cy = y1 + r * Math.sin(a + (Math.PI - theta) / 2);
  const start = Math.atan2(y1 - cy, x1 - cx);
  return bogenPunkte(cx, cy, Math.abs(r), start, theta, tol, false);
}

/* ---------------- B-Spline (de Boor) ---------------- */

/** Wertet einen (ggf. rationalen) B-Spline an der Stelle t aus. */
function deBoor(ctrl, weights, knots, grad, t) {
  const n = ctrl.length - 1;
  let k = grad;
  while (k < n && t >= knots[k + 1]) k++;
  const d = [];
  for (let j = 0; j <= grad; j++) {
    const idx = Math.min(Math.max(j + k - grad, 0), n);
    const w = weights ? (weights[idx] ?? 1) : 1;
    d.push([ctrl[idx][0] * w, ctrl[idx][1] * w, w]);
  }
  for (let r = 1; r <= grad; r++) {
    for (let j = grad; j >= r; j--) {
      const i = j + k - grad;
      const den = knots[i + grad - r + 1] - knots[i];
      const alpha = den === 0 ? 0 : (t - knots[i]) / den;
      d[j] = [
        (1 - alpha) * d[j - 1][0] + alpha * d[j][0],
        (1 - alpha) * d[j - 1][1] + alpha * d[j][1],
        (1 - alpha) * d[j - 1][2] + alpha * d[j][2],
      ];
    }
  }
  const p = d[grad];
  const w = p[2] || 1;
  return [p[0] / w, p[1] / w];
}

/** Gleichmäßiger, geklammerter Knotenvektor als Rückfall. */
function knotenGeklammert(anzahl, grad) {
  const m = anzahl + grad + 1;
  const kn = new Array(m);
  for (let i = 0; i < m; i++) {
    if (i <= grad) kn[i] = 0;
    else if (i >= anzahl) kn[i] = anzahl - grad;
    else kn[i] = i - grad;
  }
  return kn;
}

/** Splinepunkte. `meldungen` nimmt Hinweise auf Näherungen auf. */
export function splinePunkte(ctrl, weights, knots, grad, geschlossen, tol, meldungen) {
  if (ctrl.length < 2) return [];
  if (ctrl.length < grad + 1) grad = ctrl.length - 1;
  if (grad < 1) return ctrl.slice();

  let kn = knots;
  if (!kn || kn.length !== ctrl.length + grad + 1) {
    kn = knotenGeklammert(ctrl.length, grad);
    if (knots && knots.length) meldungen?.push('Ein Spline hat einen unstimmigen Knotenvektor – es wurde ein gleichmäßiger Ersatz verwendet. Bitte die Kontur prüfen.');
  }
  let laenge = 0;
  for (let i = 1; i < ctrl.length; i++) laenge += Math.hypot(ctrl[i][0] - ctrl[i - 1][0], ctrl[i][1] - ctrl[i - 1][1]);
  const spannen = Math.max(1, ctrl.length - grad);
  const proSpanne = Math.min(64, Math.max(8, Math.ceil(Math.sqrt(Math.max(1, laenge / Math.max(tol, 1e-6))) / spannen)));
  const n = Math.min(4000, spannen * proSpanne);

  const t0 = kn[grad], t1 = kn[ctrl.length];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    pts.push(deBoor(ctrl, weights, kn, grad, Math.min(t, t1 - 1e-12)));
  }
  if (geschlossen) pts.push(pts[0].slice());
  return pts;
}

/* ---------------- Entität -> Polygonzüge ---------------- */

function extrusionSpiegel(entity) {
  // Reine 2D-Zeichnungen mit umgedrehter Normalen (210/220/230 = 0/0/-1)
  // liegen in der XY-Ebene gespiegelt. Das ist der einzige praxisrelevante OCS-Fall.
  const ez = g(entity, 230, undefined);
  const ex = g(entity, 210, 0), ey = g(entity, 220, 0);
  if (ez === undefined) return { m: IDENT, schraeg: false };
  if (Math.abs(ex) < 1e-9 && Math.abs(ey) < 1e-9) {
    if (ez < 0) return { m: scaleM(-1, 1), schraeg: false };
    return { m: IDENT, schraeg: false };
  }
  return { m: IDENT, schraeg: true };
}

/**
 * Wandelt eine Entität in Polygonzüge um.
 * @returns {Array<{pts:number[][], closed:boolean, layer:string, type:string}>}
 */
export function entityZuPolys(entity, ctx) {
  const { tol, meldungen } = ctx;
  const typ = entity.type;
  const layer = entity.layer || '0';
  const { m: ocs, schraeg } = extrusionSpiegel(entity);
  if (schraeg) meldungen.push(`Ein ${typ}-Objekt liegt in einer schrägen Ebene (Extrusionsrichtung ≠ Z). Es wird auf die XY-Ebene projiziert – bitte prüfen.`);

  const raus = (pts, closed) => {
    if (!pts || pts.length < 2) return [];
    const t = pts.map(([x, y]) => applyM(ocs, x, y));
    return [{ pts: t, closed, layer, type: typ }];
  };

  switch (typ) {
    case 'LINE': {
      const p1 = [g(entity, 10, 0), g(entity, 20, 0)];
      const p2 = [g(entity, 11, 0), g(entity, 21, 0)];
      return raus([p1, p2], false);
    }
    case 'CIRCLE': {
      const cx = g(entity, 10, 0), cy = g(entity, 20, 0), r = g(entity, 40, 0);
      if (!(r > 0)) { meldungen.push('Ein Kreis mit Radius 0 wurde übersprungen.'); return []; }
      const pts = bogenPunkte(cx, cy, r, 0, 2 * Math.PI, tol, true);
      return raus(pts, true);
    }
    case 'ARC': {
      const cx = g(entity, 10, 0), cy = g(entity, 20, 0), r = g(entity, 40, 0);
      if (!(r > 0)) { meldungen.push('Ein Bogen mit Radius 0 wurde übersprungen.'); return []; }
      const a0 = (g(entity, 50, 0) * Math.PI) / 180;
      const a1 = (g(entity, 51, 0) * Math.PI) / 180;
      let sweep = a1 - a0;
      while (sweep <= 1e-12) sweep += 2 * Math.PI;
      return raus(bogenPunkte(cx, cy, r, a0, sweep, tol, true), false);
    }
    case 'ELLIPSE': {
      const cx = g(entity, 10, 0), cy = g(entity, 20, 0);
      const mx = g(entity, 11, 0), my = g(entity, 21, 0);
      const ratio = g(entity, 40, 1) || 1;
      const t0 = g(entity, 41, 0);
      const t1 = g(entity, 42, 2 * Math.PI);
      const majorLen = Math.hypot(mx, my);
      if (!(majorLen > 0)) { meldungen.push('Eine Ellipse ohne Hauptachse wurde übersprungen.'); return []; }
      let sweep = t1 - t0;
      if (sweep <= 1e-12) sweep += 2 * Math.PI;
      const geschlossen = Math.abs(sweep - 2 * Math.PI) < 1e-6;
      const n = segmenteFuerBogen(majorLen, sweep, tol);
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = t0 + (sweep * i) / n;
        const ct = Math.cos(t), st = Math.sin(t);
        pts.push([cx + mx * ct - my * ratio * st, cy + my * ct + mx * ratio * st]);
      }
      return raus(pts, geschlossen);
    }
    case 'LWPOLYLINE': {
      const flags = g(entity, 70, 0) || 0;
      const geschlossen = (flags & 1) === 1;
      const verts = [];
      let cur = null;
      for (const [c, v] of entity.codes) {
        if (c === 10) { if (cur) verts.push(cur); cur = { x: v, y: 0, bulge: 0 }; }
        else if (c === 20 && cur) cur.y = v;
        else if (c === 42 && cur) cur.bulge = v;
      }
      if (cur) verts.push(cur);
      return raus(polylineAusVertices(verts, geschlossen, tol), geschlossen);
    }
    case 'POLYLINE': {
      const flags = g(entity, 70, 0) || 0;
      if (flags & 16 || flags & 64) {
        meldungen.push('Ein 3D-Netz (POLYLINE-Mesh) wurde ignoriert – daraus lässt sich keine Schnittkontur ableiten.');
        return [];
      }
      const geschlossen = (flags & 1) === 1;
      const verts = (entity.vertices || []).map(v => ({
        x: g(v, 10, 0), y: g(v, 20, 0), bulge: g(v, 42, 0) || 0,
      }));
      return raus(polylineAusVertices(verts, geschlossen, tol), geschlossen);
    }
    case 'SPLINE': {
      const flags = g(entity, 70, 0) || 0;
      const grad = g(entity, 71, 3) || 3;
      const rational = (flags & 4) === 4;
      const geschlossen = (flags & 1) === 1;
      const xs = gAll(entity, 10), ys = gAll(entity, 20);
      const ctrl = xs.map((x, i) => [x, ys[i] ?? 0]);
      const knots = gAll(entity, 40);
      const weights = rational ? gAll(entity, 41) : null;
      if (ctrl.length >= 2) {
        if (rational && weights && weights.some(w => Math.abs(w - 1) > 1e-9)) {
          meldungen.push('Ein rationaler Spline (NURBS mit Gewichten) wurde ausgewertet – die Kontur kann geringfügig abweichen.');
        }
        return raus(splinePunkte(ctrl, weights, knots, grad, geschlossen, tol, meldungen), geschlossen);
      }
      const fx = gAll(entity, 11), fy = gAll(entity, 21);
      if (fx.length >= 2) {
        meldungen.push('Ein Spline ohne Kontrollpunkte wurde über seine Stützpunkte angenähert – bitte die Kontur prüfen.');
        return raus(fx.map((x, i) => [x, fy[i] ?? 0]), geschlossen);
      }
      meldungen.push('Ein Spline konnte nicht ausgewertet werden und wurde übersprungen.');
      return [];
    }
    default:
      return [];
  }
}

function polylineAusVertices(verts, geschlossen, tol) {
  if (verts.length < 2) return verts.length === 1 ? [[verts[0].x, verts[0].y]] : [];
  const pts = [[verts[0].x, verts[0].y]];
  const grenze = geschlossen ? verts.length : verts.length - 1;
  for (let i = 0; i < grenze; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const p1 = [a.x, a.y], p2 = [b.x, b.y];
    if (a.bulge) pts.push(...bulgePunkte(p1, p2, a.bulge, tol));
    else pts.push(p2);
  }
  return pts;
}

/* ---------------- Gesamte Zeichnung abflachen ---------------- */

/**
 * Flacht alle Entitäten (inkl. Blockreferenzen) in Polygonzüge ab.
 * @returns {{polys:Array, meldungen:string[], ignoriert:Object, unbekannt:Object, ignorierteLayer:string[]}}
 */
export function flatten(parsed, opts = {}) {
  const tol = opts.tolMm ?? 0.02;
  const meldungen = [];
  const ignoriert = {};
  const unbekannt = {};
  const ignorierteLayer = new Set();
  const polys = [];

  const zaehle = (obj, k) => { obj[k] = (obj[k] || 0) + 1; };

  const layerAus = (layer) => IGNORIERTE_LAYER.some(re => re.test(layer || ''));

  const gehe = (entities, m, tiefe) => {
    if (tiefe > 8) { meldungen.push('Zu tief verschachtelte Blöcke – ab der 8. Ebene wurde abgebrochen.'); return; }
    const skalierung = scaleOfM(m);
    const ctx = { tol: tol / Math.max(skalierung, 1e-6), meldungen };

    for (const e of entities) {
      const typ = e.type;
      if (layerAus(e.layer)) { ignorierteLayer.add(e.layer); continue; }

      if (typ === 'INSERT') {
        const name = g(e, 2, '');
        const blk = parsed.blocks[name];
        if (!blk) { meldungen.push(`Die Blockreferenz „${name}" verweist auf einen unbekannten Block und wurde übersprungen.`); continue; }
        const ix = g(e, 10, 0), iy = g(e, 20, 0);
        const sx = g(e, 41, 1) || 1, sy = g(e, 42, 1) || 1;
        const rot = ((g(e, 50, 0) || 0) * Math.PI) / 180;
        const cols = Math.max(1, g(e, 70, 1) || 1);
        const rows = Math.max(1, g(e, 71, 1) || 1);
        const cSpace = g(e, 44, 0) || 0;
        const rSpace = g(e, 45, 0) || 0;
        if (Math.abs(Math.abs(sx) - Math.abs(sy)) > 1e-9) {
          meldungen.push(`Der Block „${name}" ist ungleichmäßig skaliert (X ${sx} / Y ${sy}). Bögen werden dadurch zu Ellipsen – bitte die Maße prüfen.`);
        }
        if (cols * rows > 5000) { meldungen.push(`Die Blockreferenz „${name}" hat über 5000 Wiederholungen und wurde übersprungen.`); continue; }
        const basis = mulM(rotateM(rot), mulM(scaleM(sx, sy), translateM(-blk.base[0], -blk.base[1])));
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const lokal = mulM(translateM(ix + c * cSpace, iy + r * rSpace), basis);
            gehe(blk.entities, mulM(m, lokal), tiefe + 1);
          }
        }
        continue;
      }

      if (IGNORIERTE_TYPEN.has(typ)) { zaehle(ignoriert, typ); continue; }
      if (!GEOMETRIE_TYPEN.has(typ)) { zaehle(unbekannt, typ); continue; }

      for (const p of entityZuPolys(e, ctx)) {
        p.pts = p.pts.map(([x, y]) => applyM(m, x, y));
        polys.push(p);
      }
    }
  };

  gehe(parsed.entities, IDENT, 0);

  if (Object.keys(unbekannt).length) {
    meldungen.push(`Nicht unterstützte Objekte übersprungen: ${Object.entries(unbekannt).map(([k, v]) => `${k} (${v}×)`).join(', ')}.`);
  }
  if (ignoriert.HATCH) meldungen.push(`${ignoriert.HATCH} Schraffur(en) ignoriert – Schraffuren sind keine Schnittkonturen.`);
  if (ignoriert.SOLID || ignoriert.TRACE) meldungen.push('Gefüllte Flächen (SOLID/TRACE) wurden ignoriert – sie sind keine Schnittkonturen.');
  const bemassung = (ignoriert.DIMENSION || 0) + (ignoriert.TEXT || 0) + (ignoriert.MTEXT || 0) + (ignoriert.LEADER || 0);
  if (bemassung) meldungen.push(`${bemassung} Text-/Bemaßungsobjekt(e) ignoriert.`);

  return { polys, meldungen, ignoriert, unbekannt, ignorierteLayer: [...ignorierteLayer] };
}
