import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const windowsBuildDir = resolve(projectRoot, 'build/windows');
const distDesktopDir = resolve(projectRoot, 'dist-desktop');

export function publishDesktopArtifacts() {
  if (!existsSync(windowsBuildDir)) {
    throw new Error(`Windows build directory not found: ${windowsBuildDir}`);
  }

  // Find candidate packages
  const files = readdirSync(windowsBuildDir);
  const zips = files.filter(f => f.startsWith('MADAR-Windows-') && f.endsWith('.zip')).sort().reverse();
  const exes = files.filter(f => f.startsWith('MADAR-Windows-') && f.endsWith('.exe') && !f.includes('signed')).sort().reverse();

  const chosenFile = zips[0] || exes[0];
  if (!chosenFile) {
    throw new Error('No built Windows package found in build/windows.');
  }

  const chosenPath = resolve(windowsBuildDir, chosenFile);
  const stat = statSync(chosenPath);
  const buffer = readFileSync(chosenPath);
  const sha512 = createHash('sha512').update(buffer).digest('base64');

  // Extract version from filename or package.json
  const versionMatch = chosenFile.match(/MADAR-Windows-([0-9]+\.[0-9]+\.[0-9]+)/);
  const version = versionMatch ? versionMatch[1] : '1.0.0';

  const manifest = [
    `version: ${version}`,
    `files:`,
    `  - url: ${chosenFile}`,
    `    sha512: ${sha512}`,
    `    size: ${stat.size}`,
    `path: ${chosenFile}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    '',
  ].join('\n');

  // Write latest.yml to build/windows
  const buildManifestPath = resolve(windowsBuildDir, 'latest.yml');
  writeFileSync(buildManifestPath, manifest, 'utf8');

  // Ensure dist-desktop directory exists
  mkdirSync(distDesktopDir, { recursive: true });

  // Copy to dist-desktop for Firebase Hosting
  const distArtifactPath = resolve(distDesktopDir, chosenFile);
  copyFileSync(chosenPath, distArtifactPath);

  const distManifestPath = resolve(distDesktopDir, 'latest.yml');
  writeFileSync(distManifestPath, manifest, 'utf8');

  console.log(`[PublishDesktop] Artifact: ${chosenFile} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`[PublishDesktop] SHA-512: ${sha512}`);
  console.log(`[PublishDesktop] Generated update manifest: ${buildManifestPath}`);
  console.log(`[PublishDesktop] Staged for Firebase Hosting in: ${distDesktopDir}`);

  return {
    filename: chosenFile,
    size: stat.size,
    sha512,
    version,
    buildManifestPath,
    distDesktopDir,
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  publishDesktopArtifacts();
}
