// Führt die node:test-Suiten der Main-Prozess-Module aus.
// Die Quellen sind TypeScript; esbuild bündelt sie nach ESM, danach läuft
// Nodes eigener Test-Runner darauf – ohne zusätzliche Test-Abhängigkeiten.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

const SRC = new URL('../src/main/', import.meta.url).pathname;
const outDir = mkdtempSync(join(tmpdir(), 'event-creator-tests-'));

try {
  const entryPoints = readdirSync(SRC)
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => join(SRC, f));

  if (entryPoints.length === 0) {
    console.error('Keine *.test.ts unter src/main gefunden.');
    process.exit(1);
  }

  await build({
    entryPoints,
    outdir: outDir,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    external: [],
    // `src/main/ipc.ts` braucht Electron und das Cursor-SDK schon beim Import.
    // Beide Attrappen liefern die Namen, sammeln die registrierten Kanäle und
    // lassen die Zuordnung Kanal -> Handler prüfbar.
    alias: {
      electron: new URL('../src/main/_electron-stub.ts', import.meta.url).pathname,
      '@cursor/sdk': new URL('../src/main/_cursor-sdk-stub.ts', import.meta.url).pathname,
    },
  });

  const result = spawnSync(
    process.execPath,
    ['--test', ...readdirSync(outDir).filter((f) => f.endsWith('.js')).map((f) => join(outDir, f))],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        // Die Bündelung läuft aus einem temporären Ordner, deshalb kann eine
        // Suite nicht relativ zu den eigenen Dateien auflösen. `agent-runtime`
        // braucht den echten Projektordner, um die Electron-Binary und das
        // native Addon des Cursor-SDK zu finden.
        EVENT_CREATOR_PROJECT_ROOT: new URL('..', import.meta.url).pathname,
      },
    }
  );
  process.exit(result.status ?? 1);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
