import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig(({ mode }) => {
  const projectRoot = path.resolve(__dirname, '..')
  const isolatedBuildMode = mode === 'isolated-test'
  const env = isolatedBuildMode ? {} : loadEnv(mode, projectRoot, '')
  const backendPort = env.PORT || '3100'
  return {
    plugins: [react()],
    root: path.resolve(__dirname),
    envDir: isolatedBuildMode ? false : projectRoot,
    build: { outDir: 'dist', emptyOutDir: true },
    server: {
      port: 5173,
      proxy: {
        '/api': `http://127.0.0.1:${backendPort}`,
        '/storage': `http://127.0.0.1:${backendPort}`,
        '/socket.io': { target: `http://127.0.0.1:${backendPort}`, ws: true },
      },
    },
  }
})
