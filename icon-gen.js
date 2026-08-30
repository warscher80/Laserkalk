/**
 * icon-gen.js — erzeugt sämtliche Symbole und Startbildschirme aus EINER
 * Beschreibung des Motivs. Ohne externe Abhängigkeiten: eigener kleiner
 * Rasterizer plus PNG-Encoder über node:zlib.
 *
 *   node icon-gen.js
 *
 * Ausgabe:
 *   www/icons                             PWA-Symbole (SVG + PNG 192/512/maskable)
 *   android/app/src/main/res/mipmap-DICHTE    Launcher (klassisch, rund, adaptiv)
 *   android/app/src/main/res/drawable-LAGE    Startbildschirme hoch und quer
 *
 * Die Android-Ausgabe wird übersprungen, wenn noch kein Android-Projekt
 * angelegt ist (npx cap add android).
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = dirname(fileURLToPath(import.meta.url));
const ICONS = join(WURZEL, 'www', 'icons');
const RES = join(WURZEL, 'android', 'app', 'src', 'main', 'res');

/* ------------------------------------------------------------------ */
/* PNG-Encoder                                                         */
/* ------------------------------------------------------------------ */

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
  mkdirSync(dirname(pfad), { recursive: true });
  writeFileSync(pfad, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(roh, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

/* ------------------------------------------------------------------ */
/* Motiv                                                               */
/* ------------------------------------------------------------------ */

const SS = 4;                       // 4x4-Überabtastung für weiche Kanten
const HELL = [238, 242, 246];       // Grundfarbe der App im Hellmodus

/** Mischt eine Farbe mit Deckkraft a in col hinein. */
function misch(col, c, a) {
  col[0] = Math.round(col[0] + (c[0] - col[0]) * a);
  col[1] = Math.round(col[1] + (c[1] - col[1]) * a);
  col[2] = Math.round(col[2] + (c[2] - col[2]) * a);
}

/**
 * Zeichnet das Motiv (Blech, Düse, Laserstrahl, Funken) in ein 100x100-Raster.
 * Gibt true zurück, wenn an dieser Stelle etwas gezeichnet wurde — nötig für
 * den adaptiven Vordergrund, der außerhalb des Motivs durchsichtig bleibt.
 */
function motiv(x, y, col) {
  let getroffen = false;
  const m = (c, a = 1) => { misch(col, c, a); getroffen = true; };

  // Glühen um den Auftreffpunkt
  const glut = Math.hypot(x - 50, y - 70);
  if (glut < 26) m([255, 147, 48], 0.30 * (1 - glut / 26) ** 2);

  // Blech
  if (y >= 72 && y <= 80 && x >= 12 && x <= 88) m([150, 165, 180]);
  if (y > 80 && y <= 84 && x >= 12 && x <= 88) m([96, 110, 124]);
  // Schnittfuge
  if (y >= 72 && y <= 84 && Math.abs(x - 50) < 1.6) m([14, 19, 24]);

  // Düse
  if (y >= 20 && y <= 44) {
    const halb = 15 - ((y - 20) / 24) * 8;
    if (Math.abs(x - 50) <= halb) {
      m([190, 200, 212]);
      if (x > 50) m([132, 145, 160], 0.45);
    }
  }
  if (y >= 44 && y <= 50) {
    const halb = 7 - ((y - 44) / 6) * 3.2;
    if (Math.abs(x - 50) <= halb) m([222, 230, 238]);
  }

  // Laserstrahl
  if (y >= 50 && y <= 74) {
    const d = Math.abs(x - 50);
    if (d <= 1.9) m([255, 236, 205]);
    else if (d <= 4.2) m([255, 147, 48], 1 - (d - 1.9) / 2.3);
  }

  // Funken
  for (const [fx, fy, fr] of [[41, 68, 2.1], [60, 66, 1.7], [37, 60, 1.3], [64, 58, 1.1], [55, 55, 0.9]]) {
    if (Math.hypot(x - fx, y - fy) <= fr) m([255, 190, 110]);
  }
  return getroffen;
}

/** Dunkle Kachel mit Verlauf; außerhalb der abgerundeten Ecken durchsichtig. */
function kachel(x, y, radius) {
  const dx = Math.max(radius - x, x - (100 - radius), 0);
  const dy = Math.max(radius - y, y - (100 - radius), 0);
  if (Math.hypot(dx, dy) > radius) return null;
  const t = y / 100;
  return [
    Math.round(26 + (14 - 26) * t),
    Math.round(37 + (19 - 37) * t),
    Math.round(48 + (24 - 48) * t),
  ];
}

/**
 * Rastert ein quadratisches Bild.
 * @param {number} groesse   Kantenlänge in Pixeln
 * @param {object} o
 *   o.art      'kachel' (dunkle Kachel + Motiv) | 'vordergrund' (nur Motiv) | 'hintergrund' (nur Kachel)
 *   o.radius   Eckenradius in Prozent der Kantenlänge (50 = Kreis)
 *   o.anteil   Anteil der Fläche, den das 100x100-Motiv einnimmt (1 = randlos)
 */
function rastere(groesse, o) {
  const { art = 'kachel', radius = 22, anteil = 1 } = o;
  const buf = Buffer.alloc(groesse * groesse * 4);
  const rand = (1 - anteil) / 2 * 100;

  for (let py = 0; py < groesse; py++) {
    for (let px = 0; px < groesse; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          // Bildkoordinaten in das 100x100-Motivraster umrechnen
          const gx = ((px + (sx + 0.5) / SS) / groesse) * 100;
          const gy = ((py + (sy + 0.5) / SS) / groesse) * 100;
          const mx = (gx - rand) / anteil;
          const my = (gy - rand) / anteil;

          let col = null;
          if (art === 'kachel' || art === 'hintergrund') {
            col = kachel(gx, gy, art === 'hintergrund' ? 0 : radius);
            if (col && art === 'kachel' && motiv(mx, my, col)) { /* Motiv liegt drauf */ }
          } else {
            const tmp = [0, 0, 0];
            if (mx >= 0 && mx <= 100 && my >= 0 && my <= 100 && motiv(mx, my, tmp)) col = tmp;
          }
          if (col) { r += col[0]; g += col[1]; b += col[2]; a += 255; }
        }
      }
      const n = SS * SS;
      const i = (py * groesse + px) * 4;
      if (a > 0) {
        const treffer = a / 255;
        buf[i] = Math.round(r / treffer);
        buf[i + 1] = Math.round(g / treffer);
        buf[i + 2] = Math.round(b / treffer);
      }
      buf[i + 3] = Math.round(a / n);
    }
  }
  return buf;
}

/** Startbildschirm: heller Grund, Symbol mittig. */
function rastereSplash(breite, hoehe) {
  const buf = Buffer.alloc(breite * hoehe * 4);
  const kante = Math.round(Math.min(breite, hoehe) * 0.34);
  const symbol = rastere(kante, { art: 'kachel', radius: 22 });
  const x0 = Math.round((breite - kante) / 2);
  const y0 = Math.round((hoehe - kante) / 2);

  for (let y = 0; y < hoehe; y++) {
    for (let x = 0; x < breite; x++) {
      const i = (y * breite + x) * 4;
      buf[i] = HELL[0]; buf[i + 1] = HELL[1]; buf[i + 2] = HELL[2]; buf[i + 3] = 255;
    }
  }
  for (let y = 0; y < kante; y++) {
    for (let x = 0; x < kante; x++) {
      const s = (y * kante + x) * 4;
      const alpha = symbol[s + 3] / 255;
      if (!alpha) continue;
      const zx = x0 + x, zy = y0 + y;
      if (zx < 0 || zy < 0 || zx >= breite || zy >= hoehe) continue;
      const z = (zy * breite + zx) * 4;
      for (let k = 0; k < 3; k++) buf[z + k] = Math.round(buf[z + k] + (symbol[s + k] - buf[z + k]) * alpha);
    }
  }
  return buf;
}

/* ------------------------------------------------------------------ */
/* SVG                                                                 */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Erzeugen                                                            */
/* ------------------------------------------------------------------ */

let anzahl = 0;
const png = (pfad, breite, hoehe, daten) => { schreibePng(pfad, breite, hoehe, daten); anzahl++; };

/* --- PWA --- */
mkdirSync(ICONS, { recursive: true });
writeFileSync(join(ICONS, 'icon.svg'), SVG);
png(join(ICONS, 'icon-192.png'), 192, 192, rastere(192, { radius: 22 }));
png(join(ICONS, 'icon-512.png'), 512, 512, rastere(512, { radius: 22 }));
// maskable: Motiv im sicheren Bereich (80 %), Kachel als Vollkreis
png(join(ICONS, 'icon-maskable-512.png'), 512, 512, rastere(512, { radius: 50, anteil: 0.8 }));
console.log('PWA-Symbole erzeugt');

/* --- Android --- */
if (!existsSync(RES)) {
  console.log('Kein Android-Projekt gefunden (android/app/src/main/res) – Android-Assets übersprungen.');
} else {
  const DICHTEN = [['mdpi', 48, 108], ['hdpi', 72, 162], ['xhdpi', 96, 216], ['xxhdpi', 144, 324], ['xxxhdpi', 192, 432]];
  for (const [d, klassisch, adaptiv] of DICHTEN) {
    const ordner = join(RES, `mipmap-${d}`);
    png(join(ordner, 'ic_launcher.png'), klassisch, klassisch, rastere(klassisch, { radius: 22 }));
    png(join(ordner, 'ic_launcher_round.png'), klassisch, klassisch, rastere(klassisch, { radius: 50 }));
    // Adaptiv: 108 dp Leinwand, Motiv im mittleren 72-dp-Bereich (= 2/3)
    png(join(ordner, 'ic_launcher_foreground.png'), adaptiv, adaptiv, rastere(adaptiv, { art: 'vordergrund', anteil: 2 / 3 }));
    png(join(ordner, 'ic_launcher_background.png'), adaptiv, adaptiv, rastere(adaptiv, { art: 'hintergrund' }));
  }

  // Der adaptive Hintergrund ist ein Bild, keine Farbe – sonst stünde das
  // helle Motiv auf weißem Grund und wäre kaum zu erkennen.
  const adaptivXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
  for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
    writeFileSync(join(RES, 'mipmap-anydpi-v26', name), adaptivXml);
  }

  const SPLASH = [
    ['port', 'mdpi', 320, 480], ['port', 'hdpi', 480, 800], ['port', 'xhdpi', 720, 1280],
    ['port', 'xxhdpi', 960, 1600], ['port', 'xxxhdpi', 1280, 1920],
    ['land', 'mdpi', 480, 320], ['land', 'hdpi', 800, 480], ['land', 'xhdpi', 1280, 720],
    ['land', 'xxhdpi', 1600, 960], ['land', 'xxxhdpi', 1920, 1280],
  ];
  for (const [lage, d, b, h] of SPLASH) {
    png(join(RES, `drawable-${lage}-${d}`, 'splash.png'), b, h, rastereSplash(b, h));
  }
  png(join(RES, 'drawable', 'splash.png'), 480, 800, rastereSplash(480, 800));

  console.log('Android-Symbole und Startbildschirme erzeugt');
}

console.log(`${anzahl} PNG-Dateien geschrieben.`);
