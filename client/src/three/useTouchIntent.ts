import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import { Matrix4, Raycaster, Vector2, Vector3 } from 'three';
import type { Camera, Mesh, Object3D } from 'three';
import { FINGER_SLOP_PX } from './tap';
import {
  aimingLens,
  askingLens,
  decideTap,
  fromLens,
  inRect,
  LENS_ZOOM,
  pickInLens,
  recordTap,
  spreadOf,
  tapTarget,
} from './tapIntent';
import type { Lens, ScreenPoint, SpreadRecord, TapTarget } from './tapIntent';
import { loadTapSpread, saveTapSpread } from '../lib/tapSpread';

// The scene side of a finger's taps (tapIntent.ts): a finger's tap is read
// from its own touch and lift, where the board's targets stood on screen as
// it touched, then decided and acted on; the magnifier's state; and aiming by
// hand (a finger held still on the board opens the magnifier under it). A
// mouse click (or a pen's) keeps exactly the hit it makes.
//
// A finger's tap is never read from the click the browser makes of it: that
// click may not come (r3f reports a miss only within 2 px of the touch, the
// board's clicks only within CLICK_SLOP_PX), and may not say it came from a
// finger (Safari since 18.2 calls a tap's click a mouse's: WebKit bug 282988).

/** What the player can act on right now, by cell (ZXY). */
export interface Actionable {
  /** Own pieces that can be picked up (the held one included: a tap puts it down). */
  pieces: ReadonlySet<string>;
  /** The held piece's destinations, captures included. */
  destinations: ReadonlySet<string>;
  /** The held piece's cell. */
  held: string | null;
}

/** What a tap's ray hit on the board: a piece, or a destination's mark (or the piece it takes). */
export interface DirectHit {
  cell: string;
  kind: TapTarget['kind'];
}

/** What the board does for its taps. */
export interface TouchActions {
  actionable: () => Actionable;
  /** Act on a target: pick up or put down a piece, or play a move. */
  act: (cell: string, kind: TapTarget['kind']) => void;
  /** A tap meant for nothing the player can act on (`direct`: what its ray hit). */
  miss: (direct: DirectHit | null) => void;
}

/** The magnifier as shown: asking which of some candidates a tap meant, or following a finger that aims. */
export interface LensState {
  mode: 'ask' | 'aim';
  lens: Lens;
  candidates: TapTarget[];
  /** While aiming, the target under the finger. */
  aimed: string | null;
  /** Where the finger is (aiming) or tapped (asking). */
  finger: ScreenPoint;
}

/** How long a finger rests still on the board before it aims by hand (ms). */
export const HOLD_MS = 320;

const v = new Vector3();
const standing = new Matrix4();

/** A mesh's vertices on screen under `matrix`, in CSS px of a `width` x `height` canvas (points behind the camera left out). */
const screenPoints = (
  mesh: Mesh,
  matrix: Matrix4,
  camera: Camera,
  width: number,
  height: number,
): ScreenPoint[] => {
  const position = mesh.geometry?.getAttribute('position');
  if (!position) return [];
  const out: ScreenPoint[] = [];
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).applyMatrix4(matrix).project(camera);
    if (v.z > 1) continue;
    out.push([((v.x + 1) / 2) * width, ((1 - v.y) / 2) * height]);
  }
  return out;
};

/**
 * Every target the player can act on, as it stands on screen: a piece's hit
 * proxy (PieceMesh); a destination's mark (Board's disc), with the piece a
 * capture takes, and for a quiet move the held piece's proxy standing on it.
 * `cellOf` names the cell a piece's group stands on.
 */
export function measureTapTargets(
  grid: Object3D,
  camera: Camera,
  width: number,
  height: number,
  actionable: Actionable,
  cellOf: (piece: Object3D) => string | undefined,
): TapTarget[] {
  grid.updateWorldMatrix(true, true);
  camera.updateMatrixWorld();
  const points = new Map<string, ScreenPoint[]>();
  const squares = new Map<string, Object3D>();
  const occupied = new Set<string>();
  let held: { proxy: Mesh; at: Vector3 } | null = null;
  const add = (cell: string, more: ScreenPoint[]) =>
    points.set(cell, [...(points.get(cell) ?? []), ...more]);
  grid.traverse((o) => {
    if (o.userData.cube) {
      const cell = o.userData.zxy as string;
      if (!actionable.destinations.has(cell)) return;
      squares.set(cell, o);
      add(cell, screenPoints(o as Mesh, o.matrixWorld, camera, width, height));
    } else if (o.userData.piece) {
      const cell = cellOf(o);
      const proxy = o.children.find((c) => c.userData.hitProxy) as Mesh | undefined;
      if (!cell || !proxy) return;
      occupied.add(cell);
      if (cell === actionable.held) held = { proxy, at: o.getWorldPosition(new Vector3()) };
      if (actionable.pieces.has(cell) || actionable.destinations.has(cell)) {
        add(cell, screenPoints(proxy, proxy.matrixWorld, camera, width, height));
      }
    }
  });
  const piece = held as { proxy: Mesh; at: Vector3 } | null;
  return [...points].map(([cell, shape]) => {
    if (!actionable.destinations.has(cell)) return tapTarget(cell, 'piece', shape);
    // A quiet move's square: where the held piece would stand
    const square = squares.get(cell);
    let there: ScreenPoint[] = [];
    if (piece && square && !occupied.has(cell)) {
      const shift = square.getWorldPosition(new Vector3()).sub(piece.at);
      standing.copy(piece.proxy.matrixWorld);
      standing.elements[12] += shift.x;
      standing.elements[13] += shift.y;
      standing.elements[14] += shift.z;
      there = screenPoints(piece.proxy, standing, camera, width, height);
    }
    return tapTarget(cell, 'destination', shape, there);
  });
}

const ray = new Raycaster();
const ndc = new Vector2();

/**
 * What a tap at `at` (CSS px of a `width` x `height` canvas) hits first on
 * the board under `grid`, as r3f would hear it: a piece's hit proxy, or a
 * destination's mark (the empty squares' boxes take no tap of their own).
 * A capture's victim stands for its destination.
 */
export function directHit(
  grid: Object3D,
  camera: Camera,
  at: ScreenPoint,
  width: number,
  height: number,
  destinations: ReadonlySet<string>,
  cellOf: (piece: Object3D) => string | undefined,
): DirectHit | null {
  const meshes: Object3D[] = [];
  grid.traverse((o) => {
    if (o.userData.hitProxy || (o.userData.cube && o.userData.highlight)) meshes.push(o);
  });
  ndc.set((at[0] / width) * 2 - 1, -(at[1] / height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  for (const { object } of ray.intersectObjects(meshes, false)) {
    if (object.userData.cube) return { cell: object.userData.zxy as string, kind: 'destination' };
    const cell = object.parent && cellOf(object.parent);
    if (cell) return { cell, kind: destinations.has(cell) ? 'destination' : 'piece' };
  }
  return null;
}

/**
 * A finger's taps on the board under `grid`: a touch that lifts within
 * FINGER_SLOP_PX of where it touched is decided (tapIntent.ts) and acted on,
 * as the board stood when it touched. `tap` is for the click handlers: true
 * for any click a finger made (decided already, or a drag), false for a
 * mouse's, which the board handles as it always has. `lens` is the magnifier
 * to show (Magnifier.tsx), and `lensTap` takes a tap on it. `pieceCell` names
 * the cell a piece's group stands on; `lensTop` gives the canvas's top band
 * the magnifier keeps clear of (a HUD over it), for its height.
 */
export function useTouchIntent(
  grid: RefObject<Object3D | null>,
  pieceCell: (piece: Object3D) => string | undefined,
  actions: TouchActions,
  lensTop: (height: number) => number = () => 0,
) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const get = useThree((s) => s.get);
  const connected = useThree((s) => s.events.connected) as HTMLElement | null | undefined;
  const [lens, setLens] = useState<LensState | null>(null);
  const lensNow = useRef<LensState | null>(null);
  const show = useCallback((next: LensState | null) => {
    lensNow.current = next;
    setLens(next);
  }, []);

  const latest = useRef({ grid, pieceCell, actions, lensTop });
  useLayoutEffect(() => {
    latest.current = { grid, pieceCell, actions, lensTop };
  });
  // The player's spread, as their choices in the magnifier have shown it
  const spread = useRef<SpreadRecord | null | undefined>(undefined);
  const record = useCallback(() => {
    if (spread.current === undefined) spread.current = loadTapSpread();
    return spread.current;
  }, []);

  // The kind of pointer that last pressed: a click that follows a finger's
  // press is the finger's, whatever the click says
  const pressedBy = useRef<string | null>(null);

  /** A client point as a point of the canvas (CSS px), and the canvas's size. */
  const canvasPoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect?.();
      if (!rect || rect.width === 0 || rect.height === 0) return null;
      return {
        at: [clientX - rect.left, clientY - rect.top] as ScreenPoint,
        width: rect.width,
        height: rect.height,
      };
    },
    [gl],
  );
  const measure = useCallback(
    (view: Camera, width: number, height: number, actionable: Actionable) => {
      const root = latest.current.grid.current;
      return root
        ? measureTapTargets(root, view, width, height, actionable, (o) =>
            latest.current.pieceCell(o),
          )
        : [];
    },
    [],
  );

  /** Decides a finger's tap at `at` with the board seen through `view`, and acts on it. */
  const decide = useCallback(
    (at: ScreenPoint, view: Camera, width: number, height: number) => {
      const root = latest.current.grid.current;
      if (!root) return;
      const { actions } = latest.current;
      const actionable = actions.actionable();
      const targets = measure(view, width, height, actionable);
      const direct = directHit(root, view, at, width, height, actionable.destinations, (o) =>
        latest.current.pieceCell(o),
      );
      const hit = direct && targets.some((t) => t.id === direct.cell) ? direct.cell : null;
      const decision = decideTap(at, targets, {
        holding: actionable.held !== null,
        direct: hit,
        spread: spreadOf(record()),
      });
      if (decision.act === 'take') {
        const target = targets.find((t) => t.id === decision.id)!;
        actions.act(target.id, target.kind);
      } else if (decision.act === 'ask') {
        const candidates = decision.ids.map((id) => targets.find((t) => t.id === id)!);
        show({
          mode: 'ask',
          lens: askingLens(at, candidates, { width, height, top: latest.current.lensTop(height) }),
          candidates,
          aimed: null,
          finger: at,
        });
      } else {
        actions.miss(direct);
      }
    },
    [measure, show, record],
  );

  const latestDecide = useRef(decide);
  useLayoutEffect(() => {
    latestDecide.current = decide;
  });

  // --- Aiming by hand: a finger resting still on the board for HOLD_MS opens
  // the magnifier under it, its view no longer turning; the finger then moves
  // a point the magnifier marks, and lifting acts on what that point is on. A
  // finger that lifts where it touched was only slow to lift: a tap.
  const aim = useRef<{
    id: number;
    width: number;
    height: number;
    targets: TapTarget[];
    /** Where it touched, and the view then. */
    start: ScreenPoint;
    view: Camera;
    /** Whether it has moved off where it touched. */
    slid: boolean;
  } | null>(null);
  const endAim = useCallback(
    (commit: boolean) => {
      const was = aim.current;
      if (!was) return;
      aim.current = null;
      const controls = get().controls as { enabled?: boolean } | null;
      if (controls) controls.enabled = true;
      const aimed = lensNow.current?.mode === 'aim' ? lensNow.current.aimed : null;
      show(null);
      if (!commit) return;
      if (!was.slid) {
        latestDecide.current(was.start, was.view, was.width, was.height);
        return;
      }
      const target = aimed && was.targets.find((t) => t.id === aimed);
      if (target) latest.current.actions.act(target.id, target.kind);
    },
    [get, show],
  );
  const aimAt = useCallback(
    (at: ScreenPoint) => {
      const was = aim.current;
      if (!was) return;
      const view = {
        width: was.width,
        height: was.height,
        top: latest.current.lensTop(was.height),
      };
      show({
        mode: 'aim',
        lens: aimingLens(at, view),
        candidates: was.targets,
        aimed: pickInLens(at, was.targets, LENS_ZOOM.aim),
        finger: at,
      });
    },
    [show],
  );

  useEffect(() => {
    // (r3f's event wrapper round the canvas; a test renderer has none)
    const el = connected || gl.domElement;
    if (typeof el?.addEventListener !== 'function') return;
    // The finger down now, while it may still be a tap: where it touched, and
    // the view as it was then (the view turns under a finger that rolls)
    let finger: {
      id: number;
      x: number;
      y: number;
      view: Camera;
      hold: ReturnType<typeof setTimeout> | null;
    } | null = null;
    const fingers = new Set<number>();
    const release = () => {
      if (finger?.hold) clearTimeout(finger.hold);
      finger = null;
    };
    const startAim = () => {
      const was = finger;
      release();
      if (!was || fingers.size !== 1 || lensNow.current) return;
      const point = canvasPoint(was.x, was.y);
      if (!point) return;
      const targets = measure(
        camera,
        point.width,
        point.height,
        latest.current.actions.actionable(),
      );
      if (targets.length === 0) return;
      // The view holds still while the finger aims
      const controls = get().controls as { enabled?: boolean } | null;
      if (controls) controls.enabled = false;
      aim.current = {
        id: was.id,
        width: point.width,
        height: point.height,
        targets,
        start: point.at,
        view: was.view,
        slid: false,
      };
      aimAt(point.at);
    };
    const down = (e: PointerEvent) => {
      pressedBy.current = e.pointerType;
      if (e.pointerType !== 'touch') return;
      fingers.add(e.pointerId);
      release();
      // A second finger (a pinch) ends an aim without acting
      if (aim.current && e.pointerId !== aim.current.id) endAim(false);
      if (fingers.size !== 1 || lensNow.current) return;
      finger = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        view: camera.clone(),
        // eslint-disable-next-line no-restricted-globals -- a gesture's timing, not an animation
        hold: setTimeout(startAim, HOLD_MS),
      };
    };
    const move = (e: PointerEvent) => {
      const aiming = aim.current;
      if (aiming && e.pointerId === aiming.id) {
        const point = canvasPoint(e.clientX, e.clientY);
        if (!point) return;
        const [x, y] = aiming.start;
        if (Math.hypot(point.at[0] - x, point.at[1] - y) > FINGER_SLOP_PX) aiming.slid = true;
        aimAt(point.at);
        return;
      }
      // A finger that travels turns the view: no tap
      if (finger && e.pointerId === finger.id) {
        if (Math.hypot(e.clientX - finger.x, e.clientY - finger.y) > FINGER_SLOP_PX) release();
      }
    };
    const up = (e: PointerEvent) => {
      fingers.delete(e.pointerId);
      if (aim.current && e.pointerId === aim.current.id) {
        endAim(e.type === 'pointerup');
        return;
      }
      const was = finger;
      if (!was || e.pointerId !== was.id) return;
      release();
      if (e.type !== 'pointerup' || lensNow.current) return;
      if (Math.hypot(e.clientX - was.x, e.clientY - was.y) > FINGER_SLOP_PX) return;
      // A tap: what the finger touched, as the board stood then
      const point = canvasPoint(was.x, was.y);
      if (point) decide(point.at, was.view, point.width, point.height);
    };
    // A long press is the aim, never the page's menu
    const menu = (e: Event) => {
      if (finger || aim.current) e.preventDefault();
    };
    const options = { capture: true, passive: true } as const;
    el.addEventListener('pointerdown', down, options);
    el.addEventListener('pointermove', move, options);
    el.addEventListener('pointerup', up, options);
    el.addEventListener('pointercancel', up, options);
    el.addEventListener('contextmenu', menu, { capture: true });
    return () => {
      release();
      el.removeEventListener('pointerdown', down, options);
      el.removeEventListener('pointermove', move, options);
      el.removeEventListener('pointerup', up, options);
      el.removeEventListener('pointercancel', up, options);
      el.removeEventListener('contextmenu', menu, { capture: true });
      if (aim.current) endAim(false);
    };
  }, [gl, connected, camera, get, canvasPoint, measure, decide, aimAt, endAim]);

  /** Closes the magnifier (an aim ends without acting). */
  const closeLens = useCallback(() => {
    if (aim.current) endAim(false);
    else if (lensNow.current) show(null);
  }, [endAim, show]);
  // A resized canvas leaves the magnifier where the old one had it: closed
  const size = useThree((s) => s.size);
  useEffect(closeLens, [size.width, size.height, closeLens]);

  /**
   * Whether a click the board heard is a finger's, which the board leaves
   * alone: its tap was decided as it lifted (or it was no tap). A long
   * press's context menu is no click at all.
   */
  const tap = useCallback(
    (event: MouseEvent | undefined): boolean =>
      !!event && event.type === 'click' && pressedBy.current === 'touch',
    [],
  );

  /** A tap on the open magnifier (canvas CSS px): a candidate in it is chosen; outside it, it closes. */
  const lensTap = useCallback(
    (at: ScreenPoint) => {
      const now = lensNow.current;
      if (!now || now.mode !== 'ask') return;
      if (!inRect(at, now.lens.frame)) {
        show(null);
        return;
      }
      const id = pickInLens(fromLens(at, now.lens), now.candidates, now.lens.zoom);
      const target = id !== null && now.candidates.find((c) => c.id === id);
      if (!target) return;
      // Where the first tap landed from what it meant: the player's spread
      const next = recordTap(record() ?? { n: 0, sumSq: 0 }, [
        now.finger[0] - target.centre[0],
        now.finger[1] - target.centre[1],
      ]);
      spread.current = next;
      saveTapSpread(next);
      show(null);
      latest.current.actions.act(target.id, target.kind);
    },
    [show, record],
  );

  return { tap, lens, lensTap, closeLens };
}
