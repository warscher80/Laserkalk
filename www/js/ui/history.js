/**
 * history.js — Kalkulationshistorie (§34, §35).
 */

import { h, icon, toast, bestaetige, empty, leere, entprellt, select } from './components.js';
import { store } from '../core/store.js';
import { berechne } from '../calc/engine.js';
import { eur } from '../core/money.js';
import { matches, dateDe } from '../core/util.js';

const zustand = { suche: '', sortierung: 'neu' };

export async function render(ctx) {
  const el = h('div');
  const listeBox = h('div');

  const zeichne = () => {
    leere(listeBox);
    let alle = store.kalkulationen();

    const berechnet = [];
    for (const k of alle) {
      let r = null;
      try { r = berechne(k); } catch (e) { console.warn('Kalkulation nicht berechenbar', k.id, e); }
      berechnet.push({ k, r });
    }

    let gefiltert = berechnet;
    if (zustand.suche) {
      gefiltert = berechnet.filter(({ k, r }) => matches(
        [k.nummer, k.kunde, k.projekt, k.bauteil, k.angebotsnummer, r?.material?.name,
         k.material?.werkstoff, k.material?.dickeMm, dateDe(k.datum), k.datum].join(' '),
        zustand.suche));
    }
    if (zustand.sortierung === 'alt') gefiltert = [...gefiltert].reverse();
    else if (zustand.sortierung === 'preis') gefiltert = [...gefiltert].sort((a, b) => (b.r?.vkNettoCent || 0) - (a.r?.vkNettoCent || 0));
    else if (zustand.sortierung === 'kunde') gefiltert = [...gefiltert].sort((a, b) => String(a.k.kunde || '').localeCompare(String(b.k.kunde || ''), 'de'));

    if (!gefiltert.length) {
      listeBox.appendChild(empty(
        alle.length ? 'Keine Treffer' : 'Noch keine Kalkulationen',
        alle.length ? 'Bitte die Suche ändern.' : 'Jede gespeicherte Kalkulation erscheint hier – mit Suche, Duplizieren und Bearbeiten.',
        alle.length ? null : h('button.btn.primary', { text: 'Neue Kalkulation', onclick: () => ctx.gehe('/calc/neu') })));
      return;
    }

    const l = h('.list');
    for (const { k, r } of gefiltert) {
      l.appendChild(h('.item', { onclick: () => ctx.gehe('/calc/' + k.id) },
        h('.ib', null,
          h('.i1', { text: k.bauteil || k.projekt || k.nummer || 'Ohne Bezeichnung' }),
          h('.i2', { text: [k.kunde, k.projekt].filter(Boolean).join(' · ') || '—' }),
          h('.i3', {
            text: [
              k.nummer, dateDe(k.datum),
              r ? r.material.name : null,
              r ? `${r.stueckzahl} Stk` : null,
            ].filter(Boolean).join(' · '),
          }),
        ),
        h('.ir', null,
          h('.v', { text: r ? eur(r.vkNettoCent) : '—' }),
          h('.s', { text: r ? eur(r.vkProStueckCent) + '/Stk' : 'nicht berechenbar' }),
        ),
        h('.rowbtns', null,
          h('button.iconbtn', {
            'aria-label': 'Duplizieren',
            onclick: async (e) => {
              e.stopPropagation();
              const kopie = await store.dupliziereKalkulation(k.id);
              if (kopie) { toast(`Kopie ${kopie.nummer} angelegt.`, 'ok'); ctx.gehe('/calc/' + kopie.id); }
            },
          }, icon('copy', 17)),
          h('button.iconbtn.bad', {
            'aria-label': 'Löschen',
            onclick: async (e) => {
              e.stopPropagation();
              if (!await bestaetige('Kalkulation löschen?',
                `„${k.bauteil || k.nummer}" wird endgültig gelöscht.`, 'Löschen', true)) return;
              await store.del('calculations', k.id);
              toast('Kalkulation gelöscht.');
              zeichne();
            },
          }, icon('trash', 17)),
        ),
      ));
    }
    listeBox.appendChild(l);
    const summe = gefiltert.reduce((a, x) => a + (x.r?.vkNettoCent || 0), 0);
    listeBox.appendChild(h('.hint.mt', { text: `${gefiltert.length} Kalkulation(en) · Summe netto ${eur(summe)}` }));
  };

  el.appendChild(h('.searchbar', null,
    h('input', {
      type: 'search', placeholder: 'Kunde, Projekt, Bauteil, Material, Datum …', value: zustand.suche,
      oninput: entprellt(e => { zustand.suche = e.target.value; zeichne(); }, 140),
    }),
    h('button.btn.primary', { style: { flex: '0 0 auto' }, onclick: () => ctx.gehe('/calc/neu') }, icon('plus', 20)),
  ));
  el.appendChild(h('.field', null, select([
    ['neu', 'Neueste zuerst'], ['alt', 'Älteste zuerst'],
    ['preis', 'Höchster Preis zuerst'], ['kunde', 'Nach Kunde'],
  ], zustand.sortierung, v => { zustand.sortierung = v; zeichne(); })));
  el.appendChild(listeBox);

  zeichne();
  return { kopf: { titel: 'Kalkulationen', untertitel: 'Verlauf, suchen, duplizieren', zurueck: '/home' }, el };
}
