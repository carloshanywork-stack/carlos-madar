import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const ROOT = path.resolve(import.meta.dirname, '..');

const standardSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#172a3f"/>
  <rect x="40" y="40" width="432" height="432" rx="88" fill="none" stroke="#d6b66e" stroke-width="9" opacity=".9"/>
  <path d="M256 91c-91 0-165 74-165 165 0 43 17 82 44 111m77 51c15 5 29 8 44 8 94 0 170-76 170-170" fill="none" stroke="#4da889" stroke-width="16" stroke-linecap="round"/>
  <circle cx="256" cy="256" r="116" fill="#203b50" stroke="#73b99d" stroke-width="5"/>
  <text x="256" y="294" fill="#ffe1a0" font-family="Tahoma,Arial,sans-serif" font-size="119" font-weight="900" text-anchor="middle">م</text>
</svg>`;

const roundSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <circle cx="256" cy="256" r="256" fill="#172a3f"/>
  <circle cx="256" cy="256" r="226" fill="none" stroke="#d6b66e" stroke-width="9" opacity=".9"/>
  <path d="M256 91c-91 0-165 74-165 165 0 43 17 82 44 111m77 51c15 5 29 8 44 8 94 0 170-76 170-170" fill="none" stroke="#4da889" stroke-width="16" stroke-linecap="round"/>
  <circle cx="256" cy="256" r="116" fill="#203b50" stroke="#73b99d" stroke-width="5"/>
  <text x="256" y="294" fill="#ffe1a0" font-family="Tahoma,Arial,sans-serif" font-size="119" font-weight="900" text-anchor="middle">م</text>
</svg>`;

const foregroundSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080">
  <g transform="translate(236, 236) scale(1.18)">
    <rect x="40" y="40" width="432" height="432" rx="88" fill="none" stroke="#d6b66e" stroke-width="9" opacity=".9"/>
    <path d="M256 91c-91 0-165 74-165 165 0 43 17 82 44 111m77 51c15 5 29 8 44 8 94 0 170-76 170-170" fill="none" stroke="#4da889" stroke-width="16" stroke-linecap="round"/>
    <circle cx="256" cy="256" r="116" fill="#203b50" stroke="#73b99d" stroke-width="5"/>
    <text x="256" y="294" fill="#ffe1a0" font-family="Tahoma,Arial,sans-serif" font-size="119" font-weight="900" text-anchor="middle">م</text>
  </g>
</svg>`;

const densities = [
  { name: 'mdpi', launcherSize: 48, foregroundSize: 108 },
  { name: 'hdpi', launcherSize: 72, foregroundSize: 162 },
  { name: 'xhdpi', launcherSize: 96, foregroundSize: 216 },
  { name: 'xxhdpi', launcherSize: 144, foregroundSize: 324 },
  { name: 'xxxhdpi', launcherSize: 192, foregroundSize: 432 },
];

const resDirs = [
  path.join(ROOT, 'android/native-platform/app/src/main/res'),
  path.join(ROOT, 'android/app/src/main/res'),
];

async function generate() {
  console.log('Generating Madar official app icons...');
  for (const resDir of resDirs) {
    if (!fs.existsSync(resDir)) continue;
    console.log('Processing target directory:', resDir);
    for (const d of densities) {
      const mipmapDir = path.join(resDir, `mipmap-${d.name}`);
      fs.mkdirSync(mipmapDir, { recursive: true });

      // 1. ic_launcher.png
      await sharp(Buffer.from(standardSvg))
        .resize(d.launcherSize, d.launcherSize)
        .png()
        .toFile(path.join(mipmapDir, 'ic_launcher.png'));

      // 2. ic_launcher_round.png
      await sharp(Buffer.from(roundSvg))
        .resize(d.launcherSize, d.launcherSize)
        .png()
        .toFile(path.join(mipmapDir, 'ic_launcher_round.png'));

      // 3. ic_launcher_foreground.png
      await sharp(Buffer.from(foregroundSvg))
        .resize(d.foregroundSize, d.foregroundSize)
        .png()
        .toFile(path.join(mipmapDir, 'ic_launcher_foreground.png'));
    }
  }
  console.log('All icons generated successfully!');
}

generate().catch((err) => {
  console.error('Failed to generate icons:', err);
  process.exit(1);
});
