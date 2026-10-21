import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build, defineConfig, minify } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { DEFAULT_WS_URL, startEarlySocket } from './src/lib/earlySocket';
import { ROLE_KEY_PREFIX } from './src/lib/playerRole';
import { CLIENT_ID_KEY } from './src/lib/clientId';

type Chunk = { fileName: string; imports: string[]; moduleIds: string[]; isEntry: boolean };
/** The chunk that holds a module (not always its facade: a dynamic entry can share its chunk). */
const holding = (chunks: Iterable<Chunk>, module: string) =>
  [...chunks].find((c) => c.moduleIds.some((id) => id.replaceAll('\\', '/').endsWith(module)));
/** A chunk and the chunks it imports statically, in turn, nearest first, added to `seen`. */
const reach = (chunks: Map<string, Chunk>, file: string, seen = new Set<string>()) => {
  const queue = [file];
  for (const next of queue) {
    if (!chunks.has(next) || seen.has(next)) continue;
    seen.add(next);
    queue.push(...chunks.get(next)!.imports);
  }
  return seen;
};

/**
 * One of earlyPicture.ts's functions, bundled with the lens it places by into
 * a script that stands alone, to be written into the built page.
 */
const earlyScript = async (name: 'preloadLandingPicture' | 'placeEarlyPicture') => {
  const entry = resolve(import.meta.dirname, 'src/screens/earlyPicture.ts');
  const built = await build({
    configFile: false,
    logLevel: 'silent',
    publicDir: false,
    define: { __LANDING_VERSION__: JSON.stringify(landingVersion()) },
    plugins: [
      {
        name: 'early-picture',
        resolveId: (id) => (id === 'early-picture' ? id : null),
        load: (id) =>
          id === 'early-picture'
            ? `import { ${name} } from ${JSON.stringify(entry)}; ${name}();`
            : null,
      },
    ],
    build: {
      write: false,
      minify: true,
      rolldownOptions: { input: 'early-picture', output: { format: 'iife' } },
    },
  });
  const output = (Array.isArray(built) ? built[0] : built) as { output: { code?: string }[] };
  return (output.output[0].code ?? '').trim();
};

/**
 * The start page's pictures (public/landing/) are asked for with a version, a
 * hash of every one of them, in their addresses (landingLens.ts, pictureSource),
 * so the host keeps them a year, as it keeps the files under assets/: a
 * returning visit paints the picture from its cache, without asking whether
 * it changed. Pictures re-rendered are a new version, and a new address.
 */
export const landingVersion = (dir = resolve(import.meta.dirname, 'public/landing')): string => {
  const hash = createHash('sha256');
  for (const name of readdirSync(dir).sort())
    hash.update(name).update(readFileSync(resolve(dir, name)));
  return hash.digest('hex').slice(0, 8);
};
export const versionLandingPictures = (): Plugin => {
  let outDir = 'dist';
  return {
    name: 'version-landing-pictures',
    apply: 'build',
    config: () => ({ define: { __LANDING_VERSION__: JSON.stringify(landingVersion()) } }),
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      appendFileSync(
        resolve(outDir, '_headers'),
        `\n# The start page's pictures, asked for by their version (vite.config.ts, versionLandingPictures)\n/landing/*\n  Cache-Control: ${KEEP_A_YEAR}\n`,
      );
    },
  };
};

/**
 * The start page shows a picture of its preview while three.js loads
 * (LandingPicture): the built page starts it downloading from an inline
 * script in its head, before the stylesheet and the entry have loaded, on
 * the start page alone (preloadLandingPicture).
 */
export const preloadLandingPictureOnStartPage = (): Plugin => ({
  name: 'preload-landing-picture',
  apply: 'build',
  async transformIndexHtml(html) {
    const code = await earlyScript('preloadLandingPicture');
    // After the viewport's tag: before it, a phone's innerWidth is the
    // default 980 px, and the script would pick (and fetch) the tablet's picture
    const viewport = /<meta name="viewport"[^>]*>/i;
    if (!viewport.test(html))
      throw new Error('preload-landing-picture: index.html has no <meta name="viewport">');
    return html.replace(viewport, (tag) => `${tag}\n    <script>${code}</script>`);
  },
});

/**
 * And places it from an inline script right after #root, so the browser
 * paints it as soon as it has arrived, before the entry has loaded and run
 * (placeEarlyPicture).
 */
export const placeLandingPictureEarly = (): Plugin => ({
  name: 'place-landing-picture-early',
  apply: 'build',
  async transformIndexHtml(html) {
    const code = await earlyScript('placeEarlyPicture');
    const root = '<div id="root"></div>';
    if (!html.includes(root))
      throw new Error('place-landing-picture-early: no #root in index.html');
    // A function replacer: a `$&` or `$'` in the code is not a pattern
    return html.replace(root, (tag) => `${tag}\n    <script>${code}</script>`);
  },
});

/**
 * What each page needs at once, by address (App.tsx's routes, but for the
 * start page, which loads the scene itself): its own chunks, which the built
 * page starts fetching (with every chunk they import, in turn) alongside the entry,
 * instead of after the entry has loaded and run. First the page itself (a
 * game's address waits for it before it first renders: pageReady), then, at
 * low priority so they never hold it up, its canvases: three.js and the
 * scene load in a chunk of their own (the set's precomputed parts but the
 * king's occlusion follow in another: three/pieces/pieceData.ts), the one the
 * lobby's canvas (LobbyCanvas.tsx), the game's board (GameCanvas.tsx), the
 * tutorial's board (LearnCanvas.tsx) and the start page's preview share. The
 * lobby's pages are the side choice (/new, /computer) and the games it goes on
 * to. The build fails if a chunk is not found, rather than quietly shipping a
 * page without the preload.
 */
const LOBBY_CANVASES = ['lobby/LobbyCanvas.tsx', 'GameCanvas.tsx'];
export const PRELOADS: [path: RegExp, page: string[], canvases: string[]][] = [
  [/^\/(game\/|new$)/, ['GameScreen.tsx'], LOBBY_CANVASES],
  [/^\/computer(\/|$)/, ['ComputerGameScreen.tsx', 'GameScreen.tsx'], LOBBY_CANVASES],
  [/^\/learn(\/|$)/, ['learn/LearnScreen.tsx'], ['learn/LearnCanvas.tsx']],
];
/** The preload script for the built page's head, from its bundle's chunks. */
export const preloadScript = (chunks: Chunk[]) => {
  const byName = new Map(chunks.map((c) => [c.fileName, c]));
  const from = (file: string) => {
    const chunk = holding(chunks, `/src/screens/${file}`);
    if (!chunk) throw new Error(`preload-route-chunks: no chunk holds ${file}`);
    return chunk.fileName;
  };
  // Each, and what it imports, less the entry and what it imports (loading
  // anyway: the page links those itself)
  const entry = chunks.find((c) => c.isEntry);
  const loading = entry ? reach(byName, entry.fileName) : new Set<string>();
  const files = (modules: string[]) => {
    const seen = new Set<string>();
    for (const module of modules) reach(byName, from(module), seen);
    return [...seen].filter((f) => !loading.has(f));
  };
  const table = PRELOADS.map(([path, page, canvases]) => {
    const first = files(page);
    const later = files(canvases).filter((f) => !first.includes(f));
    return `[${path},${JSON.stringify(first)},${JSON.stringify(later)}]`;
  });
  const preload = `(f,q)=>{const l=document.createElement('link');l.rel='modulepreload';l.crossOrigin='';if(q)l.fetchPriority='low';l.href='/'+f;document.head.appendChild(l)}`;
  return `{const a=location.pathname,p=${preload},m=[${table.join(',')}].find(([r])=>r.test(a));if(m){m[1].forEach(f=>p(f));m[2].forEach(f=>p(f,1))}}`;
};
export const preloadRouteChunks = (): Plugin => ({
  name: 'preload-route-chunks',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler(html, ctx) {
      const chunks = Object.values(ctx.bundle ?? {}).filter((c) => c.type === 'chunk');
      // Right ahead of the stylesheet: an inline script waits for a
      // stylesheet before it (the preload scanner cannot see the links a
      // script makes), and the start page's own scripts stay first
      const stylesheet = /<link rel="stylesheet"[^>]*>/i;
      if (!stylesheet.test(html))
        throw new Error('preload-route-chunks: the built page has no stylesheet link');
      const script = `<script>${preloadScript(chunks)}</script>`;
      return html.replace(stylesheet, (tag) => `${script}\n    ${tag}`);
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
      const { code, errors } = await minify(
        'early-socket.js',
        `(${startEarlySocket.toString()})(${JSON.stringify(url)},${JSON.stringify(keys)})`,
      );
      if (errors.length) throw new Error(`early-socket: ${errors[0].message}`);
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
 * arrived: three.js, r3f and the scene load lazily (CLAUDE.md), as do the
 * tutorial's page and a game against the computer (their own chunks, which
 * load their canvases lazily in turn), and the computer's search (in its
 * worker; the page knows only ai/levels.ts and ai/computer.ts). One static
 * import of a helper that imports three would pull it all into the entry
 * without a word, so the build fails if one of those pages' chunks, or a
 * chunk it imports statically, holds any of it.
 */
const SCENE_MODULE =
  /\/node_modules\/(three|@react-three)\/|\/src\/ai\/(?!levels\.ts$|computer\.ts$)/;
/**
 * The start page's own code and styles (the entry and what it imports
 * statically), gzipped at the highest level: bytes a phone on a mobile network
 * waits on (CLAUDE.md "Performance"). The build fails above this, so a change
 * or a dependency's update that adds to them says so; raise it on purpose,
 * naming the cost in the PR. A tripwire for growth, not the host's size.
 */
const ENTRY_GZIP_BUDGET = 100_000;
const SHOWN_BEFORE_SCENE = [
  '/src/screens/GameScreen.tsx',
  '/src/screens/learn/LearnScreen.tsx',
  '/src/screens/ComputerGameScreen.tsx',
];
const LOBBY_CANVAS = '/src/screens/lobby/LobbyCanvas.tsx';
const PIECE_DATA = ['/src/three/pieces/knight.medium.ts', '/src/three/scene/occlusion.medium.ts'];
export const keepSceneOutOfEntry = (): Plugin => ({
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
      for (const f of reach(chunks, file, seen)) {
        const scene = chunks
          .get(f)!
          .moduleIds.find((id) => SCENE_MODULE.test(id.replaceAll('\\', '/')));
        if (scene)
          this.error(`keep-scene-out-of-entry: ${f} loads before the scene and holds ${scene}`);
      }
    };
    for (const c of chunks.values()) if (c.isEntry) walk(c.fileName);
    if (!seen.size) this.error('keep-scene-out-of-entry: no entry chunk');
    // Those pages load as chunks of their own, never in the entry (a static
    // import would put them there, and the walk below would find it seen)
    const entry = new Set(seen);
    const css = new Set(
      [...entry].flatMap((f) => [...(chunks.get(f)!.viteMetadata?.importedCss ?? [])]),
    );
    const gz = (text: string | Uint8Array) => gzipSync(text, { level: 9 }).length;
    // The start page always imports index.css: no CSS, or a name the bundle
    // lacks, means Vite's metadata changed and the sum would quietly shrink
    if (!css.size) this.error('keep-scene-out-of-entry: the entry imports no CSS');
    const bytes =
      [...entry].reduce((t, f) => t + gz(chunks.get(f)!.code), 0) +
      [...css].reduce((t, f) => {
        const asset = bundle[f];
        if (asset?.type !== 'asset') this.error(`keep-scene-out-of-entry: no asset ${f}`);
        return t + gz(asset.source);
      }, 0);
    if (bytes > ENTRY_GZIP_BUDGET)
      this.error(
        `keep-scene-out-of-entry: the start page's code and styles are ${bytes} bytes gzipped, ` +
          `over ENTRY_GZIP_BUDGET (${ENTRY_GZIP_BUDGET}): name the cost in the PR and raise it`,
      );
    for (const page of SHOWN_BEFORE_SCENE) {
      const chunk = holding(chunks.values(), page);
      if (!chunk) this.error(`keep-scene-out-of-entry: no chunk holds ${page}`);
      else if (entry.has(chunk.fileName))
        this.error(`keep-scene-out-of-entry: ${page} is in the entry, not a chunk of its own`);
      else walk(chunk.fileName);
    }
    // The lobby draws only kings: the rest of the set's precomputed parts
    // (three/pieces/pieceData.ts) stay out of its canvas's chunk and what that
    // imports statically, so the side choice never waits for them
    const lobby = holding(chunks.values(), LOBBY_CANVAS);
    if (!lobby) this.error(`keep-scene-out-of-entry: no chunk holds ${LOBBY_CANVAS}`);
    for (const f of reach(chunks, lobby!.fileName)) {
      const data = chunks
        .get(f)!
        .moduleIds.find((id) => PIECE_DATA.some((m) => id.replaceAll('\\', '/').endsWith(m)));
      if (data) this.error(`keep-scene-out-of-entry: ${f} loads with the lobby and holds ${data}`);
    }
  },
});

/**
 * A game's link is how a friend is invited, and a link preview (a chat app's,
 * a social site's) reads the page's meta tags without running the app. So
 * the build writes invite.html, index.html with the invitation's title and
 * description in place of the start page's, and public/_redirects serves it at /game/*.
 * The build fails if a tag it replaces is missing.
 */
const INVITE_META: Record<string, string> = {
  'og:title': "You're invited to a game of 3D Chess",
  'og:description': 'Your opponent is waiting.',
  description: 'Your opponent is waiting.',
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

/**
 * Pages keeps nothing by default: a returning browser asks again for every
 * file. The files the build writes under assets/ carry a hash of their
 * contents in their names, so the build adds a rule to the host's `_headers`
 * for each of them, keeping it a year. One rule a file, never `/assets/*`: a
 * name this deploy does not have (an old page's chunk after a deploy) matches
 * no rule, so whatever the host answers for it is never kept, and
 * assets/404.html makes that answer a 404 (Pages serves the nearest 404.html)
 * rather than the start page. The build fails on a file there whose name has
 * no hash, and past Pages' 100 rules.
 */
export const HASHED_NAME = /^assets\/[\w.-]+-[\w-]{8}\.\w+$/;
export const KEEP_A_YEAR = 'public, max-age=31536000, immutable';
export const keepHashedFiles = (): Plugin => {
  let outDir = 'dist';
  return {
    name: 'keep-hashed-files',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    writeBundle(_options, bundle) {
      const names = Object.keys(bundle).filter((name) => name.startsWith('assets/'));
      const unhashed = names.filter((name) => !HASHED_NAME.test(name));
      if (unhashed.length) this.error(`keep-hashed-files: no hash in ${unhashed.join(', ')}`);
      const headers = resolve(outDir, '_headers');
      const rules = names.map((name) => `/${name}\n  Cache-Control: ${KEEP_A_YEAR}\n`);
      appendFileSync(
        headers,
        `\n# The built files, named by their hash (vite.config.ts, keepHashedFiles)\n${rules.join('')}`,
      );
      const count = readFileSync(headers, 'utf8').match(/^\//gm)?.length ?? 0;
      if (count > 100) this.error(`keep-hashed-files: ${count} rules in _headers, past Pages' 100`);
      writeFileSync(
        resolve(outDir, 'assets/404.html'),
        '<!doctype html><title>Not found</title>\n',
      );
    },
  };
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    r3fCatalogue(),
    earlySocket(),
    preloadLandingPictureOnStartPage(),
    placeLandingPictureEarly(),
    preloadRouteChunks(),
    keepSceneOutOfEntry(),
    invitePage(),
    socialImageOnPreviews(),
    versionLandingPictures(),
    keepHashedFiles(),
  ],
  resolve: {
    // r3f pins a scheduler of its own (0.28) beside react-dom's (0.27, the
    // same code): one copy, and one task queue for both roots
    dedupe: ['scheduler'],
  },
});
