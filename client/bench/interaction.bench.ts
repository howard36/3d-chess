// The board's per-frame and per-pointer math (client/src/three), timed the
// way the scene calls it: the hover probe on every pointer move, the tap
// assist on every finger tap, the label placement on every frame, the camera
// fit on every resize. The scene itself is not drawn (no WebGL in Node): the
// pieces are stand-in hit proxies of the size and shape PieceMesh builds.

import { bench, describe } from 'vitest';
import {
  BoxGeometry,
  Group,
  LatheGeometry,
  MathUtils,
  Mesh,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import type { Object3D } from 'three';
import { Board } from '../src/engine';
import type { Coord } from '../src/engine';
import { toZXY } from '../src/engine/coords';
import { fitView, hudTop } from '../src/three/cameraFit';
import { resolveHover } from '../src/three/hover';
import type { FloorSquare } from '../src/three/hover';
import { CELLS } from '../src/three/layout';
import { labelAnchors } from '../src/three/scene/labelAnchors';
import type { AnchorState } from '../src/three/scene/labelAnchors';
import { layout, PIECE_SCALE } from '../src/three/scene/palette';
import { resolveTap } from '../src/three/tapAssist';
import type { ScreenPoint, TapTarget } from '../src/three/tapAssist';
import type { Vec3 } from '../src/three/types';
import { SAMPLE, busiestPiece, queenStorm, seeded } from './fixtures';
import { emit } from './report';

export let sink: unknown;

const { normal } = SAMPLE;

const FOV = 36; // GameScreen's camera
const DEG = Math.PI / 180;

/** The camera as FitCameraToBoard opens it, for a window of `width` x `height`. */
const openingCamera = (width: number, height: number) => {
  const camera = new PerspectiveCamera(FOV, width / height, 0.1, 200);
  const dir = new Vector3(...layout.viewDirection).normalize();
  const { distance } = fitView(Math.asin(dir.y), layout.frameRings, {
    width,
    height,
    fov: FOV,
    topInset: hudTop(height),
  });
  camera.position.copy(dir.multiplyScalar(distance));
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
};

// --- A board scene of stand-in pieces -----------------------------------------

const floorOf = ([x, y, z]: Vec3): Vec3 => [x, y + layout.floorY, z];
/** A turned hit proxy like PieceMesh's: a 16-segment lathe of the piece's outline. */
const proxy = new LatheGeometry(
  [
    [0.3, 0],
    [0.3, 0.08],
    [0.22, 0.14],
    [0.14, 0.3],
    [0.12, 0.55],
    [0.2, 0.7],
    [0.16, 0.85],
    [0, 0.9],
  ].map(([r, y]) => new Vector2(r, y)),
  16,
);
const clickBox = new BoxGeometry(...layout.cellSize);

interface Scene {
  grid: Group;
  pieces: Map<string, Mesh>;
  boxes: Map<string, Mesh>;
}

const sceneOf = (board: Board): Scene => {
  const grid = new Group();
  const pieces = new Map<string, Mesh>();
  const boxes = new Map<string, Mesh>();
  for (const cell of CELLS) {
    const key = toZXY(cell);
    const at = layout.toWorld(cell, 'white');
    const box = new Mesh(clickBox);
    box.position.set(...at);
    box.userData = { cube: true, zxy: key };
    grid.add(box);
    boxes.set(key, box);
    if (!board.getPiece(cell)) continue;
    const group = new Group();
    group.position.set(...at);
    group.userData = { piece: true };
    const hit = new Mesh(proxy);
    hit.position.set(0, layout.floorY, 0);
    hit.scale.setScalar(PIECE_SCALE);
    hit.userData = { hitProxy: true };
    group.add(hit);
    grid.add(group);
    pieces.set(key, hit);
  }
  grid.updateMatrixWorld(true);
  return { grid, pieces, boxes };
};

const floors: FloorSquare[] = CELLS.map((cell) => ({
  key: toZXY(cell),
  floor: floorOf(layout.toWorld(cell, 'white')),
}));
const half: [number, number] = [layout.cellSize[0] / 2 + 0.011, layout.cellSize[2] / 2 + 0.011];

/** Board.tsx's hover probe: the nearest piece the ray hits, then resolveHover. */
const probe = (scene: Scene, raycaster: Raycaster, destinations: ReadonlySet<string>) => {
  const bodies: Object3D[] = scene.grid.children.filter((c) => c.userData.piece);
  let pieceHit: { key: string; distance: number } | null = null;
  const hits = raycaster.intersectObjects(bodies, true);
  if (hits.length > 0) pieceHit = { key: String(hits[0].object.id), distance: hits[0].distance };
  const { origin, direction } = raycaster.ray;
  return resolveHover(
    { origin: origin.toArray(), direction: direction.toArray() },
    floors,
    half,
    pieceHit,
    destinations,
  );
};

/** useTapAssist's outline of a mesh: its vertices projected to CSS px. */
const v = new Vector3();
const outlineOf = (mesh: Mesh, camera: PerspectiveCamera, width: number, height: number) => {
  const position = mesh.geometry.getAttribute('position');
  const out: ScreenPoint[] = [];
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).project(camera);
    if (v.z > 1) continue;
    out.push([((v.x + 1) / 2) * width, ((1 - v.y) / 2) * height]);
  }
  return out;
};

/** A tap the direct hit test missed: project every actionable target, pick the nearest. */
const assist = (
  scene: Scene,
  camera: PerspectiveCamera,
  size: [number, number],
  tap: ScreenPoint,
  pieces: string[],
  destinations: string[],
) => {
  const targets: TapTarget[] = [];
  for (const key of destinations) {
    targets.push({
      id: key,
      kind: 'destination',
      outline: outlineOf(scene.boxes.get(key)!, camera, ...size),
    });
  }
  for (const key of pieces) {
    targets.push({
      id: key,
      kind: 'piece',
      outline: outlineOf(scene.pieces.get(key)!, camera, ...size),
    });
  }
  return resolveTap(tap, targets, destinations.length > 0);
};

const HOVER = 'I1 · Hover: every pointer move over the board';
const TAP = 'I2 · Tap assist: a finger tap that missed';
const LABELS = 'I3 · Label placement: every frame the camera moves';
const FIT = 'I4 · Camera fit: every window resize';

const opening = Board.setupStartingPosition();
const storm = queenStorm();
const desktop: [number, number] = [1280, 800];
const phone: [number, number] = [390, 844];

emit('interaction', {
  intros: {
    [HOVER]:
      'On every pointer move, `three/Board.tsx` raycasts the pieces’ hit proxies and hands the ray ' +
      'to `resolveHover` (`three/hover.ts`) to find the cell under the pointer. Rays through a grid ' +
      'of points across a 1280×800 canvas from the opening camera; stand-in 16-segment proxies.',
    [TAP]:
      'On a touch screen, a tap that hits nothing actionable projects every actionable target’s ' +
      'outline to the screen and picks the nearest within 22 px (`useTapAssist.ts` + ' +
      '`tapAssist.ts`: a convex hull and a distance per target). Phone canvas 390×844.',
    [LABELS]:
      '`labelAnchors` (`three/scene/labelAnchors.ts`) runs in `useFrame` on every rendered frame ' +
      'to place the 15 file, rank and level labels with hysteresis. Each iteration is one frame of ' +
      'a camera path; the adversarial path jitters across the hysteresis bands every frame.',
    [FIT]:
      '`fitView` (`three/cameraFit.ts`) bisects the camera distance that fits the tower’s frame ' +
      'rings in the window, on opening and on every resize (a phone turned, a window dragged).',
  },
});

describe(HOVER, () => {
  const camera = openingCamera(...desktop);
  const raycaster = new Raycaster();
  const points: Vector2[] = [];
  for (let i = 0; i < 20; i++)
    for (let j = 0; j < 20; j++)
      points.push(new Vector2(-1 + (2 * i + 1) / 20, -1 + (2 * j + 1) / 20));
  const cases = [
    { label: 'opening, 40 pieces', scene: sceneOf(opening), destinations: new Set<string>() },
    {
      label: 'queen storm ⚠, a queen held (37 destinations)',
      scene: sceneOf(storm),
      destinations: new Set(
        storm.generateLegalMoves(busiestPiece(storm, 'white').at).map((m) => toZXY(m.to)),
      ),
    },
  ];
  for (const { label, scene, destinations } of cases) {
    let i = 0;
    bench(
      label,
      () => {
        raycaster.setFromCamera(points[i++ % points.length], camera);
        sink = probe(scene, raycaster, destinations);
      },
      normal,
    );
  }
  // A ray parallel to the platforms, and one from under the tower looking down the axis
  const flat = new Raycaster(new Vector3(-20, 0.3, 0), new Vector3(1, 0, 0));
  const below = new Raycaster(new Vector3(0.1, -30, 0.1), new Vector3(0, 1, 0));
  const scene = sceneOf(opening);
  bench(
    'ray parallel to the platforms ⚠',
    () => {
      sink = probe(scene, flat, new Set());
    },
    normal,
  );
  bench(
    'ray up the tower’s axis from below ⚠',
    () => {
      sink = probe(scene, below, new Set());
    },
    normal,
  );
});

describe(TAP, () => {
  const camera = openingCamera(...phone);
  const own = (board: Board) =>
    CELLS.filter((c) => board.getPiece(c)?.color === 'white').map((c: Coord) => toZXY(c));
  const rand = seeded(3);
  const taps: ScreenPoint[] = Array.from({ length: 64 }, () => [
    rand() * phone[0],
    rand() * phone[1],
  ]);
  const openingScene = sceneOf(opening);
  const stormScene = sceneOf(storm);
  const held = busiestPiece(storm, 'white');
  const stormDestinations = storm.generateLegalMoves(held.at).map((m) => toZXY(m.to));
  let i = 0;
  bench(
    'opening: 20 own pieces',
    () => {
      sink = assist(openingScene, camera, phone, taps[i++ % taps.length], own(opening), []);
    },
    normal,
  );
  bench(
    `queen storm ⚠: a queen held, 9 pieces + ${stormDestinations.length} destinations`,
    () => {
      sink = assist(
        stormScene,
        camera,
        phone,
        taps[i++ % taps.length],
        own(storm),
        stormDestinations,
      );
    },
    normal,
  );
  // Degenerate outlines straight into resolveTap: every point on one line, or all the same point
  const line: TapTarget[] = Array.from({ length: 125 }, (_, k) => ({
    id: String(k),
    kind: 'piece',
    outline: Array.from({ length: 200 }, (_, p): ScreenPoint => [k * 3 + p * 0.01, k * 7]),
  }));
  const dots: TapTarget[] = Array.from({ length: 125 }, (_, k) => ({
    id: String(k),
    kind: 'piece',
    outline: Array.from({ length: 200 }, (): ScreenPoint => [k * 3, k * 7]),
  }));
  bench(
    'degenerate ⚠: 125 targets, 200 collinear points each',
    () => {
      sink = resolveTap([100, 200], line);
    },
    normal,
  );
  bench(
    'degenerate ⚠: 125 targets, 200 coincident points each',
    () => {
      sink = resolveTap([100, 200], dots);
    },
    normal,
  );
});

describe(LABELS, () => {
  const at = (azimuth: number, elevation: number, distance = 18): Vec3 => [
    Math.sin(azimuth) * Math.cos(elevation) * distance,
    Math.sin(elevation) * distance,
    Math.cos(azimuth) * Math.cos(elevation) * distance,
  ];
  const paths: { label: string; poses: Vec3[] }[] = [
    {
      label: 'orbit: 360° at 18° (the opening elevation)',
      poses: Array.from({ length: 720 }, (_, k) => at(k * 0.5 * DEG, 18 * DEG)),
    },
    {
      label: 'climb: -14° to 89.9° and back',
      poses: Array.from({ length: 400 }, (_, k) => {
        const t = k < 200 ? k / 199 : (399 - k) / 199;
        return at(30 * DEG, MathUtils.lerp(-14, 89.9, t) * DEG);
      }),
    },
    {
      label: 'jitter ⚠: across the hysteresis bands every frame',
      poses: Array.from({ length: 400 }, (_, k) =>
        at((45 + (k % 2 ? 6 : -6)) * DEG, (k % 4 < 2 ? 40 : 60) * DEG),
      ),
    },
    {
      label: 'straight down ⚠ (89.99°)',
      poses: Array.from({ length: 360 }, (_, k) => at(k * DEG, 89.99 * DEG)),
    },
  ];
  for (const { label, poses } of paths) {
    let state: AnchorState | null = null;
    let k = 0;
    bench(
      label,
      () => {
        const out = labelAnchors(layout, 'white', poses[k++ % poses.length], [0, 0, 0], state);
        state = out.state;
        sink = out.labels;
      },
      normal,
    );
  }
});

describe(FIT, () => {
  const windows: { label: string; size: [number, number] }[] = [
    { label: 'desktop 1280×800', size: [1280, 800] },
    { label: 'desktop 1920×1080', size: [1920, 1080] },
    { label: 'phone upright 390×844', size: [390, 844] },
    { label: 'phone on its side 844×390', size: [844, 390] },
    { label: '4K 3840×2160', size: [3840, 2160] },
    { label: 'strip ⚠ 5000×120', size: [5000, 120] },
    { label: 'sliver ⚠ 120×5000', size: [120, 5000] },
    { label: 'a single pixel ⚠ 1×1', size: [1, 1] },
  ];
  const elevation = Math.asin(new Vector3(...layout.viewDirection).normalize().y);
  for (const { label, size } of windows) {
    const view = { width: size[0], height: size[1], fov: FOV, topInset: hudTop(size[1]) };
    const { distance, shift } = fitView(elevation, layout.frameRings, view);
    const fitted = Number.isFinite(distance) ? distance.toFixed(1) : String(distance);
    bench(
      `${label} → distance ${fitted}, shift ${shift[1].toFixed(3)}`,
      () => {
        sink = fitView(elevation, layout.frameRings, view);
      },
      normal,
    );
  }
});
