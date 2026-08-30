/**
 * matpicker.js — Materialauswahl Gruppe → Werkstoff → Stärke (§3).
 * Die Struktur kommt vollständig aus der Datenbank, nichts ist fest verdrahtet.
 */

import { h, select, field, note } from './components.js';
import { store } from '../core/store.js';
import { eur, num } from '../core/money.js';
import { materialLabel } from '../core/material.js';

/**
 * @param {object} opts
 * @param {string} opts.materialId  aktuell gewähltes Material
 * @param {(mat:object|null)=>void} opts.onChange
 * @param {boolean} [opts.kompakt]  ohne Materialdaten-Zeile
 */
export function materialAuswahl(opts) {
  const box = h('div');

  const zeichne = () => {
    box.textContent = '';
    const alle = store.materialien(true);
    if (!alle.length) {
      box.appendChild(note('warn', 'Es sind keine aktiven Bleche angelegt. Bitte zuerst unter „Materialien" ein Blech mit Einkaufspreis erfassen.'));
      return;
    }

    const gewaehlt = opts.materialId ? store.material(opts.materialId) : null;
    const gruppen = store.gruppen(true).filter(g => alle.some(m => m.groupId === g.id));
    const groupId = gewaehlt?.groupId || opts._groupId || gruppen[0]?.id || '';
    const werkstoffe = store.werkstoffe(groupId);
    const werkstoff = (gewaehlt && gewaehlt.groupId === groupId ? gewaehlt.werkstoff : opts._werkstoff) ||
      (werkstoffe.includes(opts._werkstoff) ? opts._werkstoff : werkstoffe[0]) || '';
    const staerken = store.staerken(groupId, werkstoff);

    const waehle = (id) => {
      opts.materialId = id;
      opts.onChange(id ? store.material(id) : null);
      zeichne();
    };

    box.appendChild(h('.grid.g3', null,
      field('Materialgruppe', select(
        gruppen.map(g => [g.id, g.name]), groupId,
        (v) => {
          opts._groupId = v;
          opts._werkstoff = '';
          const w = store.werkstoffe(v)[0] || '';
          const st = w ? store.staerken(v, w) : [];
          waehle(st[0]?.id || '');
        })),
      field('Werkstoff', werkstoffe.length
        ? select(werkstoffe.map(w => [w, w]), werkstoff, (v) => {
            opts._groupId = groupId;
            opts._werkstoff = v;
            const st = store.staerken(groupId, v);
            waehle(st[0]?.id || '');
          })
        : select([['', '—']], '', () => {}, { disabled: true })),
      field('Blechstärke', staerken.length
        ? select(staerken.map(s => [s.id, `${fmtMm(s.dickeMm)} mm`]), gewaehlt?.id || staerken[0]?.id,
            (v) => { opts._groupId = groupId; opts._werkstoff = werkstoff; waehle(v); })
        : select([['', '—']], '', () => {}, { disabled: true })),
    ));

    if (!opts.kompakt) {
      const m = gewaehlt || (staerken[0] ? store.material(staerken[0].id) : null);
      if (m) {
        const zeilen = [];
        if (m.tafelLaengeMm > 0 && m.tafelBreiteMm > 0) zeilen.push(`Tafel ${fmtMm(m.tafelLaengeMm)} × ${fmtMm(m.tafelBreiteMm)} mm`);
        zeilen.push(`ρ ${num(Number(m.dichte) || 0, 0)} kg/m³`);
        if (m.gewichtProTafelKg > 0) zeilen.push(`${num(m.gewichtProTafelKg, 1)} kg/Tafel`);
        if (m.preisProM2Cent > 0) zeilen.push(`${eur(m.preisProM2Cent)}/m²`);
        if (m.ekProKgCent > 0) zeilen.push(`${eur(m.ekProKgCent)}/kg`);
        if (m.ekTafelCent > 0) zeilen.push(`${eur(m.ekTafelCent)}/Tafel`);
        box.appendChild(h('.hint', { text: zeilen.join(' · '), style: { marginTop: '-2px' } }));
        if (!(m.preisProM2Cent > 0) && !(m.ekProKgCent > 0) && !(m.ekTafelCent > 0)) {
          box.appendChild(note('warn', `Für „${materialLabel(m)}" ist kein Einkaufspreis hinterlegt. Die Materialkosten werden mit 0 € gerechnet.`));
        }
      }
    }
  };

  zeichne();
  box._neu = zeichne;
  return box;
}

function fmtMm(v) {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(Number(v) || 0);
}
