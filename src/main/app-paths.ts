import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';

function currentDir(): string {
  if (typeof __dirname !== 'undefined' && __dirname) {
    return __dirname;
  }
  try {
    if (typeof import.meta !== 'undefined' && import.meta && import.meta.url) {
      return path.dirname(fileURLToPath(import.meta.url));
    }
  } catch {
    // ignore
  }
  return process.cwd();
}

/** Lauft von einem Startverzeichnis aus bis zu 6 Ebenen nach oben auf den Projektroot. */
function walkUpForRepoRoot(startDir: string): string {
  let curr = startDir;
  for (let i = 0; i < 6; i++) {
    // Der Projektroot ist die einzige Ebene, die beides enthält.
    if (
      fs.existsSync(path.join(curr, 'csv-import-check.js')) &&
      fs.existsSync(path.join(curr, 'event-creator-app'))
    ) {
      return curr;
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return path.resolve(startDir, '../../..');
}

/** True, wenn `child` in `root` liegt (nach Auflösung von Symlinks). */
function isInside(root: string, child: string): boolean {
  const rel = path.relative(root, child);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

function realPathOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * True, wenn `p` im ausgelieferten App-Bundle liegt (`…/Foo.app/Contents/…`).
 *
 * Eine installierte App darf dort nichts schreiben: das Bundle gehört dem
 * Hersteller, wird beim nächsten Update ersetzt und verliert dabei seinen
 * Code-Signatur-Siegel. Genau dorthin hatte die gepackte App vorher ihre
 * CSVs gelegt, wodurch jeder scraped Datenbestand beim Update wieder
 * verschwand.
 */
function isInsideAppBundle(p: string): boolean {
  const resources = process.resourcesPath;
  if (!resources) return false;
  // `resources` ist `…/Foo.app/Contents/Resources`; die .app ist zwei Ebenen höher.
  const appBundle = path.dirname(path.dirname(resources));
  return isInside(resources, p) || isInside(appBundle, p);
}

/** Der Nutzerordner von Electron – ausserhalb des Electron-Kontexts `null`. */
function electronUserDataDir(): string | null {
  if (app && typeof app.getPath === 'function') {
    return app.getPath('userData');
  }
  return null;
}

/** Kopiert `src` nach `dest`, aber nur Dateien, deren Inhalt sich unterscheidet. */
function mirrorDir(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      mirrorDir(from, to);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      if (fs.existsSync(to) && fs.readFileSync(to).equals(fs.readFileSync(from))) continue;
    } catch {
      // nicht lesbar -> einfach neu schreiben
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

/** Legt eine Kopie der Datei an, falls sie fehlt oder abweicht. */
function mirrorFile(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  try {
    if (fs.existsSync(dest) && fs.readFileSync(dest).equals(fs.readFileSync(src))) return;
  } catch {
    // nicht lesbar -> einfach neu schreiben
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

export type CsvFileResolution =
  | { ok: true; filePath: string }
  | { ok: false; error: string };

/**
 * Einzige Quelle der Wahrheit für alle app-eigenen Pfade.
 *
 * Der Renderer benennt Dateien ausschließlich über `fileName` (Bare-Name).
 * Jede Auflösung passiert hier gegen die konfigurierten Wurzeln und wird gegen
 * Traversal, absolute Escapes und herausführende Symlinks abgesichert.
 */
export class AppPaths {
  private static instance: AppPaths | null = null;

  public readonly appRoot: string;
  public readonly repoRoot: string;
  public readonly dataDir: string;
  public readonly skillsDir: string;
  public readonly csvCheckScript: string;
  public readonly playwrightCliPath: string;

  constructor(customDataDir?: string) {
    this.appRoot = process.env.APP_ROOT || path.resolve(currentDir(), '..');
    const repoCandidate = path.resolve(this.appRoot, '..');

    if (process.env.EVENT_CREATOR_REPO_ROOT) {
      this.repoRoot = path.resolve(process.env.EVENT_CREATOR_REPO_ROOT);
    } else if (process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'csv-import-check.js'))) {
      // Gepackte App: der Bundle-Ordner ist nur die Quelle, nicht das Ziel.
      this.repoRoot = this.ensureWorkspace(process.resourcesPath);
    } else if (fs.existsSync(path.join(repoCandidate, 'csv-import-check.js'))) {
      this.repoRoot = repoCandidate;
    } else if (fs.existsSync(path.join(this.appRoot, 'csv-import-check.js'))) {
      this.repoRoot = this.appRoot;
    } else {
      this.repoRoot = walkUpForRepoRoot(currentDir());
    }

    if (customDataDir) {
      this.dataDir = path.resolve(customDataDir);
    } else if (process.env.EVENT_CREATOR_DATA_DIR) {
      this.dataDir = path.resolve(process.env.EVENT_CREATOR_DATA_DIR);
    } else {
      this.dataDir = path.join(this.repoRoot, 'data');
    }
    if (isInsideAppBundle(this.dataDir)) {
      console.warn(
        `[AppPaths] WARNUNG: Der Ausgabeordner liegt im App-Bundle (${this.dataDir}). ` +
          'Termine gehen beim nächsten Update verloren.'
      );
    }
    fs.mkdirSync(this.dataDir, { recursive: true });

    const skillCandidates = [
      process.resourcesPath ? path.join(process.resourcesPath, 'skills') : null,
      process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'skills') : null,
      path.join(this.appRoot, 'skills'),
      path.resolve(process.cwd(), 'skills'),
      path.resolve(process.cwd(), 'event-creator-app/skills'),
      path.resolve(this.appRoot, '..', 'skills'),
    ].filter(Boolean) as string[];
    this.skillsDir = skillCandidates.find((dir) => fs.existsSync(dir)) || path.join(this.appRoot, 'skills');

    const checkCandidates = [
      process.resourcesPath ? path.join(process.resourcesPath, 'csv-import-check.js') : null,
      path.join(this.repoRoot, 'csv-import-check.js'),
      path.join(this.appRoot, 'csv-import-check.js'),
      path.resolve(process.cwd(), 'csv-import-check.js'),
      path.resolve(process.cwd(), 'event-creator-app/csv-import-check.js'),
    ].filter(Boolean) as string[];
    this.csvCheckScript = checkCandidates.find((p) => fs.existsSync(p)) || path.join(this.repoRoot, 'csv-import-check.js');

    const playwrightCandidates = [
      process.resourcesPath
        ? path.join(process.resourcesPath, 'app.asar.unpacked/node_modules/@playwright/mcp/cli.js')
        : null,
      process.resourcesPath ? path.join(process.resourcesPath, 'node_modules/@playwright/mcp/cli.js') : null,
      path.join(this.appRoot, 'node_modules/@playwright/mcp/cli.js'),
      path.join(this.repoRoot, 'node_modules/@playwright/mcp/cli.js'),
      path.resolve(process.cwd(), 'node_modules/@playwright/mcp/cli.js'),
      path.resolve(process.cwd(), 'event-creator-app/node_modules/@playwright/mcp/cli.js'),
    ].filter(Boolean) as string[];
    this.playwrightCliPath =
      playwrightCandidates.find((p) => fs.existsSync(p)) ||
      path.join(this.appRoot, 'node_modules/@playwright/mcp/cli.js');
  }

  public static getInstance(customDataDir?: string): AppPaths {
    if (!AppPaths.instance) {
      AppPaths.instance = new AppPaths(customDataDir);
    }
    return AppPaths.instance;
  }

  /**
   * Legt den Arbeitsordner der gepackten App an und spiegelt die mitgelieferten
   * Lese-Ressourcen hinein.
   *
   * Der Agent arbeitet mit `cwd = repoRoot` und seine Skills verweisen auf
   * `skills/…` sowie `csv-import-check.js` relativ dazu. Damit diese relativen
   * Wege tragen, muss `repoRoot` die echten Dateien enthalten – und es darf
   * nicht das Bundle sein, denn dort verschwindet der Bestand beim Update.
   *
   * `bundleRoot` dient nur als Quelle; geschrieben wird ausschliesslich in den
   * Arbeitsordner des Nutzers. Fällt kein `userData` zur Verfügung (kein
   * Electron-Kontext), bleibt der Aufrufer auf dem Bundle und der Fehler ist
   * damit wenigstens sichtbar.
   */
  private ensureWorkspace(bundleRoot: string): string {
    const userData = electronUserDataDir();
    if (!userData) {
      console.warn(
        '[AppPaths] Kein userData ermittelbar – die App nutzt den Bundle-Ordner. ' +
          'CSV-Dateien gehen beim nächsten Update verloren.'
      );
      return bundleRoot;
    }

    const workspace = path.join(userData, 'workspace');
    try {
      fs.mkdirSync(path.join(workspace, 'data'), { recursive: true });
      // Bei jedem Start spiegeln, damit ein Update aktualisierte Skills mitnimmt.
      // Nutzer-Skills liegen getrennt in `userData/skills` und werden nicht berührt.
      mirrorDir(path.join(bundleRoot, 'skills'), path.join(workspace, 'skills'));
      mirrorFile(path.join(bundleRoot, 'csv-import-check.js'), path.join(workspace, 'csv-import-check.js'));
    } catch (err) {
      console.warn('[AppPaths] Arbeitsordner konnte nicht vollständig angelegt werden:', err);
    }
    return workspace;
  }

  /**
   * Nutzererstellte Skills liegen im userData-Ordner, getrennt von den
   * mitgelieferten Skills, damit die App sie nie überschreibt.
   */
  public getUserSkillsDir(): string | null {
    const userData = electronUserDataDir();
    return userData ? path.join(userData, 'skills') : null;
  }

  /**
   * Verzeichnisse, aus denen die App ihre CSV-Dateien liest: der Ausgabeordner
   * zuerst, danach der Projektroot. Nur hierher dürfen Renderer-Dateinamen zeigen.
   */
  public get csvRoots(): string[] {
    const roots = [this.dataDir, this.repoRoot].filter(
      (d, idx, arr) => Boolean(d) && fs.existsSync(d) && arr.indexOf(d) === idx
    );
    return roots.map(realPathOrSelf);
  }

  /**
   * Löst einen vom Renderer genannten Dateinamen gegen die app-eigenen Wurzeln auf.
   * Ablehnung bei: leerem Namen, Pfadtrennern, absoluten Pfaden, `..`, Traversal,
   * herausführenden Symlinks und Dateien, die keine reguläre Datei sind.
   */
  public resolveCsvFile(fileName: string): CsvFileResolution {
    if (typeof fileName !== 'string' || !fileName.trim()) {
      return { ok: false, error: 'Es wurde kein gültiger Dateiname übergeben.' };
    }
    if (fileName !== path.basename(fileName) || fileName === '.' || fileName === '..') {
      return { ok: false, error: 'Es werden nur einfache Dateinamen ohne Pfad akzeptiert.' };
    }
    // Der Ausgabeordner enthält ausschliesslich CSV-Dateien; alles andere ist kein
    // gültiges Ziel und darf nicht beschrieben werden.
    if (!fileName.toLowerCase().endsWith('.csv')) {
      return { ok: false, error: 'Es werden nur CSV-Dateien verarbeitet.' };
    }

    for (const root of this.csvRoots) {
      const candidate = path.join(root, fileName);
      if (!isInside(root, candidate)) continue;
      if (!fs.existsSync(candidate)) continue;

      // Symlinks auflösen und erneut prüfen: ein Link darf die Wurzel nicht verlassen.
      const real = realPathOrSelf(candidate);
      if (!isInside(root, real)) continue;

      let isFile = false;
      try {
        isFile = fs.statSync(real).isFile();
      } catch {
        isFile = false;
      }
      if (!isFile) continue;

      return { ok: true, filePath: real };
    }

    return { ok: false, error: `CSV-Datei nicht gefunden: ${fileName}` };
  }
}
