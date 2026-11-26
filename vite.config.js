import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createDashboardApi } from './server/dashboard.js';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'dashboard-api',
      configureServer(server) {
        server.middlewares.use(createDashboardApi());
      },
      configurePreviewServer(server) {
        server.middlewares.use(createDashboardApi());
      },
    },
  ],
});
