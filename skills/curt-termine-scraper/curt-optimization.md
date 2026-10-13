# Curt Termine Scraper – Optimierungs-Notizen

> **Wichtig:** Alle Einträge hier sind **Hypothesen**, nicht Garantien. Vor dem Anwenden jeden Lauf gegen die Live-Seite validieren – die Seite kann sich jederzeit ändern.

Zweck: gesammelte Ausführungserfahrung festhalten, um schneller/effizienter/robuster zu scrapen. Ein Bullet pro Erkenntnis, kurz und datiert. Neue Einträge nach oben.

## Einträge

- **2026-10-13:** DuckDuckGo-Adresssuche liefert im Playwright-MCP oft CAPTCHA („Ente auswählen“) – für Adressvervollständigung stattdessen direkt die Veranstalter-Website/Impressum aus dem Event-`website`-Link nutzen (funktionierte z. B. Theater Rootslöffel, Club Stereo).
- **2026-10-13:** Detail-Extraktion: Bei kurzen Event-Texten kann das erste `<p>` aus dem Footer stammen („Impressum / Kontakt“) – Beschreibung aus Tagline unter dem Datum oder zweitem Absatz bevorzugen. Globaler Header-Link `curt.reservix.de` nicht als event-spezifische Tickets werten (`tickets: nein`). Externe Newsletter-Links (`sibforms.com`) nicht als Veranstalter-Website übernehmen.
- **2026-10-03:** Detailseite: Titel oft nur in `document.title`, wenn `h1` „EVENTS“/„KARTE“ ist (z. B. Konzerte). Datum teils ohne Uhr (`SONNTAG, DD.MM.YYYY`) – Regex muss `/ Uhr` optional machen. Adresse steht oft in einer Zeile ohne Leerzeichen vor PLZ (`…straße 6690441`) – PLZ per Regex trennen. E-Werk-Detailtexte sehr lang; Preis-Regex trifft irrtümlich Fließtext – Beschreibung kürzen, Preis nur bei klaren Mustern (Euro, Kategorie).
