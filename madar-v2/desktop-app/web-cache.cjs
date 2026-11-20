const { randomUUID } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

function writeAtomically(path, bytes) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temporary, bytes, { flag: 'wx', flush: true });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function manifestAssets(html, manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Invalid Vite asset manifest.');
  }
  const assets = new Set();
  for (const record of Object.values(manifest)) {
    if (typeof record.file !== 'string') throw new Error('Build asset has no output file.');
    for (const path of [record.file, ...(record.css ?? []), ...(record.assets ?? [])]) {
      if (!/^assets\/[\w.-]+$/.test(path) || path === 'assets/.' || path === 'assets/..') {
        throw new Error('Build asset path is outside the cache.');
      }
      assets.add(path);
    }
    for (const key of [...(record.imports ?? []), ...(record.dynamicImports ?? [])]) {
      if (!Object.hasOwn(manifest, key)) throw new Error('Build dependency is missing from the manifest.');
    }
  }
  const htmlAssets = [...html.matchAll(/(?:src|href)=["']\/(assets\/[^"'\s>]+)["']/g)].map((match) => match[1]);
  const hasEntry = Object.values(manifest).some((record) => record.isEntry && htmlAssets.includes(record.file));
  if (!hasEntry || htmlAssets.some((path) => !assets.has(path)) || assets.size > 1000) {
    throw new Error('The HTML and asset manifest do not describe the same build.');
  }
  return assets;
}

async function commitWebBuild(cacheDir, html, fetchFile) {
  const indexPath = join(cacheDir, 'index.html');
  if (existsSync(indexPath) && readFileSync(indexPath, 'utf8') === html) return;
  const manifestFile = await fetchFile('/asset-manifest.json');
  if (!manifestFile || !manifestFile.contentType.startsWith('application/json')) {
    throw new Error('No Vite asset manifest is available.');
  }
  const assets = manifestAssets(html, JSON.parse(manifestFile.buffer.toString('utf8')));
  for (const asset of assets) {
    const path = join(cacheDir, asset);
    if (existsSync(path)) continue;
    const response = await fetchFile(`/${asset}`);
    if (!response?.buffer.length || response.contentType.includes('text/html')) {
      throw new Error(`Build asset could not be downloaded: ${asset}`);
    }
    writeAtomically(path, response.buffer);
  }
  // Vite's hashed assets are immutable, so the old index remains valid while we stage the new files.
  writeAtomically(indexPath, html);
}

module.exports = { commitWebBuild };
