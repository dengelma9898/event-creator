# GATE Nürnberg Scraper – Optimierungs-Notizen

> **Wichtig:** Alle Einträge hier sind **Hypothesen**, nicht Garantien. Vor dem Anwenden jeden Lauf gegen die Live-Seite validieren – die Seite kann sich jederzeit ändern.

Zweck: gesammelte Ausführungserfahrung festhalten, um schneller/effizienter/robuster zu scrapen. Ein Bullet pro Erkenntnis, kurz und datiert. Neue Einträge nach oben.

## Einträge

- **2026-09-01** Detailseiten sind direkt per URL erreichbar: die Startlisten-Links haben bereits die Form `https://gate-nuernberg.de/Events/Show/{id}/{slug}` — `browser_navigate` zur Detail-URL reicht, kein Klick-Hin-und-zurück nötig.
- **2026-09-01** Die kleine Datumszeile auf der Detailseite kann dem Titel widersprechen (Happy Halloween: Datumszeile „Freitag, 30. Oktober 2026" vs. real Sa 31.10.2026) → Startdatum von Titel/Slug/Beschreibungstext übernehmen, nicht von der Datumszeile.
- **2026-09-01** Dedupe über die Event-ID statt den Slug: BOARDING NIGHT erschien mit neuem Slug bei gleicher ID (149) — der Detail-URL-Vergleich kann damit fehlschlagen; stabiler Key ist `/Events/Show/{id}`.
