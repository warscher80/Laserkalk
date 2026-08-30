/**
 * icon-gen.js — erzeugt die App-Symbole aus einer einzigen Beschreibung.
 * Ohne externe Abhängigkeiten: eigener kleiner Rasterizer + PNG-Encoder (zlib).
 *
 *   node icon-gen.js
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AUS = join(dirname(fileURLToPath(import.meta.url)), 'www', 'icons');
mkdirSync(AUS, { recursive: true });

/* ---------- PNG ---------- */

function crc32(buf) {
  let c, tabelle = crc32.t;
  if (!tabelle) {
    tabelle = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabelle[n] = c;
    }
  }
  c = -1;
  for (let i = 0; i < buf.length; i++) c = tabelle[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(typ, daten) {
  const laenge = Buffer.alloc(4);
  laenge.writeUInt32BE(daten.length);
  const koerper = Buffer.concat([Buffer.from(typ, 'latin1'), daten]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(koerper));
  return Buffer.concat([laenge, koerper, crc]);
}

function schreibePng(pfad, breite, hoehe, rgba) {
  const roh = Buffer.alloc((breite * 4 + 1) * hoehe);
  for (let y = 0; y < hoehe; y++) {
    roh[y * (breite * 4 + 1)] = 0;
    rgba.copy(roh, y * (breite * 4 + 1) + 1, y * breite * 4, (y + 1) * breite * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(breite, 0); ihdr.writeUInt32BE(hoehe, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  writeFileSync(pfad, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(roh, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

/* ---------- Zeichnen ---------- */

const SS = 4; // 4×4-Überabtastung für weiche Kanten

/** Beschreibt das Symbol in einem 100×100-Raster. Rückgabe: [r,g,b,a] 0..255 */
function farbeAn(x, y, randRadius) {
  // Hintergrund: abgerundetes Quadrat mit Verlauf
  const r = randRadius;
  const dx = Math.max(r - x, x - (100 - r), 0);
  const dy = Math.max(r - y, y - (100 - r), 0);
  if (Math.hypot(dx, dy) > r) return [0, 0, 0, 0];

  const t = y / 100;
  let col = [
    Math.round(26 + (14 - 26) * t),
    Math.round(37 + (19 - 37) * t),
    Math.round(48 + (24 - 48) * t),
  ];

  const mische = (c, a) => { col = [
    Math.round(col[0] + (c[0] - col[0]) * a),
    Math.round(col[1] + (c[1] - col[1]) * a),
    Math.round(col[2] + (c[2] - col[2]) * a),
  ]; };

  // Glühen um den Auftreffpunkt
  const glut = Math.hypot(x - 50, y - 70);
  if (glut < 26) mische([255, 147, 48], 0.30 * (1 - glut / 26) ** 2);

  // Blech (waagrechter Balken)
  if (y >= 72 && y <= 80 && x >= 12 && x <= 88) mische([150, 165, 180], 1);
  if (y > 80 && y <= 84 && x >= 12 && x <= 88) mische([96, 110, 124], 1);

  // Schnittfuge im Blech
  if (y >= 72 && y <= 84 && Math.abs(x - 50) < 1.6) mische([14, 19, 24], 1);

  // Düse (Trapez)
  if (y >= 20 && y <= 44) {
    const halb = 15 - ((y - 20) / 24) * 8;
    if (Math.abs(x - 50) <= halb) mische([190, 200, 212], 1);
    if (Math.abs(x - 50) <= halb && x > 50) mische([132, 145, 160], 0.45);
  }
  // Düsenkopf
  if (y >= 44 && y <= 50) {
    const halb = 7 - ((y - 44) / 6) * 3.2;
    if (Math.abs(x - 50) <= halb) mische([222, 230, 238], 1);
  }

  // Laserstrahl
  if (y >= 50 && y <= 74) {
    const d = Math.abs(x - 50);
    if (d <= 1.9) mische([255, 236, 205], 1);
    else if (d <= 4.2) mische([255, 147, 48], 1 - (d - 1.9) / 2.3);
  }

  // Funken
  for (const [fx, fy, fr] of [[41, 68, 2.1], [60, 66, 1.7], [37, 60, 1.3], [64, 58, 1.1], [55, 55, 0.9]]) {
    if (Math.hypot(x - fx, y - fy) <= fr) mische([255, 190, 110], 1);
  }

  return [col[0], col[1], col[2], 255];
}

function rastere(groesse, randRadius) {
  const buf = Buffer.alloc(groesse * groesse * 4);
  for (let py = 0; py < groesse; py++) {
    for (let px = 0; px < groesse; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((px + (sx + 0.5) / SS) / groesse) * 100;
          const y = ((py + (sy + 0.5) / SS) / groesse) * 100;
          const c = farbeAn(x, y, randRadius);
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
        }
      }
      const n = SS * SS;
      const i = (py * groesse + px) * 4;
      if (a > 0) { buf[i] = Math.round(r / a); buf[i + 1] = Math.round(g / a); buf[i + 2] = Math.round(b / a); }
      buf[i + 3] = Math.round(a / n);
    }
  }
  return buf;
}

/* ---------- SVG ---------- */

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1a2530"/><stop offset="1" stop-color="#0e1318"/>
    </linearGradient>
    <radialGradient id="glut" cx="50%" cy="70%" r="26%">
      <stop offset="0" stop-color="#ff9330" stop-opacity=".45"/>
      <stop offset="1" stop-color="#ff9330" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100" height="100" rx="22" fill="url(#bg)"/>
  <circle cx="50" cy="70" r="26" fill="url(#glut)"/>
  <rect x="12" y="72" width="76" height="8" fill="#96a5b4"/>
  <rect x="12" y="80" width="76" height="4" fill="#606e7c"/>
  <rect x="48.4" y="72" width="3.2" height="12" fill="#0e1318"/>
  <path d="M35 20h30l-8 24H43z" fill="#bec8d4"/>
  <path d="M43 44h14l-3.2 6h-7.6z" fill="#dee6ee"/>
  <rect x="48.1" y="50" width="3.8" height="24" fill="#ffeccd"/>
  <rect x="45.8" y="50" width="8.4" height="24" fill="#ff9330" opacity=".55"/>
  <circle cx="41" cy="68" r="2.1" fill="#ffbe6e"/>
  <circle cx="60" cy="66" r="1.7" fill="#ffbe6e"/>
  <circle cx="37" cy="60" r="1.3" fill="#ffbe6e"/>
  <circle cx="64" cy="58" r="1.1" fill="#ffbe6e"/>
</svg>
`;

writeFileSync(join(AUS, 'icon.svg'), SVG);
for (const [name, groesse, radius] of [
  ['icon-192.png', 192, 22],
  ['icon-512.png', 512, 22],
  ['icon-maskable-512.png', 512, 50],   // maskable: voller Kreis, Motiv im sicheren Bereich
]) {
  schreibePng(join(AUS, name), groesse, groesse, rastere(groesse, radius));
  console.log('erzeugt:', name);
}
console.log('erzeugt: icon.svg');
