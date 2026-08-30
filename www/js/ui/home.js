/** home.js — Startseite (§1): sechs große Schaltflächen. */

import { h, icon, card, note } from './components.js';
import { store } from '../core/store.js';
import { berechne } from '../calc/engine.js';
import { eur } from '../core/money.js';
import { dateDe } from '../core/util.js';

const KACHELN = [
  { route: '/calc/neu', titel: 'NEUE KALKULATION', beschr: 'Vollständige Kalkulation mit allen Positionen', ic: 'plus', hero: true },
  { route: '/quick', titel: 'SCHNELLKALKULATION', beschr: 'Preis in wenigen Eingaben', ic: 'bolt' },
  { route: '/dxf', titel: 'DXF KALKULATION', beschr: 'Zeichnung laden und automatisch auswerten', ic: 'file' },
  { route: '/history', titel: 'KALKULATIONEN', beschr: 'Verlauf, suchen, duplizieren', ic: 'list' },
  { route: '/materials', titel: 'MATERIALIEN', beschr: 'Bleche, Preise, Lieferanten', ic: 'layers' },
  { route: '/settings', titel: 'EINSTELLUNGEN', beschr: 'Stundensätze, Aufschläge, Backup', ic: 'gear' },
];

export function render(ctx) {
  const box = h('div');

  const tiles = h('.tiles');
  for (const k of KACHELN) {
    tiles.appendChild(h('button.tile' + (k.hero ? '.hero' : ''), { type: 'button', onclick: () => ctx.gehe(k.route) },
      h('.ic', null, icon(k.ic, k.hero ? 28 : 22)),
      h('div', null, h('.tt', { text: k.titel }), h('.td', { text: k.beschr })),
    ));
  }
  box.appendChild(tiles);

  /* Hinweis, wenn noch keine Materialien gepflegt sind — ohne Material keine Preise. */
  if (!store.materialien().length) {
    box.appendChild(h('div.mt', null, note('warn',
      'Es sind noch keine Bleche angelegt. Ohne gepflegte Einkaufspreise sind die Materialkosten 0 €. Unter „Materialien" können Sie Bleche anlegen oder eine Vorlage erzeugen.',
      'Materialdatenbank ist leer.')));
  }

  /* Letzte Kalkulationen als Schnellzugriff */
  const letzte = store.kalkulationen().slice(0, 5);
  if (letzte.length) {
    const liste = h('.list');
    for (const k of letzte) {
      let r;
      try { r = berechne(k); } catch { continue; }
      liste.appendChild(h('.item', { onclick: () => ctx.gehe('/calc/' + k.id) },
        h('.ib', null,
          h('.i1', { text: k.bauteil || k.projekt || k.nummer || 'Ohne Bezeichnung' }),
          h('.i2', { text: [k.kunde, r.material.name].filter(Boolean).join(' · ') || '—' }),
          h('.i3', { text: `${dateDe(k.datum)} · ${r.stueckzahl} Stk` }),
        ),
        h('.ir', null,
          h('.v', { text: eur(r.vkNettoCent) }),
          h('.s', { text: eur(r.vkProStueckCent) + '/Stk' }),
        ),
      ));
    }
    box.appendChild(h('div.mt', null, card('Zuletzt bearbeitet', liste,
      h('button.btn.ghost.block.mt', { text: 'Alle Kalkulationen', onclick: () => ctx.gehe('/history') }))));
  }

  return { kopf: { titel: 'LaserKalk', untertitel: 'Kalkulation Laserschneiden & Blechteile' }, el: box };
}
