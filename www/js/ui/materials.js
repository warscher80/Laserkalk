/**
 * materials.js — Materialdatenbank (§4, §5).
 * Liste mit Suche und Filtern; Editor für ein Blech mit allen Feldern.
 */

import {
  h, card, field, text, num, money, select, seg, note, toast, icon, bestaetige, empty, leere,
  entprellt,
} from './components.js';
import { store } from '../core/store.js';
import { materialAbleiten, materialPruefen, materialLabel } from '../core/material.js';
import { beispielMaterialien } from '../core/defaults.js';
import { eur, num as fmtNum } from '../core/money.js';
import { matches, natCmp, isoDate, dateDe, uid } from '../core/util.js';

export async function render(ctx) {
  const param = ctx.param || [];
  if (param[0]) return editor(ctx, param[0]);
  return liste(ctx);
}

/* ------------------------------------------------------------------ */
/* Liste                                                               */
/* ------------------------------------------------------------------ */

const filter = { suche: '', groupId: '', werkstoff: '', dicke: '', lieferant: '', nurAktive: false };

function liste(ctx) {
  const el = h('div');
  const listeBox = h('div');

  const zeichne = () => {
    leere(listeBox);
    const gruppen = store.gruppen();
    const gName = new Map(gruppen.map(g => [g.id, g.name]));
    let mats = store.materialien();

    if (filter.nurAktive) mats = mats.filter(m => m.aktiv !== false);
    if (filter.groupId) mats = mats.filter(m => m.groupId === filter.groupId);
    if (filter.werkstoff) mats = mats.filter(m => m.werkstoff === filter.werkstoff);
    if (filter.dicke) mats = mats.filter(m => String(m.dickeMm) === filter.dicke);
    if (filter.lieferant) mats = mats.filter(m => m.lieferant === filter.lieferant);
    if (filter.suche) {
      mats = mats.filter(m => matches(
        [gName.get(m.groupId), m.werkstoff, m.bezeichnung, m.lieferant, m.artikelnummer, m.dickeMm, m.notizen].join(' '),
        filter.suche));
    }

    if (!mats.length) {
      const gesamt = store.materialien().length;
      listeBox.appendChild(empty(
        gesamt ? 'Keine Treffer' : 'Noch keine Bleche angelegt',
        gesamt ? 'Bitte Suche oder Filter ändern.' : 'Legen Sie Ihre Bleche mit den eigenen Einkaufspreisen an. Preise werden bewusst nicht mitgeliefert.',
        gesamt ? null : h('.btnrow', null,
          h('button.btn.primary', { text: 'Blech anlegen', onclick: () => ctx.gehe('/materials/neu') }),
          h('button.btn', { text: 'Vorlage erzeugen', onclick: vorlage }),
        )));
      return;
    }

    const l = h('.list');
    let letzteGruppe = null;
    for (const m of mats) {
      if (m.groupId !== letzteGruppe) {
        letzteGruppe = m.groupId;
        l.appendChild(h('.dg', {
          text: gName.get(m.groupId) || 'Ohne Gruppe',
          style: { fontSize: '11px', fontWeight: '800', letterSpacing: '.8px', textTransform: 'uppercase', color: 'var(--muted)', margin: '10px 2px 2px' },
        }));
      }
      const preisText = m.preisProM2Cent > 0 ? `${eur(m.preisProM2Cent)}/m²`
        : m.ekTafelCent > 0 ? `${eur(m.ekTafelCent)}/Tafel` : 'kein Preis';
      l.appendChild(h('.item' + (m.aktiv === false ? '.inaktiv' : ''), { onclick: () => ctx.gehe('/materials/' + m.id) },
        h('.ib', null,
          h('.i1', { text: materialLabel(m) }),
          h('.i2', { text: [m.werkstoff, m.tafelLaengeMm > 0 ? `${fmtNum(m.tafelLaengeMm, 0)} × ${fmtNum(m.tafelBreiteMm, 0)} mm` : null, m.lieferant].filter(Boolean).join(' · ') }),
          h('.i3', { text: [m.preisDatum ? 'Preis vom ' + dateDe(m.preisDatum) : null, m.aktiv === false ? 'inaktiv' : null].filter(Boolean).join(' · ') }),
        ),
        h('.ir', null,
          h('.v', { text: preisText === 'kein Preis' ? '—' : preisText.split('/')[0] }),
          h('.s', { text: preisText === 'kein Preis' ? 'kein Preis' : '/' + preisText.split('/')[1] }),
        ),
        h('.rowbtns', null,
          h('button.iconbtn', {
            'aria-label': 'Duplizieren',
            onclick: async (e) => {
              e.stopPropagation();
              const kopie = { ...JSON.parse(JSON.stringify(m)), id: uid('mat'), bezeichnung: materialLabel(m) + ' (Kopie)' };
              delete kopie.abgeleitet; delete kopie.tafelFlaecheM2; delete kopie.flaechengewichtKgProM2; delete kopie.gewichtProTafelKg;
              await store.saveMaterial(kopie);
              toast('Kopie angelegt.', 'ok');
              zeichne();
            },
          }, icon('copy', 17)),
        ),
      ));
    }
    listeBox.appendChild(l);
    listeBox.appendChild(h('.hint.mt', { text: `${mats.length} von ${store.materialien().length} Blechen` }));
  };

  async function vorlage() {
    if (!await bestaetige('Vorlage erzeugen?',
      'Es werden Bleche für S235JR, 1.4301 und AlMg3 in gängigen Stärken angelegt – ohne Preise. Die Einkaufspreise müssen Sie selbst eintragen.', 'Anlegen')) return;
    const neu = beispielMaterialien().filter(m => !store.get('materials', m.id));
    if (!neu.length) { toast('Die Vorlage ist bereits angelegt.', 'warn'); return; }
    await store.bulkPut('materials', neu);
    toast(`${neu.length} Bleche angelegt – bitte Einkaufspreise eintragen.`, 'ok');
    zeichne();
  }

  const filterBox = h('div');
  const zeichneFilter = () => {
    leere(filterBox);
    const gruppen = store.gruppen();
    const werkstoffe = [...new Set(store.materialien()
      .filter(m => !filter.groupId || m.groupId === filter.groupId).map(m => m.werkstoff))].filter(Boolean).sort(natCmp);
    const dicken = [...new Set(store.materialien()
      .filter(m => (!filter.groupId || m.groupId === filter.groupId) && (!filter.werkstoff || m.werkstoff === filter.werkstoff))
      .map(m => String(m.dickeMm)))].sort((a, b) => Number(a) - Number(b));
    const lieferanten = store.lieferanten();

    filterBox.appendChild(h('.grid' + (lieferanten.length ? '' : '.g3'), null,
      select([['', 'Alle Gruppen'], ...gruppen.map(g => [g.id, g.name])], filter.groupId,
        v => { filter.groupId = v; filter.werkstoff = ''; filter.dicke = ''; zeichneFilter(); zeichne(); }),
      select([['', 'Alle Werkstoffe'], ...werkstoffe.map(w => [w, w])], filter.werkstoff,
        v => { filter.werkstoff = v; filter.dicke = ''; zeichneFilter(); zeichne(); }),
      select([['', 'Alle Stärken'], ...dicken.map(d => [d, String(d).replace('.', ',') + ' mm'])], filter.dicke,
        v => { filter.dicke = v; zeichne(); }),
      lieferanten.length
        ? select([['', 'Alle Lieferanten'], ...lieferanten.map(x => [x, x])], filter.lieferant, v => { filter.lieferant = v; zeichne(); })
        : null,
    ));
    filterBox.appendChild(h('.chips', null,
      h('button.chip' + (filter.nurAktive ? '.on' : ''), {
        text: 'nur aktive', onclick: () => { filter.nurAktive = !filter.nurAktive; zeichneFilter(); zeichne(); },
      }),
      (filter.groupId || filter.werkstoff || filter.dicke || filter.lieferant || filter.suche)
        ? h('button.chip', {
            text: 'Filter zurücksetzen',
            onclick: () => { Object.assign(filter, { suche: '', groupId: '', werkstoff: '', dicke: '', lieferant: '' }); zeichneFilter(); zeichne(); sucheInput.value = ''; },
          })
        : null,
    ));
  };

  const sucheInput = h('input', {
    type: 'search', placeholder: 'Suchen: Werkstoff, Lieferant, Artikelnummer …', value: filter.suche,
    oninput: entprellt(e => { filter.suche = e.target.value; zeichne(); }, 140),
  });

  el.appendChild(h('.searchbar', null, sucheInput,
    h('button.btn.primary', { style: { flex: '0 0 auto' }, onclick: () => ctx.gehe('/materials/neu') }, icon('plus', 20))));
  el.appendChild(filterBox);
  el.appendChild(listeBox);
  el.appendChild(h('.btnrow.mt', null,
    h('button.btn', { text: 'Vorlage erzeugen', onclick: vorlage }),
    h('button.btn', { text: 'Import / Export', onclick: () => ctx.gehe('/settings/backup') }),
  ));

  zeichneFilter();
  zeichne();
  return { kopf: { titel: 'Materialien', untertitel: 'Bleche, Preise, Lieferanten', zurueck: '/home' }, el };
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

function editor(ctx, id) {
  const istNeu = id === 'neu';
  const gruppen = store.gruppen();
  let mat;
  if (istNeu) {
    const g = gruppen[0];
    mat = {
      id: '', groupId: g?.id || '', werkstoff: '', bezeichnung: '', dickeMm: 0,
      tafelLaengeMm: 2500, tafelBreiteMm: 1250,
      ekTafelCent: 0, ekProKgCent: 0, preisProM2Cent: 0, preisQuelle: 'tafel',
      dichte: g?.dichteStd || 7850,
      lieferant: '', artikelnummer: '', preisDatum: isoDate(), notizen: '', aktiv: true,
    };
  } else {
    const vorhanden = store.get('materials', id);
    if (!vorhanden) return { kopf: { titel: 'Nicht gefunden', zurueck: '/materials' }, el: note('bad', 'Dieses Material existiert nicht mehr.') };
    mat = JSON.parse(JSON.stringify(vorhanden));
  }

  const el = h('div');
  const abgeleitetBox = h('div');
  const fehlerBox = h('div');

  const zeichneAbgeleitet = () => {
    leere(abgeleitetBox);
    const a = materialAbleiten(mat);
    const zeilen = [
      ['Tafelfläche', a.tafelFlaecheM2 > 0 ? `${fmtNum(a.tafelFlaecheM2, 4)} m²` : '—'],
      ['Gewicht je Tafel', a.gewichtProTafelKg > 0 ? `${fmtNum(a.gewichtProTafelKg, 2)} kg` : '—'],
      ['Flächengewicht', a.flaechengewichtKgProM2 > 0 ? `${fmtNum(a.flaechengewichtKgProM2, 3)} kg/m²` : '—'],
      ['Preis je m²', a.preisProM2Cent > 0 ? eur(a.preisProM2Cent) : '—'],
      ['Preis je kg', a.ekProKgCent > 0 ? eur(a.ekProKgCent) : '—'],
      ['Preis je Tafel', a.ekTafelCent > 0 ? eur(a.ekTafelCent) : '—'],
    ];
    const box = h('.dxfkv');
    for (const [k, v] of zeilen) box.appendChild(h('.kv', null, h('.k', { text: k }), h('.v', { text: v })));
    abgeleitetBox.appendChild(box);
    abgeleitetBox.appendChild(h('.hint', {
      text: a.abgeleitet.length
        ? 'Berechnet aus dem gewählten Führungspreis: ' + a.abgeleitet.map(f => ({ preisProM2Cent: 'Preis/m²', ekProKgCent: 'Preis/kg', ekTafelCent: 'Tafelpreis' }[f])).join(', ')
        : 'Für abgeleitete Preise bitte Tafelmaß, Dichte und einen Einkaufspreis eintragen.',
    }));
  };

  const zeichneFehler = () => {
    leere(fehlerBox);
    const f = materialPruefen(mat);
    if (f.length) fehlerBox.appendChild(note('warn', f, 'Bitte prüfen:'));
  };

  const nach = () => {
    // Beim Wechsel des Führungspreises die abgeleiteten Werte übernehmen,
    // damit der bisher berechnete Wert nicht verloren geht.
    const a = materialAbleiten(mat);
    for (const feld of ['preisProM2Cent', 'ekProKgCent', 'ekTafelCent']) {
      if (a.abgeleitet.includes(feld)) mat[feld] = a[feld];
    }
    zeichneAbgeleitet();
    zeichneFehler();
  };

  const preisFeld = (quelle, label, wert, setter, einheit) => {
    const aktiv = mat.preisQuelle === quelle;
    return h('.field', null,
      h('label', { text: label + (aktiv ? ' (Führungspreis)' : ' – berechnet') }),
      money(wert, v => { setter(v); nach(); }, { einheit, disabled: !aktiv }),
    );
  };

  el.appendChild(card('Einordnung',
    h('.grid', null,
      field('Materialgruppe', select(gruppen.map(g => [g.id, g.name]), mat.groupId, v => {
        mat.groupId = v;
        const g = store.gruppe(v);
        if (g && !Number(mat.dichte)) mat.dichte = g.dichteStd;
        nach();
      })),
      field('Werkstoff', text(mat.werkstoff, v => { mat.werkstoff = v; nach(); }, { placeholder: 'z. B. S235JR, 1.4301' })),
      h('.field.full', null, h('label', { text: 'Materialbezeichnung' }),
        text(mat.bezeichnung, v => { mat.bezeichnung = v; }, { placeholder: 'wird sonst automatisch gebildet' })),
      field('Blechstärke', num(mat.dickeMm, v => { mat.dickeMm = v; nach(); }, { unit: 'mm' })),
      field('Dichte', num(mat.dichte, v => { mat.dichte = v; nach(); }, { unit: 'kg/m³' }),
        'Standard der Gruppe: ' + (store.gruppe(mat.groupId)?.dichteStd ?? '—') + ' kg/m³'),
    )));

  el.appendChild(card('Tafelmaß',
    h('.grid', null,
      field('Tafellänge', num(mat.tafelLaengeMm, v => { mat.tafelLaengeMm = v; nach(); }, { unit: 'mm' })),
      field('Tafelbreite', num(mat.tafelBreiteMm, v => { mat.tafelBreiteMm = v; nach(); }, { unit: 'mm' })),
    )));

  const preisBox = h('div');
  const zeichnePreis = () => {
    leere(preisBox);
    preisBox.appendChild(card('Einkaufspreis',
      h('.field', null,
        h('label', { text: 'Welcher Preis ist führend?' }),
        seg([['tafel', 'je Tafel'], ['kg', 'je kg'], ['m2', 'je m²']], mat.preisQuelle || 'tafel',
          v => { mat.preisQuelle = v; zeichnePreis(); nach(); }, 'small'),
        h('.hint', { text: 'Die beiden anderen Preise werden daraus berechnet und lassen sich nicht direkt eingeben. Beim Umschalten wird der berechnete Wert übernommen – dabei sind Abweichungen von wenigen Cent durch das Runden auf zwei Stellen normal.' }),
      ),
      h('.grid.g3', null,
        preisFeld('tafel', 'Preis je Tafel', mat.ekTafelCent, v => { mat.ekTafelCent = v; }, '€'),
        preisFeld('kg', 'Preis je kg', mat.ekProKgCent, v => { mat.ekProKgCent = v; }, '€'),
        preisFeld('m2', 'Preis je m²', mat.preisProM2Cent, v => { mat.preisProM2Cent = v; }, '€'),
      ),
      h('.grid', null,
        field('Datum des Einkaufspreises', h('input', { type: 'date', value: mat.preisDatum || '', oninput: e => { mat.preisDatum = e.target.value; } })),
        field('Lieferant', text(mat.lieferant, v => { mat.lieferant = v; }, { placeholder: 'Händler' })),
        field('Artikelnummer', text(mat.artikelnummer, v => { mat.artikelnummer = v; })),
      ),
    ));
  };
  zeichnePreis();
  el.appendChild(preisBox);

  el.appendChild(card('Berechnete Werte', abgeleitetBox));

  el.appendChild(card('Sonstiges',
    field('Notizen', h('textarea', { value: mat.notizen || '', oninput: e => { mat.notizen = e.target.value; }, placeholder: 'z. B. Oberfläche, Lieferzeit' })),
    h('.field', null, h('label', { text: 'Status' }),
      seg([['ja', 'aktiv'], ['nein', 'inaktiv']], mat.aktiv === false ? 'nein' : 'ja',
        v => { mat.aktiv = v === 'ja'; }, 'small')),
  ));

  el.appendChild(fehlerBox);

  el.appendChild(h('.btnrow.mt', null,
    h('button.btn.primary', {
      text: 'Speichern',
      onclick: async () => {
        const f = materialPruefen(mat);
        if (f.length) { toast(f[0], 'bad'); return; }
        if (!mat.bezeichnung) mat.bezeichnung = materialLabel(mat);
        if (!mat.id) mat.id = uid('mat');
        await store.saveMaterial(mat);
        toast('Material gespeichert.', 'ok');
        ctx.gehe('/materials');
      },
    }),
    !istNeu ? h('button.btn.bad', {
      text: 'Löschen',
      onclick: async () => {
        if (!await bestaetige('Material löschen?', `„${materialLabel(mat)}" wird endgültig gelöscht. Bereits gespeicherte Kalkulationen behalten ihre Materialdaten.`, 'Löschen', true)) return;
        await store.del('materials', mat.id);
        toast('Material gelöscht.');
        ctx.gehe('/materials');
      },
    }) : null,
  ));

  nach();
  return {
    kopf: { titel: istNeu ? 'Neues Blech' : materialLabel(mat), untertitel: 'Materialdatenbank', zurueck: '/materials' },
    el,
  };
}
