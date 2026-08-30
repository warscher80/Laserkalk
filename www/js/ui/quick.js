/**
 * quick.js — Schnellkalkulation (§29).
 * Nur die acht Eingaben, die man am Telefon braucht. Ergebnis sofort sichtbar.
 */

import { h, card, field, num, money, seg, note, toast, res, entprellt, leere } from './components.js';
import { store } from '../core/store.js';
import { berechne, neueKalkulation, neueZeit } from '../calc/engine.js';
import { eur, num as fmtNum } from '../core/money.js';
import { isoDate } from '../core/util.js';
import { materialAuswahl } from './matpicker.js';
import { materialLabel } from '../core/material.js';

const SCHLUESSEL = 'laserkalk_quick';

export async function render(ctx) {
  const settings = store.settings;

  /* Letzte Schnellkalkulation wiederverwenden – spart Tipparbeit am Telefon. */
  let calc = neueKalkulation(settings, { datum: isoDate(), bauteil: 'Schnellkalkulation' });
  try {
    const roh = sessionStorage.getItem(SCHLUESSEL);
    if (roh) calc = { ...calc, ...JSON.parse(roh) };
  } catch { /* egal */ }

  if (!calc.zeiten?.length) {
    calc.zeiten = [
      { ...neueZeit('cad', 'CAD / Programmierung', settings.cadSatzCent, 'einmalig') },
      { ...neueZeit('laser', 'Laserzeit', settings.laserSatzCent, 'proStueck') },
      { ...neueZeit('bediener', 'Bediener / Rüsten', settings.bedienerSatzCent, 'einmalig') },
      { ...neueZeit('prozess', 'Entgraten', settings.entgratSatzCent, 'proStueck'), prozessId: 'prc_entgraten' },
    ];
  }
  if (!calc.materialId) {
    const m = store.materialien(true)[0];
    if (m) { calc.materialId = m.id; calc.material = snap(m); }
  }
  if (calc.verbrauch.methode === 'dxf') calc.verbrauch.methode = 'rechteck';

  const zeitVon = art => calc.zeiten.find(z => z.art === art) || calc.zeiten.find(z => z.name === art);

  const ergebnisBox = h('div');
  const verbrauchBox = h('div');

  const merken = () => { try { sessionStorage.setItem(SCHLUESSEL, JSON.stringify(calc)); } catch { /* egal */ } };

  const aktualisiere = () => {
    let r;
    try { r = berechne(calc); } catch (e) { toast(e.message, 'bad'); return; }
    merken();
    leere(ergebnisBox);
    ergebnisBox.appendChild(h('.results', null,
      res('GESAMTPREIS NETTO', eur(r.vkNettoCent), '', r.mindestwertAngewendet ? 'Mindestauftragswert angewendet' : null, true),
      res('PREIS PRO STÜCK', eur(r.vkProStueckCent), '', `${r.stueckzahl} Stück`, true),
      res('Material', eur(r.material.vkCent), '', `EK ${eur(r.material.ekCent)}`),
      res('Zeitkosten', eur(r.zeitenSummeCent), '', `Laser ${fmtNum(r.laserMinutenGesamt, 0)} min gesamt`),
      res('Brutto', eur(r.vkBruttoCent), '', 'inkl. MwSt.'),
      res('Gewicht gesamt', r.material.gewichtGesamtKg > 0 ? fmtNum(r.material.gewichtGesamtKg, 2) : '–', 'kg'),
    ));
    if (r.warnungen.length) ergebnisBox.appendChild(note('warn', r.warnungen));
    ctx.zeigePreis({
      nettoCent: r.vkNettoCent, proStueckCent: r.vkProStueckCent, stueckzahl: r.stueckzahl,
      aktion: { label: 'Übernehmen', onclick: uebernehmen },
    });
  };
  const spaeter = entprellt(aktualisiere, 60);

  const picker = materialAuswahl({
    materialId: calc.materialId, kompakt: false,
    onChange: (m) => { calc.materialId = m ? m.id : ''; calc.material = snap(m); zeichneVerbrauch(); aktualisiere(); },
  });

  function zeichneVerbrauch() {
    leere(verbrauchBox);
    const v = calc.verbrauch;
    verbrauchBox.appendChild(h('.field', null,
      h('label', { text: 'Materialverbrauch' }),
      seg([['rechteck', 'L × B'], ['flaeche', 'm²'], ['gewicht', 'kg'], ['tafeln', 'Tafeln'], ['kosten', '€ direkt']],
        v.methode, (nv) => { v.methode = nv; zeichneVerbrauch(); aktualisiere(); }, 'small wrap'),
    ));
    const e = h('div');
    if (v.methode === 'rechteck') {
      e.appendChild(h('.grid', null,
        field('Länge', num(v.laengeMm, x => { v.laengeMm = Math.max(0, x); spaeter(); }, { unit: 'mm' })),
        field('Breite', num(v.breiteMm, x => { v.breiteMm = Math.max(0, x); spaeter(); }, { unit: 'mm' })),
      ));
    } else if (v.methode === 'flaeche') {
      e.appendChild(field('Fläche', num(v.flaecheM2, x => { v.flaecheM2 = Math.max(0, x); spaeter(); }, { unit: 'm²' })));
    } else if (v.methode === 'gewicht') {
      e.appendChild(field('Gewicht', num(v.gewichtKg, x => { v.gewichtKg = Math.max(0, x); spaeter(); }, { unit: 'kg' })));
    } else if (v.methode === 'tafeln') {
      e.appendChild(field('Anzahl Tafeln', num(v.tafeln, x => { v.tafeln = Math.max(0, x); spaeter(); }, { unit: 'Tafeln' })));
    } else {
      e.appendChild(field('Materialkosten (Einkauf)', money(v.kostenCent, x => { v.kostenCent = x; spaeter(); })));
    }
    e.appendChild(h('.field', null,
      seg([['stk', 'je Stück'], ['ges', 'gesamter Auftrag']], v.proStueck ? 'stk' : 'ges',
        (nv) => { v.proStueck = nv === 'stk'; aktualisiere(); }, 'small')));
    verbrauchBox.appendChild(e);
  }

  const zeitFeld = (art, label) => {
    const z = zeitVon(art);
    return field(label, num(z.minuten, v => { z.minuten = Math.max(0, v); if (art === 'laser') z.quelle = 'manuell'; spaeter(); }, { unit: 'min' }),
      z.modus === 'einmalig' ? 'einmalig' : 'je Stück');
  };

  async function uebernehmen() {
    const doc = await store.saveKalkulation({ ...calc, bauteil: calc.bauteil || 'Schnellkalkulation' });
    toast(`Gespeichert als ${doc.nummer}.`, 'ok');
    ctx.gehe('/calc/' + doc.id);
  }

  zeichneVerbrauch();

  const el = h('div', null,
    h('.cols', null,
      h('div', null,
        card('Material', picker, verbrauchBox),
        card('Stückzahl', field('Stückzahl', num(calc.stueckzahl, v => {
          calc.stueckzahl = Math.max(1, Math.trunc(v) || 1); spaeter();
        }, { unit: 'Stk' }))),
      ),
      h('div', null,
        card('Zeiten',
          h('.grid', null,
            zeitFeld('cad', 'CAD-Minuten'),
            zeitFeld('laser', 'Laser-Minuten'),
            zeitFeld('bediener', 'Bediener-Minuten'),
            zeitFeld('prozess', 'Entgraten-Minuten'),
          ),
          h('.hint', { text: 'CAD und Bediener fallen einmalig je Auftrag an, Laser und Entgraten je Stück. Für abweichende Aufteilungen die vollständige Kalkulation verwenden.' }),
        ),
      ),
    ),
    ergebnisBox,
    h('.btnrow', null,
      h('button.btn.primary', { text: 'Als Kalkulation speichern', onclick: uebernehmen }),
      h('button.btn', {
        text: 'Zurücksetzen',
        onclick: () => { try { sessionStorage.removeItem(SCHLUESSEL); } catch {} ctx.gehe('/quick'); location.reload(); },
      }),
    ),
  );

  aktualisiere();
  return { kopf: { titel: 'Schnellkalkulation', untertitel: 'Preis in wenigen Eingaben', zurueck: '/home' }, el };
}

function snap(m) {
  if (!m) return null;
  return {
    id: m.id, groupId: m.groupId, werkstoff: m.werkstoff, bezeichnung: materialLabel(m),
    dickeMm: Number(m.dickeMm) || 0, dichte: Number(m.dichte) || 0,
    tafelLaengeMm: Number(m.tafelLaengeMm) || 0, tafelBreiteMm: Number(m.tafelBreiteMm) || 0,
    ekTafelCent: Number(m.ekTafelCent) || 0, ekProKgCent: Number(m.ekProKgCent) || 0,
    preisProM2Cent: Number(m.preisProM2Cent) || 0, lieferant: m.lieferant || '',
    snapshotAm: isoDate(),
  };
}
