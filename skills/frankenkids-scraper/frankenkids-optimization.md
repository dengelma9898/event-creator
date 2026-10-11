# Frankenkids Scraper – Optimierungs-Notizen

> **Wichtig:** Alle Einträge hier sind **Hypothesen**, nicht Garantien. Vor dem Anwenden jeden Lauf gegen die Live-Seite validieren – die Seite kann sich jederzeit ändern. Selektoren in `reference.md` sind nur Stand-jetzt.

Zweck: gesammelte Ausführungserfahrung festhalten, um schneller/effizienter/robuster zu scrapen. Ein Bullet pro Erkenntnis, kurz und datiert. Neue Einträge nach oben.

## Einträge

- **2026-09-01** Detailseiten-Selektoren aus `reference.md` (`.tribe-events-event-categories`, `.tribe-events-single-event-description`, `.tribe-events-venue`) matchen NICHT mehr. Live korrigiert: Beschreibung = `.Event-Bottom-Wrap-one p` (gejoint), Ort = `.Sv-3` (textContent, whitespace→Leerzeichen), Website = Link mit Text `Zur Veranstaltungs-Website`, Bild = `.tribe-events-event-image img`/`.Event-img img`, sonst `meta[property="og:image"]`; Titel = erstes `h2`; Datum via regex `Beginn`/`Ende` in allText; sourceCategory-Fallback = Uppercase-Zeile im Text (z.B. KINDER, FÜHRUNGEN).
- **2026-09-01** URLs ohne Datum im Pfad (recurring/multi-day) brauchen Datum aus Seiteninhalt – nur URL-Collection im Listen-Scrape reicht nicht für den Pre-Filter.
- **2026-09-01** Ein Bulk-Scrape von 40 URLs lief in MCP-Timeout (-32001) → Batch-Strategie (~8 URLs pro `browser_run_code`-Lauf, jeweils mit eigenem Return) verhindert Timeouts zuverlässig.
- **2026-09-01** `page.goto('/veranstaltungen_franken/')` war einmal `net::ERR_ABORTED` (rate-limit-sensitiv) → Retry mit Ladezeit/`waitUntil:'load'` funktioniert; danach pro Detail-URL ~1200ms Puffer einplanen.
- **2026-09-01** Browser startet nach längerer Pause nur zuverlässig nach `browser_install` + `pkill` („Wird in einer aktuellen Browsersitzung geöffnet“, exitCode 0) – sonst ggf. ein `browser_run_code` zur Session-Warm-up.
- **2026-09-01** Site liefert viele Console-Fehler (jquery.hammer, JQMIGRATE, `Date.toISOString` RangeErrors auf recurring Events) – Panel ist Site-Typisch und beeinflusst die `page.evaluate`-Extraktion NICHT.
