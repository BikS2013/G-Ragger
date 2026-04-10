import { defineConfig } from 'electron-vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, 'src/main/main.ts')
        },
        external: ['bufferutil', 'utf-8-validate', 'canvas', 'jsdom', 'youtube-transcript-plus', '@mozilla/readability', 'turndown', 'turndown-plugin-gfm', 'mime-types']
      },
      watch: {
        include: [
          'src/**',
          '../src/**'
        ]
      },
      sourcemap: true
    },
    resolve: {
      alias: {
        '@cli': path.resolve(__dirname, '../src')
      }
    }
  },

  preload: {
    build: {
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, 'src/preload/preload.ts')
        }
      },
      sourcemap: true
    }
  },

  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    plugins: [
      tailwindcss(),
      react()
    ]
  }
})
