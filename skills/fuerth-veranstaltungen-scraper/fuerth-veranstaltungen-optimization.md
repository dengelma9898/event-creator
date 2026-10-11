# Fürth Veranstaltungen Scraper – Optimierungs-Notizen

> **Wichtig:** Alle Einträge hier sind **Hypothesen**, nicht Garantien. Vor dem Anwenden jeden Lauf gegen die Live-Seite validieren – die Seite kann sich jederzeit ändern.

Zweck: gesammelte Ausführungserfahrung festhalten, um schneller/effizienter/robuster zu scrapen. Ein Bullet pro Erkenntnis, kurz und datiert. Neue Einträge nach oben.

## Einträge

- **2026-09-01:** Kategorie-Mapping: Die fuerth.de-Quellkategorie (`category`, z.B. „Geselliges Freizeit Netzwerken Für Familien Für Kinder“) enthält viele generische Tag-Wörter („Workshop“, „Freizeit“, „Für Familien Für Kinder“), wodurch ein reines Keyword-Mapping auf die 7 App-Kategorien unzuverlässig wird (falsche Treffer z.B. bei „Geschichte und Gegenwart jüdischen Lebens“ → inzwischen zuverlässig „Kultur“ statt „Familie & Kinder“). Besser: für die üblichen Termin-Typen ein explizites Titel-basiertes Override nutzen („Fürth bewegt“ → immer „Workshops & PopUps“, „Sundown-Yoga“ → „Sport & Fitness“, Ausstellungen/Museen/Stadtführungen/Lesungen → „Kultur“, „Crowd-Singing“ → „Musik & Nightlife“) und nur als Fallback auf Schlüsselwörter aus Titel+Beschreibung zurückgreifen.
- **2026-09-01:** Ticket-Erkennung: Der „Tickets kaufen“-Link steht im Accordion „Preise und Kartenvorverkauf“ (URL teils von tourismus-fuerth/eat-the-world). Wenn Preise nur eine Kassen-/Barzahlung beschreiben (z.B. „Tickets können nur während der Öffnungszeiten an der Museumskasse erworben werden“) ohne Link → `Tickets=ja` ohne `Ticket-URL`. „Eintritt frei“ → `Tickets=nein`. Unkostenbeitrag-Termine („4 Euro pro Besuch“) → `Tickets=ja` ohne URL.
