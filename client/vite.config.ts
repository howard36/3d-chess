import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The game screen is a chunk of its own (App.tsx). On a game's address the
 * page needs it at once, so the built page starts fetching it (and the
 * chunks it imports) alongside the entry, instead of after the entry has
 * loaded and run; the start page leaves it for later. The precomputed
 * knight and occlusion (pieces/set.ts, scene/occlusion.ts) follow once the
 * game screen has arrived, not alongside it (that slowed the game screen)
 * nor after it has run (the board can then mount before they land and build
 * the set the slow way). The build fails if a chunk is not found, rather than
 * quietly shipping a page without the preload.
 */
const preloadGameScreenOnGamePages = (): Plugin => ({
  name: 'preload-game-screen-on-game-pages',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler(_html, ctx) {
      const chunks = Object.values(ctx.bundle ?? {}).filter((c) => c.type === 'chunk');
      const from = (file: string) =>
        chunks.find((c) => c.facadeModuleId?.replaceAll('\\', '/').endsWith(file));
      const game = from('/src/screens/GameScreen.tsx');
      if (!game) throw new Error('preload-game-screen-on-game-pages: no game screen chunk');
      // The game screen and what it imports, less the entry (loading anyway)
      const entry = chunks.find((c) => c.isEntry);
      const files = [game.fileName, ...game.imports].filter((f) => f !== entry?.fileName);
      const data = [
        '/src/three/pieces/knight.medium.ts',
        '/src/three/scene/occlusion.medium.ts',
      ].map((m) => from(m)?.fileName);
      if (data.some((f) => !f)) throw new Error('preload-game-screen-on-game-pages: no data chunk');
      const preload = (f: string, then = '') =>
        `{const l=document.createElement('link');l.rel='modulepreload';l.crossOrigin='';l.href='/${f}';${then ? `l.onload=()=>{${then}};` : ''}document.head.appendChild(l)}`;
      return [
        {
          tag: 'script',
          injectTo: 'head',
          children: `if(location.pathname.startsWith('/game/')){${preload(files[0], data.map((f) => preload(f!)).join(''))}${files
            .slice(1)
            .map((f) => preload(f))
            .join('')}}`,
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
