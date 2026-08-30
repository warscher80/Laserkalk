/**
 * version.js — die EINE Stelle, an der die App-Version im Web-Teil steht.
 *
 * Sie muss mit `android/app/build.gradle` (versionCode/versionName) und mit
 * der Cache-Kennung in `www/sw.js` übereinstimmen. Ein Test wacht darüber
 * (tests/version.test.js), damit die drei Stellen nicht auseinanderlaufen —
 * sonst schlüge die Update-Prüfung fehl oder der Service Worker lieferte
 * dauerhaft alte Dateien aus.
 *
 * Beim Anheben einer Version: alle drei Stellen ändern, dann `npm test`.
 */

export const APP_VERSION = {
  code: 3,
  name: '1.0.2',
};

/** Anzeigetext, z. B. "1.0.0 (1)". */
export function versionText() {
  return `${APP_VERSION.name} (${APP_VERSION.code})`;
}
