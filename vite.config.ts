import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: ['icon.svg', 'icons/*.png'],
      manifest: {
        id: '/',
        name: 'Kelionės vertėjas',
        short_name: 'Vertėjas',
        description: 'Jūsų kelionės pagalbininkas Italijoje',
        lang: 'lt',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#faf8f3',
        theme_color: '#a74730',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/join\//],
        cleanupOutdatedCaches: true,
        // Personal photos, audio and API replies never enter the service-worker cache.
        runtimeCaching: [],
      },
    }),
  ],
  server: { host: '0.0.0.0' },
  build: { target: 'es2022' },
});
