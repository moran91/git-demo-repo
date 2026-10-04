import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'sw',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Qareeb',
        short_name: 'Qareeb',
        description: 'Meals and everyday essentials from your neighborhood.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        dir: 'rtl',
        lang: 'he',
        background_color: '#FAF7F0',
        theme_color: '#20583B',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,woff2,svg,png,webmanifest}'],
        // The HEIC decoder (~2 MB, loaded only when a HEIC file is picked) and the on-device studio
        // background runtime (Transformers.js, loaded only when an owner asks for it) must not be
        // precached: that would push them to every customer on install. The model files themselves
        // (public/models, public/ort: .onnx/.json/.wasm/.mjs) are outside globPatterns.
        globIgnores: ['**/libheif-*.js', '**/transformers-*.js'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { port: 5173, host: '127.0.0.1' },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/@firebase') || id.includes('node_modules/firebase')) return 'firebase';
          if (id.includes('node_modules/libheif-js')) return 'libheif';
          if (id.includes('node_modules/@huggingface/transformers') || id.includes('node_modules/onnxruntime')) return 'transformers';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
          return undefined;
        },
      },
    },
  },
});
