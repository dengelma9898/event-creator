---
name: address-completion
description: Vervollständigt unvollständige Veranstaltungsorte (nur Einrichtungsname wie "Villa Leon", "Buni", "kultur.lokal.fürth") per kurzer Websuche im Playwright-Browser, bevor ein Event per add_event gespeichert wird. Verwende diesen Skill bei ALLEN *-scraper Skills, wenn der extrahierte Veranstaltungsort keine geocodierbare Adresse enthält.
---

# Address Completion (gemeinsam für alle Scraper)

Manche Quellen (z. B. Curt, Rausgegangen, Frankenkids, Fürth) liefern als Ort nur den Namen der Einrichtung, aber keine Straße oder PLZ. Ohne Adresse kann das Backend das Event nicht geocodieren (Koordinaten 0/0, UI zeigt „Adresse unvollständig“). Dieser Skill beschreibt die kurze Adresssuche, die der Agent **vor `add_event`** durchführt.

## Wann anwenden

Direkt nach der Extraktion, **vor** `add_event`: Prüfe `location` / `Veranstaltungsort`. Eine Adresse gilt als **ausreichend**, wenn sie eines der Muster erfüllt:

- `Venue, Straße Nr, PLZ Stadt` (Vollanschrift)
- `Venue, PLZ Stadt` (mindestens Name + 5-stellige PLZ + Stadt)
- `Venue, Straße Nr, Stadt` (ohne PLZ, aber mit Hausnummer und Stadt)

**Nicht ausreichend** (Suche nötig), z. B.:

- `Villa Leon`, `Buni`, `kultur.lokal.fürth`
- `Fürth`, `Nürnberg` (nur Stadt)
- `Meistersingerhalle - Großer Saal` (nur Venue/Saal)
- `Frankenstraße 200` (keine PLZ/Stadt)

## Wann NICHT anwenden

- Der Scraper-Skill definiert eine **feste Adresse** oder einen festen Suffix (z. B. Meistersingerhalle, E-Werk, Z-Bau, PARKS, GATE, Franmeisters). Diese Regeln haben Vorrang. Suche nur, wenn der Ort danach trotzdem unvollständig ist.
- Der Ort ist bereits ausreichend (siehe oben).
- Der Ort ist leer und es gibt keinen Namen, den man suchen könnte.

## Ablauf (max. eine kurze Suche pro Einrichtung)

1. **Einrichtungsname bestimmen**: Name aus `location` (ohne Saal-/Raumzusatz wie „Großer Saal“, „Etage 1“).
2. **Region wählen**: Stadt aus Quellkontext (z. B. Fürth bei fuerth.de, Nürnberg bei Nürnberg-Quellen). Ist sie unbekannt, nutze `Nürnberg Fürth Erlangen`.
3. Optional `report_step` aufrufen, z. B. `Adresse nachschlagen: Villa Leon`.
4. **Suche per Playwright** (kein anderes Werkzeug, keine Python-Skripte, keine Geocoding-API):
   - Navigiere zu `https://duckduckgo.com/?q="<Einrichtungsname>" <Stadt> Adresse`.
   - Lies Straße, Hausnummer, PLZ und Stadt aus den Snippets oder den Karten-/Infoboxen der Ergebnisse.
   - Bevorzuge die offizielle Website, Google/OSM-Infoboxen oder Stadtportale. Max. ein zusätzlicher Klick auf einen offiziellen Treffer, wenn die Snippets nicht reichen.
5. **Ergebnis zusammensetzen**: `<Einrichtungsname>, <Straße Nr>, <PLZ> <Stadt>`
   - Beispiel: `Villa Leon, Philipp-Körber-Weg 1, 90439 Nürnberg`
   - Einrichtungsname (und ggf. Saal) bleibt erhalten; ergänzt wird nur die Adresse.
6. **Zurück zur Quelle** navigieren und mit dem nächsten Event weitermachen.

## Cache innerhalb eines Laufs

Dieselbe Einrichtung kommt oft mehrfach vor. Merke dir die ermittelte Adresse **für den Rest des Laufs** und suche pro Einrichtung nur einmal.

## Wenn keine Adresse gefunden wird

- Glaubwürdige Treffer fehlen, sind mehrdeutig (mehrere Standorte, Namensgleichheit) oder widersprüchlich: **nichts raten**.
- Behalte den ursprünglichen Namen in `location` und **speichere das Event trotzdem** per `add_event`. Das Event wird **nicht** übersprungen.
- Die App markiert solche Events weiterhin als „Adresse unvollständig“, damit sie manuell nachbearbeitet werden können.
- Nenne die betroffenen Einrichtungen im Abschluss-Report (Zeile „Adresse nicht gefunden: …“).

## Grenzen

- Keine tiefe Recherche: höchstens eine Suchseite plus ein Klick pro Einrichtung.
- Keine erfundenen oder aus dem Gedächtnis ergänzten Adressen; nur Adressen aus der Suche übernehmen.
- Kein Python, Selenium, Requests oder BeautifulSoup. Nur Playwright MCP.
- Die Suche ändert nichts an den übrigen Event-Feldern.
