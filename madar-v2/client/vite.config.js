import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig(({ mode }) => {
  const capacitorBuild = mode === 'capacitor';
  const projectEnv = loadEnv(mode, projectRoot, ['VITE_', 'MADAR_REP_']);
  const releaseBuild = process.env.MADAR_ANDROID_BUILD_TYPE === 'release';
  const liveReloadBuild = capacitorBuild && !releaseBuild && process.env.MADAR_REP_LIVE_RELOAD === 'true';
  const standaloneBuild = capacitorBuild && !liveReloadBuild;
  const apiServerUrl = projectEnv.VITE_MADAR_API_BASE_URL
    || projectEnv.MADAR_REP_SERVER_URL
    || process.env.MADAR_REP_SERVER_URL
    || (standaloneBuild ? 'https://carlos-pc.tail852ef0.ts.net' : '');
  let apiBaseUrl = '';
  if (standaloneBuild) {
    try {
      const parsedApiUrl = new URL(apiServerUrl);
      if (parsedApiUrl.protocol !== 'https:' || parsedApiUrl.username || parsedApiUrl.password) throw new Error();
      apiBaseUrl = parsedApiUrl.origin;
    } catch {
      throw new Error('Standalone Android build needs a valid HTTPS MADAR_REP_SERVER_URL for API sync.');
    }
  }
  return {
    plugins: [react()],
    base: capacitorBuild ? './' : '/',
    define: {
      __MADAR_BUILD_VERSION__: JSON.stringify(new Date().toISOString()),
      __MADAR_API_BASE_URL__: JSON.stringify(apiBaseUrl),
    },
    build: {
      chunkSizeWarningLimit: 200,
      outDir: capacitorBuild ? '../public/rep' : 'dist',
      emptyOutDir: true,
      manifest: 'asset-manifest.json',
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (/node_modules\/react-dom\//.test(id)) return 'react-dom-vendor';
            if (/node_modules\/scheduler\//.test(id)) return 'scheduler-vendor';
            if (/node_modules\/react\//.test(id)) return 'react-vendor';
            if (/node_modules\/(react-router|react-router-dom|@remix-run\/router)\//.test(id)) return 'router-vendor';
            return undefined;
          },
        },
      },
    },
    server: {
      host: '127.0.0.1',
      proxy: {
        '/api': 'http://127.0.0.1:3000',
      },
    },
  };
});
