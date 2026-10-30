import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 200,
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
});
