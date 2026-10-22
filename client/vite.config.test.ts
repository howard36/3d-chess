import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { UserConfig } from 'vite';
import { expect, test, vi } from 'vitest';
import { picturePlacement } from './src/three/landingLens';
import { parseHeaders } from './bench/preview.config';
import { DEFAULT_WS_URL } from './src/lib/earlySocket';
import { ROLE_KEY_PREFIX } from './src/lib/playerRole';
import config, {
  COMPILE_HINT,
  compileSceneEagerly,
  earlySocket,
  KEEP_A_YEAR,
  keepHashedFiles,
  keepSceneOutOfEntry,
  landingVersion,
  placeLandingPictureEarly,
  PRELOADS,
  preloadLandingPictureOnStartPage,
  preloadRouteChunks,
  preloadScript,
  versionLandingPictures,
} from './vite.config';

test('the built page preloads its picture after the viewport tag, where a phone knows its width', async () => {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const transform = preloadLandingPictureOnStartPage().transformIndexHtml as (
    html: string,
  ) => Promise<string>;
  const built = await transform(html);
  // Before the tag a phone's innerWidth is the default 980 px: the script
  // would pick the tablet's picture, and the phone's would come late
  const viewport = built.indexOf('<meta name="viewport"');
  expect(viewport).toBeGreaterThan(-1);
  expect(built.indexOf('innerWidth')).toBeGreaterThan(viewport);
});

test('the built page places the start page’s picture right after #root, self-contained', async () => {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const transform = placeLandingPictureEarly().transformIndexHtml as (
    html: string,
  ) => Promise<string>;
  const built = await transform(html);
  const script = built.match(/<div id="root"><\/div>\s*<script>([\s\S]*?)<\/script>/)?.[1];
  expect(script).toBeTruthy();
  expect(script).not.toMatch(/\bimport\b/);
  // Every start page carries it: a few KB at most (2,380 bytes when written)
  expect(script!.length).toBeLessThan(3200);
  // Run as the built page runs it, on its own: on `/` in a phone's window it
  // places the picture the page's own would show, before #root; anywhere else
  // (another page, a wider window) nothing
  try {
    for (const [path, width, height] of [
      ['/', 390, 844],
      ['/', 1440, 900],
      ['/new', 390, 844],
    ] as const) {
      vi.stubGlobal('innerWidth', width);
      vi.stubGlobal('innerHeight', height);
      window.history.replaceState(null, '', path);
      document.body.innerHTML = '<div id="root"></div>';
      new Function(script!)();
      const img = document.querySelector<HTMLImageElement>('#landing-early img');
      if (path !== '/' || width > height) expect(img).toBeNull();
      else {
        const place = picturePlacement(width, height);
        expect(document.getElementById('landing-early')!.nextElementSibling?.id).toBe('root');
        expect(img!.getAttribute('src')).toBe(
          `/landing/${place.picture}.webp?v=${landingVersion()}`,
        );
        expect(img!.style.width).toBe(`${place.width}px`);
      }
    }
  } finally {
    document.body.innerHTML = '';
    window.history.replaceState(null, '', '/');
    vi.unstubAllGlobals();
  }
});

test('the built page’s preload asks for the very addresses its early picture shows, by their version', async () => {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const head = preloadLandingPictureOnStartPage().transformIndexHtml as (
    h: string,
  ) => Promise<string>;
  const body = placeLandingPictureEarly().transformIndexHtml as (h: string) => Promise<string>;
  const built = await body(await head(html));
  const scripts = [...built.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  try {
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('innerHeight', 844);
    window.history.replaceState(null, '', '/');
    document.body.innerHTML = '<div id="root"></div>';
    for (const script of scripts) new Function(script)();
    const link = document.head.querySelector('link[rel="preload"][as="image"]')!;
    const source = document.querySelector('#landing-early source')!;
    expect(link.getAttribute('imagesrcset')).toBe(source.getAttribute('srcset'));
    expect(link.getAttribute('href')).toContain(`?v=${landingVersion()}`);
    link.remove();
  } finally {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  }
});

test('the early pictures’ scripts go in as written, whatever `$` patterns the minifier makes', async () => {
  // `$&&` is ordinary minified code; as a replace() string it would put the tag in again
  const code = "$&&$'";
  vi.doMock('vite', async (original) => ({
    ...(await original<typeof import('vite')>()),
    build: async () => ({ output: [{ code }] }),
  }));
  vi.resetModules();
  try {
    const plugins = await import('./vite.config');
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    for (const plugin of [
      plugins.preloadLandingPictureOnStartPage(),
      plugins.placeLandingPictureEarly(),
    ]) {
      const built = await (plugin.transformIndexHtml as (h: string) => Promise<string>)(html);
      expect(built).toContain(`<script>${code}</script>`);
    }
  } finally {
    vi.doUnmock('vite');
    vi.resetModules();
  }
});

test('the pictures’ version changes with any of them, and the host keeps them a year', () => {
  const dir = mkdtempSync(join(tmpdir(), 'landing-'));
  try {
    writeFileSync(join(dir, 'phone.avif'), 'a');
    const before = landingVersion(dir);
    writeFileSync(join(dir, 'phone.avif'), 'b');
    expect(landingVersion(dir)).not.toBe(before);
    writeFileSync(join(dir, '_headers'), '');
    const plugin = versionLandingPictures();
    (plugin.configResolved as (c: unknown) => void)({ root: dir, build: { outDir: '.' } });
    (plugin.writeBundle as () => void)();
    const rules = parseHeaders(readFileSync(join(dir, '_headers'), 'utf8'));
    expect(rules.find((r) => r.path.test('/landing/phone@2x.avif'))?.headers).toEqual([
      ['Cache-Control', KEEP_A_YEAR],
    ]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('the entry asks for the pictures by the version the early scripts ask for', () => {
  // Without it the page's own picture misses the head's preload and the host's year-long rule
  const config = (versionLandingPictures().config as () => UserConfig)();
  expect(config.define?.__LANDING_VERSION__).toBe(JSON.stringify(landingVersion()));
});

test('the link preview’s picture is the size its tags say, as the browser’s own JPEG', () => {
  // X's cards showed no picture for ffmpeg's JPEG (no JFIF header, every
  // channel sampled 1x2): scripts/readme-image.mjs writes the browser's own
  const jpeg = readFileSync(resolve(process.cwd(), 'public/og.jpg'));
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const tag = (key: string) => html.match(new RegExp(`"${key}" content="([^"]*)"`))?.[1];
  expect(jpeg.toString('latin1', 6, 11)).toBe('JFIF\0');
  // The frame: baseline (SOF0), its height, width and components' sampling
  let at = 2;
  while (jpeg[at + 1] !== 0xc0) {
    expect(jpeg[at]).toBe(0xff);
    expect(jpeg[at + 1]).not.toBe(0xc2);
    at += 2 + jpeg.readUInt16BE(at + 2);
  }
  const [height, width] = [jpeg.readUInt16BE(at + 5), jpeg.readUInt16BE(at + 7)];
  const sampling = [0, 1, 2].map((c) => jpeg[at + 11 + 3 * c]);
  expect({ width, height, sampling }).toEqual({
    width: Number(tag('og:image:width')),
    height: Number(tag('og:image:height')),
    // 4:2:0: luma 2x2, both chroma 1x1
    sampling: [0x22, 0x11, 0x11],
  });
  expect(tag('twitter:image')).toBe(tag('og:image'));
});

test('the build runs every plugin this file defines', () => {
  const flat = (p: unknown): unknown[] => (Array.isArray(p) ? p.flatMap(flat) : [p]);
  const names = flat((config as UserConfig).plugins).map((p) => (p as { name?: string })?.name);
  // Each plugin's tests call it directly, so only this catches one left out of `plugins`.
  // 'early-picture' is the start page's script's own sub-build.
  const defined = [
    ...readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8').matchAll(
      /^\s+name: '([\w-]+)',$/gm,
    ),
  ]
    .map((m) => m[1])
    .filter((name) => name !== 'early-picture');
  expect(defined.length).toBeGreaterThanOrEqual(10);
  expect(names).toEqual(expect.arrayContaining(defined));
});

test('the scene’s chunks start with the compile hint, ahead of Vite’s own first line, and nothing a first screen loads', () => {
  // V8 reads the hint only as a file's very first line: the step runs after
  // Vite's import analysis, which puts `__vite__mapDeps` at a chunk's top in
  // its own generateBundle
  const plugin = compileSceneEagerly();
  expect(plugin.enforce).toBe('post');
  const step = plugin.generateBundle as {
    order: string;
    handler: (this: unknown, o: unknown, b: Record<string, unknown>) => void;
  };
  expect(step.order).toBe('post');
  const chunk = (
    fileName: string,
    moduleIds: string[],
    imports: string[] = [],
    isEntry = false,
  ) => ({
    type: 'chunk',
    fileName,
    code: 'const __vite__mapDeps=(i)=>i;\nf();',
    moduleIds,
    imports,
    isEntry,
  });
  const shared = chunk('shared.js', ['/app/src/game/history.ts']);
  const entry = chunk('index.js', ['/app/src/main.tsx'], ['shared.js'], true);
  const pages = ['GameScreen', 'learn/LearnScreen', 'ComputerGameScreen'].map((p) =>
    chunk(`${p}.js`, [`/app/src/screens/${p}.tsx`], ['shared.js']),
  );
  const scene = chunk('scene.js', ['/app/node_modules/three/build/three.core.js'], ['shared.js']);
  const canvas = chunk('GameCanvas.js', ['/app/src/screens/GameCanvas.tsx'], ['scene.js']);
  const bundle = Object.fromEntries(
    [shared, entry, ...pages, scene, canvas].map((c) => [c.fileName, c]),
  );
  const context = {
    error: (message: string) => {
      throw new Error(message);
    },
  };
  step.handler.call(context, {}, { ...bundle, 'index.css': { type: 'asset' } });
  expect(COMPILE_HINT).toBe('//# allFunctionsCalledOnLoad\n');
  for (const c of [scene, canvas])
    expect(c.code).toBe(`${COMPILE_HINT}const __vite__mapDeps=(i)=>i;\nf();`);
  for (const c of [shared, entry, ...pages]) expect(c.code).not.toContain(COMPILE_HINT);
  // three.js where a first screen would load it: no chunk of the scene's own
  const loaded = { ...bundle, 'shared.js': chunk('shared.js', scene.moduleIds) };
  expect(() => step.handler.call(context, {}, loaded)).toThrow(/not in a chunk of the scene's own/);
});

/** Runs keepHashedFiles' build step on a build of these files, in a folder of its own. */
const keepFiles = (names: string[]) => {
  const dir = mkdtempSync(join(tmpdir(), 'build-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, '_headers'), readFileSync(resolve(process.cwd(), 'public/_headers')));
  const plugin = keepHashedFiles();
  (plugin.configResolved as (c: unknown) => void)({ root: dir, build: { outDir: '.' } });
  const context = {
    error: (message: string) => {
      throw new Error(message);
    },
  };
  try {
    (plugin.writeBundle as (this: unknown, o: unknown, b: unknown) => void).call(
      context,
      {},
      Object.fromEntries(names.map((name) => [name, {}])),
    );
    return {
      rules: parseHeaders(readFileSync(join(dir, '_headers'), 'utf8')),
      notFound: existsSync(join(dir, 'assets/404.html')),
    };
  } finally {
    rmSync(dir, { recursive: true });
  }
};

test('the host keeps a year each file the build wrote under assets/, and nothing else', () => {
  const { rules, notFound } = keepFiles([
    'index.html',
    'assets/index-B2x9_kQe.js',
    'assets/manrope-latin-600-normal-4f0koTD-.woff2',
  ]);
  const cache = (path: string) =>
    rules
      .filter((r) => r.path.test(path))
      .flatMap((r) => r.headers)
      .find(([name]) => name === 'Cache-Control')?.[1];
  expect(cache('/assets/index-B2x9_kQe.js')).toBe(KEEP_A_YEAR);
  expect(cache('/assets/manrope-latin-600-normal-4f0koTD-.woff2')).toBe(KEEP_A_YEAR);
  // A name this deploy lacks (an old page's chunk) is never kept: the host
  // answers it from assets/404.html, not with the start page
  for (const path of ['/assets/index-ZZZZZZZZ.js', '/assets/404.html', '/', '/index.html'])
    expect(cache(path)).toBeUndefined();
  for (const path of ['/game/abc', '/landing/phone.avif', '/og.jpg'])
    expect(cache(path)).toBeUndefined();
  expect(notFound).toBe(true);
  // Every file keeps the host's other headers
  expect(rules.filter((r) => r.path.test('/assets/index-B2x9_kQe.js')).length).toBe(2);
});

test('the build fails on a file under assets/ with no hash in its name', () => {
  expect(() => keepFiles(['assets/logo.svg'])).toThrow(/no hash in assets\/logo.svg/);
  expect(() => keepFiles(['assets/a-B2x9_kQe.js', 'assets/b.js'])).toThrow(/assets\/b.js/);
});

test('the build fails past the host’s 100 rules, and not at them', () => {
  // (one past the limit, with the host's own rules: public/_headers)
  const own = parseHeaders(readFileSync(resolve(process.cwd(), 'public/_headers'), 'utf8')).length;
  const many = Array.from({ length: 101 - own }, (_, i) => `assets/c${i}-B2x9_kQe.js`);
  expect(() => keepFiles(many)).toThrow(/101 rules/);
  expect(() => keepFiles(many.slice(1))).not.toThrow();
});

// The gate that keeps three.js, r3f, the scene and the search out of the
// start page's code (a build's only), run on a bundle made by hand
type Part = Record<string, unknown>;
const chunk = (fileName: string, moduleIds: string[], more: Part = {}): Part => ({
  type: 'chunk',
  fileName,
  isEntry: false,
  imports: [],
  code: 'export {}',
  viteMetadata: { importedCss: new Set((more.css as string[] | undefined) ?? []) },
  moduleIds,
  ...more,
});
const sceneGate = (change: (parts: Record<string, Part>) => void = () => {}) => {
  const parts: Record<string, Part> = {
    'index.js': chunk('index.js', ['/src/main.tsx', '/src/ai/computer.ts', '/src/ai/levels.ts'], {
      isEntry: true,
      imports: ['shared.js'],
      css: ['index.css'],
    }),
    'shared.js': chunk('shared.js', ['/src/lib/focus.ts']),
    'learn.js': chunk('learn.js', ['/src/screens/learn/LearnScreen.tsx']),
    'computer.js': chunk('computer.js', ['/src/screens/ComputerGameScreen.tsx']),
    'game.js': chunk('game.js', ['/src/screens/GameScreen.tsx']),
    'scene.js': chunk('scene.js', [
      '/node_modules/three/build/three.module.js',
      '/src/ai/search.ts',
    ]),
    'lobby.js': chunk('lobby.js', ['/src/screens/lobby/LobbyCanvas.tsx'], {
      imports: ['scene.js'],
    }),
    'data.js': chunk('data.js', [
      '/src/three/pieces/knight.medium.ts',
      '/src/three/scene/occlusion.medium.ts',
    ]),
    'index.css': { type: 'asset', fileName: 'index.css', source: 'body{}' },
  };
  change(parts);
  const generate = keepSceneOutOfEntry().generateBundle as (...args: unknown[]) => void;
  const fail = (message: string) => {
    throw new Error(message);
  };
  generate.call({ error: fail }, {}, parts);
};

test('the build keeps the scene and the search out of the start page and the pages before the scene', () => {
  expect(() => sceneGate()).not.toThrow();
  // In a chunk the entry imports, by any path
  expect(() =>
    sceneGate((p) => {
      p['shared.js'].moduleIds = ['C:\\app\\node_modules\\@react-three\\fiber\\index.js'];
    }),
  ).toThrow(/shared.js loads before the scene/);
  expect(() =>
    sceneGate((p) => {
      p['index.js'].moduleIds = ['/src/main.tsx', '/src/ai/search.ts'];
    }),
  ).toThrow(/holds \/src\/ai\/search.ts/);
  // In a chunk that the tutorial's page imports statically
  expect(() =>
    sceneGate((p) => {
      p['learn.js'].imports = ['scene.js'];
    }),
  ).toThrow(/scene.js loads before the scene/);
  // The tutorial's page in the entry, not a chunk of its own
  expect(() =>
    sceneGate((p) => {
      p['index.js'].moduleIds = ['/src/main.tsx', '/src/screens/learn/LearnScreen.tsx'];
    }),
  ).toThrow(/LearnScreen.tsx is in the entry/);
  // Nor the game's page, nor what it imports statically
  expect(() =>
    sceneGate((p) => {
      p['index.js'].moduleIds = ['/src/main.tsx', '/src/screens/GameScreen.tsx'];
    }),
  ).toThrow(/GameScreen.tsx is in the entry/);
  expect(() =>
    sceneGate((p) => {
      p['game.js'].imports = ['scene.js'];
    }),
  ).toThrow(/scene.js loads before the scene/);
});

test('the build keeps the set’s precomputed parts out of what the lobby loads', () => {
  // In the scene's chunk, which the lobby's canvas imports statically
  expect(() =>
    sceneGate((p) => {
      p['scene.js'].moduleIds = [
        '/node_modules/three/build/three.module.js',
        'C:\\app\\src\\three\\scene\\occlusion.medium.ts',
      ];
    }),
  ).toThrow(/scene.js loads with the lobby and holds .*occlusion.medium.ts/);
  // In the lobby canvas's own chunk
  expect(() =>
    sceneGate((p) => {
      p['lobby.js'].moduleIds = [
        '/src/screens/lobby/LobbyCanvas.tsx',
        '/src/three/pieces/knight.medium.ts',
      ];
    }),
  ).toThrow(/lobby.js loads with the lobby and holds \/src\/three\/pieces\/knight.medium.ts/);
  // A bundle with no lobby canvas means the gate checks nothing
  expect(() =>
    sceneGate((p) => {
      delete p['lobby.js'];
    }),
  ).toThrow(/no chunk holds \/src\/screens\/lobby\/LobbyCanvas.tsx/);
});

test('the build fails past the start page’s budget, and on an entry with no styles', () => {
  // (random text: gzip cannot shrink it below the budget)
  const noise = randomBytes(200_000).toString('base64');
  expect(() =>
    sceneGate((p) => {
      p['shared.js'].code = noise;
    }),
  ).toThrow(/over ENTRY_GZIP_BUDGET/);
  expect(() =>
    sceneGate((p) => {
      p['index.js'].viteMetadata = { importedCss: new Set() };
    }),
  ).toThrow(/imports no CSS/);
});

/** Each of App.tsx's routes, with its address (parameters filled in, and left out where optional) and the element it renders. */
const appRoutes = () => {
  const app = readFileSync(resolve(import.meta.dirname, 'src/App.tsx'), 'utf8');
  // The routes under LobbyLayout: the side choice and the games it goes on to
  const lobby = app.match(/<Route element={<LobbyLayout \/>}>([\s\S]*?)<\/Route>/)?.[1];
  expect(lobby).toBeTruthy();
  const inLobby = new Set([...lobby!.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]));
  expect(inLobby).toContain('/game/:gameId');
  const routes = [...app.matchAll(/<Route\s+path="([^"]+)"\s+element={<(\w+)/g)];
  expect(routes.length).toBeGreaterThan(5);
  return routes.flatMap(([, route, element]) =>
    [...new Set([route.replace(/:\w+\??/g, 'ABC123'), route.replace(/\/:\w+\?/g, '')])].map(
      (address) => ({ route, address, element, lobby: inLobby.has(route) }),
    ),
  );
};
const preloadsOf = (address: string) => {
  const row = PRELOADS.find(([path]) => path.test(address));
  return row && [...row[1], ...row[2]];
};

test('the built page preloads what each page the app draws the scene on needs, from App.tsx', () => {
  for (const { address, element, lobby } of appRoutes()) {
    const modules = preloadsOf(address);
    // The start page loads the scene itself; any other address is no page's
    if (address === '/' || address === '*')
      expect([address, modules]).toEqual([address, undefined]);
    // The lobby's pages: the game's page, the lobby's canvas and the game's
    // board (and a game against the computer's own page); the tutorial's,
    // its page and board
    else if (lobby)
      expect([address, modules]).toEqual([
        address,
        expect.arrayContaining(['GameScreen.tsx', 'lobby/LobbyCanvas.tsx', 'GameCanvas.tsx']),
      ]);
    else
      expect([address, modules]).toEqual([
        address,
        ['learn/LearnScreen.tsx', 'learn/LearnCanvas.tsx'],
      ]);
    // A page from a chunk of its own has it preloaded
    if (element === 'ComputerGameRoute') expect(modules).toContain('ComputerGameScreen.tsx');
  }
  expect(preloadsOf('/nope')).toBeUndefined();
});

test('the preload script links, on each page, what its chunks need beyond the entry', () => {
  const chunk = (fileName: string, ids: string[], imports: string[] = [], isEntry = false) => ({
    fileName,
    moduleIds: ids.map((id) => `/app/src/screens/${id}`),
    imports,
    isEntry,
  });
  const chunks = [
    chunk('index.js', ['../main.tsx'], ['shared.js'], true),
    chunk('shared.js', ['../lib/focus.ts']),
    chunk('game.js', ['GameScreen.tsx'], ['shared.js', 'history.js']),
    chunk('history.js', ['../game/history.ts']),
    chunk('computer.js', ['ComputerGameScreen.tsx'], ['game.js']),
    chunk('lobby.js', ['lobby/LobbyCanvas.tsx'], ['three.js']),
    chunk('board.js', ['GameCanvas.tsx'], ['three.js', 'history.js']),
    chunk('learn.js', ['learn/LearnScreen.tsx'], ['shared.js']),
    chunk('learnBoard.js', ['learn/LearnCanvas.tsx'], ['three.js']),
    chunk('three.js', ['../../node_modules/three/build/three.module.js'], ['vendor.js']),
    // Two levels down: fetched with the rest, not once three.js has run
    chunk('vendor.js', ['../../node_modules/three/src/math/MathUtils.js']),
  ];
  const script = preloadScript(chunks);
  /** The files linked at `pathname`, a low priority one marked so. */
  const linked = (pathname: string) => {
    const links: { rel: string; href: string; fetchPriority?: string }[] = [];
    const document = {
      createElement: () => ({}),
      head: { appendChild: (l: (typeof links)[number]) => links.push(l) },
    };
    new Function('location', 'document', script)({ pathname }, document);
    expect(links.every((l) => l.rel === 'modulepreload')).toBe(true);
    return links.map((l) => (l.fetchPriority === 'low' ? `${l.href} (low)` : l.href));
  };
  const lobby = ['/lobby.js (low)', '/three.js (low)', '/vendor.js (low)', '/board.js (low)'];
  const game = ['/game.js', '/history.js', ...lobby];
  expect(linked('/game/ABC123')).toEqual(game);
  expect(linked('/new')).toEqual(game);
  const computer = ['/computer.js', '/game.js', '/history.js', ...lobby];
  expect(linked('/computer')).toEqual(computer);
  expect(linked('/computer/abc123')).toEqual(computer);
  const learn = ['/learn.js', '/learnBoard.js (low)', '/three.js (low)', '/vendor.js (low)'];
  expect(linked('/learn')).toEqual(learn);
  expect(linked('/learn/rook')).toEqual(learn);
  expect(linked('/')).toEqual([]);
  expect(linked('/nope')).toEqual([]);
  // A page whose chunk the build does not have fails the build
  expect(() => preloadScript(chunks.filter((c) => c.fileName !== 'learn.js'))).toThrow(
    /no chunk holds learn\/LearnScreen.tsx/,
  );
});

test("each page's preload script runs right ahead of the stylesheet, after the start page's own scripts", async () => {
  const { handler } = preloadRouteChunks().transformIndexHtml as {
    handler: (html: string, ctx: unknown) => string;
  };
  const chunk = (fileName: string, file: string, isEntry = false) => ({
    type: 'chunk',
    fileName,
    moduleIds: [`/app/src/screens/${file}`],
    imports: [],
    isEntry,
  });
  const bundle = Object.fromEntries(
    [
      chunk('index.js', '../main.tsx', true),
      chunk('game.js', 'GameScreen.tsx'),
      chunk('computer.js', 'ComputerGameScreen.tsx'),
      chunk('lobby.js', 'lobby/LobbyCanvas.tsx'),
      chunk('board.js', 'GameCanvas.tsx'),
      chunk('learn.js', 'learn/LearnScreen.tsx'),
      chunk('learnBoard.js', 'learn/LearnCanvas.tsx'),
    ].map((c) => [c.fileName, c]),
  );
  const stylesheet = '<link rel="stylesheet" crossorigin href="/assets/index.css">';
  const html = [
    '<meta name="viewport" content="width=device-width">',
    '<script>picture()</script>',
    '<script type="module" crossorigin src="/assets/index.js"></script>',
    stylesheet,
  ].join('\n');
  const built = handler(html, { bundle });
  const script = built.indexOf("l.rel='modulepreload'");
  expect(script).toBeGreaterThan(built.indexOf('picture()'));
  // Nothing between it and the stylesheet, which it must precede
  expect(built.slice(built.indexOf('</script>', script) + '</script>'.length).trimStart()).toMatch(
    /^<link rel="stylesheet"/,
  );
  expect(() => handler(html.replace(stylesheet, ''), { bundle })).toThrow(/no stylesheet link/);
});

// The built page's first request goes out from its head (src/lib/earlySocket.ts):
// e2e runs the dev server, which skips the plugin, and the app quietly opens
// its own socket when the inline script fails, so run the built script here
test("the built page's early socket asks for its game from the head, and nothing where there is none", async () => {
  const plugin = earlySocket();
  (plugin.configResolved as (c: unknown) => void)({ env: {} });
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const built = await (plugin.transformIndexHtml as (h: string) => Promise<string>)(html);
  const charset = built.search(/<meta charset[^>]*>/i);
  const start = built.indexOf('<script>', charset) + '<script>'.length;
  const end = built.indexOf('</script>', start);
  // Right after the charset, which must stand in the first 1024 bytes
  expect(built.slice(charset, start)).toMatch(/^<meta charset[^>]*>\s*<script>$/);
  expect(charset).toBeLessThan(1024);
  const script = built.slice(start, end);
  const run = (pathname: string, local: Record<string, string> = {}) => {
    const sockets: { url: string; sent: unknown[]; onopen?: () => void }[] = [];
    class FakeSocket {
      url: string;
      sent: unknown[] = [];
      onopen?: () => void;
      constructor(url: string) {
        this.url = url;
        sockets.push(this);
      }
      send(message: string) {
        this.sent.push(JSON.parse(message));
      }
    }
    const storage = (items: Record<string, string>) => ({
      getItem: (key: string) => items[key] ?? null,
      setItem: (key: string, value: string) => void (items[key] = value),
    });
    new Function(
      'location',
      'WebSocket',
      'localStorage',
      'sessionStorage',
      'window',
      'crypto',
      script,
    )({ pathname }, FakeSocket, storage(local), storage({}), {}, { randomUUID: () => 'a-client' });
    sockets[0]?.onopen?.();
    return sockets.map((s) => ({ url: s.url, sent: s.sent }));
  };
  const socket = (sent: unknown[]) => [{ url: DEFAULT_WS_URL, sent }];
  expect(run('/game/ABC123', { [`${ROLE_KEY_PREFIX}ABC123`]: 'black' })).toEqual(
    socket([
      {
        type: 'rejoin_game',
        gameId: 'ABC123',
        color: 'black',
        clientId: 'a-client',
        takeover: true,
      },
    ]),
  );
  expect(run('/game/ABC123')).toEqual(socket([{ type: 'look_game', gameId: 'ABC123' }]));
  // Opened to have it ready, nothing asked: the start page, the side choice,
  // and an address that is no game's
  expect(run('/')).toEqual(socket([]));
  expect(run('/new')).toEqual(socket([]));
  expect(run('/game/abc123')).toEqual(socket([]));
  // Never on the pages that do without the server
  expect(run('/computer/abc123')).toEqual([]);
  expect(run('/learn')).toEqual([]);
});
