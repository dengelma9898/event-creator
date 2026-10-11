# Event Creator einrichten – Schritt für Schritt (Intel-Mac)

Diese Anleitung richtet sich an Personen **ohne technische Vorkenntnisse**.  
Du brauchst nur etwas Zeit, eine stabile Internetverbindung und Geduld. Viele Schritte dauern beim ersten Mal länger – das ist normal.

Am Ende hast du die App **Event Creator** gebaut, gestartet und **einen ersten Terminabruf erfolgreich durchgeführt**.

---

## Für welchen Computer gilt diese Anleitung?

Diese Anleitung ist für einen **Intel-basierten Mac** gedacht, zum Beispiel:

- **Modell:** MacBook Pro (15 Zoll, 2018)
- **Prozessor:** Intel Core i7
- **macOS:** Sequoia 15 (oder vergleichbar)

### So prüfst du, ob dein Mac passt

1. Klicke oben links auf das **Apfel-Menü** ().
2. Klicke auf **Über diesen Mac**.
3. Unter **Prozessor** / **Chip** sollte etwas mit **Intel** stehen (nicht „Apple M1/M2/M3/M4“).

Wenn dort **Apple M1, M2, M3 oder M4** steht, gilt diese Anleitung **nicht**. Sag Domi Bescheid.

---

## Was du schon hast / brauchst

| Voraussetzung | Status |
|---|---|
| Mac mit Intel-Prozessor | muss vorhanden sein |
| macOS Sequoia (oder ähnlich aktuell) | muss vorhanden sein |
| Internetverbindung | muss funktionieren (auch während des ersten Abrufs) |
| **Git** (Programm zum Herunterladen von Code) | laut Domi bereits vorhanden |
| **Cursor-Zugangsschlüssel** | bekommst du **von Domi**, wenn die Anleitung danach fragt |
| Node.js | installierst du in Schritt 2 |
| Hintergrund-Browser (Playwright/Chromium) | installierst du in Schritt 5 |

Du musst **kein** Apple-Entwicklerkonto haben.

---

## Wichtige Tipps vor dem Start

1. **Immer nur einen Schritt auf einmal** machen. Erst fertig, dann weiter.
2. Text, der in grauen Kästen steht, ist ein **Befehl**. Den kopierst du und fügst ihn im Terminal ein.
3. Nach jedem Befehl die **Return-Taste** (Enter) drücken.
4. Wenn etwas **rot** wird oder „Error“ / „Fehler“ erscheint: **nicht weiterprobieren**. Screenshot machen und Domi fragen.
5. Manche Schritte dauern **mehrere Minuten**. Warte, bis der Computer wieder eine neue Zeile zeigt und du tippen kannst.
6. Der Mac sollte während Build und erstem Abruf **nicht in den Ruhezustand** gehen.

---

## Schritt 1: Das Terminal öffnen

Das Terminal ist ein Fenster, in dem du kurze Textbefehle eingeben kannst.

1. Drücke gleichzeitig **Befehlstaste (⌘) + Leertaste**.  
   Oben erscheint die Spotlight-Suche.
2. Tippe: `Terminal`
3. Drücke **Return**.

Es öffnet sich ein Fenster mit Text. Das ist richtig so.

### Kurz testen, ob Git da ist

Kopiere diesen Befehl ins Terminal und drücke Return:

```bash
git --version
```

**Erwartetes Ergebnis:** Eine Zeile wie `git version 2.xxx…`  
Wenn eine Fehlermeldung kommt („command not found“), stoppe hier und melde dich bei Domi.

---

## Schritt 2: Node.js installieren (offizieller Installer)

Node.js ist ein Programm, das die App zum Bauen braucht.  
Wir nutzen den **offiziellen Installer** von der Node.js-Website – **nicht** Homebrew und keine anderen Umwege.

### 2.1 Installer herunterladen

1. Öffne den Browser (Safari oder Chrome).
2. Gehe zu: [https://nodejs.org/](https://nodejs.org/)
3. Lade die Version mit dem Hinweis **LTS** herunter  
   (Long Term Support = die stabile Empfehlung).
4. Wähle den Installer für **macOS**.  
   Auf der Seite sollte es einen Download für macOS geben.  
   Für deinen Intel-Mac ist die passende Variante die **x64**-Version, falls die Seite zwischen „ARM64“ und „x64“ unterscheidet.  
   - **x64** = Intel → richtig für dich  
   - **ARM64 / Apple Silicon** = falsch für dich

Falls unsicher: Domi fragen, bevor du etwas installierst.

### 2.2 Installer ausführen

1. Öffne die heruntergeladene Datei (endet oft auf `.pkg`).
2. Folge dem Installationsassistenten mit **Weiter** / **Fortfahren**.
3. Wenn nach dem Administrator-Passwort gefragt wird: das normale Mac-Anmeldepasswort eingeben.
4. Am Ende auf **Schließen** klicken.

### 2.3 Installation prüfen

**Wichtig:** Schließe das Terminal-Fenster komplett und öffne es **neu** (wie in Schritt 1).  
Nur so erkennt das Terminal die neue Installation.

Dann nacheinander diese beiden Befehle ausführen:

```bash
node -v
```

```bash
npm -v
```

**Erwartetes Ergebnis:** Bei beiden erscheint eine Versionsnummer, z. B. `v22.x.x` und `10.x.x`.  
Beide müssen funktionieren. Sonst hier stoppen und Domi fragen.

---

## Schritt 3: Projektordner anlegen und Code holen

Wir legen einen einfachen Ordner an und laden den Programmcode von GitHub.

### 3.1 In den Dokumente-Ordner wechseln

Im Terminal:

```bash
cd ~/Documents
```

### 3.2 Code von GitHub herunterladen

```bash
git clone https://github.com/dengelma9898/event-creator.git
```

Das kann eine Weile dauern. Am Ende sollte etwas wie `Cloning into 'event-creator'...` und danach wieder die Eingabezeile erscheinen.

### 3.3 In den Projektordner wechseln

```bash
cd ~/Documents/event-creator
```

### 3.4 Prüfen, ob du am richtigen Ort bist

```bash
ls
```

Du solltest unter anderem Dateien/Ordner wie `package.json`, `src` und `skills` sehen.  
Wenn das nicht der Fall ist: stoppen und Domi fragen.

---

## Schritt 4: Hilfsprogramme der App installieren

Immer noch im Ordner `event-creator` diesen Befehl ausführen:

```bash
npm install
```

### Was passiert jetzt?

Der Computer lädt viele kleine Programmbausteine herunter.  
Das kann **5–20 Minuten** dauern und erzeugt viel Textausgabe. Das ist normal.

### Wann bist du fertig?

Wenn wieder eine normale Eingabezeile erscheint und **keine** rote Fehlermeldung am Ende steht.  
Wenn ganz unten etwas mit `npm error` oder `ERR!` steht: stoppen und Domi fragen.

---

## Schritt 5: Hintergrund-Browser installieren (Playwright / Chromium)

Die App öffnet Webseiten **nicht** mit Safari, sondern mit einem eigenen unsichtbaren Browser im Hintergrund.  
Diesen Browser musst du **einmalig** herunterladen – sonst schlägt der Terminabruf später fehl.

Stelle sicher, dass du noch im Projektordner bist:

```bash
cd ~/Documents/event-creator
```

Dann:

```bash
npx playwright install chromium
```

### Was passiert jetzt?

- Es wird Chromium (ein Chrome-ähnlicher Browser) heruntergeladen.
- Das kann **mehrere Minuten** dauern und braucht Internet.
- Die Dateien landen automatisch in einem Systemordner deines Macs (`Library/Caches`). Du musst dort nichts von Hand öffnen.

### Wann bist du fertig?

Wenn wieder die normale Eingabezeile erscheint und **keine** Fehlermeldung am Ende steht.

Falls macOS nach Netzwerkzugriff fragt: erlauben.

Wenn der Befehl mit Fehler endet: stoppen und Domi fragen (Screenshot der letzten Zeilen mitschicken).

---

## Schritt 6: Die App für Intel-Macs bauen

Jetzt wird aus dem Code eine echte Mac-App gebaut.

Im Terminal (weiterhin im Ordner `event-creator`):

```bash
npm run package:intel
```

### Was passiert jetzt?

- Zuerst wird ein spezielles Intel-Bauteil nachgeladen.
- Danach wird die App zusammengesetzt.
- Am Ende liegen fertige Dateien im Ordner `release`.

Das kann **mehrere Minuten** dauern. Computer nicht in den Ruhezustand schicken und das Terminal-Fenster offen lassen.

### Erfolg prüfen

```bash
ls release/mac
```

**Erwartetes Ergebnis:** Du siehst `Event Creator.app`.

Falls der Ordner fehlt oder leer ist: stoppen und Domi fragen.

---

## Schritt 7: Die App starten (macOS-Sicherheitswarnung)

Die App ist aktuell **nicht** von Apple signiert. Beim ersten Start warnt macOS deshalb oft.

### Richtiger Weg (wichtig)

1. Öffne den **Finder**.
2. Gehe zu: **Dokumente → event-creator → release → mac**
3. Suche die App **Event Creator**.
4. **Nicht** doppelklicken.
5. Stattdessen: **Rechtsklick** (oder Control-Klick) auf **Event Creator**.
6. Wähle **Öffnen**.
7. Im Dialog erneut auf **Öffnen** klicken.

Ab dem zweiten Mal reicht meist normales Doppelklicken.

### Falls macOS die App komplett blockiert

1. Öffne **Systemeinstellungen**.
2. Gehe zu **Datenschutz & Sicherheit**.
3. Suche den Hinweis zu **Event Creator**.
4. Klicke auf **Trotzdem öffnen** (Wortlaut kann leicht abweichen).
5. Nochmal bestätigen.

Wenn gar nichts geht: Domi fragen.

---

## Schritt 8: Zugangsschlüssel eintragen (von Domi)

Beim **ersten Start** erscheint ein Willkommensfenster.  
Die App fragt nach einem **Zugriffsschlüssel** (Cursor API Key).

### Was du jetzt brauchst

Frage **Domi** nach dem Zugangsschlüssel.  
Du musst ihn **nicht selbst** erzeugen.

### So trägst du ihn ein

1. Warte, bis Domi dir den Schlüssel geschickt hat.
2. Kopiere den Schlüssel genau so, wie Domi ihn dir gibt (am besten per Kopieren/Einfügen).
3. Füge ihn in das Feld im Willkommensfenster ein.
4. Speichern / Bestätigen.

Der Schlüssel wird verschlüsselt auf deinem Mac gespeichert.  
Du musst ihn danach nicht jedes Mal neu eingeben.

### Falls du das Fenster geschlossen hast

1. Öffne die App erneut.
2. Drücke **⌘ + ,** (Befehlstaste + Komma), um die Einstellungen zu öffnen.
3. Trage den Schlüssel dort ein.

**Ohne diesen Schlüssel funktioniert der Terminabruf nicht.** Erst weiter zu Schritt 9, wenn der Schlüssel gespeichert ist.

---

## Schritt 9: Ersten Terminabruf erfolgreich durchführen

Jetzt prüfst du, ob wirklich alles funktioniert: App, Schlüssel und Hintergrund-Browser.

### 9.1 Reiter öffnen

1. Stelle sicher, dass Event Creator geöffnet ist.
2. Oben auf den Reiter **„Termine abrufen“** klicken (falls nicht schon aktiv).

### 9.2 Webseite auswählen

1. Klicke auf das Auswahlfeld für die Webseite.
2. Wähle für den ersten Test z. B. **„E-Werk Erlangen“**  
   (oder eine andere Quelle, die Domi dir ausdrücklich empfiehlt).

### 9.3 Abruf starten

1. Klicke auf den blauen Button **▶ Termine jetzt abrufen**.
2. Die App arbeitet jetzt im Hintergrund. Das kann **einige Minuten** dauern.
3. Laptop am Strom lassen, Internet nicht trennen, App nicht schließen.

Du siehst Fortschrittsmeldungen (z. B. dass die Webseite geöffnet wird, Termine geprüft werden usw.). Das ist normal.

### 9.4 Erfolg erkennen

Der Abruf war erfolgreich, wenn du **mindestens eines** davon siehst:

- einen **grünen Haken** / Erfolgsmeldung in der App
- den Button **📁 Datei im Finder anzeigen**
- und nach Klick darauf einen Ordner mit einer Tabellendatei (endet auf `.csv`)

Optional: Öffne die Datei kurz im Finder – sie sollte nicht leer sein (außer Domi sagt, dass gerade keine zukünftigen Termine vorhanden sind).

### 9.5 Wenn etwas schiefgeht

Erscheint eine Meldung wie:

> *„Hier hat etwas nicht geklappt. Frag Domi wie das geht.“*

dann so vorgehen:

1. Auf **📋 Details für Domi kopieren** klicken.
2. Die Nachricht per Mail/Chat an Domi schicken (`⌘ + V` zum Einfügen).
3. **Nicht** mehrfach wild neu starten, bevor Domi geantwortet hat.

Typische Ursachen beim allerersten Mal:

| Symptom | Was oft fehlt |
|---|---|
| Abruf startet nicht / Schlüssel-Hinweis | Schritt 8 (Zugangsschlüssel) |
| Browser-/Playwright-Fehler | Schritt 5 erneut ausführen |
| Internet-/Zeitüberschreitung | WLAN prüfen, später noch einmal versuchen |

---

## Fertig – wann bist du durch?

Du bist fertig, wenn **alles** zutrifft:

1. Die App **Event Creator** startet und zeigt ein Fenster.
2. Der Zugangsschlüssel ist eingetragen.
3. Chromium/Playwright wurde installiert (Schritt 5).
4. Ein Terminabruf (z. B. E-Werk) ist **durchgelaufen**.
5. Du siehst den Erfolg in der App und kannst die Ergebnisdatei im Finder öffnen.

Damit ist die Einrichtung abgeschlossen – inklusive erstem erfolgreichen Eventabruf.

---

## Kurze Befehls-Übersicht (zum Nachschlagen)

Nur verwenden, wenn du die Schritte oben schon einmal gemacht hast:

```bash
# Terminal neu öffnen, dann:
cd ~/Documents/event-creator
npm install
npx playwright install chromium
npm run package:intel
```

Danach die App im Finder unter:

`Dokumente / event-creator / release / mac / Event Creator.app`

per **Rechtsklick → Öffnen** starten, Schlüssel eintragen und einen Terminabruf testen.

---

## Häufige Probleme

### „command not found: node“ oder „npm“
- Terminal komplett schließen und neu öffnen.
- Node.js-Installation (Schritt 2) prüfen.
- Sonst: Domi fragen.

### „command not found: git“
- Git fehlt trotz Annahme. Domi fragen.

### `npm install`, `npx playwright install chromium` oder `npm run package:intel` bricht mit Fehler ab
- Screenshot der letzten 10–20 Zeilen machen.
- Domi schicken. Nicht weiter „probieren“.

### App startet nicht / „beschädigt“ / „unbekannter Entwickler“
- Schritt 7 mit Rechtsklick → Öffnen versuchen.
- Sonst: Domi fragen.

### Willkommensfenster erscheint, aber du hast keinen Schlüssel
- Bei Domi den Zugangsschlüssel anfordern.
- Ohne diesen Schlüssel ist die Einrichtung nicht abgeschlossen.

### Terminabruf scheitert mit Browser-/Playwright-Hinweis
Im Terminal noch einmal:

```bash
cd ~/Documents/event-creator
npx playwright install chromium
```

Danach die App neu starten und den Abruf wiederholen. Wenn es weiter hakt: Domi die kopierten Fehlerdetails schicken.

### Abruf läuft sehr lange und bricht ab
- Internet prüfen.
- Eine andere Webseite aus der Liste testen (nach Absprache mit Domi).
- Fehlerdetails kopieren und an Domi senden.

---

## Was du Domi schicken kannst, wenn etwas hakt

Am hilfreichsten sind:

1. Ein Screenshot der Fehlermeldung.
2. Falls vorhanden: der Text aus **📋 Details für Domi kopieren**.
3. Die Ausgabe der folgenden Befehle (jeweils im Terminal):

```bash
uname -m
```

```bash
sw_vers
```

```bash
node -v
```

```bash
npm -v
```

```bash
git --version
```

```bash
npx playwright --version
```

`uname -m` sollte bei dir `x86_64` zeigen (Intel).  
Wenn dort `arm64` steht, bist du auf einem Apple-Silicon-Mac – dann stimmt diese Anleitung nicht.

---

## Hinweis für Domi (technisch)

- Repo: `https://github.com/dengelma9898/event-creator.git`
- Intel-Build: `npm run package:intel` (führt intern `scripts/prepare-intel.mjs` aus)
- App-Pfad nach Build: `release/mac/Event Creator.app`
- Playwright: `@playwright/mcp` kommt mit `npm install`; Chromium-Binaries separat via `npx playwright install chromium` nach `~/Library/Caches/ms-playwright`
- API-Key: wird von Domi bereitgestellt und in der App über safeStorage/Keychain gespeichert
- Erfolgsdefinition dieser Anleitung: App startet + Key hinterlegt + erster erfolgreicher Terminabruf (CSV im Finder sichtbar)
- Empfohlener Ersttest: E-Werk Erlangen
- Zielgerät dieser Anleitung: MacBook Pro 15" 2018, Intel Core i7, macOS Sequoia 15.7.9
