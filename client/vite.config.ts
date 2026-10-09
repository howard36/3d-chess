import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

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

/**
 * A game's link is how a friend is invited, and a link preview (a chat app's,
 * a social site's) reads the page's meta tags without running the app. So
 * the build writes invite.html, index.html with the invitation's title in
 * place of the start page's, and public/_redirects serves it at /game/*.
 * The build fails if a tag it replaces is missing.
 */
const INVITE_META: Record<string, string> = {
  'og:title': "You're invited to a game of 3D Chess",
};
const invitePage = (): Plugin => ({
  name: 'invite-page',
  apply: 'build',
  enforce: 'post',
  generateBundle(_options, bundle) {
    const index = bundle['index.html'];
    if (index?.type !== 'asset') this.error('invite-page: no index.html in the bundle');
    let html = String(index.source);
    for (const [key, content] of Object.entries(INVITE_META)) {
      const tag = new RegExp(`(<meta\\s+(?:name|property)="${key}"\\s+content=")[^"]*(")`);
      if (!tag.test(html)) this.error(`invite-page: index.html has no ${key} meta tag`);
      html = html.replace(tag, `$1${content.replaceAll("'", '&#39;')}$2`);
    }
    this.emitFile({ type: 'asset', fileName: 'invite.html', source: html });
  },
});

/**
 * og:image must be an absolute address, and the site's own holds only what
 * main has deployed: a branch's preview on Cloudflare Pages (which builds
 * with CF_PAGES_BRANCH and CF_PAGES_URL set) points at the image it deployed
 * itself, so its link previews show the picture they will have once merged.
 */
const SOCIAL_IMAGE = 'https://3dchess.club/og.jpg';
const socialImageOnPreviews = (): Plugin => ({
  name: 'social-image-on-previews',
  apply: 'build',
  transformIndexHtml(html) {
    const { CF_PAGES_BRANCH: branch, CF_PAGES_URL: url } = process.env;
    if (!branch || branch === 'main' || !url) return html;
    if (!html.includes(SOCIAL_IMAGE))
      throw new Error(`social-image-on-previews: index.html has no ${SOCIAL_IMAGE}`);
    return html.replaceAll(SOCIAL_IMAGE, `${url.replace(/\/$/, '')}/og.jpg`);
  },
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    r3fCatalogue(),
    preloadSceneOnGamePages(),
    keepSceneOutOfEntry(),
    invitePage(),
    socialImageOnPreviews(),
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
