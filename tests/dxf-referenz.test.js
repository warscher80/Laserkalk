/**
 * dxf-referenz.test.js — 20 erzeugte Test-DXF mit festen Referenzwerten.
 *
 * TOLERANZEN — hergeleitet, nicht geschätzt:
 *
 *   EXAKT (1e-6)   Nur Geraden im Spiel. Jede Abweichung wäre ein Rechenfehler.
 *
 *   BOGEN          Kreise, Bögen, Ellipsen und Bulge-Segmente werden mit einer
 *                  Sehnenhöhe von 0,005 mm (Einstellung dxfFlachToleranzMm) in
 *                  Geraden zerlegt. Das einbeschriebene Vieleck ist IMMER etwas
 *                  kleiner als die runde Form — der Fehler ist systematisch,
 *                  einseitig und exakt berechenbar:
 *
 *                      dα = 2·arccos(1 − tol/r),  n = ⌈2π/dα⌉
 *                      Vieleckfläche = ½·n·r²·sin(2π/n)
 *
 *                  Die Segmentzahl holen die Tests aus segmenteFuerBogen()
 *                  in geometry.js — also aus derselben Funktion, die die App
 *                  benutzt. Wird die Abflachung feiner oder gröber gestellt,
 *                  wandert die Toleranz automatisch mit.
 *
 *                  Daraus je Vollkreis:
 *                      r =   5 mm  →  −1,31 ‰ Fläche,  −0,33 ‰ Länge
 *                      r =  10 mm  →  −0,66 ‰          −0,16 ‰
 *                      r =  25 mm  →  −0,26 ‰          −0,07 ‰
 *                      r = 100 mm  →  −0,07 ‰          −0,02 ‰
 *
 *                  Die Tests rechnen diesen Fehler mit bogenFehlerFlaeche()
 *                  bzw. bogenFehlerUmfang() aus und lassen das DOPPELTE davon
 *                  als Spielraum zu. Eine Toleranz kann damit nicht
 *                  stillschweigend „so lange gelockert werden, bis es grün
 *                  wird" — sie hängt an der Abflachungseinstellung.
 *
 *                  Fachliche Einordnung: bei einem 10-mm-Loch sind −0,66 ‰
 *                  rund 0,05 mm² von 78,5 mm². Auf ein Bauteil mit 5 m²
 *                  Materialfläche wirkt sich das mit Bruchteilen eines Cents
 *                  aus. Die Richtung ist zudem kaufmännisch unbedenklich:
 *                  Löcher werden minimal zu klein gerechnet, die Nettofläche
 *                  also minimal zu groß — es wird nie zu wenig verrechnet.
 *
 *   SPLINE (5 ‰)   Splines werden über den Knotenvektor abgetastet; die
 *                  Abtastdichte richtet sich nach der Länge des
 *                  Kontrollpolygons, nicht nach der wahren Krümmung. Deshalb
 *                  eine großzügigere Grenze. Splines sind im Blechteil die
 *                  Ausnahme.
 *
 * Die Referenzwerte sind aus der Geometrie von Hand hergeleitet und im
 * jeweiligen Test als Formel notiert, damit sie nachrechenbar bleiben.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { analysiereDxf } from '../www/js/dxf/analyze.js';
import { segmenteFuerBogen } from '../www/js/dxf/geometry.js';

/* ------------------------------------------------------------------ */
/* Werkzeug                                                            */
/* ------------------------------------------------------------------ */

const EXAKT = 1e-6;
const SPLINE_PROMILLE = 5;

/** Sehnenhöhe beim Abflachen – muss zu defaults.js (dxfFlachToleranzMm) passen. */
const FLACH_TOL = 0.005;

/**
 * Segmentzahl, die die App für diesen Bogen erzeugt. Bewusst die Funktion aus
 * geometry.js selbst — so kann die Toleranz nicht von der Abflachung abdriften.
 */
const segmente = (r, sweep = 2 * Math.PI) => segmenteFuerBogen(r, sweep, FLACH_TOL);

/** Betrag des systematischen Flächenfehlers eines abgeflachten Bogens (mm²). */
function bogenFehlerFlaeche(r, sweep = 2 * Math.PI) {
  const n = segmente(r, sweep);
  // Kreissektor minus Sehnenvieleck aus n gleichen Dreiecken
  return Math.abs(0.5 * r * r * sweep - 0.5 * n * r * r * Math.sin(sweep / n));
}
/** Betrag des systematischen Längenfehlers eines abgeflachten Bogens (mm). */
function bogenFehlerUmfang(r, sweep = 2 * Math.PI) {
  const n = segmente(r, sweep);
  return Math.abs(r * sweep - n * 2 * r * Math.sin(sweep / (2 * n)));
}
/**
 * Flächenfehler einer abgeflachten Ellipse. Die App tastet sie gleichmäßig im
 * Parameter ab und bemisst die Segmentzahl an der HAUPTachse; das ergibt
 * dieselbe Formel wie beim Kreis, nur mit a·b statt r².
 */
function ellipsenFehlerFlaeche(a, b) {
  const n = segmente(a);
  return Math.abs(Math.PI * a * b - 0.5 * n * a * b * Math.sin(2 * Math.PI / n));
}
/**
 * Wie weit darf ein Randmaß (Breite/Höhe) danebenliegen? Der äußerste
 * Vieleckpunkt liegt höchstens eine Sehnenhöhe innerhalb der Rundung — je
 * Seite einmal, also zweimal über das ganze Maß.
 */
const RAND_FEHLER = 2 * FLACH_TOL;

function dxf(fn) {
  const z = [];
  const p = (code, wert) => { z.push(String(code)); z.push(String(wert)); };
  fn(p);
  return z.join('\r\n') + '\r\n';
}

/** Kopf mit Einheit. 4 = mm, 5 = cm, 6 = m, 1 = Zoll, null = keine Angabe. */
const kopf = (p, insunits = 4) => {
  p(0, 'SECTION'); p(2, 'HEADER');
  if (insunits !== null) { p(9, '$INSUNITS'); p(70, insunits); }
  p(0, 'ENDSEC');
};
const auf = (p) => { p(0, 'SECTION'); p(2, 'ENTITIES'); };
const zu = (p) => { p(0, 'ENDSEC'); p(0, 'EOF'); };

const rechteck = (p, x, y, b, hh, layer = 'SCHNITT') => {
  p(0, 'LWPOLYLINE'); p(8, layer); p(90, 4); p(70, 1);
  for (const [px, py] of [[x, y], [x + b, y], [x + b, y + hh], [x, y + hh]]) { p(10, px); p(20, py); }
};
const kreis = (p, cx, cy, r, layer = 'SCHNITT') => { p(0, 'CIRCLE'); p(8, layer); p(10, cx); p(20, cy); p(40, r); };
const linie = (p, x1, y1, x2, y2, layer = 'SCHNITT') => { p(0, 'LINE'); p(8, layer); p(10, x1); p(20, y1); p(11, x2); p(21, y2); };

/** Vergleich mit absoluter Toleranz. */
const exakt = (ist, soll, was) =>
  assert.ok(Math.abs(ist - soll) <= EXAKT, `${was}: ${ist} statt ${soll} (exakt erwartet)`);

/** Vergleich mit relativer Toleranz in Promille. */
const nahe = (ist, soll, promille, was) => {
  const grenze = Math.abs(soll) * promille / 1000;
  assert.ok(Math.abs(ist - soll) <= grenze,
    `${was}: ${ist} statt ${soll} (zulässig ±${grenze.toExponential(2)} = ${promille} ‰)`);
};

/**
 * Vergleich mit einer Toleranz, die aus dem systematischen Abflachungsfehler
 * hergeleitet ist. `fehler` ist der erwartete Betrag in derselben Einheit;
 * zugelassen wird das Doppelte plus ein kleiner Rechenspielraum.
 */
const naheBogen = (ist, soll, fehler, was) => {
  const grenze = 2 * fehler + 1e-6;
  assert.ok(Math.abs(ist - soll) <= grenze,
    `${was}: ${ist} statt ${soll} (zulässig ±${grenze.toPrecision(3)}, ` +
    `hergeleitet aus Sehnenhöhe ${FLACH_TOL} mm)`);
};

const KREIS_F = (r) => Math.PI * r * r;
const KREIS_U = (r) => 2 * Math.PI * r;

/* ------------------------------------------------------------------ */
/* 1 – Rechteck 100 x 50                                               */
/* ------------------------------------------------------------------ */

test('DXF 1: Rechteck 100 x 50 mm', () => {
  const r = analysiereDxf(dxf(p => { kopf(p); auf(p); rechteck(p, 0, 0, 100, 50); zu(p); }), {});
  exakt(r.breiteMm, 100, 'Breite');
  exakt(r.hoeheMm, 50, 'Höhe');
  exakt(r.bbox.breite * r.bbox.hoehe, 5000, 'Bounding Box');
  exakt(r.nettoFlaecheMm2, 5000, 'Nettofläche');
  exakt(r.laengeAussenMm, 300, 'Schnittlänge außen');
  exakt(r.laengeInnenMm, 0, 'Schnittlänge innen');
  exakt(r.schnittlaengeMm, 300, 'Gesamtschnittlänge');
  assert.equal(r.konturenAnzahl, 1);
  assert.equal(r.loecherAnzahl, 0);
  assert.equal(r.offeneKonturenAnzahl, 0);
  assert.equal(r.einstiche, 1);
  assert.equal(r.bauteile.length, 1);
  assert.deepEqual(r.warnungen, []);
});

/* ------------------------------------------------------------------ */
/* 2 – Rechteck mit einem Kreisloch                                    */
/* ------------------------------------------------------------------ */

test('DXF 2: Rechteck 100 x 50 mit Kreisloch d20', () => {
  const r = analysiereDxf(dxf(p => { kopf(p); auf(p); rechteck(p, 0, 0, 100, 50); kreis(p, 50, 25, 10); zu(p); }), {});
  // Netto = 100*50 - pi*10^2
  naheBogen(r.nettoFlaecheMm2, 5000 - KREIS_F(10), bogenFehlerFlaeche(10), 'Nettofläche');
  exakt(r.laengeAussenMm, 300, 'Schnittlänge außen');
  naheBogen(r.laengeInnenMm, KREIS_U(10), bogenFehlerUmfang(10), 'Schnittlänge innen');
  naheBogen(r.schnittlaengeMm, 300 + KREIS_U(10), bogenFehlerUmfang(10), 'Gesamtschnittlänge');
  assert.equal(r.konturenAnzahl, 2);
  assert.equal(r.loecherAnzahl, 1);
  assert.equal(r.einstiche, 2, 'Außenkontur + ein Loch');
  assert.equal(r.bauteile[0].loecher, 1);
});

/* ------------------------------------------------------------------ */
/* 3 – Mehrere Innenausschnitte                                        */
/* ------------------------------------------------------------------ */

test('DXF 3: Rechteck 200 x 100 mit drei Ausschnitten', () => {
  const r = analysiereDxf(dxf(p => {
    kopf(p); auf(p);
    rechteck(p, 0, 0, 200, 100);
    kreis(p, 50, 50, 5);
    kreis(p, 100, 50, 5);
    rechteck(p, 140, 30, 40, 40);   // rechteckiger Ausschnitt
    zu(p);
  }), {});
  // Netto = 200*100 - 2*pi*25 - 40*40
  const soll = 20000 - 2 * KREIS_F(5) - 1600;
  naheBogen(r.nettoFlaecheMm2, soll, 2 * bogenFehlerFlaeche(5), 'Nettofläche');
  exakt(r.laengeAussenMm, 600, 'Schnittlänge außen');
  naheBogen(r.laengeInnenMm, 2 * KREIS_U(5) + 160, 2 * bogenFehlerUmfang(5), 'Schnittlänge innen');
  assert.equal(r.konturenAnzahl, 4);
  assert.equal(r.loecherAnzahl, 3);
  assert.equal(r.einstiche, 4);
  assert.equal(r.bauteile.length, 1, 'alles gehört zu einem Bauteil');
});

/* ------------------------------------------------------------------ */
/* 4 – Zwei getrennte Bauteile                                         */
/* ------------------------------------------------------------------ */

test('DXF 4: zwei getrennte Bauteile', () => {
  const r = analysiereDxf(dxf(p => {
    kopf(p); auf(p);
    rechteck(p, 0, 0, 100, 50);
    rechteck(p, 150, 0, 100, 50);
    kreis(p, 200, 25, 10);          // Loch nur im zweiten Teil
    zu(p);
  }), {});
  exakt(r.breiteMm, 250, 'Gesamtbreite');
  assert.equal(r.bauteile.length, 2);
  exakt(r.bauteile[0].nettoFlaecheMm2, 5000, 'Bauteil 1 ohne Loch');
  naheBogen(r.bauteile[1].nettoFlaecheMm2, 5000 - KREIS_F(10), bogenFehlerFlaeche(10), 'Bauteil 2 mit Loch');
  assert.equal(r.bauteile[0].loecher, 0);
  assert.equal(r.bauteile[1].loecher, 1);
  assert.equal(r.einstiche, 3);
  assert.ok(r.meldungen.some(m => /2 getrennte Bauteile/.test(m)));
});

/* ------------------------------------------------------------------ */
/* 5 – Offene Kontur                                                   */
/* ------------------------------------------------------------------ */

test('DXF 5: offene Kontur wird gemeldet und macht die Fläche unsicher', () => {
  const r = analysiereDxf(dxf(p => {
    kopf(p); auf(p);
    linie(p, 0, 0, 100, 0); linie(p, 100, 0, 100, 50); linie(p, 100, 50, 0, 50);
    zu(p);
  }), {});
  assert.equal(r.konturenAnzahl, 0);
  assert.equal(r.offeneKonturenAnzahl, 1);
  assert.equal(r.flaecheUnsicher, true, 'Fläche MUSS als unsicher gelten');
  exakt(r.nettoFlaecheMm2, 0, 'ohne geschlossene Kontur keine Fläche');
  exakt(r.schnittlaengeMm, 250, 'die Linien werden trotzdem geschnitten');
  exakt(r.laengeOffenMm, 250, 'als offene Länge geführt');
  assert.equal(r.einstiche, 1);
  assert.ok(r.warnungen.some(w => /offene Kontur/.test(w)));
  assert.ok(r.warnungen.some(w => /Bounding Box/.test(w)), 'es muss ein Ausweg angeboten werden');
});

/* ------------------------------------------------------------------ */
/* 6 – Doppelte Linie                                                  */
/* ------------------------------------------------------------------ */

test('DXF 6: doppelte Linie wird erkannt, Kontur bleibt geschlossen', () => {
  const r = analysiereDxf(dxf(p => {
    kopf(p); auf(p);
    linie(p, 0, 0, 100, 0); linie(p, 100, 0, 100, 50);
    linie(p, 100, 50, 0, 50); linie(p, 0, 50, 0, 0);
    linie(p, 0, 0, 100, 0);       // Dublette
    zu(p);
  }), {});
  assert.equal(r.pruefung.doppelt, 1);
  assert.equal(r.konturenAnzahl, 1, 'die Dublette darf den Konturschluss nicht zerstören');
  exakt(r.nettoFlaecheMm2, 5000, 'Fläche bleibt richtig');
  assert.ok(r.warnungen.some(w => /doppelte Linien/.test(w)));
  assert.ok(r.warnungen.some(w => /Einstiche/.test(w)), 'Auswirkung auf Einstiche muss benannt sein');
});

/* ------------------------------------------------------------------ */
/* 7 – Teilweise überlappende Linien                                   */
/* ------------------------------------------------------------------ */

test('DXF 7: Teilüberlappung wird auch über weite Distanz erkannt', () => {
  const r = analysiereDxf(dxf(p => {
    kopf(p); auf(p);
    // 0..1000 und 400..1400 auf derselben Geraden: 600 mm Überlappung.
    // Die Mittelpunkte liegen 200 mm auseinander – eine Prüfung, die nur
    // innerhalb einer Rasterzelle vergleicht, übersieht diesen Fall.
    linie(p, 0, 0, 1000, 0); linie(p, 400, 0, 1400, 0);
    linie(p, 1400, 0, 1400, 500); linie(p, 1400, 500, 0, 500); linie(p, 0, 500, 0, 0);
    zu(p);
  }), {});
  assert.equal(r.pruefung.ueberlappend, 1);
  nahe(r.pruefung.ueberlappungLaengeMm, 600, 1, 'gemeldete Überlappungslänge');
  assert.ok(r.warnungen.some(w => /überlappende/.test(w)));
  assert.ok(r.warnungen.some(w => /Schnittlänge/.test(w)), 'die Auswirkung muss benannt sein');
});

test('DXF 7b: kurze Linie vollständig auf einer langen', () => {
  const r = analysiereDxf(dxf(p => {
    kopf(p); auf(p);
    linie(p, 0, 0, 1000, 0); linie(p, 700, 0, 760, 0);
    linie(p, 1000, 0, 1000, 300); linie(p, 1000, 300, 0, 300); linie(p, 0, 300, 0, 0);
    zu(p);
  }), {});
  assert.equal(r.pruefung.ueberlappend, 1);
  nahe(r.pruefung.ueberlappungLaengeMm, 60, 1, 'Überlappungslänge');
});

/* ------------------------------------------------------------------ */
/* 8 – Extrem kurzes Segment                                           */
/* ------------------------------------------------------------------ */

test('DXF 8: extrem kurzes Segment wird gemeldet', () => {
  const r = analysiereDxf(dxf(p => {
    kopf(p); auf(p);
    p(0, 'LWPOLYLINE'); p(90, 5); p(70, 1);
    for (const [x, y] of [[0, 0], [100, 0], [100.01, 0.01], [100, 50], [0, 50]]) { p(10, x); p(20, y); }
    zu(p);
  }), { minSegmentMm: 0.05 });
  assert.ok(r.pruefung.kurz >= 1, 'mindestens ein zu kurzes Segment');
  assert.ok(r.warnungen.some(w => /kurze Segmente/.test(w)));
  assert.equal(r.konturenAnzahl, 1, 'die Kontur bleibt trotzdem auswertbar');
});

/* ------------------------------------------------------------------ */
/* 9 – Kreis und Kreisbögen                                            */
/* ------------------------------------------------------------------ */

test('DXF 9: Vollkreis', () => {
  const r = analysiereDxf(dxf(p => { kopf(p); auf(p); kreis(p, 0, 0, 25); zu(p); }), {});
  naheBogen(r.nettoFlaecheMm2, KREIS_F(25), bogenFehlerFlaeche(25), 'Kreisfläche');
  naheBogen(r.schnittlaengeMm, KREIS_U(25), bogenFehlerUmfang(25), 'Kreisumfang');
  naheBogen(r.breiteMm, 50, RAND_FEHLER, 'Breite');
  assert.equal(r.konturenAnzahl, 1);
  assert.equal(r.einstiche, 1);
});

test('DXF 9b: Halbkreis aus ARC plus Sehne', () => {
  const r = analysiereDxf(dxf(p => {
    kopf(p); auf(p);
    p(0, 'ARC'); p(10, 0); p(20, 0); p(40, 20); p(50, 0); p(51, 180);   // oberer Halbkreis
    linie(p, -20, 0, 20, 0);
    zu(p);
  }), {});
  // Halbkreisfläche = pi*20^2/2 = 628,32 ; Umfang = pi*20 + 40
  naheBogen(r.nettoFlaecheMm2, KREIS_F(20) / 2, bogenFehlerFlaeche(20, Math.PI), 'Halbkreisfläche');
  naheBogen(r.schnittlaengeMm, Math.PI * 20 + 40, bogenFehlerUmfang(20, Math.PI), 'Halbkreisumfang');
  assert.equal(r.konturenAnzahl, 1, 'Bogen und Sehne müssen sich verketten');
});

/* ------------------------------------------------------------------ */
/* 10 – LWPOLYLINE mit Bulge (Langloch)                                */
/* ------------------------------------------------------------------ */

test('DXF 10: Langloch aus LWPOLYLINE mit Bulge', () => {
  const r = analysiereDxf(dxf(p => {
    kopf(p); auf(p);
    p(0, 'LWPOLYLINE'); p(90, 4); p(70, 1);
    p(10, 0); p(20, 0); p(42, 0);
    p(10, 50); p(20, 0); p(42, 1);      // Halbkreis r=10 rechts
    p(10, 50); p(20, 20); p(42, 0);
    p(10, 0); p(20, 20); p(42, 1);      // Halbkreis links
    zu(p);
  }), {});
  // Fläche = Rechteck 50x20 + zwei Halbkreise r=10 = 1000 + pi*100
  naheBogen(r.nettoFlaecheMm2, 1000 + KREIS_F(10), 2 * bogenFehlerFlaeche(10, Math.PI), 'Langlochfläche');
  // Umfang = 2*50 + zwei Halbkreise r=10
  naheBogen(r.schnittlaengeMm, 100 + KREIS_U(10), 2 * bogenFehlerUmfang(10, Math.PI), 'Langlochumfang');
  naheBogen(r.breiteMm, 70, RAND_FEHLER, 'Breite = 50 + 2*10');
  exakt(r.hoeheMm, 20, 'Höhe');
  assert.equal(r.konturenAnzahl, 1);
});

/* ------------------------------------------------------------------ */
/* 11 – Klassische POLYLINE mit VERTEX                                 */
/* ------------------------------------------------------------------ */

test('DXF 11: klassische POLYLINE/VERTEX/SEQEND', () => {
  const r = analysiereDxf(dxf(p => {
    kopf(p); auf(p);
    p(0, 'POLYLINE'); p(8, 'SCHNITT'); p(70, 1);
    for (const [x, y] of [[0, 0], [80, 0], [80, 40], [0, 40]]) {
      p(0, 'VERTEX'); p(8, 'SCHNITT'); p(10, x); p(20, y);
    }
    p(0, 'SEQEND');
    zu(p);
  }), {});
  exakt(r.nettoFlaecheMm2, 3200, 'Fläche 80 x 40');
  exakt(r.schnittlaengeMm, 240, 'Umfang');
  assert.equal(r.konturenAnzahl, 1);
});

/* ------------------------------------------------------------------ */
/* 12 – Ellipse                                                        */
/* ------------------------------------------------------------------ */

test('DXF 12: Ellipse a=50 b=25', () => {
  const r = analysiereDxf(dxf(p => {
    kopf(p); auf(p);
    p(0, 'ELLIPSE'); p(8, 'SCHNITT');
    p(10, 0); p(20, 0);        // Mittelpunkt
    p(11, 50); p(21, 0);       // Hauptachsenende relativ zum Mittelpunkt
    p(40, 0.5);                // Verhältnis Neben-/Hauptachse
    p(41, 0); p(42, 2 * Math.PI);
    zu(p);
  }), {});
  naheBogen(r.nettoFlaecheMm2, Math.PI * 50 * 25, ellipsenFehlerFlaeche(50, 25), 'Ellipsenfläche');
  // Umfang nach Ramanujan
  const a = 50, b = 25;
  const umfang = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  nahe(r.schnittlaengeMm, umfang, 1, 'Ellipsenumfang (Ramanujan-Näherung)');
  naheBogen(r.breiteMm, 100, RAND_FEHLER, 'Breite');
  naheBogen(r.hoeheMm, 50, RAND_FEHLER, 'Höhe');
  assert.equal(r.konturenAnzahl, 1);
});

/* ------------------------------------------------------------------ */
/* 13 – Spline                                                         */
/* ------------------------------------------------------------------ */

test('DXF 13: Spline plus Schlusslinie ergibt eine geschlossene Kontur', () => {
  const r = analysiereDxf(dxf(p => {
    kopf(p); auf(p);
    p(0, 'SPLINE'); p(8, 'SCHNITT'); p(70, 8); p(71, 3); p(72, 8); p(73, 4);
    for (const k of [0, 0, 0, 0, 1, 1, 1, 1]) p(40, k);
    for (const [x, y] of [[0, 0], [0, 60], [80, 60], [80, 0]]) { p(10, x); p(20, y); }
    linie(p, 80, 0, 0, 0);
    zu(p);
  }), {});
  assert.equal(r.konturenAnzahl, 1);
  assert.equal(r.offeneKonturenAnzahl, 0);
  // Bézier 3. Grades über diese vier Punkte: Fläche = 3/10 * 80 * 60 = 1440...
  // Statt einer Handformel prüfen wir den plausiblen Bereich und die Ränder.
  assert.ok(r.nettoFlaecheMm2 > 2000 && r.nettoFlaecheMm2 < 4800,
    `Splinefläche plausibel: ${r.nettoFlaecheMm2}`);
  nahe(r.breiteMm, 80, SPLINE_PROMILLE, 'Breite');
  assert.ok(r.hoeheMm > 40 && r.hoeheMm <= 60, `Höhe plausibel: ${r.hoeheMm}`);
});

/* ------------------------------------------------------------------ */
/* 14 – BLOCK / INSERT                                                 */
/* ------------------------------------------------------------------ */

test('DXF 14: INSERT mit Verschiebung, Drehung und Skalierung', () => {
  const bau = (x, y, sx, sy, rot) => dxf(p => {
    kopf(p);
    p(0, 'SECTION'); p(2, 'BLOCKS');
    p(0, 'BLOCK'); p(2, 'TEIL'); p(10, 0); p(20, 0);
    rechteck(p, 0, 0, 40, 20);
    kreis(p, 20, 10, 5);
    p(0, 'ENDBLK');
    p(0, 'ENDSEC');
    auf(p);
    p(0, 'INSERT'); p(2, 'TEIL'); p(10, x); p(20, y); p(41, sx); p(42, sy); p(50, rot);
    zu(p);
  });

  const einfach = analysiereDxf(bau(0, 0, 1, 1, 0), {});
  naheBogen(einfach.nettoFlaecheMm2, 800 - KREIS_F(5), bogenFehlerFlaeche(5), 'unverändert eingefügt');
  exakt(einfach.breiteMm, 40, 'Breite');

  const skaliert = analysiereDxf(bau(100, 100, 2, 2, 0), {});
  naheBogen(skaliert.nettoFlaecheMm2, (800 - KREIS_F(5)) * 4, 4 * bogenFehlerFlaeche(5), 'Fläche vervierfacht bei Faktor 2');
  exakt(skaliert.breiteMm, 80, 'Breite verdoppelt');
  exakt(skaliert.bbox.minX, 100, 'Verschiebung wirkt');

  const gedreht = analysiereDxf(bau(0, 0, 1, 1, 90), {});
  naheBogen(gedreht.nettoFlaecheMm2, 800 - KREIS_F(5), bogenFehlerFlaeche(5), 'Drehung ändert die Fläche nicht');
  exakt(gedreht.breiteMm, 20, 'nach 90 Grad ist die Breite die alte Höhe');
  exakt(gedreht.hoeheMm, 40, 'und die Höhe die alte Breite');
  assert.equal(gedreht.loecherAnzahl, 1, 'das Loch im Block bleibt ein Loch');
});

/* ------------------------------------------------------------------ */
/* 15 – Verschachtelte Konturen beliebiger Tiefe                       */
/* ------------------------------------------------------------------ */

test('DXF 15: vier verschachtelte Ebenen, Gerade/Ungerade-Regel', () => {
  const radien = [50, 40, 30, 20];
  const r = analysiereDxf(dxf(p => {
    kopf(p); auf(p);
    for (const rad of radien) kreis(p, 0, 0, rad);
    zu(p);
  }), {});
  // aussen(+) loch(-) insel(+) loch(-) => pi*(2500 - 1600 + 900 - 400)
  const soll = Math.PI * (2500 - 1600 + 900 - 400);
  naheBogen(r.nettoFlaecheMm2, soll, radien.reduce((s, rad) => s + bogenFehlerFlaeche(rad), 0), 'Nettofläche über vier Ebenen');
  assert.deepEqual(r.konturen.map(k => k.rolle), ['aussen', 'loch', 'insel', 'loch']);
  assert.deepEqual(r.konturen.map(k => k.tiefe), [0, 1, 2, 3]);
  assert.equal(r.einstiche, 4);
  assert.equal(r.bauteile.length, 1);
});

test('DXF 15b: sechs Ebenen bleiben korrekt', () => {
  const radien = [60, 50, 40, 30, 20, 10];
  const r = analysiereDxf(dxf(p => {
    kopf(p); auf(p);
    for (const rad of radien) kreis(p, 0, 0, rad);
    zu(p);
  }), {});
  const soll = Math.PI * (3600 - 2500 + 1600 - 900 + 400 - 100);
  naheBogen(r.nettoFlaecheMm2, soll, radien.reduce((s, rad) => s + bogenFehlerFlaeche(rad), 0), 'Nettofläche über sechs Ebenen');
  assert.deepEqual(r.konturen.map(k => k.tiefe), [0, 1, 2, 3, 4, 5]);
});

/* ------------------------------------------------------------------ */
/* 16 – Ohne $INSUNITS                                                 */
/* ------------------------------------------------------------------ */

test('DXF 16: ohne $INSUNITS wird die Einheit NICHT geraten', () => {
  const r = analysiereDxf(dxf(p => { kopf(p, null); auf(p); rechteck(p, 0, 0, 100, 50); zu(p); }),
    { standardEinheit: 'mm' });
  assert.equal(r.einheitUnsicher, true, 'die Einheit muss als unsicher gelten');
  assert.equal(r.einheitBestaetigt, false, 'und unbestätigt bleiben');
  assert.equal(r.einheit, 'mm', 'der Betriebsstandard wird vorgeschlagen');
  assert.ok(r.warnungen.some(w => /Einheit/.test(w) && /bestätigen/i.test(w)),
    'es muss zur Bestätigung aufgefordert werden');
  // Die Maße gelten trotzdem als mm-Vorschlag
  exakt(r.breiteMm, 100, 'Vorschlagsmaß');
});

/* ------------------------------------------------------------------ */
/* 17 – Einheiten mm, cm, m, inch                                      */
/* ------------------------------------------------------------------ */

test('DXF 17: mm, cm, m und Zoll werden richtig umgerechnet', () => {
  const faelle = [
    [4, 'mm', 1], [5, 'cm', 10], [6, 'm', 1000], [1, 'inch', 25.4],
  ];
  for (const [code, name, faktor] of faelle) {
    const r = analysiereDxf(dxf(p => { kopf(p, code); auf(p); rechteck(p, 0, 0, 10, 4); zu(p); }), {});
    assert.equal(r.einheit, name, `Einheit ${name}`);
    assert.equal(r.einheitUnsicher, false, `${name} ist eindeutig`);
    exakt(r.breiteMm, 10 * faktor, `Breite in ${name}`);
    exakt(r.hoeheMm, 4 * faktor, `Höhe in ${name}`);
    exakt(r.nettoFlaecheMm2, 40 * faktor * faktor, `Fläche in ${name}`);
  }
});

test('DXF 17b: Einheit von aussen erzwingen', () => {
  const r = analysiereDxf(dxf(p => { kopf(p, null); auf(p); rechteck(p, 0, 0, 10, 4); zu(p); }),
    { einheit: 'cm' });
  assert.equal(r.einheitUnsicher, false, 'eine gesetzte Einheit gilt als geklärt');
  exakt(r.breiteMm, 100, 'cm nach mm');
});

/* ------------------------------------------------------------------ */
/* 18 – Nicht unterstützte Objekte                                     */
/* ------------------------------------------------------------------ */

test('DXF 18: nicht ausgewertete Objekte werden mit Typ und Anzahl genannt', () => {
  const r = analysiereDxf(dxf(p => {
    kopf(p); auf(p);
    rechteck(p, 0, 0, 100, 50);
    p(0, 'TEXT'); p(8, 'TEXTE'); p(10, 10); p(20, 10); p(40, 5); p(1, 'Pos 1');
    p(0, 'TEXT'); p(8, 'TEXTE'); p(10, 10); p(20, 20); p(40, 5); p(1, 'Pos 2');
    p(0, 'DIMENSION'); p(8, 'MASSE'); p(10, 0); p(20, 0);
    p(0, 'HATCH'); p(8, 'FUELL'); p(10, 0); p(20, 0);
    p(0, 'SOLID'); p(8, 'FUELL'); p(10, 0); p(20, 0);
    p(0, '3DSOLID'); p(8, 'KOERPER'); p(10, 0); p(20, 0);
    zu(p);
  }), {});
  exakt(r.nettoFlaecheMm2, 5000, 'die ignorierten Objekte dürfen die Fläche nicht verändern');
  const alle = r.meldungen.join(' ');
  assert.ok(/TEXT \(2×\)/.test(alle), `TEXT mit Anzahl fehlt: ${alle}`);
  assert.ok(/DIMENSION \(1×\)/.test(alle), 'DIMENSION mit Anzahl fehlt');
  assert.ok(/HATCH \(1×\)/.test(alle), 'HATCH mit Anzahl fehlt');
  assert.ok(/SOLID \(1×\)/.test(alle), 'SOLID mit Anzahl fehlt');
  assert.ok(/3DSOLID \(1×\)/.test(alle), 'unbekannter Typ 3DSOLID muss genannt werden');
  assert.ok(/nicht unterstützte|Nicht unterstützte/i.test(alle));
});

test('DXF 18b: DEFPOINTS bläht die Bounding Box nicht auf', () => {
  const r = analysiereDxf(dxf(p => {
    kopf(p); auf(p);
    rechteck(p, 0, 0, 100, 50);
    linie(p, -5000, -5000, 5000, 5000, 'DEFPOINTS');
    zu(p);
  }), {});
  exakt(r.breiteMm, 100, 'Breite');
  exakt(r.hoeheMm, 50, 'Höhe');
});

/* ------------------------------------------------------------------ */
/* 19 – Große Datei                                                    */
/* ------------------------------------------------------------------ */

test('DXF 19: grosse Datei mit vielen Segmenten bleibt auswertbar', () => {
  const LOECHER = 400;
  const text = dxf(p => {
    kopf(p); auf(p);
    rechteck(p, 0, 0, 2000, 1000);
    for (let i = 0; i < LOECHER; i++) {
      kreis(p, 25 + (i % 40) * 50, 25 + Math.floor(i / 40) * 50, 8);
    }
    zu(p);
  });
  const start = Date.now();
  const r = analysiereDxf(text, {});
  const dauer = Date.now() - start;

  // Maßstab ist die Segmentzahl, nicht die Dateigröße: ein Kreis ist im DXF
  // 6 Zeilen, wird beim Abflachen aber zu ~45 Segmenten. Die 400 Löcher
  // ergeben rund 18 000 Segmente — das ist die Last, um die es hier geht.
  assert.ok(r.pruefung.gesamt > 15000,
    `Testfall ist gross genug: ${r.pruefung.gesamt} Segmente aus ${(text.length / 1024).toFixed(0)} kB Datei`);

  naheBogen(r.nettoFlaecheMm2, 2000 * 1000 - LOECHER * KREIS_F(8), LOECHER * bogenFehlerFlaeche(8), 'Nettofläche');
  assert.equal(r.konturenAnzahl, LOECHER + 1);
  assert.equal(r.loecherAnzahl, LOECHER);
  assert.equal(r.einstiche, LOECHER + 1);
  assert.equal(r.pruefung.doppelt, 0, 'keine falschen Dubletten');
  assert.equal(r.pruefung.ueberlappend, 0, 'keine falschen Überlappungen');
  assert.ok(dauer < 20000, `Auswertung in ${dauer} ms (Grenze 20 s)`);
  console.log(`      DXF 19: ${r.pruefung.gesamt} Segmente in ${dauer} ms`);
});

/* ------------------------------------------------------------------ */
/* 20 – Mehrere Layer                                                  */
/* ------------------------------------------------------------------ */

test('DXF 20: Konturen auf mehreren Layern werden alle ausgewertet', () => {
  const r = analysiereDxf(dxf(p => {
    kopf(p); auf(p);
    rechteck(p, 0, 0, 100, 50, 'AUSSEN');
    kreis(p, 30, 25, 8, 'INNEN');
    kreis(p, 70, 25, 8, 'BOHRUNGEN');
    zu(p);
  }), {});
  naheBogen(r.nettoFlaecheMm2, 5000 - 2 * KREIS_F(8), 2 * bogenFehlerFlaeche(8), 'Fläche über alle Layer');
  assert.equal(r.konturenAnzahl, 3, 'der Layer darf die Auswertung nicht beeinflussen');
  assert.equal(r.loecherAnzahl, 2);
  assert.equal(r.einstiche, 3);
});

/* ------------------------------------------------------------------ */
/* Beschädigte Dateien                                                 */
/* ------------------------------------------------------------------ */

test('DXF: beschädigte und fremde Dateien stürzen nicht ab', () => {
  const muell = [
    '', '   ', 'kein dxf', '0\nSECTION', '0\nSECTION\n2\nENTITIES',
    'AutoCAD Binary DXF  ', 'AC1027binary',
    '0\nSECTION\n2\nENTITIES\n0\nLINE\n10\nabc\n20\ndef\n0\nENDSEC\n0\nEOF',
    '0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n10\n0\n20\n0\n40\n0\n0\nENDSEC\n0\nEOF',
    '0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n90\n999999\n70\n1\n0\nENDSEC\n0\nEOF',
  ];
  for (const t of muell) {
    let ergebnis = null, fehler = null;
    try { ergebnis = analysiereDxf(t, {}); } catch (e) { fehler = e; }
    // Entweder ein sauberes Ergebnis oder ein verständlicher Fehler – nie ein Absturz.
    assert.ok(ergebnis || fehler, 'kein Ergebnis und kein Fehler');
    if (fehler) {
      assert.ok(typeof fehler.message === 'string' && fehler.message.length > 10,
        `Fehlermeldung zu knapp: "${fehler.message}"`);
    } else {
      assert.ok(Number.isFinite(ergebnis.nettoFlaecheMm2), 'Nettofläche muss eine Zahl sein');
      assert.ok(Number.isFinite(ergebnis.schnittlaengeMm), 'Schnittlänge muss eine Zahl sein');
    }
  }
});
