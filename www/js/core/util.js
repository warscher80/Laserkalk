/** util.js — kleine Helfer ohne Abhängigkeiten. DOM-frei. */

let counter = 0;
/** Kollisionsarme ID, auch ohne crypto.randomUUID (alte WebViews). */
export function uid(prefix = 'id') {
  counter = (counter + 1) % 100000;
  const r = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}_${r}`;
}

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepClone);
  const out = {};
  for (const k of Object.keys(obj)) out[k] = deepClone(obj[k]);
  return out;
}

/** ISO-Datum (YYYY-MM-DD) von heute oder einem Date. */
export function isoDate(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "2026-08-30" -> "30.08.2026" */
export function dateDe(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** Zeitstempel -> "30.08.2026 14:05" */
export function stampDe(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Minuten -> "2 h 5 min" bzw. "45 min" */
export function minStr(minuten) {
  if (!Number.isFinite(minuten) || minuten <= 0) return '0 min';
  const h = Math.floor(minuten / 60);
  const m = minuten - h * 60;
  const mStr = Number.isInteger(m) ? String(m) : m.toFixed(1).replace('.', ',');
  if (h <= 0) return `${mStr} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${mStr} min`;
}

/** Normalisiert Text für Suche/Vergleich: klein, ohne Umlaut-Sonderfälle, ohne Rand. */
export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .trim();
}

/** Enthält haystack alle Wörter aus needle? */
export function matches(haystack, needle) {
  const n = norm(needle);
  if (!n) return true;
  const h = norm(haystack);
  return n.split(/\s+/).every(w => h.includes(w));
}

/** Sortiert Werkstoff-/Materialnamen natürlich (1.4301 vor 1.4404, 2 mm vor 10 mm). */
export function natCmp(a, b) {
  return String(a).localeCompare(String(b), 'de', { numeric: true, sensitivity: 'base' });
}

/** Escaped HTML für sichere Textausgabe. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
