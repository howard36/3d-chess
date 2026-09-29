import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { openStandInGame } from './helpers/standIn';

// The real camera turned all the way round the tower, a few degrees at a
// time, at three elevations, and climbed from under the horizon to overhead
// and back at a few azimuths, from both seats: the view never slides (the
// tower's centre stays at one point on the canvas, in the middle across,
// however the camera turns or climbs), and the level letters never jump
// except in a change of post, which crossfades all five together. Measured
// from the page itself (window.__r3fState): the camera the app fitted, its
// lens shift, and the label sprites SmartLabels drew. The pages run on a
// virtual clock, as scripts/showcase.mjs records, so every step is one frame
// of known length and a crossfade takes the same steps on any machine; the
// frames are not drawn, except for the pictures of the poses round each
// failure, which are attached to the report. The game is served by a
// stand-in for the server (helpers/standIn.ts), like hudFit.spec.ts.

const WIDTH = 1280;
const HEIGHT = 720;
// (set with the context: resizing a page later leaves the protocol's
// screenshots waiting on a frame the virtual clock never lets through)
test.use({ viewport: { width: WIDTH, height: HEIGHT } });
/** Degrees turned from one step to the next, and the elevations of each full turn. */
const STEP = 3;
const ELEVATIONS = [18, 55, 89.9];
/** A letter turning with the view moves about 15 px a step here; a jump, hundreds. */
const JUMP_PX = 60;
/** Changes of post in a turn at each elevation: from low down twice a quarter turn, from high up once. */
const SWITCHES: Record<number, number> = { 18: 8, 55: 4, 89.9: 4 };
/** Azimuths of the climbs, and their elevations: under the horizon (as low as the orbit goes) to overhead. */
const CLIMB_AZIMUTHS = [16, 110, 200];
const CLIMB = [...Array.from({ length: 52 }, (_, k) => -14 + 2 * k), 89.9];
/** Where the letters leave the side post climbing, and come back to it dipping (labelAnchors). */
const [LETTERS_HIGH, LETTERS_LOW] = [55, 45];

/** Installed before any page script: a clock that moves only when told to. */
const VIRTUAL_CLOCK = () => {
  const realNow = performance.now.bind(performance);
  let now: number | null = null;
  const queue = new Map<number, FrameRequestCallback>();
  let next = 1;
  const w = window as Window & {
    __vclock?: { enable(): void; disable(): void; step(ms: number): void };
  };
  const realRaf = window.requestAnimationFrame.bind(window);
  w.__vclock = {
    enable() {
      if (now === null) now = realNow();
    },
    /** Back to the browser's own clock, the frames asked for so far with it. */
    disable() {
      now = null;
      const due = [...queue.values()];
      queue.clear();
      for (const cb of due) realRaf(cb);
    },
    step(ms) {
      now = (now ?? realNow()) + ms;
      const due = [...queue.values()];
      queue.clear();
      for (const cb of due) cb(now);
    },
  };
  performance.now = () => (now === null ? realNow() : now);
  window.requestAnimationFrame = (cb) => {
    if (now === null) return realRaf(cb);
    const id = next++;
    queue.set(id, cb);
    return id;
  };
};

/** The page seated as `seat` in a game at its opening position, served by a stand-in. */
async function seated(page: Page, seat: 'white' | 'black') {
  await page.addInitScript(VIRTUAL_CLOCK);
  await openStandInGame(page, seat, 'ORBIT');
  // The board is up once all 125 cells are in the scene
  await page.waitForFunction(() => {
    const state = (window as Window & { __r3fState?: { get(): { scene: SceneLike } } }).__r3fState;
    let cells = 0;
    state?.get().scene.traverse((o) => {
      if (o.userData?.cube) cells++;
    });
    return cells === 125;
  });
  await page.evaluate(() => document.fonts.ready);
  // Let the fonts reach the label textures, then take over the clock
  await page.waitForTimeout(500);
  await page.evaluate(() =>
    (window as Window & { __vclock?: { enable(): void } }).__vclock?.enable(),
  );
}

interface SceneLike {
  traverse(cb: (o: { userData?: Record<string, unknown> }) => void): void;
}

interface Pose {
  azimuth: number;
  elevation: number;
  /** The camera's elevation as the orbit's limits left it, degrees. */
  actual: number;
  /** The orbit target (the tower's centre) on the canvas, px. */
  centre: [number, number];
  /** The level letters' corner post (labelAnchors' state). */
  corner: number;
  /** Each letter's two sprites (SmartLabels crossfades between them): where and how opaque. */
  letters: Record<string, { at: [number, number]; opacity: number }[]>;
}

/**
 * Turns the camera to `azimuth`/`elevation` (degrees) as the player's drag
 * does (OrbitControls moves it and says so, and the app re-fits the lens),
 * runs one 33 ms frame without drawing it (the renderer is the slow part),
 * and measures.
 */
const pose = (page: Page, azimuth: number, elevation: number): Promise<Pose> =>
  page.evaluate(
    ({ azimuth, elevation }) => {
      type V = { x: number; y: number; z: number; clone(): V; project(c: unknown): V };
      type Obj = {
        userData: Record<string, unknown>;
        visible: boolean;
        material: { opacity: number };
        children: Obj[];
        getWorldPosition(v: V): V;
      };
      const w = window as unknown as {
        __r3fState: {
          get(): {
            camera: {
              position: V & {
                set(x: number, y: number, z: number): void;
                constructor: new () => V;
              };
              lookAt(x: number, y: number, z: number): void;
            };
            controls: { target: V; update(): void };
            scene: { getObjectByName(n: string): Obj | undefined };
            gl: { render: (...a: unknown[]) => void };
            invalidate(): void;
          };
        };
        __vclock: { step(ms: number): void };
      };
      const st = w.__r3fState.get();
      const { camera, controls } = st;
      const r = Math.hypot(camera.position.x, camera.position.y, camera.position.z);
      const [a, e] = [(azimuth * Math.PI) / 180, (elevation * Math.PI) / 180];
      camera.position.set(
        r * Math.cos(e) * Math.sin(a),
        r * Math.sin(e),
        r * Math.cos(e) * Math.cos(a),
      );
      camera.lookAt(0, 0, 0);
      controls.update();
      const render = st.gl.render;
      st.gl.render = () => {};
      try {
        st.invalidate();
        w.__vclock.step(1000 / 30);
      } finally {
        st.gl.render = render;
      }
      const canvas = document.querySelector('canvas')!.getBoundingClientRect();
      const px = (v: V): [number, number] => {
        const p = v.clone().project(camera);
        return [(p.x + 1) * 0.5 * canvas.width, (1 - p.y) * 0.5 * canvas.height];
      };
      const V = camera.position.constructor;
      const group = st.scene.getObjectByName('smart-labels')!;
      const letters: Pose['letters'] = {};
      for (const s of group.children) {
        const id = s.userData.labelId as string;
        if (!id?.startsWith('level-')) continue;
        (letters[id] ??= []).push({
          at: px(s.getWorldPosition(new V())),
          opacity: s.visible ? s.material.opacity : 0,
        });
      }
      const anchors = group.userData.anchors as { corner: number };
      const p = camera.position;
      const actual = (Math.asin(p.y / Math.hypot(p.x, p.y, p.z)) * 180) / Math.PI;
      return { azimuth, elevation, actual, centre: px(new V()), corner: anchors.corner, letters };
    },
    { azimuth, elevation },
  );

/** Where a letter shows: the sprite more opaque (mid-crossfade, the one fading in or out). */
const shown = (sprites: Pose['letters'][string]) =>
  sprites.reduce((a, b) => (b.opacity > a.opacity ? b : a));
const crossfading = (p: Pose) =>
  Object.values(p.letters).some((s) => s.filter((x) => x.opacity > 0.02).length > 1);
/** Every one of the five letters crossfading, as when they all change post at once. */
const allCrossfading = (p: Pose) =>
  Object.keys(p.letters).length === 5 &&
  Object.values(p.letters).every((s) => s.filter((x) => x.opacity > 0.02).length === 2);

/**
 * The problems between one pose and the next: the letters change post only
 * all five together, crossfading, and otherwise each moves with the view.
 */
const stepProblems = (p: Pose, q: Pose): string[] => {
  if (p.corner !== q.corner) {
    return allCrossfading(p) ? [] : ['the letters changed post, not all five crossfading'];
  }
  if (crossfading(p) || crossfading(q)) return [];
  const out: string[] = [];
  for (const [id, sprites] of Object.entries(p.letters)) {
    const [a, b] = [shown(sprites).at, shown(q.letters[id]).at];
    const moved = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (moved > JUMP_PX) out.push(`${id} jumped ${moved.toFixed(0)} px`);
  }
  return out;
};

/** How far (px) the letters stray from one straight line A to E; 0 mid-crossfade. */
const offLine = (p: Pose) => {
  if (crossfading(p)) return 0;
  const pts = ['A', 'B', 'C', 'D', 'E'].map((l) => shown(p.letters[`level-${l}`]).at);
  const [a, e] = [pts[0], pts[4]];
  const l = Math.hypot(e[0] - a[0], e[1] - a[1]);
  return Math.max(
    ...pts.map((q) =>
      Math.abs(((e[0] - a[0]) * (q[1] - a[1]) - (e[1] - a[1]) * (q[0] - a[0])) / l),
    ),
  );
};

/**
 * Pictures of the poses around each failure, attached to the report, drawn
 * on the browser's own clock (screenshots stall behind a long run of frames
 * the virtual clock kept from the screen).
 */
async function attachFailures(page: Page, info: TestInfo, poses: Pose[], bad: number[]) {
  await page.evaluate(() =>
    (window as Window & { __vclock?: { disable(): void } }).__vclock?.disable(),
  );
  for (const i of [...new Set(bad)].slice(0, 4)) {
    for (const k of [i - 1, i]) {
      const p = poses[Math.max(k, 0)];
      await page.evaluate(
        ({ azimuth, elevation }) => {
          const st = (
            window as unknown as {
              __r3fState: {
                get(): {
                  camera: {
                    position: { length(): number; set(x: number, y: number, z: number): void };
                    lookAt(x: number, y: number, z: number): void;
                  };
                  controls: { update(): void };
                  invalidate(): void;
                };
              };
            }
          ).__r3fState.get();
          const r = st.camera.position.length();
          const [a, e] = [(azimuth * Math.PI) / 180, (elevation * Math.PI) / 180];
          st.camera.position.set(
            r * Math.cos(e) * Math.sin(a),
            r * Math.sin(e),
            r * Math.cos(e) * Math.cos(a),
          );
          st.camera.lookAt(0, 0, 0);
          st.controls.update();
          st.invalidate();
        },
        { azimuth: p.azimuth, elevation: p.elevation },
      );
      // A frame or two in software
      await page.waitForTimeout(600);
      await info.attach(`az${p.azimuth}-el${p.elevation}.png`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    }
  }
  await info.attach('poses.json', {
    body: JSON.stringify(poses),
    contentType: 'application/json',
  });
}

/**
 * The poses measured in one test, and the problems found in them: `flag`
 * records one against pose `i`, `centre` checks that the tower's axis stayed
 * where the pose `start` had it, and `finish` attaches the pictures round
 * each failure and fails the test with the first few.
 */
function tracker(page: Page, info: TestInfo) {
  const poses: Pose[] = [];
  const bad: number[] = [];
  const problems: string[] = [];
  const flag = (i: number, what: string) => {
    bad.push(i);
    problems.push(`az ${poses[i].azimuth} el ${poses[i].elevation}: ${what}`);
  };
  return {
    poses,
    flag,
    /** The tower's axis in the middle of the canvas across, at the height of pose `start`. */
    centre(i: number, start: number) {
      const p = poses[i];
      if (Math.abs(p.centre[0] - WIDTH / 2) > 0.5) {
        flag(i, `the centre is ${(p.centre[0] - WIDTH / 2).toFixed(1)} px off the middle`);
      }
      if (Math.abs(p.centre[1] - poses[start].centre[1]) > 0.5) {
        flag(i, `the centre moved ${(p.centre[1] - poses[start].centre[1]).toFixed(1)} px down`);
      }
    },
    finish: async () => {
      if (problems.length) await attachFailures(page, info, poses, bad);
      expect(problems.slice(0, 20)).toEqual([]);
    },
  };
}

for (const seat of ['white', 'black'] as const) {
  test(`turning the view never slides it or makes the level letters jump, seated as ${seat}`, async ({
    page,
  }, info) => {
    await seated(page, seat);
    const { poses, flag, centre, finish } = tracker(page, info);
    for (const elevation of ELEVATIONS) {
      // Up to the elevation, and a few frames for any crossfade to finish
      for (let k = 0; k < 12; k++) await pose(page, 0, elevation);
      const start = poses.length;
      for (let azimuth = 0; azimuth <= 360; azimuth += STEP) {
        const i = poses.push(await pose(page, azimuth, elevation)) - 1;
        centre(i, start);
        if (i === start) continue;
        for (const what of stepProblems(poses[i], poses[i - 1])) flag(i, what);
      }
      // One straight line of letters, in order A to E, at every pose
      for (let i = start; i < poses.length; i++) {
        const off = offLine(poses[i]);
        if (off > 2) flag(i, `the letters are ${off.toFixed(1)} px off one line`);
      }
      // Each change of post the band past a tie, no more often
      const turn = poses.slice(start);
      const switches = turn.filter((p, k) => k > 0 && p.corner !== turn[k - 1].corner).length;
      if (switches > SWITCHES[elevation]) {
        flag(poses.length - 1, `${switches} changes of post in a turn`);
      }
    }
    await finish();
  });

  test(`climbing to overhead moves the level letters to the far post in one crossfade, seated as ${seat}`, async ({
    page,
  }, info) => {
    await seated(page, seat);
    const { poses, flag, centre, finish } = tracker(page, info);
    for (const azimuth of CLIMB_AZIMUTHS) {
      // To the bottom of the climb, and a few frames for any crossfade to finish
      for (let k = 0; k < 12; k++) await pose(page, azimuth, CLIMB[0]);
      for (const [way, elevations] of [
        ['up', CLIMB],
        ['down', [...CLIMB].reverse()],
      ] as const) {
        const start = poses.length;
        for (const elevation of elevations) {
          const i = poses.push(await pose(page, azimuth, elevation)) - 1;
          // Climbing only turns the camera about the tower's centre, which stays put
          centre(i, start);
          const off = offLine(poses[i]);
          if (off > 2) flag(i, `the letters are ${off.toFixed(1)} px off one line`);
          if (i > start) for (const what of stepProblems(poses[i], poses[i - 1])) flag(i, what);
        }
        // One change of post each way: climbing just past LETTERS_HIGH,
        // dipping just under LETTERS_LOW
        const climb = poses.slice(start);
        const at = climb.filter((p, k) => k > 0 && p.corner !== climb[k - 1].corner);
        const [lo, hi] =
          way === 'up' ? [LETTERS_HIGH, LETTERS_HIGH + 2] : [LETTERS_LOW - 2, LETTERS_LOW];
        if (at.length !== 1 || at[0].actual < lo || at[0].actual > hi) {
          flag(
            poses.length - 1,
            `going ${way}, the letters changed post at ${at.map((p) => p.actual.toFixed(1)).join(', ') || 'no elevation'}`,
          );
        }
      }
    }
    await finish();
  });
}

test('only a piece in front hides a label: the platforms write no depth and are drawn before them', async ({
  page,
}) => {
  await seated(page, 'white');
  const found = await page.evaluate(() => {
    type Mat = { depthWrite: boolean; depthTest: boolean };
    type Obj = {
      name: string;
      renderOrder: number;
      material?: Mat | Mat[];
      userData: Record<string, unknown>;
      traverse(cb: (o: Obj) => void): void;
    };
    const st = (
      window as unknown as {
        __r3fState: { get(): { scene: { getObjectByName(n: string): Obj | undefined } } };
      }
    ).__r3fState.get();
    const mats = (o: Obj) => (o.material ? [o.material].flat() : []);
    const levels: { writes: boolean; order: number }[] = [];
    st.scene.getObjectByName('levels')!.traverse((o) => {
      for (const m of mats(o)) levels.push({ writes: m.depthWrite, order: o.renderOrder });
    });
    const labels: { tests: boolean; writes: boolean; order: number }[] = [];
    st.scene.getObjectByName('smart-labels')!.traverse((o) => {
      if (!o.userData.labelId) return;
      for (const m of mats(o)) {
        labels.push({ tests: m.depthTest, writes: m.depthWrite, order: o.renderOrder });
      }
    });
    return { levels, labels };
  });
  // Glass, borders and rims: seen through, never a wall
  expect(found.levels.length).toBeGreaterThanOrEqual(10);
  expect(found.levels.filter((l) => l.writes)).toEqual([]);
  // Every label: hidden by what writes depth in front of it (a piece), drawn
  // after every platform so none tints it
  expect(found.labels.length).toBeGreaterThanOrEqual(30);
  const last = Math.max(...found.levels.map((l) => l.order));
  for (const l of found.labels)
    expect(l).toEqual({ tests: true, writes: false, order: expect.any(Number) });
  expect(Math.min(...found.labels.map((l) => l.order))).toBeGreaterThan(last);
});
