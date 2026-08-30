/** helper.js — Testhilfen: DXF-Dateien im Speicher bauen. */

export function dxfBauen(fn) {
  const zeilen = [];
  const p = (code, wert) => { zeilen.push(String(code)); zeilen.push(String(wert)); };
  fn(p);
  return zeilen.join('\r\n') + '\r\n';
}

/** Rechteck mit runden Löchern, als LWPOLYLINE + CIRCLE. */
export function rechteckMitLoechern({ breite = 300, hoehe = 180, loecher = [], insunits = 4 } = {}) {
  return dxfBauen(p => {
    if (insunits !== null) { p(0, 'SECTION'); p(2, 'HEADER'); p(9, '$INSUNITS'); p(70, insunits); p(0, 'ENDSEC'); }
    p(0, 'SECTION'); p(2, 'ENTITIES');
    p(0, 'LWPOLYLINE'); p(8, 'SCHNITT'); p(90, 4); p(70, 1);
    for (const [x, y] of [[0, 0], [breite, 0], [breite, hoehe], [0, hoehe]]) { p(10, x); p(20, y); }
    for (const [cx, cy, r] of loecher) { p(0, 'CIRCLE'); p(8, 'SCHNITT'); p(10, cx); p(20, cy); p(40, r); }
    p(0, 'ENDSEC'); p(0, 'EOF');
  });
}

/** Einfache Kalkulation für Engine-Tests. */
export function musterMaterial(over = {}) {
  return {
    werkstoff: 'S235JR', bezeichnung: 'S235JR 2,0 mm', dickeMm: 2, dichte: 7850,
    tafelLaengeMm: 2500, tafelBreiteMm: 1250,
    ekTafelCent: 31250, ekProKgCent: 51, preisProM2Cent: 1000,
    ...over,
  };
}
