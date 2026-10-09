import { defineConfig, transformWithEsbuild } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { DEFAULT_WS_URL, startEarlySocket } from './src/lib/earlySocket';
import { ROLE_KEY_PREFIX } from './src/lib/playerRole';
import { CLIENT_ID_KEY } from './src/lib/clientId';

/**
 * three.js, the scene and the set's precomputed parts load in a chunk of
 * their own, the one the lobby's canvas (LobbyCanvas.tsx), the game's board
 * (GameCanvas.tsx), the tutorial's board (LearnCanvas.tsx) and the landing
 * page's preview share. On the side choice (/new, /computer), a game's
 * address (/game/:id, /computer/:id) and the tutorial (/learn, whose own page
 * is a chunk too, LearnScreen.tsx) the page needs it at once, so the
 * built page starts fetching it (and the chunks it imports) alongside the
 * entry, instead of after the entry has loaded and run; the start page leaves
 * it for later. The build fails if a chunk is not found, rather than quietly
 * shipping a page without the preload.
 */
const PRELOADED = [
  '/src/screens/lobby/LobbyCanvas.tsx',
  '/src/screens/GameCanvas.tsx',
  '/src/screens/learn/LearnScreen.tsx',
  '/src/screens/learn/LearnCanvas.tsx',
];
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
          children: `if(/^\\/(game\\/|new$|computer(\\/|$)|learn(\\/|$))/.test(location.pathname)){${files.map(preload).join('')}}`,
        },
      ];
    },
  },
});

/**
 * The built page opens its socket from an inline script in its head, before the entry has loaded, and on a game's address sends its first
 * request (src/lib/earlySocket.ts): the app adopts the socket and what came
 * back. Build only: the dev server's StrictMode mounts the app's socket twice
 * (closing the first), which would rejoin the seat a second time.
 */
const earlySocket = (): Plugin => {
  let url = DEFAULT_WS_URL;
  return {
    name: 'early-socket',
    apply: 'build',
    configResolved(config) {
      url = config.env.VITE_WS_URL ?? DEFAULT_WS_URL;
    },
    async transformIndexHtml(html) {
      const keys = { role: ROLE_KEY_PREFIX, clientId: CLIENT_ID_KEY };
      // Minified: it is in every page's HTML
      const { code } = await transformWithEsbuild(
        `(${startEarlySocket.toString()})(${JSON.stringify(url)},${JSON.stringify(keys)})`,
        'early-socket.js',
        { minify: true },
      );
      // Right after the charset (which must stand in the first 1024 bytes),
      // ahead of the stylesheet: an inline script waits for a stylesheet before it
      const charset = /<meta charset[^>]*>/i;
      if (!charset.test(html)) throw new Error('early-socket: index.html has no <meta charset>');
      return html.replace(charset, (tag) => `${tag}\n    <script>${code.trim()}</script>`);
    },
  };
};

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

/**
 * The start page, a game's invitation and its HUD show before three.js has
 * arrived: three.js, r3f and the scene load lazily (CLAUDE.md). One static
 * import of a helper that imports three would pull it all into the entry
 * without a word, so the build fails if the entry, or a chunk it imports
 * statically, holds any of it.
 */
const SCENE_MODULE = /\/node_modules\/(three|@react-three)\//;
const keepSceneOutOfEntry = (): Plugin => ({
  name: 'keep-scene-out-of-entry',
  apply: 'build',
  generateBundle(_options, bundle) {
    const chunks = new Map(
      Object.values(bundle)
        .filter((c) => c.type === 'chunk')
        .map((c) => [c.fileName, c]),
    );
    const seen = new Set<string>();
    const walk = (file: string) => {
      const chunk = chunks.get(file);
      if (!chunk || seen.has(file)) return;
      seen.add(file);
      const scene = chunk.moduleIds.filter((id) => SCENE_MODULE.test(id.replaceAll('\\', '/')));
      if (scene.length)
        this.error(`keep-scene-out-of-entry: ${file} loads with the entry and holds ${scene[0]}`);
      chunk.imports.forEach(walk);
    };
    for (const c of chunks.values()) if (c.isEntry) walk(c.fileName);
    if (!seen.size) this.error('keep-scene-out-of-entry: no entry chunk');
  },
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    r3fCatalogue(),
    earlySocket(),
    preloadSceneOnGamePages(),
    keepSceneOutOfEntry(),
  ],
  css: {
    postcss: './postcss.config.js',
  },
  resolve: {
    // r3f and its reconciler each pin a scheduler of their own (0.25) beside
    // react-dom's (0.26): one copy, and one task queue for both roots
    dedupe: ['scheduler'],
  },
});
