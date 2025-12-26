import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      'mock-aws-s3': path.join(__dirname, 'electron/stub.ts'),
      'aws-sdk': path.join(__dirname, 'electron/stub.ts'),
      'nock': path.join(__dirname, 'electron/stub.ts'),
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        video_generator: path.resolve(__dirname, 'src/video-generator/index.html'),
      },
    },
  },
  plugins: [
    react(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: ['electron', 'better-sqlite3', '@lancedb/lancedb', 'get-windows'],
            },
          },
          resolve: {
            alias: {
              'mock-aws-s3': path.join(__dirname, 'electron/stub.ts'),
              'aws-sdk': path.join(__dirname, 'electron/stub.ts'),
              'nock': path.join(__dirname, 'electron/stub.ts'),
            }
          },
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, 'electron/preload.ts'),
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: process.env.NODE_ENV === 'test'
        // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        ? undefined
        : {},
    }),
  ],
})
