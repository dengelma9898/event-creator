# E-Werk Scraper – Optimierungs-Notizen

> **Wichtig:** Alle Einträge hier sind **Hypothesen**, nicht Garantien. Vor dem Anwenden jeden Lauf gegen die Live-Seite validieren – die Seite kann sich jederzeit ändern.

Zweck: gesammelte Ausführungserfahrung festhalten, um schneller/effizienter/robuster zu scrapen. Ein Bullet pro Erkenntnis, kurz und datiert. Neue Einträge nach oben.

## Einträge

- **2026-09-23**: Detailseiten-Extraktion per `fetch(url)` + `DOMParser` im Browser-Kontext (`page.evaluate`) ist extrem schnell (~150ms vs. ~3s pro Event mit `page.goto()`). Initial sind 12 Events auf der Seite gerendert; ein Klick auf `.showMore-events` lädt 12 weitere Termine per AJAX nach (insgesamt 24). Ziel-Limit auf 15 Events gesetzt. Jedes Event sofort als `EVENT_LIVE:` ausgeben für Echtzeit-Darstellung im Tool.
