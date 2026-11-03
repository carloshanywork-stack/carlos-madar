const CACHE_VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE_NAME = `madar-rep-shell-${CACHE_VERSION}`;
const SHELL_FILES = ['/','/index.html','/manifest.json','/icon.svg','/icon-192.png','/icon-512.png','/asset-manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const response = await fetch('/', { cache: 'reload' });
    if (response.ok) {
      const html = await response.clone().text();
      await cache.put('/', response.clone());
      await cache.put('/index.html', response.clone());
      const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
        .map((match) => match[1])
        .filter((path) => path.startsWith('/') && /\.(?:js|css|svg|png|webp|woff2?)(?:\?|$)/i.test(path));
      let builtAssets = [];
      try {
        const manifestResponse = await fetch('/asset-manifest.json', { cache: 'reload' });
        if (manifestResponse.ok) {
          const manifest = await manifestResponse.json();
          builtAssets = Object.values(manifest).flatMap((entry) => [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])])
            .filter((path) => typeof path === 'string')
            .map((path) => path.startsWith('/') ? path : `/${path}`);
        }
      } catch {
        // The HTML references are still cached when a build does not publish a manifest.
      }
      await Promise.allSettled([...new Set([...SHELL_FILES, ...assets, ...builtAssets])].map(async (path) => {
        const asset = await fetch(path, { cache: 'reload' });
        if (asset.ok) await cache.put(path, asset);
      }));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('madar-rep-shell-') && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/storage/') || url.pathname.startsWith('/socket.io/')) return;
  if (request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    const cachePromise = caches.open(CACHE_NAME);
    const shellPromise = cachePromise.then(async (cache) => await cache.match('/') || await cache.match('/index.html'));
    const updateShell = cachePromise.then((cache) => fetch(request).then(async (response) => {
      if (response.ok) {
        await cache.put('/', response.clone());
        await cache.put('/index.html', response.clone());
      }
      return response;
    }));
    event.waitUntil(updateShell.then(() => undefined).catch(() => undefined));
    event.respondWith(shellPromise.then((shell) => shell || updateShell));
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
    return response;
  })());
});
