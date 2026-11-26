import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createDashboardApi } from './server/dashboard.js';

export default defineConfig({
  server: {
    allowedHosts: true
  },
  plugins: [
    react(),
    {
      name: 'dashboard-api',
      configureServer(server) {
        server.middlewares.use(createDashboardApi());
      },
      configurePreviewServer(server) {
        server.a
        server.middlewares.use(createDashboardApi());
      },
    },
  ],
});
