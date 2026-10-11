import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

interface FileSnapshot {
  relativePath: string;
  originalContent: Buffer;
  exists: boolean;
}

/**
 * Verwaltet transaktionale Snapshots des Ausgabeordners data/ sowie
 * die kontrollierte Prozessbereinigung bei Abbruch oder Fehlschlag.
 * Implementiert AP 2.4 (Stufe 2 und Stufe 3 der Abbruchroutine).
 */
export class RollbackManager {
  private dataDir: string;
  private snapshotFiles: Map<string, FileSnapshot> = new Map();
  private isSnapshotActive = false;
  private trackedPids: Set<number> = new Set();

  constructor(dataDir: string) {
    this.dataDir = path.resolve(dataDir);
  }

  public getDataDir(): string {
    return this.dataDir;
  }

  /**
   * Registriert eine Prozess-ID zur Überwachung und Bereinigung.
   */
  public trackPid(pid: number): void {
    if (pid > 0) {
      this.trackedPids.add(pid);
    }
  }

  /**
   * Erstellt vor dem Start eines Terminabrufs einen vollständigen Snapshot aller Dateien in data/.
   */
  public takeSnapshot(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    this.snapshotFiles.clear();
    const existingFiles = this.scanDir(this.dataDir);

    for (const relPath of existingFiles) {
      const fullPath = path.join(this.dataDir, relPath);
      try {
        const content = fs.readFileSync(fullPath);
        this.snapshotFiles.set(relPath, {
          relativePath: relPath,
          originalContent: content,
          exists: true,
        });
      } catch (err) {
        console.warn(`[RollbackManager] Konnte Snapshot-Datei ${relPath} nicht lesen:`, err);
      }
    }

    this.isSnapshotActive = true;
    console.log(`[RollbackManager] Snapshot von ${this.snapshotFiles.size} Dateien in ${this.dataDir} erstellt.`);
  }

  /**
   * Gibt den Snapshot nach erfolgreicher Validierung frei (Commit).
   */
  public commit(): string[] {
    if (!this.isSnapshotActive) return [];

    const currentFiles = this.scanDir(this.dataDir);
    const newOrModified: string[] = [];

    for (const relPath of currentFiles) {
      const snap = this.snapshotFiles.get(relPath);
      if (!snap) {
        newOrModified.push(path.join(this.dataDir, relPath));
      } else {
        const fullPath = path.join(this.dataDir, relPath);
        try {
          const currentContent = fs.readFileSync(fullPath);
          if (!currentContent.equals(snap.originalContent)) {
            newOrModified.push(fullPath);
          }
        } catch {
          // ignore
        }
      }
    }

    this.snapshotFiles.clear();
    this.isSnapshotActive = false;
    this.trackedPids.clear();
    return newOrModified;
  }

  /**
   * Prüft, welche Dateien neu oder modifiziert wurden, ohne den Snapshot zu schließen.
   */
  public getModifiedFiles(): string[] {
    if (!this.isSnapshotActive) return [];

    const currentFiles = this.scanDir(this.dataDir);
    const newOrModified: string[] = [];

    for (const relPath of currentFiles) {
      const snap = this.snapshotFiles.get(relPath);
      if (!snap) {
        newOrModified.push(path.join(this.dataDir, relPath));
      } else {
        const fullPath = path.join(this.dataDir, relPath);
        try {
          const currentContent = fs.readFileSync(fullPath);
          if (!currentContent.equals(snap.originalContent)) {
            newOrModified.push(fullPath);
          }
        } catch {
          // ignore
        }
      }
    }

    return newOrModified;
  }

  /**
   * Führt ein transaktionales Rollback durch (Stufe 3):
   * - Neu erstellte Dateien werden gelöscht.
   * - Modifizierte Dateien werden auf den ursprünglichen Stand zurückgesetzt.
   * - Gelöschte Dateien werden wiederhergestellt.
   */
  public rollback(): void {
    if (!this.isSnapshotActive) return;

    try {
      const currentFiles = this.scanDir(this.dataDir);

      // 1. Neu erstellte Dateien entfernen
      for (const relPath of currentFiles) {
        if (!this.snapshotFiles.has(relPath)) {
          const fullPath = path.join(this.dataDir, relPath);
          try {
            if (fs.existsSync(fullPath)) {
              fs.unlinkSync(fullPath);
              console.log(`[RollbackManager] Rollback: Neue Datei gelöscht -> ${relPath}`);
            }
          } catch (err) {
            console.error(`[RollbackManager] Fehler beim Löschen von ${relPath}:`, err);
          }
        }
      }

      // 2. Modifizierte oder versehentlich gelöschte Dateien wiederherstellen
      for (const [relPath, snap] of this.snapshotFiles.entries()) {
        const fullPath = path.join(this.dataDir, relPath);
        try {
          let needsRestore = false;
          if (!fs.existsSync(fullPath)) {
            needsRestore = true;
          } else {
            const currentContent = fs.readFileSync(fullPath);
            if (!currentContent.equals(snap.originalContent)) {
              needsRestore = true;
            }
          }

          if (needsRestore) {
            fs.writeFileSync(fullPath, snap.originalContent);
            console.log(`[RollbackManager] Rollback: Datei wiederhergestellt -> ${relPath}`);
          }
        } catch (err) {
          console.error(`[RollbackManager] Fehler bei Wiederherstellung von ${relPath}:`, err);
        }
      }
    } finally {
      this.snapshotFiles.clear();
      this.isSnapshotActive = false;
    }
  }

  /**
   * Stufe 2 der Abbruchroutine: Beendet explizit getrackte Prozesse sowie
   * verwaiste Playwright/Chromium-Headless-Prozesse.
   */
  public async cleanupOrphanProcesses(): Promise<void> {
    // 1. Getrackte PIDs beenden
    for (const pid of this.trackedPids) {
      try {
        process.kill(pid, 'SIGKILL');
        console.log(`[RollbackManager] Getrackten Prozess beendet: PID ${pid}`);
      } catch {
        // Prozess existiert bereits nicht mehr
      }
    }
    this.trackedPids.clear();

    // 2. Verwaiste Playwright-Chromium-Browser aufspüren und schließen
    try {
      // Nur Headless-Chromium / Playwright Prozesse filtern, niemals normale User-Browser!
      const { stdout } = await execAsync(
        "ps -eo pid,command | grep -E '[p]laywright.*chromium|[c]hromium.*--headless' | awk '{print $1}'"
      );
      const pids = stdout
        .split('\n')
        .map((line) => parseInt(line.trim(), 10))
        .filter((pid) => !isNaN(pid) && pid > 0);

      for (const orphanPid of pids) {
        try {
          process.kill(orphanPid, 'SIGTERM');
          console.log(`[RollbackManager] Verwaisten Browser-Prozess beendet: PID ${orphanPid}`);
        } catch {
          // Bereits beendet
        }
      }
    } catch {
      // ps / grep Fehler unkritisch (z. B. keine passenden Prozesse gefunden)
    }
  }

  /**
   * Nur CSV-Dateien zählen als Bestand des Ausgabeordners.
   *
   * Der Agent legt beim Scrapen regelmäßig Hilfsskripte und Zwischendateien
   * in `data/` ab (z. B. `data/build-csv.mjs`). Würden die mitgeschnitten,
   * meldete ein Lauf sie als "gespeicherte Datei", zählte ihre Zeilen als
   * Termine und ein Rollback löschte beim nächsten Fehlschlag Nutzerdateien.
   */
  private scanDir(dir: string, base: string = ''): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // .gitkeep etc. überspringen
      const rel = base ? path.join(base, entry.name) : entry.name;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        results.push(...this.scanDir(full, rel));
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.csv')) {
        results.push(rel);
      }
    }
    return results;
  }
}
