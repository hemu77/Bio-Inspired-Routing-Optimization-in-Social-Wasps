import { defineConfig } from 'vite';
import { copyFileSync, createReadStream, mkdirSync } from 'node:fs';
export default defineConfig({ base: './', build: { chunkSizeWarningLimit: 700 },
  plugins: [{ name: 'preserved-legacy-replays', configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const match = /^\/legacy\/simulation_(tsp|biased|random|greedy)\.html(?:\?.*)?$/.exec(request.url ?? '');
      if (request.method !== 'GET' || !match) return next();
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      createReadStream(new URL(`../animations/simulation_${match[1]}.html`, import.meta.url))
        .on('error', next).pipe(response);
    });
  }, closeBundle() {
    const destination = new URL('./dist/legacy/', import.meta.url);
    mkdirSync(destination, { recursive: true });
    for (const method of ['tsp', 'biased', 'random', 'greedy'])
      copyFileSync(new URL(`../animations/simulation_${method}.html`, import.meta.url),
        new URL(`simulation_${method}.html`, destination));
  } }],
});
