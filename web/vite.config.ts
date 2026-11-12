import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'طائرة المراجيل',
        short_name: 'المراجيل',
        description: 'Al-Marajeel volleyball group tracker',
        lang: 'ar',
        dir: 'rtl',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#121218',
        theme_color: '#D81B5C',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/\.auth\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/photos/'),
            handler: 'CacheFirst',
            options: { cacheName: 'photos', expiration: { maxEntries: 200 } },
          },
          {
            urlPattern: ({ url, request }) => url.pathname.startsWith('/api/') && request.method === 'GET',
            handler: 'NetworkFirst',
            options: { cacheName: 'api', networkTimeoutSeconds: 4 },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 30 } },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    // Without the SWA CLI: talk to `func start` directly (reads only; writes need the SWA auth header).
    proxy: { '/api': 'http://localhost:7071' },
  },
});
