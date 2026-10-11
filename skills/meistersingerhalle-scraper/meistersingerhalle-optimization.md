# Meistersingerhalle Scraper – Optimierungs-Notizen

> **Wichtig:** Alle Einträge hier sind **Hypothesen**, nicht Garantien. Vor dem Anwenden jeden Lauf gegen die Live-Seite validieren – die Seite kann sich jederzeit ändern.

Zweck: gesammelte Ausführungserfahrung festhalten, um schneller/effizienter/robuster zu scrapen. Ein Bullet pro Erkenntnis, kurz und datiert. Neue Einträge nach oben.

## Einträge

- 2026-09-01: **Datumsgestempelte Snapshots zwingend** – neue Ausgabe schreiben als `data/meistersingerhalle-events-data-YYYY-MM-DD[-N].csv` (Regel `csv-handling`); Alt-Dateien ohne Datum nicht überschreiben/anfassen.
- 2026-09-01: **Beschreibung-Selektor robust**: voller Text liegt in `div.whitespace-pre-line` (innerText). Snapshot-Ansicht ist gekürzt – Beschreibung dort nicht mehr aus dem Snapshot übernehmen, sondern via `evaluate` aus dem Element.
- 2026-09-01: **h1-Warten**: `waitForSelector('h1', {state:'visible'})` schlägt fehl; `{state:'attached'}` + kurzes `waitForTimeout(500)` verwenden.
- 2026-09-01: **Preis-Quirk**: Preis-Button zeigt bei kostenfreien Events `Eintritt ab Infinity €` → als `Eintritt ab 0,00 €` speichern.
- 2026-09-01: **Pagination**: Suchseite ist per `page.goto(..., &page=N)` leer; alle Seiten iterieren (Button „Next Page“) innerhalb eines `run_code`-Durchlaufs. Detail-URLs dagegen direkt per `goto` abrufbar – Batching über URL-Liste in `run_code` spart Round-Trips.
- 2026-09-01: **Organizer**: Name/Webseite/Telefon unter der h2 „Über den Veranstalter“: erster `a` (nicht `tel:`) = Name+Webseite, `a[href^=tel:]` = Telefon.
- 2026-09-01: **Kategorien Klassik**: Konzerte (auch Vivaldi, Oper/Gala, Klassiknacht, Familien-Filmkonzert, Klavierabende) im Bestand durchgehend `Musik & Nightlife`; `Messe` im Titel → `Märkte & Messen`; reine Vortrags-Events → `Workshops & PopUps`.
