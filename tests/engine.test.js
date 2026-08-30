import test from 'node:test';
import assert from 'node:assert/strict';
import { berechne, neueKalkulation, neueZeit, pruefeKalkulation, staffel, dxfFlaecheM2 } from '../www/js/calc/engine.js';
import { defaultSettings } from '../www/js/core/defaults.js';
import { musterMaterial } from './helper.js';

const S = defaultSettings();

function basis(over = {}) {
  const c = neueKalkulation(S, over);
  c.material = musterMaterial();
  c.mindestwertAktiv = false;
  c.gewinnAktiv = false;
  c.verschnittBp = 0;
  return c;
}

test('Beispielrechnung aus der Anforderung (§36) stimmt auf den Cent', () => {
  const c = basis({ stueckzahl: 10 });
  c.verbrauch = { methode: 'kosten', kostenCent: 3000, proStueck: false };
  c.materialAufschlagBp = 2500;
  c.zeiten = [
    { ...neueZeit('cad', 'CAD', 7000, 'einmalig'), minuten: 10 },
    { ...neueZeit('laser', 'Laser', 3000, 'gesamt'), minuten: 120 },
    { ...neueZeit('prozess', 'Entgraten', 6500, 'gesamt'), minuten: 15 },
  ];
  const r = berechne(c);
  assert.equal(r.material.ekCent, 3000);
  assert.equal(r.material.aufschlagCent, 750);
  assert.equal(r.material.vkCent, 3750);
  assert.equal(r.zeitenSummeCent, 1167 + 6000 + 1625);
  assert.equal(r.kalkulationCent, 12542);      // 125,42 €
  assert.equal(r.vkNettoCent, 12542);
  assert.equal(r.vkProStueckCent, 1254);       // 12,54 €
});

test('Summe der Detailpositionen entspricht exakt dem Kalkulationspreis', () => {
  const c = basis({ stueckzahl: 7 });
  c.verbrauch = { methode: 'rechteck', laengeMm: 333, breiteMm: 177, proStueck: true };
  c.verschnittBp = 1234;
  c.materialAufschlagBp = 1750;
  c.zeiten = [
    { ...neueZeit('cad', 'CAD', 7000, 'einmalig'), minuten: 13 },
    { ...neueZeit('laser', 'Laser', 3000, 'proStueck'), minuten: 3.7 },
    { ...neueZeit('bediener', 'Rüsten', 6500, 'einmalig'), minuten: 11 },
  ];
  c.gas = { modus: 'proStunde', preisCent: 900, name: 'N2' };
  c.zusatz = [{ bezeichnung: 'Verzinken', menge: 1, einheit: 'Pos', einzelpreisCent: 4550, modus: 'einmalig' }];
  const r = berechne(c);
  const summe = r.positionen.reduce((a, p) => a + p.cent, 0);
  assert.equal(summe, r.kalkulationCent, 'Detailaufstellung und Summe müssen übereinstimmen');
});

test('§28: einmalige Kosten skalieren nicht mit der Stückzahl', () => {
  const mk = (n) => {
    const c = basis({ stueckzahl: n });
    c.verbrauch = { methode: 'kosten', kostenCent: 1000, proStueck: true };
    c.materialAufschlagBp = 0;
    c.zeiten = [
      { ...neueZeit('cad', 'CAD', 6000, 'einmalig'), minuten: 60 },      // 60,00 € einmalig
      { ...neueZeit('laser', 'Laser', 6000, 'proStueck'), minuten: 60 }, // 60,00 € je Stück
    ];
    return berechne(c);
  };
  const r1 = mk(1), r10 = mk(10);
  assert.equal(r1.vkNettoCent, 1000 + 6000 + 6000);
  assert.equal(r10.vkNettoCent, 10000 + 6000 + 60000);
  // Stückpreis muss durch die Verteilung der Einmalkosten sinken:
  assert.ok(r10.vkProStueckCent < r1.vkProStueckCent);
  assert.equal(r10.vkProStueckCent, Math.round(76000 / 10));
});

test('§28: Modus "Gesamtzeit" wird nicht mit der Stückzahl multipliziert', () => {
  const c = basis({ stueckzahl: 20 });
  c.verbrauch = { methode: 'kosten', kostenCent: 0, proStueck: false };
  c.zeiten = [{ ...neueZeit('laser', 'Laser', 3000, 'gesamt'), minuten: 100 }];
  const r = berechne(c);
  assert.equal(r.laserMinutenGesamt, 100);
  assert.equal(r.vkNettoCent, 5000);
});

test('Material: alle Verbrauchsmethoden liefern konsistente Kosten', () => {
  // 1 m² Blech, 2 mm, 7850 kg/m³ -> 15,7 kg/m², 10,00 €/m², 0,51 €/kg, 312,50 €/Tafel
  const flaeche = (methode, v) => {
    const c = basis({ stueckzahl: 1 });
    c.materialAufschlagBp = 0;
    c.verbrauch = { methode, proStueck: true, ...v };
    return berechne(c);
  };
  assert.equal(flaeche('flaeche', { flaecheM2: 1 }).material.ekCent, 1000);
  assert.equal(flaeche('rechteck', { laengeMm: 1000, breiteMm: 1000 }).material.ekCent, 1000);
  const g = flaeche('gewicht', { gewichtKg: 15.7 });
  assert.equal(g.material.ekCent, Math.round(15.7 * 51));
  const t = flaeche('tafeln', { tafeln: 2, proStueck: false });
  assert.equal(t.material.ekCent, 62500);
  const k = flaeche('kosten', { kostenCent: 4321, proStueck: false });
  assert.equal(k.material.ekCent, 4321);
});

test('Verschnitt und Materialaufschlag werden in der richtigen Reihenfolge gerechnet', () => {
  const c = basis({ stueckzahl: 1 });
  c.verbrauch = { methode: 'kosten', kostenCent: 10000, proStueck: false };
  c.verschnittBp = 1000;          // 10 %
  c.materialAufschlagBp = 2500;   // 25 %
  const r = berechne(c);
  assert.equal(r.material.ekCent, 10000);
  assert.equal(r.material.verschnittCent, 1000);
  assert.equal(r.material.nachVerschnittCent, 11000);
  assert.equal(r.material.aufschlagCent, 2750);   // 25 % auf 110,00 €
  assert.equal(r.material.vkCent, 13750);
});

test('§26: Gewinnaufschlag an/aus', () => {
  const c = basis({ stueckzahl: 1 });
  c.verbrauch = { methode: 'kosten', kostenCent: 10000, proStueck: false };
  c.materialAufschlagBp = 0;
  const ohne = berechne(c);
  assert.equal(ohne.vkNettoCent, 10000);
  assert.equal(ohne.gewinnCent, 0);

  c.gewinnAktiv = true; c.gewinnBp = 1500;
  const mit = berechne(c);
  assert.equal(mit.gewinnCent, 1500);
  assert.equal(mit.vkNettoCent, 11500);
});

test('§27: Mindestauftragswert hebt den Preis an, aber nie ab', () => {
  const c = basis({ stueckzahl: 1 });
  c.verbrauch = { methode: 'kosten', kostenCent: 1872, proStueck: false };
  c.materialAufschlagBp = 0;
  c.mindestwertAktiv = true; c.mindestwertCent = 3000;
  const r = berechne(c);
  assert.equal(r.vkVorMindestCent, 1872);
  assert.equal(r.mindestwertAngewendet, true);
  assert.equal(r.vkNettoCent, 3000);

  c.verbrauch.kostenCent = 5000;
  const r2 = berechne(c);
  assert.equal(r2.mindestwertAngewendet, false);
  assert.equal(r2.vkNettoCent, 5000);
});

test('MwSt. und Bruttopreis', () => {
  const c = basis({ stueckzahl: 4 });
  c.verbrauch = { methode: 'kosten', kostenCent: 10000, proStueck: false };
  c.materialAufschlagBp = 0;
  c.mwstBp = 2000;
  const r = berechne(c);
  assert.equal(r.mwstCent, 2000);
  assert.equal(r.vkBruttoCent, 12000);
  assert.equal(r.vkProStueckCent, 2500);
});

test('§23: Gasabrechnung in allen Varianten', () => {
  const mk = (gas) => {
    const c = basis({ stueckzahl: 5 });
    c.verbrauch = { methode: 'kosten', kostenCent: 0, proStueck: false };
    c.zeiten = [{ ...neueZeit('laser', 'Laser', 0, 'proStueck'), minuten: 12 }]; // 60 min gesamt
    c.gas = gas;
    return berechne(c);
  };
  assert.equal(mk({ modus: 'inklusive', preisCent: 900 }).gas.kostenCent, 0);
  assert.equal(mk({ modus: 'proStunde', preisCent: 900 }).gas.kostenCent, 900);
  assert.equal(mk({ modus: 'proMinute', preisCent: 15 }).gas.kostenCent, 900);
  assert.equal(mk({ modus: 'pauschal', preisCent: 500 }).gas.kostenCent, 500);
  assert.equal(mk({ modus: 'pauschal', preisCent: 500, proStueck: true }).gas.kostenCent, 2500);
});

test('§14: DXF-Flächenbasis wird respektiert', () => {
  const c = basis({ stueckzahl: 1 });
  c.verbrauch = { methode: 'dxf', proStueck: true };
  c.materialAufschlagBp = 0;
  c.dxf = { nettoFlaecheM2: 0.05, bboxFlaecheM2: 0.054, manuelleFlaecheM2: 0.08, flaechenBasis: 'netto' };
  assert.equal(dxfFlaecheM2(c), 0.05);
  assert.equal(berechne(c).material.ekCent, 50);
  c.dxf.flaechenBasis = 'bbox';
  assert.equal(berechne(c).material.ekCent, 54);
  c.dxf.flaechenBasis = 'manuell';
  assert.equal(berechne(c).material.ekCent, 80);
  c.dxf.flaechenBasis = 'tafel';
  assert.equal(berechne(c).material.ekCent, Math.round(2500 * 1250 / 1e6 * 1000));
});

test('§41: Validierung fängt ungültige Eingaben ab', () => {
  const c = basis({ stueckzahl: 0 });
  assert.ok(pruefeKalkulation(c).fehler.some(f => /Stückzahl/.test(f)));

  const c2 = basis({ stueckzahl: 5 });
  c2.zeiten = [{ ...neueZeit('laser', 'Laser', 3000, 'proStueck'), minuten: -3 }];
  assert.ok(pruefeKalkulation(c2).fehler.some(f => /Negative Zeit/.test(f)));

  const c3 = basis({ stueckzahl: 5 });
  c3.verbrauch = { methode: 'rechteck', laengeMm: -1, breiteMm: 10, proStueck: true };
  assert.ok(pruefeKalkulation(c3).fehler.some(f => /negativ/.test(f)));

  const c4 = basis({ stueckzahl: 5 });
  c4.dxf = { einheitUnsicher: true, einheitBestaetigt: false };
  assert.ok(pruefeKalkulation(c4).fehler.some(f => /Einheit/.test(f)));

  const c5 = basis({ stueckzahl: 5 });
  c5.verbrauch = { methode: 'rechteck', laengeMm: 3000, breiteMm: 1400, proStueck: true };
  assert.ok(pruefeKalkulation(c5).hinweise.some(t => /größer als eine Tafel/.test(t)));
});

test('Preisstaffel: Stückpreis sinkt bei einmaligen Kosten monoton', () => {
  const c = basis({ stueckzahl: 1 });
  c.verbrauch = { methode: 'kosten', kostenCent: 500, proStueck: true };
  c.zeiten = [
    { ...neueZeit('cad', 'CAD', 7000, 'einmalig'), minuten: 30 },
    { ...neueZeit('laser', 'Laser', 3000, 'proStueck'), minuten: 2 },
  ];
  const st = staffel(c, [1, 10, 100]);
  assert.ok(st[0].proStueckCent > st[1].proStueckCent);
  assert.ok(st[1].proStueckCent > st[2].proStueckCent);
});

test('Fehlender Materialpreis führt zu 0 € und einer klaren Warnung', () => {
  const c = basis({ stueckzahl: 1 });
  c.material = musterMaterial({ preisProM2Cent: 0, ekProKgCent: 0, ekTafelCent: 0 });
  c.verbrauch = { methode: 'flaeche', flaecheM2: 1, proStueck: true };
  const r = berechne(c);
  assert.equal(r.material.ekCent, 0);
  assert.ok(r.warnungen.some(w => /kein Preis je m²/.test(w)));
});

test('Berechnung ist reproduzierbar', () => {
  const c = basis({ stueckzahl: 13 });
  c.verbrauch = { methode: 'rechteck', laengeMm: 412.7, breiteMm: 233.9, proStueck: true };
  c.verschnittBp = 875; c.materialAufschlagBp = 2333; c.gewinnAktiv = true; c.gewinnBp = 1500;
  const a = berechne(c), b = berechne(JSON.parse(JSON.stringify(c)));
  assert.deepEqual(a.vkNettoCent, b.vkNettoCent);
  assert.deepEqual(a.positionen, b.positionen);
});
