import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The game screen is a chunk of its own (App.tsx). On a game's address the
 * page needs it at once, so the built page starts fetching it (and the
 * chunks it imports) alongside the entry, instead of after the entry has
 * loaded and run; the start page leaves it for later.
 */
const preloadGameScreenOnGamePages = (): Plugin => ({
  name: 'preload-game-screen-on-game-pages',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler(_html, ctx) {
      const chunk = Object.values(ctx.bundle ?? {}).find(
        (c) => c.type === 'chunk' && c.isDynamicEntry && c.name === 'GameScreen',
      );
      if (!chunk || chunk.type !== 'chunk') return;
      // The chunk and what it imports, less the entry (loading anyway)
      const entry = Object.values(ctx.bundle ?? {}).find((c) => c.type === 'chunk' && c.isEntry);
      const files = [chunk.fileName, ...chunk.imports]
        .filter((f) => f !== entry?.fileName)
        .map((f) => `/${f}`);
      return [
        {
          tag: 'script',
          injectTo: 'head',
          children: `if(location.pathname.startsWith('/game/'))for(const f of ${JSON.stringify(files)}){const l=document.createElement('link');l.rel='modulepreload';l.crossOrigin='';l.href=f;document.head.appendChild(l)}`,
        },
      ];
    },
  },
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), preloadGameScreenOnGamePages()],
  css: {
    postcss: './postcss.config.js',
  },
});
