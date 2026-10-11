// Legt das x64-Binary des Cursor SDK in node_modules ab, damit electron-builder
// es in ein Intel-Bundle packen kann.
//
// npm installiert optionale Plattform-Pakete nur für die aktuelle Maschine
// (auf Apple Silicon also nur `sdk-darwin-arm64`). `npm install --cpu=x64`
// würde das arm64-Paket dabei wieder entfernen und `npm run dev` brechen.
// Deshalb wird das x64-Paket hier per `npm pack` geholt und daneben entpackt.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const sdkPkg = JSON.parse(readFileSync(join(root, 'node_modules/@cursor/sdk/package.json'), 'utf8'));
const name = '@cursor/sdk-darwin-x64';
const version = sdkPkg.optionalDependencies?.[name];

if (!version) {
  console.error(`${name} ist in @cursor/sdk nicht als optionale Abhängigkeit eingetragen.`);
  process.exit(1);
}

const target = join(root, 'node_modules/@cursor/sdk-darwin-x64');
if (existsSync(join(target, 'package.json'))) {
  console.log(`${name}@${version} ist bereits vorhanden.`);
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), 'sdk-x64-'));
try {
  console.log(`Lade ${name}@${version} ...`);
  const out = execFileSync('npm', ['pack', `${name}@${version}`, '--pack-destination', tmp, '--silent'], {
    cwd: tmp,
    encoding: 'utf8',
  });
  const tarball = join(tmp, out.trim().split('\n').pop());
  mkdirSync(target, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', target, '--strip-components=1']);
  console.log(`Entpackt nach ${target}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
