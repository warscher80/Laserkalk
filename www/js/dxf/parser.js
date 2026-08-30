/**
 * parser.js — schlanker DXF-Leser (ASCII, DXF R12 bis R2018).
 *
 * Liest nur, was für Blechteile gebraucht wird. Erzeugt eine neutrale Struktur:
 *   { header, blocks, entities, meldungen }
 * Interpretation (Fläche, Konturen, …) passiert bewusst NICHT hier, sondern in
 * geometry.js / analyze.js — so bleibt jede Stufe einzeln testbar.
 *
 * DOM-frei, in Node testbar.
 */

/* ---------------- Gruppencodes ---------------- */

/** Datentyp eines DXF-Gruppencodes. */
export function codeType(code) {
  if (code === 999) return 'string';
  if (code >= 0 && code <= 9) return 'string';
  if (code >= 10 && code <= 59) return 'float';
  if (code >= 60 && code <= 79) return 'int';
  if (code >= 90 && code <= 99) return 'int';
  if (code === 100 || code === 102 || code === 105) return 'string';
  if (code >= 110 && code <= 149) return 'float';
  if (code >= 160 && code <= 169) return 'int';
  if (code >= 170 && code <= 179) return 'int';
  if (code >= 210 && code <= 239) return 'float';
  if (code >= 270 && code <= 289) return 'int';
  if (code >= 290 && code <= 299) return 'bool';
  if (code >= 300 && code <= 369) return 'string';
  if (code >= 370 && code <= 389) return 'int';
  if (code >= 390 && code <= 399) return 'string';
  if (code >= 400 && code <= 409) return 'int';
  if (code >= 410 && code <= 419) return 'string';
  if (code >= 420 && code <= 429) return 'int';
  if (code >= 430 && code <= 439) return 'string';
  if (code >= 440 && code <= 449) return 'int';
  if (code >= 450 && code <= 459) return 'int';
  if (code >= 460 && code <= 469) return 'float';
  if (code >= 470 && code <= 481) return 'string';
  if (code >= 1000 && code <= 1009) return 'string';
  if (code >= 1010 && code <= 1059) return 'float';
  if (code >= 1060 && code <= 1071) return 'int';
  return 'string';
}

/** Entitätstypen, die eine Schnittkontur darstellen können. */
export const GEOMETRIE_TYPEN = new Set([
  'LINE', 'LWPOLYLINE', 'POLYLINE', 'ARC', 'CIRCLE', 'ELLIPSE', 'SPLINE', 'INSERT',
]);

/** Typen, die für die Kalkulation bewusst ignoriert werden. */
export const IGNORIERTE_TYPEN = new Set([
  'TEXT', 'MTEXT', 'ATTRIB', 'ATTDEF', 'DIMENSION', 'LEADER', 'MLEADER', 'MULTILEADER',
  'HATCH', 'POINT', 'VIEWPORT', 'IMAGE', 'WIPEOUT', 'TOLERANCE', 'RAY', 'XLINE',
  'SOLID', 'TRACE', '3DFACE', 'MESH', 'REGION', 'BODY',
]);

/** Layer, die üblicherweise keine Schnittkontur enthalten. */
export const IGNORIERTE_LAYER = [/^defpoints$/i];

const BINAER_KENNUNG = 'AutoCAD Binary DXF';

export class DxfFehler extends Error {}

/* ---------------- Tokenizer ---------------- */

/**
 * Zerlegt den Dateitext in Gruppencode/Wert-Paare.
 * DXF ist zeilenbasiert: eine Zeile Code, eine Zeile Wert.
 */
export function tokenize(text) {
  if (typeof text !== 'string') throw new DxfFehler('DXF-Inhalt ist kein Text.');
  if (text.startsWith(BINAER_KENNUNG)) {
    throw new DxfFehler('Diese Datei ist eine BINÄRE DXF-Datei. Bitte im CAD als ASCII-DXF (R12 oder neuer) exportieren.');
  }
  if (/^\s*(AC10|MC0\.0)/.test(text.slice(0, 8))) {
    throw new DxfFehler('Das sieht nach einer DWG-Datei aus. Bitte als DXF exportieren.');
  }

  const zeilen = text.split(/\r\n|\r|\n/);
  const out = [];
  for (let i = 0; i < zeilen.length - 1; i += 2) {
    const codeRaw = zeilen[i].trim();
    if (codeRaw === '') { i -= 1; continue; }      // Leerzeile überspringen
    const code = Number(codeRaw);
    if (!Number.isInteger(code)) {
      throw new DxfFehler(`Ungültiger DXF-Gruppencode in Zeile ${i + 1}: "${zeilen[i]}". Die Datei ist vermutlich beschädigt oder keine DXF-Datei.`);
    }
    const raw = zeilen[i + 1] ?? '';
    let value;
    switch (codeType(code)) {
      case 'float': value = Number(String(raw).trim().replace(',', '.')); if (!Number.isFinite(value)) value = 0; break;
      case 'int':   value = parseInt(String(raw).trim(), 10); if (!Number.isFinite(value)) value = 0; break;
      case 'bool':  value = String(raw).trim() !== '0'; break;
      default:      value = String(raw).replace(/\s+$/, '');
    }
    out.push([code, value]);
  }
  if (!out.length) throw new DxfFehler('Die Datei enthält keine lesbaren DXF-Daten.');
  return out;
}

/* ---------------- Entitäten ---------------- */

/** Eine Entität: Typ, Layer und die geordnete Liste ihrer Gruppencodes. */
function neueEntity(type) {
  return { type, layer: '0', codes: [], vertices: null };
}

/** Erster Wert zu einem Code, sonst fallback. */
export function g(entity, code, fallback = undefined) {
  for (const [c, v] of entity.codes) if (c === code) return v;
  return fallback;
}
/** Alle Werte zu einem Code, in Dateireihenfolge. */
export function gAll(entity, code) {
  const out = [];
  for (const [c, v] of entity.codes) if (c === code) out.push(v);
  return out;
}

/**
 * Liest Entitäten ab Position `i` bis zu einem der `enden` (z. B. ENDSEC/ENDBLK).
 * Behandelt POLYLINE/VERTEX/SEQEND als eine zusammengesetzte Entität.
 */
function readEntities(tok, i, enden) {
  const entities = [];
  let cur = null;
  let polyline = null;

  const abschliessen = () => {
    if (polyline) { entities.push(polyline); polyline = null; }
    else if (cur) entities.push(cur);
    cur = null;
  };

  while (i < tok.length) {
    const [code, value] = tok[i];
    if (code === 0) {
      const name = String(value).toUpperCase();
      if (enden.includes(name)) { abschliessen(); return { entities, next: i }; }

      if (name === 'SEQEND') {
        if (polyline) { entities.push(polyline); polyline = null; }
        cur = null;
        i++;
        continue;
      }
      if (name === 'VERTEX' && polyline) {
        cur = neueEntity('VERTEX');
        polyline.vertices.push(cur);
        i++;
        continue;
      }
      // Neue eigenständige Entität
      abschliessen();
      if (name === 'POLYLINE') {
        polyline = neueEntity('POLYLINE');
        polyline.vertices = [];
        cur = polyline;
      } else {
        cur = neueEntity(name);
      }
      i++;
      continue;
    }
    if (cur) {
      if (code === 8) cur.layer = String(value);
      cur.codes.push([code, value]);
    }
    i++;
  }
  abschliessen();
  return { entities, next: i };
}

/* ---------------- Hauptfunktion ---------------- */

/**
 * Liest eine DXF-Datei.
 * @returns {{header:Object, blocks:Object, entities:Array, meldungen:string[]}}
 */
export function parseDxf(text) {
  const tok = tokenize(text);
  const header = {};
  const blocks = {};
  let entities = [];
  const meldungen = [];

  let i = 0;
  while (i < tok.length) {
    const [code, value] = tok[i];
    if (code === 0 && value === 'SECTION') {
      const secName = (tok[i + 1] && tok[i + 1][0] === 2) ? String(tok[i + 1][1]).toUpperCase() : '';
      i += 2;

      if (secName === 'HEADER') {
        let varName = null;
        while (i < tok.length && !(tok[i][0] === 0 && tok[i][1] === 'ENDSEC')) {
          const [c, v] = tok[i];
          if (c === 9) { varName = String(v); header[varName] = header[varName] ?? {}; }
          else if (varName) {
            if (header[varName].value === undefined) header[varName].value = v;
            header[varName][c] = v;
          }
          i++;
        }
      } else if (secName === 'BLOCKS') {
        while (i < tok.length && !(tok[i][0] === 0 && tok[i][1] === 'ENDSEC')) {
          if (tok[i][0] === 0 && tok[i][1] === 'BLOCK') {
            i++;
            const blk = { name: '', base: [0, 0], entities: [] };
            while (i < tok.length && tok[i][0] !== 0) {
              const [c, v] = tok[i];
              if (c === 2 && !blk.name) blk.name = String(v);
              else if (c === 10) blk.base[0] = v;
              else if (c === 20) blk.base[1] = v;
              i++;
            }
            const res = readEntities(tok, i, ['ENDBLK', 'ENDSEC']);
            blk.entities = res.entities;
            i = res.next;
            if (i < tok.length && tok[i][1] === 'ENDBLK') i++;
            if (blk.name) blocks[blk.name] = blk;
          } else i++;
        }
      } else if (secName === 'ENTITIES') {
        const res = readEntities(tok, i, ['ENDSEC']);
        entities = res.entities;
        i = res.next;
      } else {
        while (i < tok.length && !(tok[i][0] === 0 && tok[i][1] === 'ENDSEC')) i++;
      }

      if (i < tok.length && tok[i][0] === 0 && tok[i][1] === 'ENDSEC') i++;
      continue;
    }
    i++;
  }

  if (!entities.length && Object.keys(blocks).length === 0) {
    meldungen.push('Die DXF-Datei enthält keine Zeichnungsobjekte.');
  }
  return { header, blocks, entities, meldungen };
}

/* ---------------- Einheiten (§12) ---------------- */

/** $INSUNITS-Code → Einheit + Faktor auf mm. */
export const INSUNITS = {
  0: null,            // unbestimmt
  1: { einheit: 'inch', faktor: 25.4 },
  2: { einheit: 'ft', faktor: 304.8 },
  4: { einheit: 'mm', faktor: 1 },
  5: { einheit: 'cm', faktor: 10 },
  6: { einheit: 'm', faktor: 1000 },
};

export const EINHEIT_FAKTOR = { mm: 1, cm: 10, m: 1000, inch: 25.4 };

/**
 * Bestimmt die Zeichnungseinheit.
 * Rät NICHT: ist der Wert nicht eindeutig, wird `sicher:false` gemeldet und der
 * Benutzer muss bestätigen (§12).
 */
export function einheitBestimmen(header, standard = 'mm') {
  const insunits = header?.$INSUNITS?.value;
  if (Number.isInteger(insunits) && INSUNITS[insunits]) {
    const u = INSUNITS[insunits];
    return { einheit: u.einheit, faktor: u.faktor, sicher: true, quelle: '$INSUNITS', hinweis: '' };
  }
  const measurement = header?.$MEASUREMENT?.value;
  if (measurement === 0) {
    return {
      einheit: 'inch', faktor: 25.4, sicher: false, quelle: '$MEASUREMENT',
      hinweis: 'Die Datei nennt keine Einheit; $MEASUREMENT=0 deutet auf Zoll hin. Bitte bestätigen.',
    };
  }
  return {
    einheit: standard, faktor: EINHEIT_FAKTOR[standard] ?? 1, sicher: false, quelle: 'Standard',
    hinweis: `Die DXF-Datei nennt keine Einheit ($INSUNITS fehlt). Angenommen wird der Betriebsstandard „${standard}". Bitte bestätigen.`,
  };
}
