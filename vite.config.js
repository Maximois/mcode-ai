import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: [
      {
        find: /^@codingame\/monaco-vscode-api\/vscode\/(.*)$/,
        replacement: path.resolve(__dirname, 'node_modules/@codingame/monaco-vscode-api/vscode/src/$1'),
      },
      {
        find: /^@codingame\/monaco-vscode-base-service-override\/vscode\/(.*)$/,
        replacement: path.resolve(__dirname, 'node_modules/@codingame/monaco-vscode-base-service-override/vscode/src/$1'),
      },
    ],
  },
  optimizeDeps: {
    entries: ['src/main.jsx'],
    include: [
      'vscode',
      'vscode/services',
      'monaco-editor/esm/vs/editor/editor.api.js',
    ],
  },
  build: {
    outDir: 'dist',
    target: 'esnext',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('monaco-editor')) return 'monaco'
          if (id.includes('node_modules')) return 'vendor'
        },
      },
    },
  },
  server: { host: '127.0.0.1', port: 5176, strictPort: true },
  worker: { format: 'es' },
})
