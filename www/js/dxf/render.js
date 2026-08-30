/**
 * render.js — 2D-Vorschau der DXF-Geometrie (§10).
 *
 * Einziges Modul im dxf-Ordner, das den Browser braucht.
 * Zeichnet auf ein <canvas>: Außenkonturen, Innenkonturen, offene Konturen
 * (rot, weil fehlerhaft), Bounding Box und Abmessungen.
 */

const FARBEN = {
  aussen: '#ff8a3d',
  loch: '#4aa8ff',
  insel: '#3ddc84',
  offen: '#ff5d5d',
  bbox: 'rgba(255,255,255,.28)',
  text: 'rgba(255,255,255,.7)',
};

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} analyse  Ergebnis aus analysiereDxf
 * @param {object} opts     { padding, zeigeBbox, zeigeMasse, hervorBauteil }
 */
export function zeichne(canvas, analyse, opts = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || 320;
  const cssH = canvas.clientHeight || 220;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  if (!analyse || !analyse.bbox || !(analyse.bbox.breite > 0 || analyse.bbox.hoehe > 0)) {
    ctx.fillStyle = FARBEN.text;
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Keine Vorschau verfügbar', cssW / 2, cssH / 2);
    return;
  }

  const zeigeMasse = opts.zeigeMasse !== false;
  const pad = opts.padding ?? (zeigeMasse ? 34 : 12);
  const bb = analyse.bbox;
  const w = Math.max(bb.breite, 1e-6);
  const h = Math.max(bb.hoehe, 1e-6);
  const s = Math.min((cssW - 2 * pad) / w, (cssH - 2 * pad) / h);
  const offX = (cssW - w * s) / 2 - bb.minX * s;
  const offY = (cssH + h * s) / 2 + bb.minY * s;
  const X = x => x * s + offX;
  const Y = y => offY - y * s;   // Y in DXF zeigt nach oben, im Canvas nach unten

  // Bounding Box
  if (opts.zeigeBbox !== false) {
    ctx.save();
    ctx.strokeStyle = FARBEN.bbox;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(X(bb.minX), Y(bb.maxY), w * s, h * s);
    ctx.restore();
  }

  const pfad = (pts, closed) => {
    ctx.beginPath();
    ctx.moveTo(X(pts[0][0]), Y(pts[0][1]));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i][0]), Y(pts[i][1]));
    if (closed) ctx.closePath();
    ctx.stroke();
  };

  // Dezente Füllung des Materials. ALLE geschlossenen Konturen kommen in EINEN
  // Pfad; mit der Even-Odd-Regel stanzt das die Löcher korrekt aus und Inseln
  // in Löchern werden wieder gefüllt.
  ctx.save();
  ctx.fillStyle = 'rgba(255,138,61,.13)';
  ctx.beginPath();
  for (const k of analyse.konturen) {
    ctx.moveTo(X(k.pts[0][0]), Y(k.pts[0][1]));
    for (let i = 1; i < k.pts.length; i++) ctx.lineTo(X(k.pts[i][0]), Y(k.pts[i][1]));
    ctx.closePath();
  }
  ctx.fill('evenodd');
  ctx.restore();

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const k of analyse.konturen) {
    ctx.strokeStyle = k.rolle === 'aussen' ? FARBEN.aussen : k.rolle === 'loch' ? FARBEN.loch : FARBEN.insel;
    ctx.lineWidth = k.rolle === 'aussen' ? 1.8 : 1.3;
    pfad(k.pts, true);
  }
  ctx.strokeStyle = FARBEN.offen;
  ctx.lineWidth = 2;
  for (const k of analyse.offeneKetten) pfad(k.pts, false);

  // Offene Enden markieren – dort liegt der Zeichnungsfehler
  ctx.fillStyle = FARBEN.offen;
  for (const k of analyse.offeneKetten) {
    for (const p of [k.pts[0], k.pts[k.pts.length - 1]]) {
      ctx.beginPath();
      ctx.arc(X(p[0]), Y(p[1]), 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (zeigeMasse) {
    ctx.fillStyle = FARBEN.text;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${mm(bb.breite)} mm`, X(bb.minX) + (w * s) / 2, Y(bb.minY) + 18);
    ctx.save();
    ctx.translate(X(bb.minX) - 12, Y(bb.maxY) + (h * s) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`${mm(bb.hoehe)} mm`, 0, 0);
    ctx.restore();
  }
}

function mm(v) {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: v < 10 ? 2 : 1 }).format(v);
}
