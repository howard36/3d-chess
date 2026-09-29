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

/**
 * r3f's Canvas registers the whole three namespace (extend(THREE)), which
 * keeps all of three.js in the build. In the build it is handed the classes
 * the scene uses as elements instead (src/three/r3fCatalogue.ts), and the
 * rest of three.js is left to tree-shaking.
 */
const r3fCatalogue = (): Plugin => {
  const canvasModule = (id: string) =>
    id.replaceAll('\\', '/').includes('/@react-three/fiber/') &&
    id.includes('react-three-fiber.esm');
  let redirected = false;
  return {
    name: 'r3f-catalogue',
    apply: 'build',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (source !== 'three' || !importer || !canvasModule(importer)) return null;
      redirected = true;
      return this.resolve('/src/three/r3fCatalogue.ts', importer, { skipSelf: true });
    },
    // The catalogue stands in for three only where r3f uses it to name
    // elements: fail the build if a new r3f uses it for anything else, or if
    // the redirect stops applying (all of three.js would quietly come back)
    transform(code, id) {
      if (!canvasModule(id)) return null;
      const bare = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      const uses = bare.match(/\bTHREE\b/g)?.length ?? 0;
      if (uses !== 2 || !/extend\(THREE\)/.test(bare)) {
        this.error(`r3f-catalogue: ${id} uses THREE beyond extend(THREE); review the catalogue`);
      }
      return null;
    },
    buildEnd(error) {
      if (!error && !redirected)
        this.error("r3f-catalogue: r3f's Canvas module was not redirected");
    },
  };
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), r3fCatalogue(), preloadGameScreenOnGamePages()],
  css: {
    postcss: './postcss.config.js',
  },
});
