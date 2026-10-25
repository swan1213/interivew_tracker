import type { Plugin } from 'vite';

/**
 * Serves the API from the Vite dev server so `npm run dev` is the only command needed.
 * The production entry (server/src/index.ts) mounts the same app under /api.
 */
export function apiPlugin(): Plugin {
  return {
    name: 'interviewflow-api',
    async configureServer(server) {
      const { createApi } = await import('./api');
      server.middlewares.use('/api', createApi());
    },
  };
}
