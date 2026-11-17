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

  // Find standalone exe (> 1MB)
  const standaloneExe = exes.find(f => {
    try {
      return statSync(resolve(windowsBuildDir, f)).size > 1024 * 1024;
    } catch {
      return false;
    }
  });

  const chosenFile = standaloneExe || zips[0] || exes[0];
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

  const fileEntries = [];
  if (standaloneExe) {
    const p = resolve(windowsBuildDir, standaloneExe);
    const blockmapPath = `${p}.blockmap`;
    const entry = {
      url: standaloneExe,
      sha512: createHash('sha512').update(readFileSync(p)).digest('base64'),
      size: statSync(p).size,
    };
    if (existsSync(blockmapPath)) {
      entry.blockMapSize = statSync(blockmapPath).size;
    }
    fileEntries.push(entry);
  }
  for (const zip of zips) {
    const p = resolve(windowsBuildDir, zip);
    fileEntries.push({
      url: zip,
      sha512: createHash('sha512').update(readFileSync(p)).digest('base64'),
      size: statSync(p).size,
    });
  }
  if (!fileEntries.length) {
    fileEntries.push({ url: chosenFile, sha512, size: stat.size });
  }

  const filesYaml = fileEntries.map(e => {
    let entryYaml = `  - url: ${e.url}\n    sha512: ${e.sha512}\n    size: ${e.size}`;
    if (e.blockMapSize) {
      entryYaml += `\n    blockMapSize: ${e.blockMapSize}`;
    }
    return entryYaml;
  }).join('\n');

  const manifest = [
    `version: ${version}`,
    `files:`,
    filesYaml,
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

  // Copy all built packages and blockmap files to dist-desktop
  const blockmaps = files.filter(f => f.endsWith('.blockmap'));
  for (const pkg of [...zips, ...exes, ...blockmaps]) {
    const pkgSrc = resolve(windowsBuildDir, pkg);
    const pkgDest = resolve(distDesktopDir, pkg);
    copyFileSync(pkgSrc, pkgDest);
  }

  // Copy public code signing certificate so clients can download and trust it
  const certSrc = resolve(projectRoot, 'desktop/madar-codesign.cer');
  if (existsSync(certSrc)) {
    copyFileSync(certSrc, resolve(distDesktopDir, 'madar-codesign.cer'));
    copyFileSync(certSrc, resolve(distDesktopDir, 'madar-ca.cer'));
  }

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
