import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analysiereDxf, signedArea, pathLength, pointInPolygon, interiorPoint,
  gewichtKg, laserzeitMin,
} from '../www/js/dxf/analyze.js';
import { parseDxf, tokenize, einheitBestimmen, DxfFehler } from '../www/js/dxf/parser.js';
import { bulgePunkte, segmenteFuerBogen } from '../www/js/dxf/geometry.js';
import { dxfBauen, rechteckMitLoechern } from './helper.js';

const nahe = (a, b, tol, was = '') =>
  assert.ok(Math.abs(a - b) <= tol, `${was}: ${a} statt ${b} (Toleranz ${tol})`);

/** Kopf mit Einheit mm. */
function kopfMm(p) {
  p(0, 'SECTION'); p(2, 'HEADER'); p(9, '$INSUNITS'); p(70, 4); p(0, 'ENDSEC');
}

test('Polygon-Grundfunktionen', () => {
  const quadrat = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(signedArea(quadrat), 100);
  assert.equal(signedArea([...quadrat].reverse()), -100);
  assert.equal(pathLength(quadrat, true), 40);
  assert.equal(pathLength(quadrat, false), 30);
  assert.ok(pointInPolygon([5, 5], quadrat));
  assert.ok(!pointInPolygon([15, 5], quadrat));
});

test('interiorPoint liegt auch bei konkaven Formen innerhalb', () => {
  // U-Form: der Schwerpunkt laege im Ausschnitt, also ausserhalb des Polygons.
  const u = [[0, 0], [30, 0], [30, 30], [20, 30], [20, 10], [10, 10], [10, 30], [0, 30]];
  const p = interiorPoint(u);
  assert.ok(pointInPolygon(p, u), `Punkt ${p} muss innen liegen`);
});

test('Bulge: Halbkreis wird korrekt aufgeloest', () => {
  const pts = bulgePunkte([0, 0], [20, 0], 1, 0.005);
  const laenge = pathLength([[0, 0], ...pts], false);
  nahe(laenge, Math.PI * 10, 0.02, 'Halbkreisbogen');
  assert.ok(segmenteFuerBogen(10, Math.PI, 0.005) > 40);
});

test('Rechteck mit 8 Loechern: Flaeche, Schnittlaenge, Konturen', () => {
  const loecher = Array.from({ length: 8 }, (_, i) => [30 + i * 30, 90, 5]);
  const r = analysiereDxf(rechteckMitLoechern({ breite: 300, hoehe: 180, loecher }), {});

  assert.equal(r.ok, true);
  nahe(r.breiteMm, 300, 0.01, 'Breite');
  nahe(r.hoeheMm, 180, 0.01, 'Hoehe');
  nahe(r.nettoFlaecheMm2, 300 * 180 - 8 * Math.PI * 25, 2, 'Nettoflaeche');
  nahe(r.laengeAussenMm, 960, 0.01, 'Aussenkontur');
  nahe(r.laengeInnenMm, 8 * Math.PI * 10, 0.5, 'Innenkonturen');
  nahe(r.schnittlaengeMm, 960 + 8 * Math.PI * 10, 0.5, 'Gesamtschnittlaenge');
  assert.equal(r.konturenAnzahl, 9);
  assert.equal(r.loecherAnzahl, 8);
  assert.equal(r.einstiche, 9);
  assert.equal(r.offeneKonturenAnzahl, 0);
  assert.equal(r.warnungen.length, 0);
  assert.equal(r.bauteile.length, 1);
  assert.equal(r.bauteile[0].loecher, 8);
});

test('Offene Konturen werden erkannt und gemeldet', () => {
  const txt = dxfBauen(p => {
    kopfMm(p);
    p(0, 'SECTION'); p(2, 'ENTITIES');
    for (const [x1, y1, x2, y2] of [[0, 0, 100, 0], [100, 0, 100, 50], [100, 50, 0, 50]]) {
      p(0, 'LINE'); p(10, x1); p(20, y1); p(11, x2); p(21, y2);
    }
    p(0, 'ENDSEC'); p(0, 'EOF');
  });
  const r = analysiereDxf(txt, {});
  assert.equal(r.offeneKonturenAnzahl, 1);
  assert.equal(r.konturenAnzahl, 0);
  assert.equal(r.flaecheUnsicher, true);
  assert.ok(r.warnungen.some(w => /offene Kontur/.test(w)));
  assert.ok(r.warnungen.some(w => /Bounding Box/.test(w)));
});

test('Einzelne Linien werden zu einer geschlossenen Kontur verkettet', () => {
  const txt = dxfBauen(p => {
    kopfMm(p);
    p(0, 'SECTION'); p(2, 'ENTITIES');
    for (const [x1, y1, x2, y2] of [[0, 0, 100, 0], [100, 0, 100, 50], [100, 50, 0, 50], [0, 50, 0, 0]]) {
      p(0, 'LINE'); p(10, x1); p(20, y1); p(11, x2); p(21, y2);
    }
    p(0, 'ENDSEC'); p(0, 'EOF');
  });
  const r = analysiereDxf(txt, {});
  assert.equal(r.konturenAnzahl, 1);
  assert.equal(r.nettoFlaecheMm2, 5000);
  assert.equal(r.offeneKonturenAnzahl, 0);
});

test('Eine doppelte Linie zerstoert den Konturschluss nicht, wird aber gemeldet', () => {
  const txt = dxfBauen(p => {
    kopfMm(p);
    p(0, 'SECTION'); p(2, 'ENTITIES');
    const seg = [[0, 0, 100, 0], [100, 0, 100, 50], [100, 50, 0, 50], [0, 50, 0, 0], [0, 0, 100, 0]];
    for (const [x1, y1, x2, y2] of seg) { p(0, 'LINE'); p(10, x1); p(20, y1); p(11, x2); p(21, y2); }
    p(0, 'ENDSEC'); p(0, 'EOF');
  });
  const r = analysiereDxf(txt, {});
  assert.equal(r.konturenAnzahl, 1);
  assert.equal(r.nettoFlaecheMm2, 5000);
  assert.equal(r.pruefung.doppelt, 1);
  assert.ok(r.warnungen.some(w => /doppelte Linien/.test(w)));
});

test('Insel im Loch wird wieder addiert', () => {
  const txt = dxfBauen(p => {
    kopfMm(p);
    p(0, 'SECTION'); p(2, 'ENTITIES');
    for (const r of [50, 30, 10]) { p(0, 'CIRCLE'); p(10, 0); p(20, 0); p(40, r); }
    p(0, 'ENDSEC'); p(0, 'EOF');
  });
  const r = analysiereDxf(txt, {});
  nahe(r.nettoFlaecheMm2, Math.PI * (2500 - 900 + 100), 2, 'Ring mit Insel');
  assert.deepEqual(r.konturen.map(k => k.rolle), ['aussen', 'loch', 'insel']);
});

test('Mehrere getrennte Bauteile werden erkannt', () => {
  const txt = dxfBauen(p => {
    kopfMm(p);
    p(0, 'SECTION'); p(2, 'ENTITIES');
    for (const dx of [0, 200, 400]) {
      p(0, 'LWPOLYLINE'); p(90, 4); p(70, 1);
      for (const [x, y] of [[dx, 0], [dx + 100, 0], [dx + 100, 60], [dx, 60]]) { p(10, x); p(20, y); }
    }
    p(0, 'CIRCLE'); p(10, 50); p(20, 30); p(40, 10);
    p(0, 'ENDSEC'); p(0, 'EOF');
  });
  const r = analysiereDxf(txt, {});
  assert.equal(r.bauteile.length, 3);
  assert.equal(r.bauteile.reduce((a, b) => a + b.loecher, 0), 1);
  nahe(r.breiteMm, 500, 0.01, 'Gesamtbreite');
});

test('Einheiten: mm, Zoll, cm und der unsichere Fall', () => {
  const mm = analysiereDxf(rechteckMitLoechern({ breite: 100, hoehe: 50, insunits: 4 }), {});
  assert.equal(mm.einheit, 'mm');
  assert.equal(mm.einheitUnsicher, false);

  const zoll = analysiereDxf(rechteckMitLoechern({ breite: 10, hoehe: 4, insunits: 1 }), {});
  assert.equal(zoll.einheit, 'inch');
  nahe(zoll.breiteMm, 254, 0.01, 'Zoll nach mm');
  nahe(zoll.hoeheMm, 101.6, 0.01, 'Zoll nach mm');

  const ohne = analysiereDxf(rechteckMitLoechern({ breite: 100, hoehe: 50, insunits: null }), { standardEinheit: 'mm' });
  assert.equal(ohne.einheitUnsicher, true);
  assert.ok(ohne.warnungen.some(w => /Einheit/.test(w)));

  const erzwungen = analysiereDxf(rechteckMitLoechern({ breite: 10, hoehe: 4, insunits: null }), { einheit: 'cm' });
  assert.equal(erzwungen.einheitUnsicher, false);
  nahe(erzwungen.breiteMm, 100, 0.01, 'cm nach mm');
});

test('einheitBestimmen liest INSUNITS und MEASUREMENT', () => {
  assert.equal(einheitBestimmen({ $INSUNITS: { value: 4 } }).einheit, 'mm');
  assert.equal(einheitBestimmen({ $INSUNITS: { value: 6 } }).faktor, 1000);
  const m = einheitBestimmen({ $MEASUREMENT: { value: 0 } }, 'mm');
  assert.equal(m.einheit, 'inch');
  assert.equal(m.sicher, false);
});

test('Blockreferenzen werden mit Verschiebung, Drehung und Skalierung aufgeloest', () => {
  const txt = dxfBauen(p => {
    kopfMm(p);
    p(0, 'SECTION'); p(2, 'BLOCKS');
    p(0, 'BLOCK'); p(2, 'TEIL'); p(10, 0); p(20, 0);
    p(0, 'LWPOLYLINE'); p(90, 4); p(70, 1);
    for (const [x, y] of [[0, 0], [40, 0], [40, 20], [0, 20]]) { p(10, x); p(20, y); }
    p(0, 'ENDBLK');
    p(0, 'ENDSEC');
    p(0, 'SECTION'); p(2, 'ENTITIES');
    p(0, 'INSERT'); p(2, 'TEIL'); p(10, 100); p(20, 100); p(41, 2); p(42, 2); p(50, 90);
    p(0, 'ENDSEC'); p(0, 'EOF');
  });
  const r = analysiereDxf(txt, {});
  assert.equal(r.konturenAnzahl, 1);
  nahe(r.nettoFlaecheMm2, 40 * 20 * 4, 0.1, 'Flaeche nach Skalierung mal 2');
  nahe(r.breiteMm, 40, 0.01, 'nach 90 Grad Drehung ist die Breite die alte Hoehe');
  nahe(r.hoeheMm, 80, 0.01, 'nach 90 Grad Drehung');
});

test('Text, Bemassung und DEFPOINTS werden ignoriert', () => {
  const txt = dxfBauen(p => {
    kopfMm(p);
    p(0, 'SECTION'); p(2, 'ENTITIES');
    p(0, 'LWPOLYLINE'); p(90, 4); p(70, 1);
    for (const [x, y] of [[0, 0], [100, 0], [100, 50], [0, 50]]) { p(10, x); p(20, y); }
    p(0, 'TEXT'); p(8, 'BESCHRIFTUNG'); p(10, 10); p(20, 10); p(40, 5); p(1, 'Pos 1');
    p(0, 'DIMENSION'); p(8, 'MASSE'); p(10, 0); p(20, 0);
    p(0, 'LINE'); p(8, 'DEFPOINTS'); p(10, -500); p(20, -500); p(11, 500); p(21, 500);
    p(0, 'ENDSEC'); p(0, 'EOF');
  });
  const r = analysiereDxf(txt, {});
  assert.equal(r.konturenAnzahl, 1);
  assert.equal(r.nettoFlaecheMm2, 5000);
  nahe(r.breiteMm, 100, 0.01, 'DEFPOINTS darf die Bounding Box nicht aufblaehen');
  assert.ok(r.meldungen.some(m => /Bemassungsobjekt|Bema/.test(m)));
});

test('Extrem kurze Segmente werden gemeldet', () => {
  const txt = dxfBauen(p => {
    kopfMm(p);
    p(0, 'SECTION'); p(2, 'ENTITIES');
    p(0, 'LWPOLYLINE'); p(90, 5); p(70, 1);
    for (const [x, y] of [[0, 0], [100, 0], [100.01, 0.01], [100, 50], [0, 50]]) { p(10, x); p(20, y); }
    p(0, 'ENDSEC'); p(0, 'EOF');
  });
  const r = analysiereDxf(txt, { minSegmentMm: 0.05 });
  assert.ok(r.pruefung.kurz >= 1);
  assert.ok(r.warnungen.some(w => /kurze Segmente/.test(w)));
});

test('Fehlerhafte Dateien werden klar abgelehnt statt falsch interpretiert', () => {
  assert.throws(() => tokenize('AutoCAD Binary DXF  '), DxfFehler);
  assert.throws(() => tokenize('das ist\nkeine dxf\ndatei\nhier'), DxfFehler);
  assert.throws(() => tokenize(''), DxfFehler);
  const leer = analysiereDxf(dxfBauen(p => { p(0, 'SECTION'); p(2, 'ENTITIES'); p(0, 'ENDSEC'); p(0, 'EOF'); }), {});
  assert.equal(leer.ok, false);
  assert.ok(leer.warnungen.some(w => /keine auswertbare Geometrie/.test(w)));
});

test('SPLINE wird ausgewertet', () => {
  const txt = dxfBauen(p => {
    kopfMm(p);
    p(0, 'SECTION'); p(2, 'ENTITIES');
    p(0, 'SPLINE'); p(70, 8); p(71, 3); p(72, 8); p(73, 4);
    for (const k of [0, 0, 0, 0, 1, 1, 1, 1]) p(40, k);
    for (const [x, y] of [[0, 0], [0, 60], [80, 60], [80, 0]]) { p(10, x); p(20, y); }
    p(0, 'LINE'); p(10, 80); p(20, 0); p(11, 0); p(21, 0);
    p(0, 'ENDSEC'); p(0, 'EOF');
  });
  const r = analysiereDxf(txt, {});
  assert.equal(r.konturenAnzahl, 1, 'Spline und Schlusslinie ergeben eine geschlossene Kontur');
  assert.ok(r.nettoFlaecheMm2 > 2000 && r.nettoFlaecheMm2 < 4800, `Flaeche plausibel: ${r.nettoFlaecheMm2}`);
});

test('Gewicht aus Flaeche, Staerke und Dichte', () => {
  // 1 m2 x 2 mm x 7850 kg/m3 = 15,7 kg
  nahe(gewichtKg(1, 2, 7850), 15.7, 1e-9, 'Stahl 2 mm');
  nahe(gewichtKg(0.5, 3, 2700), 4.05, 1e-9, 'Aluminium 3 mm');
  assert.equal(gewichtKg(0, 2, 7850), 0);
  assert.equal(gewichtKg(1, 0, 7850), 0);
});

test('Laserzeit aus Schnittlaenge, Einstichen und Nebenzeit', () => {
  const min = laserzeitMin({
    schnittlaengeMm: 2790, einstiche: 9, vSchnittMmMin: 8000, piercingSek: 0.3, nebenzeitSek: 20,
  });
  const erwartet = 2790 / 8000 + (9 * 0.3) / 60 + 20 / 60;
  assert.ok(Math.abs(min - erwartet) < 1e-9);
  assert.equal(
    laserzeitMin({ schnittlaengeMm: 100, einstiche: 1, vSchnittMmMin: 0, piercingSek: 1 }), null,
    'ohne Schnittgeschwindigkeit wird nicht geraten');
});

test('parseDxf liefert Kopfdaten, Bloecke und Entitaeten getrennt', () => {
  const p = parseDxf(rechteckMitLoechern({ loecher: [[50, 50, 5]] }));
  assert.equal(p.header.$INSUNITS.value, 4);
  assert.equal(p.entities.length, 2);
  assert.equal(p.entities[0].type, 'LWPOLYLINE');
  assert.equal(p.entities[1].type, 'CIRCLE');
  assert.equal(p.entities[0].layer, 'SCHNITT');
});
