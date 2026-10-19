import { test, expect } from '@playwright/test';
import type { Browser, CDPSession, Page } from '@playwright/test';
import { waitForBoard } from './helpers/board';

// A finger's taps on a phone (src/three/tapIntent.ts): real touch input sent
// through the DevTools protocol to a 390 x 844 page, seated as White against
// a stand-in for the server that plays every move it is sent straight back.
// The last test throws thousands of simulated taps at the board, aimed at
// each thing the player can act on and scattered as a careful finger's are,
// and checks how often each does what it was meant to, through the app's own
// code: its ray's real hit, then the decision and the magnifier.

/** A middlegame (10 plies) in which White's queen on Cc4 has 36 moves and the knight on Cb2 14. */
const MIDGAME = [
  'Ac2-Cc4',
  'Ec4-Cc2',
  'Aa2-Ac4',
  'Ee4-Ce2',
  'Ab1-Cb2',
  'Eb5-Cb4',
  'Ad1-Cd2',
  'Ed5-Cc5',
  'Aa1-Aa3',
  'Ea4-Db3',
];

type Finger = [x: number, y: number];

/**
 * A phone seated as White at `moves`, its moves played back as they are sent.
 * `safari`: its clicks say a mouse made them, as Safari's say of a finger's
 * tap since 18.2 (WebKit bug 282988).
 */
async function phoneGame(browser: Browser, gameId: string, moves: string[], safari = false) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const sent: string[] = [];
  const records = moves.map((m, i) => {
    const [from, to] = m.split('-');
    return { by: i % 2 === 0 ? 'white' : 'black', from, to };
  });
  await page.routeWebSocket(/\/ws$/, (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === 'rejoin_game') {
        ws.send(
          JSON.stringify({ type: 'game_state', color: 'white', started: true, moves: records }),
        );
        ws.send(JSON.stringify({ type: 'presence', color: 'black', online: true }));
      } else if (message.type === 'move') {
        sent.push(`${message.from}-${message.to}`);
        const { from, to } = message;
        ws.send(JSON.stringify({ type: 'move_made', by: 'white', from, to }));
      }
    });
  });
  await page.addInitScript((id) => localStorage.setItem(`3dchess:role:${id}`, 'white'), gameId);
  if (safari) {
    await page.addInitScript(() => {
      const own = Object.getOwnPropertyDescriptor(PointerEvent.prototype, 'pointerType')!;
      Object.defineProperty(PointerEvent.prototype, 'pointerType', {
        get() {
          return this.type === 'click' ? 'mouse' : own.get!.call(this);
        },
      });
    });
  }
  await page.goto(`/game/${gameId}`);
  await waitForBoard(page);
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp, sent };
}

const touch = (cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', at?: Finger) =>
  cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: at ? [{ x: at[0], y: at[1], id: 1 }] : [],
  });
/** A finger's tap at `at`, rolling `drift` px to the right before it lifts. */
const tap = async (cdp: CDPSession, at: Finger, drift = 0) => {
  await touch(cdp, 'touchStart', at);
  if (drift) await touch(cdp, 'touchMove', [at[0] + drift, at[1]]);
  await touch(cdp, 'touchEnd');
};

interface Scene {
  /** White's pieces: the middle of each body on screen. */
  pieces: Record<string, Finger>;
  /** The held piece's destinations: the middle of each mark on screen. */
  marks: Record<string, Finger>;
}

/** Where White's pieces and the held piece's marks are on screen (CSS px of the page). */
const sceneOf = (page: Page): Promise<Scene> =>
  page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { camera, size, scene } = (window as any).__r3fState.get();
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    const V = camera.position.constructor;
    const rect = (window as any).__r3fState.get().gl.domElement.getBoundingClientRect();
    const px = (w: any): [number, number] => {
      const p = w.clone().project(camera);
      return [rect.left + ((p.x + 1) / 2) * size.width, rect.top + ((1 - p.y) / 2) * size.height];
    };
    const cubes: any[] = [];
    const pieces: Record<string, [number, number]> = {};
    const marks: Record<string, [number, number]> = {};
    scene.traverse((o: any) => {
      if (o.userData.cube) cubes.push(o);
    });
    scene.traverse((o: any) => {
      if (!o.userData.piece || o.userData.piece.color !== 'white') return;
      const proxy = o.children.find((c: any) => c.userData.hitProxy);
      if (!proxy) return;
      const at = o.getWorldPosition(new V());
      const cube = cubes.find((c) => c.getWorldPosition(new V()).distanceTo(at) < 1e-3);
      proxy.geometry.computeBoundingBox();
      const top = proxy.geometry.boundingBox.max.y - 0.14;
      pieces[cube.userData.zxy] = px(new V(0, top * 0.45, 0).applyMatrix4(proxy.matrixWorld));
    });
    for (const c of cubes) {
      if (!c.userData.highlight) continue;
      const pos = c.geometry.getAttribute('position');
      const sum = new V();
      for (let i = 0; i < pos.count; i++) sum.add(new V().fromBufferAttribute(pos, i));
      marks[c.userData.zxy] = px(sum.divideScalar(pos.count).applyMatrix4(c.matrixWorld));
    }
    return { pieces, marks };
  });

const magnifier = (page: Page) => page.getByTestId('magnifier');

/** Picks up the piece on `cell` with a finger and waits for its marks. */
async function pickUp(page: Page, cdp: CDPSession, cell: string): Promise<Scene> {
  await tap(cdp, (await sceneOf(page)).pieces[cell]);
  await expect.poll(async () => Object.keys((await sceneOf(page)).marks).length).toBeGreaterThan(0);
  return sceneOf(page);
}

/**
 * A spot on screen (CSS px of the page) between two close marks of the piece
 * held on `held` where the board's own decision asks which move was meant:
 * the midpoint of the closest pair that asks there.
 */
const askingSpot = (page: Page, held: string): Promise<Finger> =>
  page.evaluate(async (held) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const from = (path: string) => import(/* @vite-ignore */ path);
    const intent = await from('/src/three/tapIntent.ts');
    const touchIntent = await from('/src/three/useTouchIntent.ts');
    const { camera, scene, gl } = (window as any).__r3fState.get();
    const rect = gl.domElement.getBoundingClientRect();
    scene.updateMatrixWorld(true);
    const V = camera.position.constructor;
    const grid = scene.getObjectByName('board-grid');
    const cubes: any[] = [];
    grid.traverse((o: any) => o.userData.cube && cubes.push(o));
    const cellOf = (o: any) =>
      cubes.find((c) => c.getWorldPosition(new V()).distanceTo(o.getWorldPosition(new V())) < 1e-3)
        ?.userData.zxy as string | undefined;
    const groups: any[] = [];
    grid.traverse((o: any) => o.userData.piece && groups.push(o));
    const destinations = new Set<string>(
      cubes.filter((c) => c.userData.highlight).map((c) => c.userData.zxy),
    );
    const own = groups.filter((g) => g.userData.piece.color === 'white').map(cellOf);
    const actionable = { pieces: new Set(own), destinations, held };
    const [w, h] = [rect.width, rect.height];
    const targets = touchIntent.measureTapTargets(grid, camera, w, h, actionable, cellOf);
    const moves = targets.filter((t: any) => t.kind === 'destination');
    const pairs = moves.flatMap((a: any, i: number) => moves.slice(i + 1).map((b: any) => [a, b]));
    const apart = ([a, b]: any) => Math.hypot(a.centre[0] - b.centre[0], a.centre[1] - b.centre[1]);
    pairs.sort((p: any, q: any) => apart(p) - apart(q));
    for (const [a, b] of pairs) {
      const at = [(a.centre[0] + b.centre[0]) / 2, (a.centre[1] + b.centre[1]) / 2];
      const direct = touchIntent.directHit(grid, camera, at, w, h, destinations, cellOf);
      const hit = direct && targets.some((t: any) => t.id === direct.cell) ? direct.cell : null;
      const decision = intent.decideTap(at, targets, { holding: true, direct: hit });
      if (decision.act === 'ask') return [rect.left + at[0], rect.top + at[1]] as [number, number];
    }
    throw new Error('no spot asks');
  }, held);

test('a tap between two close moves asks which, and a tap in the magnifier plays it', async ({
  browser,
}, testInfo) => {
  const { context, page, cdp, sent } = await phoneGame(browser, 'TAPASK', MIDGAME);
  // The magnifier links no shader program: it draws with the view's own
  await page.locator('canvas[data-warm="done"]').waitFor({ state: 'attached', timeout: 120_000 });
  await page.evaluate(() => {
    const w = window as unknown as {
      __r3fState: { get: () => { gl: { getContext: () => WebGL2RenderingContext } } };
      __links: number;
    };
    const ctx = w.__r3fState.get().gl.getContext();
    const link = ctx.linkProgram.bind(ctx);
    w.__links = 0;
    ctx.linkProgram = (program: WebGLProgram) => {
      w.__links++;
      link(program);
    };
  });

  const { marks } = await pickUp(page, cdp, 'Cc4');
  const cells = Object.keys(marks);
  // A spot between two close moves, where the board's own decision asks
  // (once the queen has finished rising)
  let between = await askingSpot(page, 'Cc4');
  await expect
    .poll(async () => {
      const was = between;
      between = await askingSpot(page, 'Cc4');
      return Math.hypot(between[0] - was[0], between[1] - was[1]);
    })
    .toBe(0);
  await tap(cdp, between);
  await expect(magnifier(page)).toHaveAttribute('data-mode', 'ask');
  const candidates = (await magnifier(page).getAttribute('data-candidates'))!.split(' ');
  expect(candidates.length).toBeGreaterThanOrEqual(2);
  expect(sent).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('magnifier-ask.png') });

  // Outside it: it closes, the queen still held
  await tap(cdp, [20, 820]);
  await expect(magnifier(page)).toBeHidden();
  expect(Object.keys((await sceneOf(page)).marks).length).toBe(cells.length);

  // Asked again, a tap on a candidate in it plays that move
  await tap(cdp, between);
  await expect(magnifier(page)).toHaveAttribute('data-mode', 'ask');
  const chosen = (await magnifier(page).getAttribute('data-candidates'))!.split(' ')[1];
  const ring = (await magnifier(page).locator(`polygon[data-cell="${chosen}"]`).boundingBox())!;
  await tap(cdp, [ring.x + ring.width / 2, ring.y + ring.height / 2]);
  await expect(magnifier(page)).toBeHidden();
  await expect.poll(() => sent).toEqual([`Cc4-${chosen}`]);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { __links: number }).__links)).toBe(0);
  await context.close();
});

test("a finger's near miss picks up the piece it was meant for, in Safari too, rolling as it lifts", async ({
  browser,
}) => {
  const { context, page, cdp } = await phoneGame(browser, 'TAPSAFARI', MIDGAME, true);
  const { pieces } = await sceneOf(page);
  // Beside the knight, clear of its body, and rolling 8 px as it lifts
  const knight = pieces.Cb2;
  await tap(cdp, [knight[0] - 14, knight[1] + 6], 8);
  await expect.poll(async () => Object.keys((await sceneOf(page)).marks).length).toBe(14);
  await context.close();
});

test('a finger held still aims by hand, the view still, and lifting acts on what it aims at', async ({
  browser,
}, testInfo) => {
  const { context, page, cdp } = await phoneGame(browser, 'TAPAIM', MIDGAME);
  const camera = () =>
    page.evaluate(() => {
      const { camera } = (
        window as unknown as {
          __r3fState: { get: () => { camera: { position: { x: number; y: number; z: number } } } };
        }
      ).__r3fState.get();
      return [camera.position.x, camera.position.y, camera.position.z];
    });
  const { pieces } = await sceneOf(page);
  const knight = pieces.Cb2;
  const before = await camera();
  // Down beside the knight, held: the magnifier follows the finger
  await touch(cdp, 'touchStart', [knight[0] + 40, knight[1] + 30]);
  await expect(magnifier(page)).toHaveAttribute('data-mode', 'aim', { timeout: 3000 });
  // Slid onto the knight (the view does not turn), it marks the knight
  for (let k = 1; k <= 8; k++) {
    await touch(cdp, 'touchMove', [knight[0] + 40 - 5 * k, knight[1] + 30 - (30 / 8) * k]);
  }
  await expect(magnifier(page)).toHaveAttribute('data-aimed', 'Cb2');
  await page.screenshot({ path: testInfo.outputPath('magnifier-aim.png') });
  await touch(cdp, 'touchEnd');
  await expect(magnifier(page)).toBeHidden();
  // Lifted: the knight is picked up
  await expect.poll(async () => Object.keys((await sceneOf(page)).marks).length).toBe(14);
  expect(await camera()).toEqual(before);
  await context.close();
});

// --- The sweep -------------------------------------------------------------------

/** How a careful finger's taps scatter round where it aims (CSS px, each axis): about 1.7 mm. */
const SPREAD = 10;

interface Tally {
  taps: number;
  right: number;
  /** Right, once the magnifier asked. */
  asked: number;
  wrongMove: number;
  wrongPiece: number;
  nothing: number;
}

/**
 * Taps scattered round each target the player can act on (a piece's body, a
 * mark's middle), each through the board's real ray and then the app's own
 * decision and magnifier (as a careful finger picks in it), tallied by what
 * the player meant: a move (a piece held), or picking a piece up.
 */
const sweep = (page: Page, held: string | null, perTarget: number) =>
  page.evaluate(
    async ({ held, perTarget, spread }) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      // The app's own modules, from Vite (a path the type check leaves alone)
      const from = (path: string) => import(/* @vite-ignore */ path);
      const intent = await from('/src/three/tapIntent.ts');
      const touchIntent = await from('/src/three/useTouchIntent.ts');
      const { camera, scene } = (window as any).__r3fState.get();
      const canvas = (window as any).__r3fState.get().gl.domElement as HTMLCanvasElement;
      const { width, height } = canvas.getBoundingClientRect();
      scene.updateMatrixWorld(true);
      const V = camera.position.constructor;
      const grid = scene.getObjectByName('board-grid');
      const cubes: any[] = [];
      grid.traverse((o: any) => o.userData.cube && cubes.push(o));
      const cellOf = (o: any) =>
        cubes.find(
          (c) => c.getWorldPosition(new V()).distanceTo(o.getWorldPosition(new V())) < 1e-3,
        )?.userData.zxy as string | undefined;
      const groups: any[] = [];
      grid.traverse((o: any) => o.userData.piece && groups.push(o));
      const destinations = new Set<string>(
        cubes.filter((c) => c.userData.highlight).map((c) => c.userData.zxy),
      );
      const own = groups.filter((g) => g.userData.piece.color === 'white').map(cellOf);
      const actionable = { pieces: new Set(own), destinations, held };
      const targets = touchIntent.measureTapTargets(
        grid,
        camera,
        width,
        height,
        actionable,
        cellOf,
      );
      // What a tap's ray hits first, as the board hears it
      const directHit = (at: [number, number]) =>
        touchIntent.directHit(grid, camera, at, width, height, destinations, cellOf);
      let seed = 7;
      const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
      const normal = () =>
        Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
      const tally = { taps: 0, right: 0, asked: 0, wrongMove: 0, wrongPiece: 0, nothing: 0 };
      const kindOf = new Map(targets.map((t: any) => [t.id, t.kind]));
      const aimOf = (t: any): [number, number] => {
        if (t.kind === 'piece') {
          // A piece's body: the middle of its proxy without the headroom for a lift
          const g = groups.find((o) => cellOf(o) === t.id);
          const proxy = g.children.find((c: any) => c.userData.hitProxy);
          proxy.geometry.computeBoundingBox();
          const top = proxy.geometry.boundingBox.max.y - 0.14;
          const p = new V(0, top * 0.45, 0).applyMatrix4(proxy.matrixWorld).project(camera);
          return [((p.x + 1) / 2) * width, ((1 - p.y) / 2) * height];
        }
        return t.centre;
      };
      const meant = targets.filter((t: any) => (held ? t.kind === 'destination' : true));
      for (const t of meant) {
        const aim = aimOf(t);
        for (let i = 0; i < perTarget; i++) {
          const at: [number, number] = [aim[0] + normal() * spread, aim[1] + normal() * spread];
          const direct = directHit(at);
          const hit = direct && kindOf.has(direct.cell) ? direct.cell : null;
          const decision = intent.decideTap(at, targets, { holding: !!held, direct: hit, spread });
          let got: string | null = null;
          if (decision.act === 'take') got = decision.id;
          else if (decision.act === 'ask') {
            const candidates = decision.ids.map((id: string) =>
              targets.find((c: any) => c.id === id),
            );
            const lens = intent.askingLens(at, candidates, { width, height, top: 100 });
            const [lx, ly] = intent.toLens(t.centre, lens);
            const second: [number, number] = [lx + normal() * spread, ly + normal() * spread];
            // (A tap outside the lens closes it: the piece still held)
            got = intent.inRect(second, lens.frame)
              ? intent.pickInLens(intent.fromLens(second, lens), candidates, lens.zoom)
              : null;
            if (got === t.id) tally.asked++;
          }
          tally.taps++;
          if (got === t.id) {
            if (decision.act === 'take') tally.right++;
          } else if (got === null) tally.nothing++;
          else if (kindOf.get(got) === 'destination') tally.wrongMove++;
          else tally.wrongPiece++;
        }
      }
      return tally;
    },
    { held, perTarget, spread: SPREAD },
  );

const pct = (n: number, of: number) => `${((100 * n) / of).toFixed(1)}%`;

test("a finger's taps do what they were meant to: a sweep of the board", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const opening = await phoneGame(browser, 'TAPOPEN', []);
  const middle = await phoneGame(browser, 'TAPMID', MIDGAME);
  const rows: [string, Tally][] = [];
  rows.push(['opening, nothing held: pick up', await sweep(opening.page, null, 120)]);
  rows.push(['middlegame, nothing held: pick up', await sweep(middle.page, null, 120)]);
  await pickUp(opening.page, opening.cdp, 'Ab1');
  rows.push(['opening, knight held: move', await sweep(opening.page, 'Ab1', 120)]);
  await pickUp(middle.page, middle.cdp, 'Cc4');
  rows.push(['middlegame, queen held (36 moves): move', await sweep(middle.page, 'Cc4', 60)]);
  await tap(middle.cdp, (await sceneOf(middle.page)).pieces.Cc4);
  await pickUp(middle.page, middle.cdp, 'Cb2');
  rows.push(['middlegame, knight held (14 moves): move', await sweep(middle.page, 'Cb2', 120)]);

  const header =
    '| Meant | Taps | Right, one tap | Right, via magnifier | Wrong move | Wrong piece | Nothing |';
  const table = [header, '|---|---|---|---|---|---|---|']
    .concat(
      rows.map(
        ([name, t]) =>
          `| ${name} | ${t.taps} | ${pct(t.right, t.taps)} | ${pct(t.asked, t.taps)} | ${pct(t.wrongMove, t.taps)} | ${pct(t.wrongPiece, t.taps)} | ${pct(t.nothing, t.taps)} |`,
      ),
    )
    .join('\n');
  console.log(`\nTaps scattered ${SPREAD} px round their aim, phone 390 x 844:\n${table}\n`);
  await testInfo.attach('tap-sweep.md', { body: table, contentType: 'text/markdown' });

  for (const [name, t] of rows) {
    const moves = name.endsWith('move');
    // A wrong move is the mistake no tap undoes
    if (moves) expect(t.wrongMove / t.taps, `${name}: wrong moves`).toBeLessThan(0.06);
    // Every tap ends on what was meant at least this often, at once or through the magnifier
    expect((t.right + t.asked) / t.taps, `${name}: right`).toBeGreaterThan(moves ? 0.8 : 0.65);
  }
  await opening.context.close();
  await middle.context.close();
});
