import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig(({ mode }) => {
  const capacitorBuild = mode === 'capacitor' || mode === 'capacitor-rep' || mode === 'capacitor-manager';
  const capacitorTarget = mode === 'capacitor-manager' ? 'manager' : capacitorBuild ? 'rep' : 'web';
  const projectEnv = loadEnv(mode, projectRoot, ['VITE_', 'MADAR_REP_']);
  // `loadEnv` surfaces a server-only NODE_ENV as VITE_USER_NODE_ENV even when
  // it is excluded by the prefix allowlist; do not let that trigger Vite's warning.
  delete process.env.VITE_USER_NODE_ENV;
  const releaseBuild = process.env.MADAR_ANDROID_BUILD_TYPE === 'release';
  const liveReloadBuild = capacitorTarget === 'rep' && !releaseBuild && process.env.MADAR_REP_LIVE_RELOAD === 'true';
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
    plugins: [react(), {
      name: 'madar-capacitor-entry',
      transformIndexHtml: {
        order: 'pre',
        handler(html) {
          return capacitorTarget === 'rep' ? html.replace('/src/main.jsx', '/src/rep-main.jsx') : html;
        },
      },
    }],
    // The project root .env is loaded explicitly above with an allowlist.
    // Avoid Vite also reading server-only NODE_ENV from that file.
    envFile: false,
    base: capacitorBuild ? './' : '/',
    define: {
      __MADAR_BUILD_VERSION__: JSON.stringify(process.env.MADAR_BUILD_VERSION || new Date().toISOString()),
      __MADAR_API_BASE_URL__: JSON.stringify(apiBaseUrl),
      __MADAR_BUILD_TARGET__: JSON.stringify(capacitorTarget),
    },
    build: {
      chunkSizeWarningLimit: 200,
      target: capacitorTarget === 'rep' ? ['chrome74', 'es2018'] : 'modules',
      outDir: capacitorTarget === 'manager' ? '../public/manager' : capacitorBuild ? '../public/rep' : 'dist',
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
            if (/node_modules\/(pptxgenjs|xlsx|jszip)\//.test(id)) return 'export-vendor';
            return undefined;
          },
        },
      },
    },
    server: {
      host: '127.0.0.1',
      // The notification catalog lives in ../shared and is imported by both the
      // API and the clients, so the dev server must be allowed to read it.
      fs: { allow: [projectRoot] },
      proxy: {
        '/api': 'http://127.0.0.1:3000',
      },
    },
  };
});
