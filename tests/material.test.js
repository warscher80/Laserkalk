import test from 'node:test';
import assert from 'node:assert/strict';
import {
  materialAbleiten, gewichtProTafelKg, tafelFlaecheM2, flaechengewichtKgProM2,
  materialPruefen, materialLabel, findeSchnittparameter,
} from '../www/js/core/material.js';
import { defaultCutParams } from '../www/js/core/defaults.js';

const blech = (over = {}) => ({
  groupId: 'grp_stahl', werkstoff: 'S235JR', dickeMm: 2, dichte: 7850,
  tafelLaengeMm: 2500, tafelBreiteMm: 1250,
  ekTafelCent: 0, ekProKgCent: 0, preisProM2Cent: 0, preisQuelle: 'tafel',
  ...over,
});

test('Tafelflaeche, Flaechengewicht und Tafelgewicht', () => {
  const m = blech();
  assert.equal(tafelFlaecheM2(m), 3.125);
  // 0,002 m x 7850 kg/m3 = 15,7 kg/m2 (Gleitkomma: Toleranz statt Gleichheit)
  assert.ok(Math.abs(flaechengewichtKgProM2(m) - 15.7) < 1e-9);
  // 2,5 m x 1,25 m x 0,002 m x 7850 kg/m3 = 49,0625 kg
  assert.ok(Math.abs(gewichtProTafelKg(m) - 49.0625) < 1e-9);
  assert.equal(gewichtProTafelKg(blech({ tafelLaengeMm: 0 })), 0);
  assert.equal(flaechengewichtKgProM2(blech({ dichte: 0 })), 0);
});

test('Preis je Tafel ist fuehrend: m2 und kg werden abgeleitet', () => {
  const a = materialAbleiten(blech({ ekTafelCent: 31250, preisQuelle: 'tafel' }));
  // 312,50 EUR / 3,125 m2 = 100,00 EUR/m2
  assert.equal(a.preisProM2Cent, 10000);
  assert.equal(a.ekProKgCent, Math.round(31250 / 49.0625));
  assert.deepEqual(a.abgeleitet.sort(), ['ekProKgCent', 'preisProM2Cent']);
});

test('Preis je kg ist fuehrend: Tafelpreis und m2-Preis werden abgeleitet', () => {
  const a = materialAbleiten(blech({ ekProKgCent: 120, preisQuelle: 'kg' }));
  assert.equal(a.preisProM2Cent, Math.round(120 * 15.7));
  assert.equal(a.ekTafelCent, Math.round(120 * 49.0625));
});

test('Preis je m2 ist fuehrend', () => {
  const a = materialAbleiten(blech({ preisProM2Cent: 2000, preisQuelle: 'm2' }));
  assert.equal(a.ekTafelCent, Math.round(2000 * 3.125));
  assert.equal(a.ekProKgCent, Math.round(2000 / 15.7));
});

test('Ohne Tafelmass werden keine Werte erfunden', () => {
  const a = materialAbleiten(blech({ tafelLaengeMm: 0, tafelBreiteMm: 0, ekProKgCent: 120, preisQuelle: 'kg' }));
  assert.equal(a.ekTafelCent, 0, 'ohne Tafelmass kein Tafelpreis');
  assert.equal(a.preisProM2Cent, Math.round(120 * 15.7), 'Flaechenpreis geht auch ohne Tafelmass');
});

test('Materialpruefung meldet unplausible Werte im Klartext', () => {
  assert.equal(materialPruefen(blech({ ekTafelCent: 1000 })).length, 0);
  assert.ok(materialPruefen(blech({ dickeMm: 0 })).some(f => /Blechstaerke|Blechst/.test(f)));
  assert.ok(materialPruefen(blech({ dichte: 0 })).some(f => /Dichte/.test(f)));
  assert.ok(materialPruefen(blech({ dichte: 99999 })).some(f => /unplausibel/.test(f)));
  assert.ok(materialPruefen(blech({ werkstoff: '' })).some(f => /Werkstoff/.test(f)));
  assert.ok(materialPruefen(blech({ tafelBreiteMm: 0 })).some(f => /Tafelbreite|Tafell/.test(f)));
  assert.ok(materialPruefen(blech({ ekTafelCent: -5 })).some(f => /negativ/.test(f)));
});

test('materialLabel bildet einen sinnvollen Namen', () => {
  assert.equal(materialLabel({ werkstoff: 'S235JR', dickeMm: 2 }), 'S235JR 2 mm');
  assert.equal(materialLabel({ bezeichnung: 'Sonderblech' }), 'Sonderblech');
  assert.equal(materialLabel(null), '—');
});

test('Schnittparameter: exakter Treffer', () => {
  const t = findeSchnittparameter(defaultCutParams(), {
    groupId: 'grp_stahl', werkstoff: 'S235JR', dickeMm: 2, gas: 'Druckluft',
  });
  assert.equal(t.exakt, true);
  assert.equal(t.param.vSchnittMmMin, 8000);
  assert.equal(t.param.piercingSek, 0.3);
  assert.equal(t.hinweis, '');
});

test('Schnittparameter: Naeherung wird benutzt, aber als solche gemeldet', () => {
  const t = findeSchnittparameter(defaultCutParams(), {
    groupId: 'grp_stahl', werkstoff: 'S235JR', dickeMm: 2.5, gas: 'Druckluft',
  });
  assert.equal(t.exakt, false);
  assert.ok(t.param, 'es wird ein Nachbarwert benutzt');
  assert.ok(/Kein exakter Schnittparameter/.test(t.hinweis), 'die Naeherung wird offengelegt');
});

test('Schnittparameter: leere Tabelle liefert keinen Wert und sagt es', () => {
  const t = findeSchnittparameter([], { werkstoff: 'S235JR', dickeMm: 2 });
  assert.equal(t.param, null);
  assert.ok(t.hinweis.length > 0);
});

test('Schnittparameter: der Werkstoff schlaegt die Gruppe', () => {
  const t = findeSchnittparameter(defaultCutParams(), {
    groupId: 'grp_stahl', werkstoff: '1.4301', dickeMm: 2, gas: 'Stickstoff N₂',
  });
  assert.equal(t.param.werkstoff, '1.4301');
  assert.equal(t.param.vSchnittMmMin, 6500);
});
