import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error plain ESM module without types
import { apiHandler } from './api.mjs';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-db-api',
      configureServer(server) {
        server.middlewares.use((req, res, next) => apiHandler(req, res, next));
      },
    },
  ],
  server: { port: 5173, host: '127.0.0.1' },
});
