# Struktur: der Prozess-Saum

Kurzfassung für spätere Durchgänge. Ausführlich ist der Vertrag in
`src/shared/ipc-contract.ts` kommentiert.

## Wer besitzt was

| Ort | Besitzt | Kennt Electron? |
|---|---|---|
| `src/shared/ipc-contract.ts` | Kanalnamen, Anfrage-/Antworttypen, die abgeleitete `ElectronAPI` | nein |
| `src/main/ipc.ts` | die Zuordnung Kanal → Handler, die Herkunftsprüfung | ja |
| `src/preload/preload.ts` | nichts als den Aufruf von `buildElectronApi` | ja |
| `src/shared/types.ts` | fachliche Typen (`CsvEventRecord`, `RunStatusUpdate`, …) | nein |

Daten fließen in eine Richtung: `IpcContract` beschreibt, `ipc-contract.ts` baut
daraus die Oberfläche, `preload.ts` stellt sie dem Renderer bereit, `ipc.ts`
bedient sie im Hauptprozess. Kein Modul kennt ein anderes als diese Kanten.

## Ein Kanal hinzufügen

1. Eine Zeile in `IpcContract` (Name, Anfrage, Antwort).
2. Eine Zeile in `IPC_CHANNELS` (darunter: `satisfies` merkt Tippfehler).
3. Einen Handler in `buildIpcHandlers` – die Form ist vom Vertrag vorgegeben.

`preload.ts` und `types.ts` werden **nicht** angefasst. `Window.electronAPI` und
`ElectronAPI` sind abgeleitet, es gibt keine zweite Niederschrift mehr, die
driften könnte. Fehlt Schritt 2, bricht `preload.ts` beim Bauen; fehlt Schritt 3,
bricht `ipc.ts` beim Bauen. Beides ist ein Compilerfehler, kein Laufzeitwunder.

## Namentliche Ausnahmen

- `ping` hat keinen Namespace und liegt deshalb direkt auf `api`. Das ist
  mechanisch abgeleitet, keine Sonderregel im Code.
- Die drei Sendekanäle heißen nicht `ns:method`, deshalb nennt
  `EVENT_SUBSCRIPTIONS` den Zielpfad ausdrücklich (`menu:open-settings` →
  `api.settings.onOpenSettings`). Der **Typ** der Nutzlast kommt trotzdem aus
  `IpcEvents` und kann nicht driften.

## Herkunftsprüfung

`assertOwnFrame` in `ipc.ts` steckt in der Registrierschleife, nicht in den
Handlern: kein Handler kann sie vergessen, und ein Handler, der sie braucht,
bekommt sie ohne Zusatzaufwand. Sie lehnt jeden Aufruf ab, dessen `sender` nicht
das eigene `webContents` ist oder dessen `senderFrame` nicht der Hauptframe ist.
Im Renderer ist sie nicht sichtbar; der Preload bietet sie nicht an.

## Dienste

`buildIpcHandlers(deps)` nimmt seine Dienste als Parameter (`IpcDeps`) und greift
selbst nirgends nach Singletons. Nur `registerIpcHandlers` baut sie aus
`AppPaths`, `KeychainStore`, `SkillLoader`, `AgentRunner`, `AssistantService` und
`CsvService`. Dadurch lässt sich die Zuordnung Kanal → Handler ohne Electron und
ohne Dateisystem prüfen (`ipc.test.ts`).

## Tests

`npm test` bündelt die Suites unter `src/main/*.test.ts` mit esbuild. Electron
und `@cursor/sdk` werden dabei durch `src/main/_electron-stub.ts` bzw.
`src/main/_cursor-sdk-stub.ts` ersetzt – beide lassen sich in
`scripts/run-tests.mjs` per `alias` eintragen. Die Electron-Attrappe merkt sich
jeden registrierten Listener; so prüft `ipc.test.ts`, dass genau die
Vertragskanäle registriert wurden und dass die Herkunftsprüfung greift.
