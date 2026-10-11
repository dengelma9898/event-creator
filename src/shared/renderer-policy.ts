/**
 * Content-Security-Policy für den Renderer – einzige Quelle der Wahrheit.
 *
 * Jede Regel ist aus dem tatsächlichen Bedarf des Renderers abgeleitet und im
 * laufenden `dist`-Build geprüft (0 Verstöße über alle Tabs, inklusive eines
 * echten Event-Bilds und der Quell-Avatare).
 *
 * - `default-src 'none'`          nichts ist erlaubt, was nicht unten steht.
 * - `script-src 'self'`           Vite liefert das Bundle als externe Datei aus
 *                                 (`dist/assets/index-*.js`). Es gibt kein
 *                                 Inline-Script, kein `innerHTML` und kein
 *                                 `dangerouslySetInnerHTML`.
 * - `style-src 'self'`            Tailwind wird nach `dist/assets/index-*.css`
 *                                 extrahiert. React-`style`-Props schreiben über
 *                                 das CSSOM und werden von CSP nicht blockiert.
 * - `img-src 'self' https:`       Die Event-Liste rendert `Bild-URL` aus
 *                                 beliebigen Quell-Webseiten (acht verschiedene
 *                                 Hosts in den aktuellen Daten, keine
 *                                 geschlossene Menge). `https:` ist die engste
 *                                 Regel, die das überlebt – `http:` (Mixed
 *                                 Content) und alle anderen Schemata bleiben
 *                                 gesperrt. Darin liegt auch
 *                                 `www.google.com/s2/favicons` der Quell-Avatare.
 *                                 `data:` wird nicht gebraucht und ist entfernt.
 * - `connect-src 'none'`          Der Renderer spricht ausschliesslich über IPC,
 *                                 niemals per fetch/XHR/WebSocket.
 * - kein `font-src`               es gibt kein `@font-face`; alle Schriften sind
 *                                 Systemschriften, die CSP nicht kontrolliert.
 * - `form-action/frame-src/object-src/base-uri 'none'` wird nichts davon benutzt.
 *
 * `unsafe-eval` wird nirgends benötigt und ist nicht enthalten.
 */
export const RENDERER_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' https:",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

/**
 * Nur für den Vite-Dev-Server: HMR braucht einen WebSocket und injiziert CSS
 * zur Laufzeit als <style>. Sonst ist die Policy identisch zur Produktion.
 */
export const DEV_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https:",
  "connect-src 'self' ws: http://localhost:* http://127.0.0.1:*",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');
