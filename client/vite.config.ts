import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * three.js, the scene and the set's precomputed parts load in a chunk of
 * their own, the one the lobby's canvas (LobbyCanvas.tsx), the game's board
 * (GameCanvas.tsx) and the landing page's preview share. On the side choice
 * (/new) and a game's address (/game/:id) the page needs it at once, so the
 * built page starts fetching it (and the chunks it imports) alongside the
 * entry, instead of after the entry has loaded and run; the start page leaves
 * it for later. The build fails if a chunk is not found, rather than quietly
 * shipping a page without the preload.
 */
const PRELOADED = ['/src/screens/lobby/LobbyCanvas.tsx', '/src/screens/GameCanvas.tsx'];
const preloadSceneOnGamePages = (): Plugin => ({
  name: 'preload-scene-on-game-pages',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler(_html, ctx) {
      const chunks = Object.values(ctx.bundle ?? {}).filter((c) => c.type === 'chunk');
      // The chunk that holds a module (not always its facade: a dynamic
      // entry can share its chunk)
      const from = (file: string) => {
        const chunk = chunks.find((c) =>
          c.moduleIds.some((id) => id.replaceAll('\\', '/').endsWith(file)),
        );
        if (!chunk) throw new Error(`preload-scene-on-game-pages: no chunk holds ${file}`);
        return chunk;
      };
      // Each, and what it imports, less the entry (loading anyway)
      const entry = chunks.find((c) => c.isEntry);
      const files = [
        ...new Set(PRELOADED.map(from).flatMap((c) => [c.fileName, ...c.imports])),
      ].filter((f) => f !== entry?.fileName);
      const preload = (f: string) =>
        `{const l=document.createElement('link');l.rel='modulepreload';l.crossOrigin='';l.href='/${f}';document.head.appendChild(l)}`;
      return [
        {
          tag: 'script',
          injectTo: 'head',
          children: `if(/^\\/(game\\/|new$)/.test(location.pathname)){${files.map(preload).join('')}}`,
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
  plugins: [react(), r3fCatalogue(), preloadSceneOnGamePages()],
  css: {
    postcss: './postcss.config.js',
  },
});
