import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      manifest: {
        name: 'Le banc · Basket U11',
        short_name: 'Le banc',
        description: 'Carnet de match U11 local',
        theme_color: '#172e4d',
        background_color: '#f5f2eb',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon_192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon_512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'], navigateFallback: '/index.html' },
    }),
  ],
  server: { port: 5177, strictPort: true },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], exclude: ['e2e/**', 'node_modules/**'] },
});
