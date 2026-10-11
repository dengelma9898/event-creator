---
name: curt-termine-scraper
description: Extrahiert Event-Details von https://www.curt.de/termine/84/ durch Navigation zu den Detailseiten jedes Events. Verwendet Playwright MCP Browser-Automation um alle Event-Links zu finden, auf die Detailseiten zu navigieren und vollständige Event-Informationen zu extrahieren. Ordnet Events App-Eventkategorien zu. Schreibt Daten nach data/. Nutze diesen Skill NUR auf explizite Anfrage des Users wenn Events von curt.de/termine/84/ gescraped werden sollen.
---

# Curt Termine Scraper

Dieser Skill extrahiert Event-Details von der spezifischen Seite https://www.curt.de/termine/84/. Die Liste selbst ist irrelevant - die Details zu den Events sind das relevante Ziel. Alle CSV-Dateien werden verbindlich im Ordner `data/` verwaltet.

## Datenqualität (Pipeline-kompatibel)

### Gemeinsame CSV-Regeln (Referenz: `skills/csv-handling`)

- **Dateibenennung (neu, datumsgestempelt)**: `data/curt-events-data-YYYY-MM-DD.csv` (+ `-2`, `-3` … bei >50). Nur im Ordner `data/` speichern.
- **Max. 50 Einträge pro CSV**: siehe `csv-handling`.
- **Vergangenheitsbereinigung** (`Startdatum < heute + 1 Tag`): siehe `csv-handling` (Events von heute sind nach App-Vorgabe nicht erlaubt, erst ab morgen).
- **Carry-Forward-Merge & Dedupe** (per `Detail-URL`): siehe `csv-handling` — beim Run jüngsten Bestand aus `data/` laden, bereinigen, mit neuen Events mergen, neues datumsgestempeltes Snapshot in `data/` schreiben.
- **Quoting & Zeichenbereinigung**: siehe `csv-handling`.

### Regel: Kategorien (App-Eventkategorie)

- `Kategorien` enthält **nur** den exakten App-Kategorie-`name` (ein Wert) oder bleibt **leer**
- Kein rohes CURT-Tag (z.B. KONZERT, THEATER) in die CSV schreiben
- Kein Semikolon-Mehrfachwert
- Rohe Quell-Kategorie nur intern als `sourceCategory` für die Zuordnung nutzen

### Regel: Abgesagte Events

Vor CSV-Aufnahme Event **überspringen** wenn:
- Titel: `/^abgesagt:/i` oder `/\b(abgesagt|cancelled|verschoben)\b/i`
- Beschreibung: `/ersatzlos abgesagt|wurde abgesagt/i`

Siehe README „Gemeinsame Regeln“ und `.cursorrules` Regel 8.

## Eventkategorie-Zuordnung

Details: `skills/event-category-mapper/` im Anwendungsordner (Site-Override: curt-termine-scraper).

### Mapping-Schritt (nach Extraktion, vor CSV-Schreiben)

1. Input: `sourceCategory`, `Titel`, `Beschreibung`
2. Regeln aus `skills/event-category-mapper/reference.md` anwenden
3. Output: genau einer der 7 `name`-Werte oder `""`
4. Validierung: `Kategorien` ist leer oder exakt einer der 7 Namen

## 🚨 SOFORTIGER BEFEHL BEI AUSFÜHRUNG

**WENN DIESER SKILL AUSGEFÜHRT WIRD:**

1. Bestand und Bereinigung wurden bereits vorab automatisch von der App erledigt (Phase 0).
2. **NAVIGIERE** zu https://www.curt.de/termine/84/
3. **FINDE** alle Event-Links (erkennbar am ">>" am Ende).
   - Melde gefundene Events als Plan über `announce_plan`.
   - Bei fehlenden Events Tag-URL nutzen: `https://www.curt.de/termine/84/tag/YYYY-MM-DD/`.
4. **FÜR JEDES EVENT** (standardmäßig max. 30 neue pro Run):
   - Klicke auf den Event-Link / navigiere zur Detailseite.
   - Extrahiere die 17 Standardfelder und ordne die App-Kategorie zu.
   - Rufe `add_event` auf.
   - Gehe zurück zur Liste für das nächste Event.
5. **STOPPE** nach maximal 30 neuen Events.
6. Beende den Lauf. Die App führt abschließend automatisch `node csv-import-check.js data` aus.
7. **MELDE PFLICHT-REPORT**: `Optimierung hinzugefügt` (Eintrag in `curt-optimization.md`) oder `Keine Optimierung nötig`.

## Workflow

### Phase 1: Liste analysieren & Kandidaten überblicken

1. **Navigiere zur Seite**
   - URL: `https://www.curt.de/termine/84/`
2. **Event-Links identifizieren & Plan melden**
   - Suche alle Links, die mit ">>" enden.
   - Rufe `announce_plan` mit den gefundenen Kandidaten auf.
3. **Tageswechsel-Logik**
   - Falls nötig, wechsle Tag per `https://www.curt.de/termine/84/tag/YYYY-MM-DD/`.

### Phase 2: Event-Details extrahieren & einzeln speichern

**Limit:** Scrape standardmäßig maximal **30 neue Events** pro Run.

Für jedes Event:
1. Detailseite aufrufen.
2. Felder extrahieren:
   - **title**, **description**, **startDate** (YYYY-MM-DD), **endDate**, **startTime**, **endTime**
   - **location**, **category**, **price**, **tickets** (ja/nein), **ticketUrl**
   - **email**, **phone**, **website**, **socialMedia**, **imageUrl**, **detailUrl**
3. `add_event` aufrufen und zurück zur Liste navigieren.
4. Bei 30 neuen Events stoppen.

### Phase 3: Abschluss

1. Keine Dateien manuell schreiben oder prüfen – das macht die App.
2. Pflicht-Report melden.

## Ausgabe

- **CSV-Dateien**: neu `data/curt-events-data-YYYY-MM-DD.csv` (und ggf. `-2`, `-3` … in `data/`)
- **Status**:
  - Anzahl entfernter vergangener Events (`Startdatum < heute + 1 Tag`)
  - Anzahl neu gescrapter Events
  - Gesamtanzahl Events und Anzahl erzeugter CSV-Dateien (Chunks)
  - **Kategorie-Statistik**: Anzahl pro zugewiesener Kategorie + Anzahl ohne Zuordnung
  - Ergebnis des CSV-Import-Checks (`OK`)

## Selbst-Optimierung

Die Ausführungserfahrung soll genutzt werden, um diesen Skill selbst zu verbessern – schneller, effizienter und robuster zu scrapen. **Wichtig: Dabei nicht zu deterministisch werden**, da sich die Seite jederzeit ändern kann.

### Ausführungs-Notizen (Pflicht)

**Pflicht-Report am Ende jedes Laufs:** Melde dem User am Ende IMMER genau einen der beiden Status zurück:
- `Optimierung hinzugefügt` – was konkret verbessert/notiert wurde, ODER
- `Keine Optimierung nötig` – es gab nichts Verbesserungswürdiges.

Notizen nur schreiben, wenn du WIRKLICH etwas gefunden hast (brüchiger Selektor, schnellere Navigation,
andere Seitenstruktur, oft fehlende/manuell nachzubearbeitende Felder u. a.). Dann kurze datierte Einträge
an den ANFANG von `curt-optimization.md` (ein Bullet pro Erkenntnis).
Wenn es nichts zu verbessern gibt, ist es KORREKT, KEINEN Eintrag zu schreiben – der Status-Report ist trotzdem Pflicht.

1. **Beim Start** (`Phase 0`): Lese die Datei `curt-optimization.md` im Ordner dieses Skills (`event-creator-app/skills/curt-termine-scraper/`), falls vorhanden. Behandle alle Einträge als **Hypothesen** – nie als Garantie.
2. **Während der Ausführung**: Beobachte laufend, was sich optimieren lässt.
3. **Am Ende**: Schreibe den Pflicht-Report (siehe oben). Falls du Verbesserungen notiert hast, ergänze sie datiert an den ANFANG von `curt-optimization.md`. Wenn nichts zu verbessern war, melde nur `Keine Optimierung nötig`.

### Restriktion (Anti-Determinismus)

- Starte **niemals** mit der Annahme, dass eine Notiz noch aktuell ist – validiere Selektoren/Abläufe **jeden Lauf gegen die Live-Seite**, bevor du dich darauf verlässt.
- Wenn sich die Seite geändert hat: Notiere das und falle auf die regulären Phasen dieses Skills zurück.
- Speichere nichts, das voraussetzt, dass sich die Seite nicht ändert.
- Optimiere nur innerhalb der Grenzen dieses Skills – die Pipeline-Regeln (50er-Chunking, Vergangenheitsfilter, Kategorien u. a.) bleiben unverändert verbindlich.
