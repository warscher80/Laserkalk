/**
 * files.js — Datei speichern und lesen im Browser / in der Android-WebView.
 *
 * Der klassische Download-Link funktioniert in manchen WebViews nicht.
 * Deshalb: erst die Datei-System-API, dann Teilen, dann Download-Link,
 * und als letzte Sicherung Text zum Kopieren.
 */

/**
 * Bietet einen Text als Datei an.
 * @returns {Promise<'gespeichert'|'geteilt'|'download'|'kopieren'>}
 */
export async function speichereText(text, name, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: name.endsWith('.csv') ? 'CSV-Datei' : 'JSON-Datei', accept: { [mime]: [`.${name.split('.').pop()}`] } }],
      });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return 'gespeichert';
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
    }
  }

  if (navigator.canShare && navigator.share) {
    try {
      const file = new File([blob], name, { type: mime });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return 'geteilt';
      }
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
    }
  }

  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'download';
  } catch {
    return 'kopieren';
  }
}

/** Liest eine vom Benutzer gewählte Datei als Text. */
export function leseDatei(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Die Datei konnte nicht gelesen werden.'));
    r.readAsText(file, 'utf-8');
  });
}

/** iPhone/iPad? Dort verhält sich die Dateiauswahl anders. */
export function istIOS() {
  const ua = navigator.userAgent || '';
  // iPadOS meldet sich seit Version 13 als Macintosh – am Touchscreen erkennbar.
  return /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1);
}

/**
 * Öffnet den Dateiauswahl-Dialog und liefert die gewählte Datei.
 *
 * Auf dem iPhone wird `accept` bewusst NICHT gesetzt: iOS kennt für DXF keinen
 * Dateityp, und mit einer Einschränkung erscheinen die .dxf-Dateien in der
 * Dateien-App ausgegraut und lassen sich nicht auswählen.
 */
export function waehleDatei(accept) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    if (accept && !istIOS()) inp.accept = accept;
    inp.style.position = 'fixed';
    inp.style.left = '-9999px';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0] ? inp.files[0] : null;
      inp.remove();
      resolve(f);
    }, { once: true });
    inp.click();
  });
}
