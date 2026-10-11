import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');
const buildDir = path.join(appRoot, 'build');
const iconsetDir = path.join(buildDir, 'icon.iconset');

if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

// 1. Erstelle das macOS App-Icon als hochauflösendes SVG (1024x1024)
// Nach Nürnbergspots Brand Guidelines: Monochromatisch (Schwarz/Weiß/Dark Neutral),
// minimalistisch, moderne Typografie und Event-Symbolik.
const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- macOS Icon Squircle Clip -->
    <clipPath id="macSquircle">
      <rect x="32" y="32" width="960" height="960" rx="224" ry="224" />
    </clipPath>
    
    <!-- Linear Gradients -->
    <linearGradient id="bgGrad" x1="512" y1="32" x2="512" y2="992" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#18181B" />
      <stop offset="100%" stop-color="#09090B" />
    </linearGradient>

    <linearGradient id="borderGrad" x1="512" y1="32" x2="512" y2="992" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#3F3F46" />
      <stop offset="100%" stop-color="#27272A" />
    </linearGradient>

    <linearGradient id="cardGrad" x1="512" y1="210" x2="512" y2="814" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="100%" stop-color="#F4F4F5" />
    </linearGradient>

    <filter id="shadow" x="120" y="150" width="784" height="730" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="24" stdDeviation="32" flood-color="#000000" flood-opacity="0.6"/>
    </filter>
  </defs>

  <!-- Squircle Base with Border -->
  <rect x="32" y="32" width="960" height="960" rx="224" ry="224" fill="url(#bgGrad)" stroke="url(#borderGrad)" stroke-width="8" />

  <!-- Inner Content Clipped -->
  <g clip-path="url(#macSquircle)">
    <!-- Subtle Background Glow -->
    <circle cx="512" cy="512" r="380" fill="#27272A" opacity="0.4" />

    <!-- Calendar Card Base -->
    <g filter="url(#shadow)">
      <rect x="200" y="220" width="624" height="584" rx="72" fill="url(#cardGrad)" />
      
      <!-- Calendar Header (Schwarz/Anthrazit) -->
      <path d="M 200 292 C 200 252 232 220 272 220 L 752 220 C 792 220 824 252 824 292 L 824 370 L 200 370 Z" fill="#09090B" />
      
      <!-- Header Binder Pins -->
      <rect x="340" y="176" width="36" height="88" rx="18" fill="#E4E4E7" stroke="#09090B" stroke-width="6" />
      <rect x="648" y="176" width="36" height="88" rx="18" fill="#E4E4E7" stroke="#09090B" stroke-width="6" />

      <!-- Header Dots / Nürnbergspots Sparkle -->
      <circle cx="512" cy="295" r="12" fill="#FFFFFF" />
      <circle cx="460" cy="295" r="7" fill="#A1A1AA" />
      <circle cx="564" cy="295" r="7" fill="#A1A1AA" />

      <!-- Main Central Motif: 4-pointed Sparkle Star & Event Date -->
      <!-- Big Event Sparkle Star (Schwarz auf weißer Karte) -->
      <path d="M 512 430 Q 512 550 632 550 Q 512 550 512 670 Q 512 550 392 550 Q 512 550 512 430 Z" fill="#09090B" />
      
      <!-- Small accent sparkle top right -->
      <path d="M 680 440 Q 680 480 720 480 Q 680 480 680 520 Q 680 480 640 480 Q 680 480 680 440 Z" fill="#71717A" />

      <!-- Minimalist Event Grid Lines below -->
      <rect x="280" y="715" width="130" height="16" rx="8" fill="#D4D4D8" />
      <rect x="445" y="715" width="130" height="16" rx="8" fill="#D4D4D8" />
      <rect x="610" y="715" width="130" height="16" rx="8" fill="#18181B" />
    </g>
  </g>
</svg>`;

const svgPath = path.join(buildDir, 'icon.svg');
const png1024Path = path.join(buildDir, 'icon.png');
const icnsPath = path.join(buildDir, 'icon.icns');

fs.writeFileSync(svgPath, svgContent, 'utf8');
console.log('✓ icon.svg erstellt in:', svgPath);

// 2. SVG -> PNG (1024x1024) via qlmanage
const tempOutputDir = path.join(buildDir, 'temp_render');
if (!fs.existsSync(tempOutputDir)) {
  fs.mkdirSync(tempOutputDir, { recursive: true });
}

try {
  execSync(`qlmanage -t -s 1024 -o "${tempOutputDir}" "${svgPath}"`, { stdio: 'pipe' });
  const renderedPng = path.join(tempOutputDir, 'icon.svg.png');
  
  if (!fs.existsSync(renderedPng)) {
    throw new Error('qlmanage konnte PNG nicht erzeugen');
  }

  // Kopiere und prüfe Größe mit sips
  fs.copyFileSync(renderedPng, png1024Path);
  execSync(`sips -z 1024 1024 "${png1024Path}"`, { stdio: 'pipe' });
  console.log('✓ 1024x1024 icon.png erzeugt in:', png1024Path);

  // 3. Multi-Resolution Iconset für macOS iconutil generieren
  if (fs.existsSync(iconsetDir)) {
    fs.rmSync(iconsetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(iconsetDir, { recursive: true });

  const iconSizes = [
    { name: 'icon_16x16.png', size: 16 },
    { name: 'icon_16x16@2x.png', size: 32 },
    { name: 'icon_32x32.png', size: 32 },
    { name: 'icon_32x32@2x.png', size: 64 },
    { name: 'icon_128x128.png', size: 128 },
    { name: 'icon_128x128@2x.png', size: 256 },
    { name: 'icon_256x256.png', size: 256 },
    { name: 'icon_256x256@2x.png', size: 512 },
    { name: 'icon_512x512.png', size: 512 },
    { name: 'icon_512x512@2x.png', size: 1024 },
  ];

  for (const { name, size } of iconSizes) {
    const targetFile = path.join(iconsetDir, name);
    execSync(`sips -z ${size} ${size} "${png1024Path}" --out "${targetFile}"`, { stdio: 'pipe' });
  }
  console.log('✓ Alle Größen im iconset erfolgreich erstellt.');

  // 4. iconutil zur Erzeugung von icon.icns ausführen
  execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`, { stdio: 'pipe' });
  console.log('✓ macOS icon.icns erfolgreich erzeugt in:', icnsPath);

  // Aufräumen von temporären Dateien
  fs.rmSync(tempOutputDir, { recursive: true, force: true });
  fs.rmSync(iconsetDir, { recursive: true, force: true });
  console.log('✓ Temporäre Iconset-Dateien aufgeräumt.');
} catch (err) {
  console.error('Fehler bei der Icon-Generierung:', err);
  process.exit(1);
}
