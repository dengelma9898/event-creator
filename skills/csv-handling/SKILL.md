---
name: csv-handling
description: Gemeinsame CSV-Verwaltung für alle Event-Scraper im Event Creator Projekt. Beschreibt die zentrale Speicherung durch die App via announce_plan und add_event, datumsgestempelte Dateibenennung in data/, 50er-Chunking, Dedupe und Vergangenheitsfilter.
---

# CSV Handling (zentral durch die Event Creator App)

Diese Skill ist die **verbindliche Referenz** für den CSV-Lebenszyklus in der Event Creator Desktop-App.

> **Wichtigste Regel für Agenten:** Der Agent schreibt **keine CSV-Dateien** mehr selbst auf der Festplatte! Die Desktop-App übernimmt das Schreiben, Validieren, Chunking und Bereinigen vollständig über die bereitgestellten Werkzeuge `announce_plan` und `add_event`.

Alle CSV-Dateien werden verbindlich und ausnahmslos im zentralen Ausgabeordner `data/` verwaltet.

## Dateibenennung (datumsgestempelt im Ordner data/)

Dateien heißen **datumsgestempelt** nach dem Laufdatum (lokal `YYYY-MM-DD`) und liegen immer in `data/`:

```
data/<quelle>-events-data-YYYY-MM-DD.csv      # 1–50 Datensätze
data/<quelle>-events-data-YYYY-MM-DD-2.csv    # 51–100 (nur falls >50)
data/<quelle>-events-data-YYYY-MM-DD-3.csv    # 101–150
# usw.
```

- **`-2`/`-3` = Folge-Chunks** desselben Datums-Snapshots (automatisch bei >50 Datenzeilen von der App verwaltet).
- Die App bereinigt veraltete Termine (`Startdatum < morgen`) automatisch in Phase 0 vor dem Agentenlauf.

## Workflow für Scraper-Skills

1. **Phase 0 (Bestand):** Wird von der App automatisch erledigt. Die App lädt den aktiven Bestand, filtert vergangene Events und legt die Snapshot-Datei an.
2. **Phase 1 (Entdecken & Plan melden):**
   - Webseite aufrufen, Terminliste erfassen.
   - Einmalig `announce_plan` aufrufen mit allen gefundenen Kandidaten (`title`, `startDate`, `detailUrl`).
3. **Phase 2 (Events einzeln erfassen):**
   - Pro Termin Details aufrufen (sofern nötig) und `add_event` mit den 17 Feldern aufrufen.
   - `add_event` prüft Validität, Duplikate, Absagen und schreibt das Event sofort in die CSV.
   - Bei Erreichen des Limits von **maximal 30 neuen Events** stoppen.
4. **Phase 3 (Abschluss):**
   - Der Agent beendet seine Ausführung. Die App führt abschließend `node csv-import-check.js data` aus.

## Gemeinsame Datenqualitäts-Regeln (für add_event)

- **Titel**: Pflichtfeld, nicht leer.
- **Startdatum**: Pflichtfeld, im Format `YYYY-MM-DD`. Frühestens morgen (`Startdatum >= heute + 1 Tag`).
- **Tickets**: nur `ja` oder `nein`; **Ticket-URL**: Shop-URL oder leer.
- **Kategorien**: exakter App-Kategorie-`name` (eine der 7 Kategorien) oder leer → siehe `event-category-mapper`.
- **Abgesagte Events**: Events mit `Abgesagt:` im Titel oder `\b(abgesagt|cancelled|verschoben)\b` im Titel bzw. `ersatzlos abgesagt` in der Beschreibung werden von der App abgewiesen.
- **Lauf-Limit**: standardmäßig maximal 30 neue Events pro Run (bereits bekannte Bestandsevents zählen nicht zum Limit).
