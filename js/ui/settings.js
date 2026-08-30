/**
 * settings.js — Einstellungen (§37) und Maschinenkalkulation (§38).
 * Alle Werte kommen aus der Datenbank; die Startwerte aus defaults.js sind
 * nach dem ersten Start ohne Bedeutung.
 */

import {
  h, card, field, text, num, money, prozent, select, seg, switchRow, note, toast, icon,
  sheet, bestaetige, empty, leere, res,
} from './components.js';
import { store } from '../core/store.js';
import { setzeTheme, appUpdatePruefen, istNativeApp } from './app.js';
import { APP_VERSION, versionText } from '../core/version.js';
import { STATUS } from '../core/update.js';
import { maschinenkosten, maschinenmarge } from '../calc/machine.js';
import { eur, centStr, num as fmtNum } from '../core/money.js';
import { uid, stampDe } from '../core/util.js';
import { STORES } from '../core/db.js';
import {
  baueBackup, leseBackup, validiereDaten, materialienCsv, leseMaterialCsv,
  kalkulationenCsv, dateiname,
} from '../io/backup.js';
import { speichereText, waehleDatei, leseDatei, istIOS } from '../io/files.js';

const BEREICHE = [
  ['saetze', 'Stundensätze & Aufschläge', 'Laser, CAD, Bediener, Material, Gewinn, MwSt.'],
  ['prozesse', 'Bearbeitungsarten', 'Entgraten, Schleifen, Kanten … mit eigenen Sätzen'],
  ['gase', 'Gase / Schneidmedien', 'Druckluft, O₂, N₂ und deren Abrechnung'],
  ['gruppen', 'Materialgruppen & Dichten', 'Stahl, Edelstahl, Aluminium …'],
  ['schnitt', 'Schnittparameter', 'Schnittgeschwindigkeit und Einstichzeit'],
  ['maschine', 'Maschinenkalkulation', 'Selbstkosten je Maschinenstunde prüfen'],
  ['dxf', 'DXF & Einheiten', 'Toleranzen, Standardeinheit, Flächenbasis'],
  ['backup', 'Backup & Export', 'Sichern, wiederherstellen, CSV/JSON'],
  ['update', 'Updates', 'Automatisch nach neuen Versionen sehen'],
];

export async function render(ctx) {
  const bereich = (ctx.param || [])[0];
  if (bereich === 'saetze') return saetze(ctx);
  if (bereich === 'prozesse') return prozesse(ctx);
  if (bereich === 'gase') return gase(ctx);
  if (bereich === 'gruppen') return gruppen(ctx);
  if (bereich === 'schnitt') return schnitt(ctx);
  if (bereich === 'maschine') return maschine(ctx);
  if (bereich === 'dxf') return dxfEinstellungen(ctx);
  if (bereich === 'backup') return backup(ctx);
  if (bereich === 'update') return updates(ctx);
  return uebersicht(ctx);
}

/* ------------------------------------------------------------------ */

function uebersicht(ctx) {
  const s = store.settings;
  const el = h('div');
  const l = h('.list');
  for (const [key, titel, beschr] of BEREICHE) {
    l.appendChild(h('.item', { onclick: () => ctx.gehe('/settings/' + key) },
      h('.ib', null, h('.i1', { text: titel }), h('.i2', { text: beschr })),
      h('.ir', { style: { transform: 'rotate(180deg)', color: 'var(--muted)' } }, icon('back', 18)),
    ));
  }
  el.appendChild(l);

  el.appendChild(h('div.mt', null, card('Darstellung',
    h('.field', null, h('label', { text: 'Farbschema' }),
      seg([['dark', 'Dunkel'], ['light', 'Hell']], s.theme, async (v) => { await setzeTheme(v); ctx.gehe('/settings'); }, 'small')))));

  el.appendChild(card('Kalkulationsnummern',
    h('.grid', null,
      field('Präfix', text(s.nummernPraefix, async v => { await store.setSettings({ nummernPraefix: v || 'K' }); })),
      field('Nächster Zähler', num(s.nummernZaehler, async v => { await store.setSettings({ nummernZaehler: Math.max(1, Math.trunc(v) || 1) }); })),
    ),
    h('.hint', { text: `Nächste Nummer: ${s.nummernPraefix || 'K'}-${new Date().getFullYear()}-${String(s.nummernZaehler || 1).padStart(4, '0')}` })));

  el.appendChild(h('.hint.mt', { text: `LaserKalk ${versionText()} · Speicher: ${store.adapter.kind === 'indexeddb' ? 'Gerätedatenbank (IndexedDB)' : 'nur Arbeitsspeicher'}` }));

  return { kopf: { titel: 'Einstellungen', zurueck: '/home' }, el };
}

/* ------------------------------------------------------------------ */

function saetze(ctx) {
  const s = { ...store.settings };
  const el = h('div');
  const sichern = async (patch) => { Object.assign(s, patch); await store.setSettings(patch); };

  el.appendChild(card('Stundensätze (netto)',
    h('.grid', null,
      field('Laser / Maschine', money(s.laserSatzCent, v => sichern({ laserSatzCent: v }), { einheit: '€/h' })),
      field('CAD / Programmierung', money(s.cadSatzCent, v => sichern({ cadSatzCent: v }), { einheit: '€/h' })),
      field('Bediener / Rüsten', money(s.bedienerSatzCent, v => sichern({ bedienerSatzCent: v }), { einheit: '€/h' })),
      field('Entgraten / Nachbearbeitung', money(s.entgratSatzCent, v => sichern({ entgratSatzCent: v }), { einheit: '€/h' })),
    ),
    h('.hint', { text: 'Diese Sätze werden in jede neue Kalkulation übernommen und sind dort einzeln überschreibbar.' })));

  el.appendChild(card('Material',
    h('.grid', null,
      field('Materialaufschlag', prozent(s.materialAufschlagBp, v => sichern({ materialAufschlagBp: v }))),
      field('Verschnitt (Standard)', prozent(s.verschnittBp, v => sichern({ verschnittBp: v }))),
    )));

  const gewinnBox = h('div');
  const zeichneGewinn = () => {
    leere(gewinnBox);
    gewinnBox.appendChild(h('.field', null,
      h('label', { text: 'Wie wird der Gewinn behandelt?' }),
      seg([['aufschlag', 'A: Aufschlag anwenden'], ['inklusive', 'B: bereits enthalten']], s.gewinnModus,
        async v => { await sichern({ gewinnModus: v }); zeichneGewinn(); }, 'small'),
      h('.hint', {
        text: s.gewinnModus === 'aufschlag'
          ? 'Auf den Kalkulationspreis wird zusätzlich der Gewinnaufschlag gerechnet.'
          : 'Kein zusätzlicher Gewinn – die hinterlegten Stundensätze sind bereits Verkaufspreise. Das verhindert eine doppelte Gewinnberechnung.',
      }),
    ));
    if (s.gewinnModus === 'aufschlag') {
      gewinnBox.appendChild(field('Gewinnaufschlag', prozent(s.gewinnBp, v => sichern({ gewinnBp: v }))));
    }
  };
  zeichneGewinn();
  el.appendChild(card('Gewinn', gewinnBox));

  const mindestBox = h('div');
  const zeichneMindest = () => {
    leere(mindestBox);
    mindestBox.appendChild(switchRow('Mindestauftragswert anwenden', s.mindestwertAktiv,
      async v => { await sichern({ mindestwertAktiv: v }); zeichneMindest(); }));
    if (s.mindestwertAktiv) {
      mindestBox.appendChild(field('Mindestauftragswert (netto)', money(s.mindestwertCent, v => sichern({ mindestwertCent: v })),
        'Liegt der berechnete Preis darunter, wird dieser Wert verrechnet.'));
    }
  };
  zeichneMindest();
  el.appendChild(card('Mindestauftragswert', mindestBox));

  el.appendChild(card('Steuer', field('Mehrwertsteuer', prozent(s.mwstBp, v => sichern({ mwstBp: v })))));

  el.appendChild(note('info', 'Änderungen werden sofort gespeichert und gelten für neue Kalkulationen. Bereits gespeicherte Kalkulationen behalten ihre Werte.'));

  return { kopf: { titel: 'Stundensätze & Aufschläge', zurueck: '/settings' }, el };
}

/* ------------------------------------------------------------------ */

function prozesse(ctx) {
  const el = h('div');
  const box = h('div');

  const bearbeiten = async (p) => {
    const neu = p || { id: '', name: '', satzCent: store.settings.entgratSatzCent, aktiv: true, sort: (store.prozesse().length + 1) * 10 };
    const daten = { ...neu };
    const ok = await sheet(p ? 'Bearbeitung ändern' : 'Neue Bearbeitungsart', (schliessen) => h('div', null,
      field('Name', text(daten.name, v => { daten.name = v; }, { placeholder: 'z. B. Pulverbeschichten' })),
      field('Stundensatz', money(daten.satzCent, v => { daten.satzCent = v; }, { einheit: '€/h' })),
      h('.field', null, h('label', { text: 'Status' }),
        seg([['ja', 'aktiv'], ['nein', 'inaktiv']], daten.aktiv === false ? 'nein' : 'ja', v => { daten.aktiv = v === 'ja'; }, 'small')),
      h('.sheetfoot', null,
        h('button.btn', { text: 'Abbrechen', onclick: () => schliessen(false) }),
        h('button.btn.primary', { text: 'Speichern', onclick: () => schliessen(true) }),
      ),
    ));
    if (!ok) return;
    if (!daten.name.trim()) { toast('Bitte einen Namen angeben.', 'bad'); return; }
    if (!daten.id) daten.id = uid('prc');
    await store.put('processes', daten);
    zeichne();
  };

  const zeichne = () => {
    leere(box);
    const liste = h('.list');
    for (const p of store.prozesse()) {
      liste.appendChild(h('.item' + (p.aktiv === false ? '.inaktiv' : ''), { onclick: () => bearbeiten(p) },
        h('.ib', null, h('.i1', { text: p.name }), h('.i2', { text: p.aktiv === false ? 'inaktiv' : 'aktiv' })),
        h('.ir', null, h('.v', { text: eur(p.satzCent) }), h('.s', { text: 'je Stunde' })),
        h('.rowbtns', null, h('button.iconbtn.bad', {
          'aria-label': 'Löschen',
          onclick: async (e) => {
            e.stopPropagation();
            if (!await bestaetige('Bearbeitungsart löschen?', `„${p.name}" wird gelöscht. Gespeicherte Kalkulationen bleiben unverändert.`, 'Löschen', true)) return;
            await store.del('processes', p.id);
            zeichne();
          },
        }, icon('trash', 17))),
      ));
    }
    box.appendChild(liste);
  };

  zeichne();
  el.appendChild(box);
  el.appendChild(h('button.btn.primary.block.mt', { onclick: () => bearbeiten(null) }, icon('plus', 18), 'Bearbeitungsart hinzufügen'));
  return { kopf: { titel: 'Bearbeitungsarten', zurueck: '/settings' }, el };
}

/* ------------------------------------------------------------------ */

function gase(ctx) {
  const el = h('div');
  const box = h('div');
  const MODI = [['inklusive', 'Im Maschinensatz enthalten'], ['proStunde', 'Preis je Stunde'], ['proMinute', 'Preis je Minute'], ['pauschal', 'Pauschalbetrag']];

  const bearbeiten = async (g) => {
    const daten = { ...(g || { id: '', name: '', modus: 'proStunde', preisCent: 0, sort: (store.gase().length + 1) * 10 }) };
    const preisFeldBox = h('div');
    const zeichnePreis = () => {
      leere(preisFeldBox);
      if (daten.modus === 'inklusive') {
        preisFeldBox.appendChild(h('.hint', { text: 'Es werden keine zusätzlichen Gaskosten berechnet.' }));
      } else {
        preisFeldBox.appendChild(field('Preis', money(daten.preisCent, v => { daten.preisCent = v; },
          { einheit: daten.modus === 'proStunde' ? '€/h' : daten.modus === 'proMinute' ? '€/min' : '€' })));
      }
    };
    zeichnePreis();
    const ok = await sheet(g ? 'Gas ändern' : 'Neues Gas', (schliessen) => h('div', null,
      field('Name', text(daten.name, v => { daten.name = v; }, { placeholder: 'z. B. Stickstoff N₂' })),
      field('Abrechnung', select(MODI, daten.modus, v => { daten.modus = v; zeichnePreis(); })),
      preisFeldBox,
      h('.sheetfoot', null,
        h('button.btn', { text: 'Abbrechen', onclick: () => schliessen(false) }),
        h('button.btn.primary', { text: 'Speichern', onclick: () => schliessen(true) }),
      ),
    ));
    if (!ok) return;
    if (!daten.name.trim()) { toast('Bitte einen Namen angeben.', 'bad'); return; }
    if (!daten.id) daten.id = uid('gas');
    await store.put('gases', daten);
    zeichne();
  };

  const zeichne = () => {
    leere(box);
    const liste = h('.list');
    const s = store.settings;
    for (const g of store.gase()) {
      liste.appendChild(h('.item', { onclick: () => bearbeiten(g) },
        h('.ib', null,
          h('.i1', { text: g.name + (s.standardGasId === g.id ? '  ★' : '') }),
          h('.i2', { text: MODI.find(m => m[0] === g.modus)?.[1] || g.modus })),
        h('.ir', null,
          h('.v', { text: g.modus === 'inklusive' ? '—' : eur(g.preisCent) }),
          h('.s', { text: g.modus === 'proStunde' ? 'je Stunde' : g.modus === 'proMinute' ? 'je Minute' : g.modus === 'pauschal' ? 'pauschal' : 'inklusive' })),
        h('.rowbtns', null,
          h('button.iconbtn', {
            'aria-label': 'Als Standard setzen',
            onclick: async (e) => { e.stopPropagation(); await store.setSettings({ standardGasId: g.id }); toast(`${g.name} ist jetzt Standard.`, 'ok'); zeichne(); },
          }, icon('check', 17)),
          h('button.iconbtn.bad', {
            'aria-label': 'Löschen',
            onclick: async (e) => {
              e.stopPropagation();
              if (!await bestaetige('Gas löschen?', `„${g.name}" wird gelöscht.`, 'Löschen', true)) return;
              await store.del('gases', g.id);
              zeichne();
            },
          }, icon('trash', 17)),
        ),
      ));
    }
    box.appendChild(liste);
  };

  zeichne();
  el.appendChild(box);
  el.appendChild(h('.hint.mt', { text: '★ = Standardgas für neue Kalkulationen.' }));
  el.appendChild(h('button.btn.primary.block.mt', { onclick: () => bearbeiten(null) }, icon('plus', 18), 'Gas hinzufügen'));
  return { kopf: { titel: 'Gase / Schneidmedien', zurueck: '/settings' }, el };
}

/* ------------------------------------------------------------------ */

function gruppen(ctx) {
  const el = h('div');
  const box = h('div');

  const bearbeiten = async (g) => {
    const daten = { ...(g || { id: '', name: '', dichteStd: 7850, aktiv: true, sort: (store.gruppen().length + 1) * 10 }) };
    const ok = await sheet(g ? 'Materialgruppe ändern' : 'Neue Materialgruppe', (schliessen) => h('div', null,
      field('Name', text(daten.name, v => { daten.name = v; }, { placeholder: 'z. B. Messing' })),
      field('Standard-Dichte', num(daten.dichteStd, v => { daten.dichteStd = v; }, { unit: 'kg/m³' }),
        'Wird beim Anlegen eines neuen Blechs dieser Gruppe vorgeschlagen und ist dort änderbar.'),
      h('.field', null, h('label', { text: 'Status' }),
        seg([['ja', 'aktiv'], ['nein', 'inaktiv']], daten.aktiv === false ? 'nein' : 'ja', v => { daten.aktiv = v === 'ja'; }, 'small')),
      h('.sheetfoot', null,
        h('button.btn', { text: 'Abbrechen', onclick: () => schliessen(false) }),
        h('button.btn.primary', { text: 'Speichern', onclick: () => schliessen(true) }),
      ),
    ));
    if (!ok) return;
    if (!daten.name.trim()) { toast('Bitte einen Namen angeben.', 'bad'); return; }
    if (!(Number(daten.dichteStd) > 0)) { toast('Die Dichte muss größer als 0 sein.', 'bad'); return; }
    if (!daten.id) daten.id = uid('grp');
    await store.put('materialGroups', daten);
    zeichne();
  };

  const zeichne = () => {
    leere(box);
    const liste = h('.list');
    for (const g of store.gruppen()) {
      const anzahl = store.all('materials').filter(m => m.groupId === g.id).length;
      liste.appendChild(h('.item' + (g.aktiv === false ? '.inaktiv' : ''), { onclick: () => bearbeiten(g) },
        h('.ib', null, h('.i1', { text: g.name }), h('.i2', { text: `${anzahl} Blech(e)` })),
        h('.ir', null, h('.v', { text: fmtNum(g.dichteStd, 0) }), h('.s', { text: 'kg/m³' })),
        h('.rowbtns', null, h('button.iconbtn.bad', {
          'aria-label': 'Löschen',
          onclick: async (e) => {
            e.stopPropagation();
            if (anzahl) { toast(`„${g.name}" enthält noch ${anzahl} Blech(e) und kann nicht gelöscht werden.`, 'bad'); return; }
            if (!await bestaetige('Materialgruppe löschen?', `„${g.name}" wird gelöscht.`, 'Löschen', true)) return;
            await store.del('materialGroups', g.id);
            zeichne();
          },
        }, icon('trash', 17))),
      ));
    }
    box.appendChild(liste);
  };

  zeichne();
  el.appendChild(box);
  el.appendChild(note('info', 'Die Dichte hier ist nur der Vorschlagswert. Maßgeblich für Gewicht und Preis ist immer die Dichte, die beim einzelnen Blech gespeichert ist.'));
  el.appendChild(h('button.btn.primary.block.mt', { onclick: () => bearbeiten(null) }, icon('plus', 18), 'Materialgruppe hinzufügen'));
  return { kopf: { titel: 'Materialgruppen & Dichten', zurueck: '/settings' }, el };
}

/* ------------------------------------------------------------------ */

function schnitt(ctx) {
  const el = h('div');
  const box = h('div');

  const bearbeiten = async (p) => {
    const daten = { ...(p || {
      id: '', groupId: store.gruppen()[0]?.id || '', werkstoff: '', dickeMm: 0,
      gas: store.gase()[0]?.name || 'Druckluft', maschineId: store.settings.standardMaschineId,
      vSchnittMmMin: 0, piercingSek: 0, notizen: '',
    }) };
    const ok = await sheet(p ? 'Schnittparameter ändern' : 'Neuer Schnittparameter', (schliessen) => h('div', null,
      h('.grid', null,
        field('Materialgruppe', select(store.gruppen().map(g => [g.id, g.name]), daten.groupId, v => { daten.groupId = v; })),
        field('Werkstoff', text(daten.werkstoff, v => { daten.werkstoff = v; }, { placeholder: 'S235JR' })),
        field('Blechstärke', num(daten.dickeMm, v => { daten.dickeMm = v; }, { unit: 'mm' })),
        field('Gas', select(store.gase().map(g => [g.name, g.name]), daten.gas, v => { daten.gas = v; })),
        field('Schnittgeschwindigkeit', num(daten.vSchnittMmMin, v => { daten.vSchnittMmMin = v; }, { unit: 'mm/min' })),
        field('Einstichzeit', num(daten.piercingSek, v => { daten.piercingSek = v; }, { unit: 's' })),
      ),
      field('Notiz', text(daten.notizen, v => { daten.notizen = v; })),
      h('.sheetfoot', null,
        h('button.btn', { text: 'Abbrechen', onclick: () => schliessen(false) }),
        h('button.btn.primary', { text: 'Speichern', onclick: () => schliessen(true) }),
      ),
    ));
    if (!ok) return;
    if (!daten.werkstoff.trim()) { toast('Bitte einen Werkstoff angeben.', 'bad'); return; }
    if (!(Number(daten.dickeMm) > 0)) { toast('Die Blechstärke muss größer als 0 sein.', 'bad'); return; }
    if (!(Number(daten.vSchnittMmMin) > 0)) { toast('Die Schnittgeschwindigkeit muss größer als 0 sein.', 'bad'); return; }
    if (!daten.id) daten.id = uid('cp');
    await store.put('cutParams', daten);
    zeichne();
  };

  const zeichne = () => {
    leere(box);
    const alle = store.schnittparameter();
    if (!alle.length) { box.appendChild(empty('Keine Schnittparameter', 'Ohne Schnittparameter kann die Laserzeit nicht geschätzt werden.')); return; }
    const liste = h('.list');
    const gName = new Map(store.gruppen().map(g => [g.id, g.name]));
    for (const p of alle) {
      liste.appendChild(h('.item', { onclick: () => bearbeiten(p) },
        h('.ib', null,
          h('.i1', { text: `${p.werkstoff} ${String(p.dickeMm).replace('.', ',')} mm` }),
          h('.i2', { text: `${gName.get(p.groupId) || '—'} · ${p.gas}` }),
          p.notizen ? h('.i3', { text: p.notizen }) : null),
        h('.ir', null,
          h('.v', { text: fmtNum(p.vSchnittMmMin, 0) }),
          h('.s', { text: `mm/min · ${fmtNum(p.piercingSek, 2)} s` })),
        h('.rowbtns', null, h('button.iconbtn.bad', {
          'aria-label': 'Löschen',
          onclick: async (e) => {
            e.stopPropagation();
            if (!await bestaetige('Schnittparameter löschen?', `${p.werkstoff} ${p.dickeMm} mm / ${p.gas}`, 'Löschen', true)) return;
            await store.del('cutParams', p.id);
            zeichne();
          },
        }, icon('trash', 17))),
      ));
    }
    box.appendChild(liste);
  };

  zeichne();
  el.appendChild(note('warn', 'Die mitgelieferten Werte sind grobe Richtwerte. Bitte an der eigenen Maschine überprüfen und anpassen – davon hängt die geschätzte Laserzeit ab.'));
  el.appendChild(box);
  el.appendChild(card('Nebenzeit',
    field('Nebenzeit je Bauteil', num(store.settings.nebenzeitSek, async v => { await store.setSettings({ nebenzeitSek: Math.max(0, v) }); }, { unit: 's' }),
      'Positionieren, Verfahrwege zwischen Konturen, Ein-/Ausfahren. Wird bei der Laserzeit-Schätzung je Stück aufgeschlagen.')));
  el.appendChild(h('button.btn.primary.block.mt', { onclick: () => bearbeiten(null) }, icon('plus', 18), 'Schnittparameter hinzufügen'));
  return { kopf: { titel: 'Schnittparameter', zurueck: '/settings' }, el };
}

/* ------------------------------------------------------------------ */

function maschine(ctx) {
  const m = JSON.parse(JSON.stringify(store.maschine(store.settings.standardMaschineId) || {
    id: uid('mach'), name: 'Laser 1', verrechnungssatzCent: store.settings.laserSatzCent, aktiv: true, kalk: {},
  }));
  m.kalk = m.kalk || {};
  const el = h('div');
  const ergebnisBox = h('div');

  const sichern = async () => { await store.put('machines', m); };

  const zeichneErgebnis = () => {
    leere(ergebnisBox);
    const k = maschinenkosten(m.kalk);
    const marge = maschinenmarge(k.selbstkostenProStunde, m.verrechnungssatzCent);
    ergebnisBox.appendChild(h('.results', null,
      res('Selbstkosten je Stunde', k.vollstaendig ? eur(k.selbstkostenProStunde) : '—', '',
        k.vollstaendig ? null : 'Nutzungsdauer und Stunden/Jahr fehlen', true),
      res('Verrechnungssatz', eur(m.verrechnungssatzCent), '', 'manuell festgelegt', true),
      res('Differenz je Stunde', k.vollstaendig ? eur(marge.diffCent) : '—', '',
        k.vollstaendig && marge.prozent !== null ? `${fmtNum(marge.prozent, 0)} % über Selbstkosten` : null),
      res('Abschreibung je Jahr', eur(k.abschreibungProJahr), '', `Investition ${eur(k.investition)}`),
    ));
    const d = h('.detail', null,
      h('.dg', { text: 'Selbstkosten je Maschinenstunde' }),
      zeile('Abschreibung', '', eur(k.abschreibungProStunde)),
      zeile('Wartung', '', eur(k.wartungProStunde)),
      zeile('Raumkosten', '', eur(k.raumProStunde)),
      zeile('Sonstige Fixkosten', '', eur(k.sonstigeProStunde)),
      zeile('Strom', `${fmtNum(Number(m.kalk.stromverbrauchKw) || 0, 1)} kW × ${centStr(m.kalk.strompreisCentProKwh || 0)} €/kWh`, eur(k.stromProStunde)),
      zeile('Selbstkosten', '', eur(k.selbstkostenProStunde), 'sum'),
    );
    ergebnisBox.appendChild(d);
    if (k.vollstaendig && marge.diffCent < 0) {
      ergebnisBox.appendChild(note('bad', `Der Verrechnungssatz liegt ${eur(-marge.diffCent)} unter den Selbstkosten je Stunde. Jede Maschinenstunde macht Verlust.`));
    }
  };

  const f = (label, feld, einheit, geld = true) => field(label,
    geld
      ? money(m.kalk[feld] || 0, v => { m.kalk[feld] = v; zeichneErgebnis(); sichern(); }, { einheit })
      : num(m.kalk[feld] || 0, v => { m.kalk[feld] = v; zeichneErgebnis(); sichern(); }, { unit: einheit }));

  el.appendChild(card('Maschine',
    h('.grid', null,
      field('Bezeichnung', text(m.name, v => { m.name = v; sichern(); })),
      field('Verrechnungssatz (manuell)', money(m.verrechnungssatzCent, v => { m.verrechnungssatzCent = v; zeichneErgebnis(); sichern(); }, { einheit: '€/h' })),
    ),
    h('button.btn.small.block.mt', {
      text: 'Verrechnungssatz als Laser-Stundensatz übernehmen',
      onclick: async () => { await store.setSettings({ laserSatzCent: m.verrechnungssatzCent }); toast('Laser-Stundensatz aktualisiert.', 'ok'); },
    })));

  el.appendChild(card('Investition & Fixkosten',
    h('.grid', null,
      f('Anschaffungspreis', 'anschaffungCent', '€'),
      f('Elektroinstallation', 'elektroinstallationCent', '€'),
      f('Nutzungsdauer', 'nutzungsdauerJahre', 'Jahre', false),
      f('Maschinenstunden je Jahr', 'stundenProJahr', 'h/Jahr', false),
      f('Wartung je Jahr', 'wartungProJahrCent', '€'),
      f('Raumkosten je Jahr', 'raumkostenProJahrCent', '€'),
      f('Sonstige Fixkosten je Jahr', 'sonstigeFixkostenProJahrCent', '€'),
    )));

  el.appendChild(card('Strom',
    h('.grid', null,
      f('Strompreis', 'strompreisCentProKwh', '€/kWh'),
      f('Durchschnittlicher Verbrauch', 'stromverbrauchKw', 'kW', false),
    )));

  el.appendChild(card('Ergebnis', ergebnisBox));
  el.appendChild(note('info', 'Diese Rechnung ist eine Kontrollrechnung. Für die Kalkulation wird immer der Verrechnungssatz bzw. der Laser-Stundensatz aus den Einstellungen verwendet.'));

  zeichneErgebnis();
  return { kopf: { titel: 'Maschinenkalkulation', zurueck: '/settings' }, el };
}

function zeile(label, unter, wert, klasse = '') {
  return h('.dr' + (klasse ? '.' + klasse : ''), null,
    h('.dl', null, h('span', { text: label }), unter ? h('small', { text: unter }) : null),
    h('.dv', { text: wert }));
}

/* ------------------------------------------------------------------ */

function dxfEinstellungen(ctx) {
  const s = { ...store.settings };
  const sichern = async (patch) => { Object.assign(s, patch); await store.setSettings(patch); };
  const el = h('div');

  el.appendChild(card('Einheiten',
    field('Standardeinheit, wenn die DXF keine nennt',
      select([['mm', 'Millimeter'], ['cm', 'Zentimeter'], ['m', 'Meter'], ['inch', 'Zoll']], s.dxfEinheitStandard,
        v => sichern({ dxfEinheitStandard: v })),
      'Die App fragt trotzdem immer nach, wenn die Einheit nicht eindeutig aus der Datei hervorgeht.')));

  el.appendChild(card('Standard-Flächenbasis',
    field('Welche Fläche zählt nach dem DXF-Import?',
      select([
        ['netto', 'Netto-Bauteilfläche'], ['bbox', 'Umschließendes Rechteck'],
        ['tafel', 'Komplette Tafel'], ['manuell', 'Manuelle Materialfläche'],
      ], s.dxfFlaechenBasis, v => sichern({ dxfFlaechenBasis: v })),
      'Bei offenen Konturen wird automatisch das umschließende Rechteck vorgeschlagen.')));

  el.appendChild(card('Toleranzen',
    h('.grid', null,
      field('Verkettungstoleranz', num(s.dxfToleranzMm, v => sichern({ dxfToleranzMm: Math.max(0.0001, v) }), { unit: 'mm' }),
        'Bis zu diesem Abstand gelten zwei Linienenden als verbunden.'),
      field('Abflachung von Bögen', num(s.dxfFlachToleranzMm, v => sichern({ dxfFlachToleranzMm: Math.max(0.0005, v) }), { unit: 'mm' }),
        'Maximale Abweichung beim Zerlegen von Bögen und Splines in Geraden.'),
      field('Grenze „extrem kurz"', num(s.dxfMinSegmentMm, v => sichern({ dxfMinSegmentMm: Math.max(0, v) }), { unit: 'mm' }),
        'Kürzere Segmente werden als Zeichnungsfehler gemeldet.'),
    )));

  el.appendChild(note('info', 'Kleinere Toleranzen bedeuten genauere Ergebnisse, aber mehr Rechenzeit bei sehr großen Zeichnungen.'));
  return { kopf: { titel: 'DXF & Einheiten', zurueck: '/settings' }, el };
}

/* ------------------------------------------------------------------ */

function backup(ctx) {
  const el = h('div');

  const anzahlen = () => STORES.map(s => `${s}: ${store.all(s).length}`);

  const exportiere = async (stores, basis, label, eigeneDaten = null) => {
    const daten = {};
    for (const s of stores) daten[s] = eigeneDaten ? (eigeneDaten[s] || []) : store.all(s);
    const text = baueBackup(daten, stores);
    try {
      const art = await speichereText(text, dateiname(basis, 'json'), 'application/json');
      if (art === 'kopieren') zeigeText(label, text);
      else toast(`${label} gespeichert.`, 'ok');
    } catch (e) {
      if (e?.name === 'AbortError') return;
      zeigeText(label, text);
    }
  };

  const exportiereCsv = async (text, basis, label) => {
    try {
      const art = await speichereText(text, dateiname(basis, 'csv'), 'text/csv');
      if (art === 'kopieren') zeigeText(label, text);
      else toast(`${label} gespeichert.`, 'ok');
    } catch (e) {
      if (e?.name === 'AbortError') return;
      zeigeText(label, text);
    }
  };

  const zeigeText = (titel, inhalt) => sheet(titel, (schliessen) => h('div', null,
    note('info', 'Das Speichern als Datei ist auf diesem Gerät nicht möglich. Bitte den Text markieren und kopieren.'),
    h('textarea', { value: inhalt, readonly: true, style: { minHeight: '240px', fontSize: '12px', fontFamily: 'monospace' } }),
    h('.sheetfoot', null,
      h('button.btn', { text: 'Schließen', onclick: () => schliessen(true) }),
      h('button.btn.primary', {
        text: 'In Zwischenablage',
        onclick: async () => {
          try { await navigator.clipboard.writeText(inhalt); toast('Kopiert.', 'ok'); }
          catch { toast('Kopieren nicht möglich – bitte von Hand markieren.', 'bad'); }
        },
      }),
    ),
  ));

  const importiereJson = async (nurStores) => {
    const datei = await waehleDatei('.json,application/json');
    if (!datei) return;
    if (datei.size > 60 * 1024 * 1024) { toast('Die Datei ist größer als 60 MB und wird nicht gelesen.', 'bad'); return; }
    let text;
    try { text = await leseDatei(datei); } catch (e) { toast(e.message, 'bad'); return; }

    // Stufe 1: Hülle, Format, Prüfsumme
    const gelesen = leseBackup(text);
    if (!gelesen.ok) { toast(gelesen.fehler, 'bad'); return; }

    // Stufe 2: Inhalt vollständig prüfen – VOR jedem Schreibzugriff
    const auswahl = {};
    for (const b of (nurStores || Object.keys(gelesen.daten))) {
      if (gelesen.daten[b]) auswahl[b] = gelesen.daten[b];
    }
    const geprueft = validiereDaten(auswahl);
    const warnungen = [...gelesen.warnungen, ...geprueft.warnungen];

    if (!geprueft.ok) {
      await sheet('Backup wird abgelehnt', (schliessen) => h('div', null,
        note('bad', geprueft.fehler.slice(0, 12), 'Das Backup enthält fehlerhafte Daten und wurde NICHT eingespielt:'),
        geprueft.fehler.length > 12 ? h('.hint', { text: `… und ${geprueft.fehler.length - 12} weitere.` }) : null,
        h('.hint', { text: 'Ihr aktueller Datenbestand ist unverändert.' }),
        h('.sheetfoot', null, h('button.btn.primary', { text: 'Verstanden', onclick: () => schliessen(true) })),
      ), { klickAussenSchliesst: false });
      return;
    }

    const zusammenfassung = Object.entries(geprueft.anzahl)
      .filter(([, n]) => n > 0).map(([b, n]) => `${beschriftung(b)}: ${n}`);

    const modus = await sheet('Backup einspielen', (schliessen) => h('div', null,
      note('ok', `Backup vom ${gelesen.kopf.erstellt ? new Date(gelesen.kopf.erstellt).toLocaleString('de-DE') : 'unbekannt'} – geprüft, keine Fehler.`),
      warnungen.length ? note('warn', warnungen.slice(0, 8)) : null,
      h('p.small', { text: 'Enthaltene Daten:' }),
      h('ul.small.muted', null, ...zusammenfassung.map(t => h('li', { text: t }))),
      h('.hint', { text: 'Vor dem Einspielen wird automatisch eine Sicherheitskopie Ihres jetzigen Bestands angelegt.' }),
      h('.sheetfoot', null,
        h('button.btn', { text: 'Abbrechen', onclick: () => schliessen(null) }),
        h('button.btn.primary', { text: 'Hinzufügen', onclick: () => schliessen('hinzufuegen') }),
      ),
      h('button.btn.bad.block.mt', { text: 'Ersetzen (vorhandene Daten überschreiben)', onclick: () => schliessen('ersetzen') }),
      h('.hint', { text: '„Hinzufügen" überschreibt nur Einträge mit gleicher Kennung. „Ersetzen" leert die betroffenen Bereiche vorher – beides läuft in einem Zug, ein Abbruch lässt keinen halben Zustand zurück.' }),
    ), { klickAussenSchliesst: false });
    if (!modus) return;

    if (modus === 'ersetzen' && !await bestaetige('Wirklich ersetzen?',
      `Die Bereiche ${Object.keys(geprueft.anzahl).filter(b => geprueft.anzahl[b] > 0).map(beschriftung).join(', ')} werden geleert und durch das Backup ersetzt.`,
      'Ersetzen', true)) return;

    const ergebnis = await store.wiederherstellen(geprueft.daten, modus);
    if (!ergebnis.ok) { toast(ergebnis.fehler, 'bad'); return; }
    if (ergebnis.sicherung && !ergebnis.sicherung.ok) {
      toast('Eingespielt, aber ohne Sicherheitskopie: ' + ergebnis.sicherung.fehler, 'warn');
    } else {
      toast(`${ergebnis.anzahl} Einträge eingespielt.`, 'ok');
    }
    ctx.gehe('/settings/backup');
    location.reload();
  };

  const importiereMaterialCsv = async () => {
    const datei = await waehleDatei('.csv,text/csv');
    if (!datei) return;
    let text;
    try { text = await leseDatei(datei); } catch (e) { toast(e.message, 'bad'); return; }
    const gelesen = leseMaterialCsv(text, store.gruppen());
    if (gelesen.fehler.length) { toast(gelesen.fehler[0], 'bad'); return; }

    const ok = await sheet('Materialien importieren', (schliessen) => h('div', null,
      note('ok', `${gelesen.materialien.length} Bleche gelesen.`),
      gelesen.warnungen.length ? note('warn', gelesen.warnungen.slice(0, 12)) : null,
      gelesen.neueGruppen.length ? note('info', `Diese Materialgruppen fehlen und werden angelegt: ${gelesen.neueGruppen.join(', ')}.`) : null,
      h('.sheetfoot', null,
        h('button.btn', { text: 'Abbrechen', onclick: () => schliessen(false) }),
        h('button.btn.primary', { text: 'Importieren', onclick: () => schliessen(true) }),
      ),
    ), { klickAussenSchliesst: false });
    if (!ok) return;

    const gName = new Map(store.gruppen().map(g => [String(g.name).toLowerCase(), g]));
    for (const name of gelesen.neueGruppen) {
      const g = { id: uid('grp'), name, dichteStd: 7850, aktiv: true, sort: (store.gruppen().length + 1) * 10 };
      await store.put('materialGroups', g);
      gName.set(name.toLowerCase(), g);
    }
    const neu = [];
    for (const m of gelesen.materialien) {
      const gruppe = m.groupId ? store.gruppe(m.groupId) : gName.get(String(m._gruppeName || '').toLowerCase());
      delete m._gruppeName;
      m.groupId = gruppe?.id || store.gruppen()[0]?.id || '';
      if (!(Number(m.dichte) > 0)) m.dichte = gruppe?.dichteStd || 7850;
      const vorhanden = store.all('materials').find(x =>
        x.groupId === m.groupId && x.werkstoff === m.werkstoff && Number(x.dickeMm) === Number(m.dickeMm));
      m.id = vorhanden ? vorhanden.id : uid('mat');
      neu.push(m);
    }
    for (const m of neu) await store.saveMaterial(m);
    toast(`${neu.length} Bleche importiert.`, 'ok');
    ctx.gehe('/materials');
  };

  // iOS räumt den Speicher von Webseiten auf, die länger nicht benutzt werden.
  // Bei Kalkulationsdaten wäre das schmerzhaft, deshalb ein deutlicher Hinweis.
  if (istIOS()) {
    el.appendChild(note('warn',
      'Auf dem iPhone bitte beachten: Solange die App nur als Lesezeichen in Safari läuft, '
      + 'kann iOS die gespeicherten Daten nach etwa einer Woche ohne Benutzung löschen. '
      + 'Legen Sie die App über „Teilen → Zum Home-Bildschirm" ab — dann bleiben die Daten erhalten. '
      + 'Speichern Sie zusätzlich regelmäßig ein Backup.',
      'Datensicherheit auf dem iPhone:'));
  }

  /* --- Speicherzustand: Darf der Browser die Daten löschen? --- */
  const speicherBox = h('div');
  const zeichneSpeicher = async (anfordern = false) => {
    leere(speicherBox);
    const st = anfordern ? await store.speicherPruefen(true) : (store.speicher || await store.speicherPruefen(false));
    const mb = (b) => (b === null || b === undefined) ? '—' : (b / 1024 / 1024).toFixed(1) + ' MB';

    speicherBox.appendChild(h('.results', null,
      res('Speicherort', store.adapter.kind === 'indexeddb' ? 'Gerätedatenbank' : 'nur Arbeitsspeicher', '',
        store.adapter.kind === 'indexeddb' ? 'IndexedDB' : 'geht beim Schließen verloren'),
      res('Dauerhaft', st.dauerhaft ? 'Ja' : (st.unterstuetzt ? 'Nein' : 'unbekannt'), '',
        st.dauerhaft ? 'vom Browser zugesichert' : 'nicht zugesichert', st.dauerhaft),
      res('Belegt', mb(st.belegtBytes), '', st.kontingentBytes ? 'von ' + mb(st.kontingentBytes) : null),
    ));

    if (store.adapter.kind !== 'indexeddb') {
      speicherBox.appendChild(note('bad',
        'Die Gerätedatenbank ist nicht verfügbar (Privatmodus oder gesperrter Speicher). Alles, was Sie jetzt eingeben, ist beim Schließen der App weg. Bitte den Privatmodus verlassen.'));
    } else if (!st.dauerhaft) {
      speicherBox.appendChild(note('warn',
        'Der Browser hat nicht zugesichert, die Daten dauerhaft zu behalten. Bei Platzmangel oder längerer Nichtbenutzung kann er sie löschen. '
        + 'Abhilfe: die App über „Zum Startbildschirm" bzw. „Zum Home-Bildschirm" installieren — und regelmäßig ein Backup speichern.'));
      speicherBox.appendChild(h('button.btn.small.block.mt', {
        text: 'Dauerhaften Speicher anfordern',
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          const neu2 = await store.speicherPruefen(true);
          await zeichneSpeicher(false);
          toast(neu2.dauerhaft ? 'Der Browser sichert die Daten jetzt dauerhaft zu.' : 'Der Browser hat die Zusicherung abgelehnt. Bitte die App installieren.', neu2.dauerhaft ? 'ok' : 'warn');
        },
      }));
    } else {
      speicherBox.appendChild(h('.hint', { text: 'Der Browser hat zugesichert, die Daten dauerhaft zu behalten. Ein Backup ersetzt das trotzdem nicht.' }));
    }
  };
  zeichneSpeicher(false);
  el.appendChild(card('Speicherzustand', speicherBox));

  /* --- Sicherheitskopie aus einem früheren Restore --- */
  const kopie = store.sicherheitskopie();
  if (kopie) {
    const anzahlKopie = Object.values(kopie.daten).reduce((a, b) => a + (b?.length || 0), 0);
    el.appendChild(card('Sicherheitskopie',
      note('info', `Vor der letzten Wiederherstellung wurde Ihr damaliger Bestand gesichert (${anzahlKopie} Einträge, ${stampDe(kopie.ts)}).`),
      h('.btnrow.mt', null,
        h('button.btn', {
          text: 'Als Datei speichern',
          onclick: () => exportiere(STORES, 'laserkalk-sicherheitskopie', 'Sicherheitskopie', kopie.daten),
        }),
        h('button.btn.bad', {
          text: 'Diesen Stand zurückholen',
          onclick: async () => {
            if (!await bestaetige('Sicherheitskopie zurückholen?',
              `Der jetzige Bestand wird durch den Stand von ${stampDe(kopie.ts)} ersetzt.`, 'Zurückholen', true)) return;
            const g = validiereDaten(kopie.daten);
            if (!g.ok) { toast('Die Sicherheitskopie ist beschädigt: ' + g.fehler[0], 'bad'); return; }
            const r = await store.wiederherstellen(g.daten, 'ersetzen');
            if (!r.ok) { toast(r.fehler, 'bad'); return; }
            toast('Stand zurückgeholt.', 'ok');
            location.reload();
          },
        }),
      )));
  }

  el.appendChild(card('Vollständiges Backup',
    h('.hint', { text: 'Enthält Einstellungen, Materialien, Schnittparameter, Bearbeitungsarten, Gase, Maschinen und alle Kalkulationen.' }),
    h('.btnrow.mt', null,
      h('button.btn.primary', { onclick: () => exportiere(STORES, 'laserkalk-backup', 'Backup') }, icon('down', 18), 'Backup speichern'),
      h('button.btn', { onclick: () => importiereJson(null) }, icon('up', 18), 'Backup einspielen'),
    ),
    h('.hint.mt', { text: anzahlen().join(' · ') })));

  el.appendChild(card('Materialdatenbank',
    h('.btnrow', null,
      h('button.btn', { onclick: () => exportiere(['materials', 'materialGroups'], 'laserkalk-materialien', 'Materialien') }, 'JSON-Export'),
      h('button.btn', { onclick: () => importiereJson(['materials', 'materialGroups']) }, 'JSON-Import'),
    ),
    h('.btnrow.mt', null,
      h('button.btn', { onclick: () => exportiereCsv(materialienCsv(store.materialien(), store.gruppen()), 'laserkalk-materialien', 'Material-CSV') }, 'CSV-Export (Excel)'),
      h('button.btn', { onclick: importiereMaterialCsv }, 'CSV-Import'),
    ),
    h('.hint.mt', { text: 'Für den CSV-Import am besten zuerst exportieren und diese Datei als Vorlage verwenden. Bleche mit gleicher Gruppe, gleichem Werkstoff und gleicher Stärke werden aktualisiert statt doppelt angelegt.' })));

  el.appendChild(card('Kalkulationen',
    h('.btnrow', null,
      h('button.btn', { onclick: () => exportiere(['calculations'], 'laserkalk-kalkulationen', 'Kalkulationen') }, 'JSON-Export'),
      h('button.btn', { onclick: () => importiereJson(['calculations']) }, 'JSON-Import'),
      h('button.btn', { onclick: () => exportiereCsv(kalkulationenCsv(store.kalkulationen()), 'laserkalk-kalkulationen', 'Kalkulations-CSV') }, 'CSV-Export'),
    )));

  el.appendChild(card('Gefahrenzone',
    h('button.btn.bad.block', {
      text: 'Alle Kalkulationen löschen',
      onclick: async () => {
        const n = store.all('calculations').length;
        if (!n) { toast('Es sind keine Kalkulationen gespeichert.', 'warn'); return; }
        if (!await bestaetige('Alle Kalkulationen löschen?', `${n} Kalkulation(en) werden endgültig gelöscht. Materialien und Einstellungen bleiben erhalten.`, 'Löschen', true)) return;
        await store.clear('calculations');
        toast('Alle Kalkulationen gelöscht.');
        ctx.gehe('/settings/backup');
      },
    }),
    h('button.btn.bad.block.mt', {
      text: 'App zurücksetzen (alles löschen)',
      onclick: async () => {
        if (!await bestaetige('Wirklich alles löschen?', 'Sämtliche Daten – Materialien, Preise, Kalkulationen und Einstellungen – werden gelöscht. Bitte vorher ein Backup speichern!', 'Alles löschen', true)) return;
        if (!await bestaetige('Letzte Rückfrage', 'Es gibt danach keinen Weg zurück. Wurde ein Backup gespeichert?', 'Ja, löschen', true)) return;
        for (const s of STORES) await store.clear(s);
        try { localStorage.removeItem('laserkalk_mirror_v1'); } catch {}
        location.hash = '#/home';
        location.reload();
      },
    }),
    h('.hint.mt', { text: 'Vorher unbedingt ein vollständiges Backup speichern.' })));

  return { kopf: { titel: 'Backup & Export', zurueck: '/settings' }, el };
}

/* ------------------------------------------------------------------ */

function updates(ctx) {
  const s = { ...store.settings };
  const sichern = async (patch) => { Object.assign(s, patch); await store.setSettings(patch); };
  const el = h('div');
  const ergebnisBox = h('div');
  const einstellBox = h('div');

  const zeichneEinstellungen = () => {
    leere(einstellBox);
    einstellBox.appendChild(switchRow('Automatisch nach Updates sehen', s.updateAktiv !== false,
      async v => { await sichern({ updateAktiv: v }); zeichneEinstellungen(); },
      'Prüft im Hintergrund, ob eine neuere Version bereitsteht'));
    if (s.updateAktiv !== false) {
      einstellBox.appendChild(field('Prüfabstand',
        num(s.updateIntervallStunden, v => sichern({ updateIntervallStunden: Math.max(1, Math.trunc(v) || 24) }), { unit: 'Stunden' }),
        'Höchstens einmal in diesem Abstand; beim Start der App.'));
    }
    einstellBox.appendChild(field('Adresse der Update-Datei',
      text(s.updateUrl, v => sichern({ updateUrl: v.trim() }), { placeholder: 'https://…/laserkalk/update.json' }),
      'Leer lassen, wenn keine Prüfung gewünscht ist. Die Datei enthält nur Versionsnummer und Downloadadresse.'));
    if (Number(s.ignorierteVersionCode) > 0) {
      einstellBox.appendChild(h('button.btn.small.block.mt', {
        text: `Übersprungene Version ${s.ignorierteVersionCode} wieder anzeigen`,
        onclick: async () => { await sichern({ ignorierteVersionCode: 0 }); zeichneEinstellungen(); toast('Wird wieder gemeldet.', 'ok'); },
      }));
    }
  };

  const zeichneErgebnis = (r) => {
    leere(ergebnisBox);
    if (!r) {
      ergebnisBox.appendChild(h('.hint', {
        text: s.letzteUpdatePruefung
          ? 'Zuletzt geprüft: ' + stampDe(s.letzteUpdatePruefung)
          : 'Noch nie geprüft.',
      }));
      return;
    }
    if (r.status === STATUS.NEU) {
      const i = r.info;
      ergebnisBox.appendChild(note('ok', `Version ${i.versionName} steht bereit. Installiert ist ${versionText()}.` + (i.hinweise ? ' ' + i.hinweise : '')));
      if (i.apkUrl) {
        ergebnisBox.appendChild(h('button.btn.primary.block.mt', {
          text: `Version ${i.versionName} herunterladen`,
          onclick: () => { try { window.open(i.apkUrl, '_blank', 'noopener'); } catch { location.href = i.apkUrl; } },
        }));
        ergebnisBox.appendChild(h('.hint', { text: 'Nach dem Download die Datei antippen und die Installation bestätigen. Ihre Daten bleiben dabei erhalten.' }));
      } else {
        ergebnisBox.appendChild(note('warn', 'In der Update-Datei ist keine Downloadadresse hinterlegt.'));
      }
    } else if (r.status === STATUS.AKTUELL) {
      ergebnisBox.appendChild(note('ok', `${versionText()} ist die neueste Version.`));
    } else if (r.status === STATUS.FEHLER) {
      ergebnisBox.appendChild(note('bad', r.fehler || 'Die Prüfung ist fehlgeschlagen.'));
    } else {
      ergebnisBox.appendChild(note('info', 'Es ist keine Adresse für die Update-Prüfung hinterlegt.'));
    }
  };

  el.appendChild(card('Installierte Version',
    h('.results', null,
      res('Version', APP_VERSION.name, '', `versionCode ${APP_VERSION.code}`, true),
      res('Zuletzt geprüft', s.letzteUpdatePruefung ? stampDe(s.letzteUpdatePruefung) : '—', ''),
    ),
    h('button.btn.primary.block.mt', {
      text: 'Jetzt nach Updates suchen',
      onclick: async (e) => {
        const knopf = e.currentTarget;
        knopf.disabled = true;
        knopf.textContent = 'Wird geprüft …';
        try {
          const r = await appUpdatePruefen(true);
          s.letzteUpdatePruefung = store.settings.letzteUpdatePruefung;
          zeichneErgebnis(r);
        } catch (err) {
          zeichneErgebnis({ status: STATUS.FEHLER, fehler: String(err?.message || err) });
        } finally {
          knopf.disabled = false;
          knopf.textContent = 'Jetzt nach Updates suchen';
        }
      },
    }),
    ergebnisBox));

  el.appendChild(card('Einstellungen', einstellBox));

  el.appendChild(card('Wie das Update funktioniert',
    h('.hint', {
      text: 'Die App lädt nur eine kleine Textdatei mit der neuesten Versionsnummer. ' +
        'Dabei werden keine Daten über das Gerät, den Betrieb oder Ihre Kalkulationen übertragen — ' +
        'es ist ein einfacher Abruf ohne Kennung. Die App installiert nichts von selbst: ' +
        'Sie entscheiden, ob Sie das Installationspaket laden und einspielen. ' +
        'Deshalb braucht die App auch keine Berechtigung zum Installieren von Apps.',
    }),
    h('.hint.mt', {
      text: istNativeApp()
        ? 'Diese App ist als Installationspaket eingerichtet. Alle Dateien liegen auf dem Gerät, '
          + 'ein neues Paket ersetzt sie vollständig. Über den Play Store installierte Apps '
          + 'aktualisiert der Store selbst – dann kann die Adresse oben leer bleiben.'
        : 'Läuft die App als Web-App im Browser oder über „Zum Startbildschirm hinzufügen", '
          + 'aktualisiert sie sich selbst: Eine neue Fassung wird im Hintergrund geladen und erst nach '
          + 'Ihrer Bestätigung übernommen — nie mitten in einer laufenden Kalkulation.',
    })));

  zeichneEinstellungen();
  zeichneErgebnis(null);
  return { kopf: { titel: 'Updates', untertitel: versionText(), zurueck: '/settings' }, el };
}

/* ------------------------------------------------------------------ */

function beschriftung(store2) {
  return {
    settings: 'Einstellungen', materialGroups: 'Materialgruppen', materials: 'Materialien',
    cutParams: 'Schnittparameter', processes: 'Bearbeitungsarten', gases: 'Gase',
    machines: 'Maschinen', calculations: 'Kalkulationen', remnants: 'Restbleche', meta: 'Systemdaten',
  }[store2] || store2;
}
