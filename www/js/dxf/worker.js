/**
 * worker.js — führt die DXF-Auswertung in einem eigenen Strang aus.
 *
 * Warum: Das Abflachen, Verketten und Prüfen einer großen Zeichnung dauert
 * spürbar. Im Hauptstrang würde die Oberfläche währenddessen einfrieren —
 * kein Tippen, kein Scrollen, keine Rückmeldung. Hier läuft es daneben, die
 * App bleibt bedienbar und kann den Vorgang abbrechen.
 *
 * Die Auswertung selbst ist unverändert dieselbe wie im Hauptstrang
 * (analyze.js); dieser Worker ist nur die Hülle drumherum. Fällt er aus
 * (alter WebView ohne Modul-Worker), rechnet dxfcard.js direkt weiter.
 */

import { analysiereDxf } from './analyze.js';
import { DxfFehler } from './parser.js';

self.addEventListener('message', (e) => {
  const { id, text, opts } = e.data || {};
  try {
    const ergebnis = analysiereDxf(text, opts || {});
    self.postMessage({ id, ok: true, ergebnis });
  } catch (fehler) {
    self.postMessage({
      id,
      ok: false,
      // Fehlerobjekte lassen sich nicht übertragen – Art und Text getrennt senden.
      art: fehler instanceof DxfFehler ? 'DxfFehler' : 'Fehler',
      meldung: String(fehler && fehler.message ? fehler.message : fehler),
    });
  }
});
