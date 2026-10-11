---
name: event-category-mapper
description: Ordnet gescrapte Events den 7 App-Eventkategorien zu. Verwende diesen Skill bei allen *-scraper Skills wenn Kategorien in die CSV geschrieben werden, oder wenn der User App-Kategorie-Mapping, Kategorien-Spalte oder categoryId-Zuordnung erwähnt.
---

# Event Category Mapper

Gemeinsame Kategorie-Logik für alle Event-Scraper im `crawler-to-csv`-Projekt.

## Verbindliche Regeln

1. **`Kategorien`** in der CSV enthält **nur** den exakten App-Kategorie-`name` (ein Wert) oder bleibt **leer**.
2. **Kein Semikolon-Mehrfachwert** in `Kategorien`.
3. **Rohe Quell-Kategorie** (z. B. `Party`, `KONZERT`, `Flohmarkt`) nur intern als `sourceCategory` / `genre` halten — **nie** in die CSV schreiben.
4. **Mapping-Input**: `sourceCategory` + `Titel` + `Beschreibung` (lowercase vergleichen).
5. **Erste passende Regel gewinnt** (siehe [reference.md](reference.md)).
6. **Validierung vor CSV-Schreiben**: jede `Kategorien`-Zelle ist leer oder exakt einer der 7 Namen.
7. **Statusmeldung**: Kategorie-Statistik ausgeben (Anzahl pro Kategorie + ohne Zuordnung).

## Erlaubte Werte für `Kategorien`

| name (in CSV schreiben) |
|---|
| `Musik & Nightlife` |
| `Familie & Kinder` |
| `Workshops & PopUps` |
| `Märkte & Messen` |
| `Show & Performance` |
| `Kultur` |
| `Sport & Fitness` |
| *(leer)* → Backend-Fallback `default` |

## Mapping-Schritt (nach Extraktion, vor CSV-Schreiben)

1. Quell-Kategorie von der Seite extrahieren → intern `sourceCategory` (oder `genre` bei z-bau)
2. Site-Override prüfen (falls Scraper in [reference.md](reference.md) gelistet)
3. Generische Keyword-Regeln anwenden
4. Output: genau einer der 7 `name`-Werte oder `""`
5. Validieren

### Zwei Felder unterscheiden

| Feld | Herkunft | Verwendung |
|---|---|---|
| `sourceCategory` / `genre` | Quellseite | Nur intern für Mapping |
| `Kategorien` | abgeleitet | CSV-Ausgabe |

## Integration in Scraper-Skills

Jeder `*-scraper` Skill muss:

1. In **Datenqualität**: Regel 3 (Kategorien) referenzieren
2. Im **Workflow** nach Extraktion: „App-Kategorie zuordnen“
3. Vor **CSV-Schreiben**: Validierung + Kategorie-Statistik in Statusmeldung

Details, generische Regeln und Site-Overrides: [reference.md](reference.md)
