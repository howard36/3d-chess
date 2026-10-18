import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import { Matrix4, Vector3 } from 'three';
import type { Camera, Mesh, Object3D } from 'three';
import { CLICK_SLOP_PX } from './tap';
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

// The scene side of a finger's taps (tapIntent.ts): which kind of pointer
// pressed, where the board's targets stand on screen, the magnifier's state,
// and aiming by hand (a finger held still on the board opens the magnifier
// under it). A mouse click (or a pen's) keeps exactly the hit it makes.

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

/**
 * A finger's taps on the board under `grid`: `tap` decides what a tap the
 * board heard was meant for and acts on it (tapIntent.ts), returning false for
 * a mouse's click, which the board handles as it always has. `lens` is the
 * magnifier to show (Magnifier.tsx), and `lensTap` takes a tap on it.
 * `pieceCell` names the cell a piece's group stands on; `lensTop` gives the
 * canvas's top band the magnifier keeps clear of (a HUD over it), for its height.
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

  const latest = useRef({ pieceCell, actions, lensTop });
  useLayoutEffect(() => {
    latest.current = { pieceCell, actions, lensTop };
  });
  // The player's spread, as their choices in the magnifier have shown it
  const spread = useRef<SpreadRecord | null | undefined>(undefined);
  const record = useCallback(() => {
    if (spread.current === undefined) spread.current = loadTapSpread();
    return spread.current;
  }, []);

  // The last press: a click carries its pointer's type in most browsers, but
  // not all, so the press that started it is the fallback
  const press = useRef<{ type: string; x: number; y: number } | null>(null);
  // A finger that aimed by hand lifts: the click its press and release make is not a tap
  const swallow = useRef(false);

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
    (width: number, height: number, actionable: Actionable) =>
      grid.current
        ? measureTapTargets(grid.current, camera, width, height, actionable, (o) =>
            latest.current.pieceCell(o),
          )
        : [],
    [grid, camera],
  );

  // --- Aiming by hand: a finger resting still on the board for HOLD_MS opens
  // the magnifier under it, its view no longer turning; the finger then moves
  // a point the magnifier marks, and lifting acts on what that point is on.
  const aim = useRef<{ id: number; width: number; height: number; targets: TapTarget[] } | null>(
    null,
  );
  const endAim = useCallback(
    (commit: boolean) => {
      const was = aim.current;
      if (!was) return;
      aim.current = null;
      const controls = get().controls as { enabled?: boolean } | null;
      if (controls) controls.enabled = true;
      const aimed = lensNow.current?.mode === 'aim' ? lensNow.current.aimed : null;
      show(null);
      swallow.current = true;
      const target = aimed && was.targets.find((t) => t.id === aimed);
      if (commit && target) latest.current.actions.act(target.id, target.kind);
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
    const el = connected ?? gl.domElement;
    // (A test renderer's stand-in canvas takes no listeners)
    if (typeof el?.addEventListener !== 'function') return;
    let hold: { id: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null =
      null;
    const fingers = new Set<number>();
    const cancelHold = () => {
      if (hold) clearTimeout(hold.timer);
      hold = null;
    };
    const startAim = (id: number, clientX: number, clientY: number) => {
      hold = null;
      const point = canvasPoint(clientX, clientY);
      const actionable = latest.current.actions.actionable();
      if (!point || fingers.size !== 1 || lensNow.current) return;
      const targets = measure(point.width, point.height, actionable);
      if (targets.length === 0) return;
      // The view holds still while the finger aims
      const controls = get().controls as { enabled?: boolean } | null;
      if (controls) controls.enabled = false;
      aim.current = { id, width: point.width, height: point.height, targets };
      aimAt(point.at);
    };
    const down = (e: PointerEvent) => {
      press.current = { type: e.pointerType, x: e.clientX, y: e.clientY };
      swallow.current = false;
      if (e.pointerType !== 'touch') return;
      fingers.add(e.pointerId);
      cancelHold();
      // A second finger (a pinch) ends an aim without acting
      if (aim.current && e.pointerId !== aim.current.id) endAim(false);
      if (fingers.size !== 1 || lensNow.current) return;
      const { pointerId, clientX, clientY } = e;
      hold = {
        id: pointerId,
        x: clientX,
        y: clientY,
        // eslint-disable-next-line no-restricted-globals -- a gesture's timing, not an animation
        timer: setTimeout(() => startAim(pointerId, clientX, clientY), HOLD_MS),
      };
    };
    const move = (e: PointerEvent) => {
      if (aim.current && e.pointerId === aim.current.id) {
        const point = canvasPoint(e.clientX, e.clientY);
        if (point) aimAt(point.at);
        return;
      }
      if (hold && e.pointerId === hold.id) {
        if (Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > CLICK_SLOP_PX) cancelHold();
      }
    };
    const up = (e: PointerEvent) => {
      fingers.delete(e.pointerId);
      if (hold && e.pointerId === hold.id) cancelHold();
      if (aim.current && e.pointerId === aim.current.id) endAim(e.type === 'pointerup');
    };
    // A long press is the aim, never the page's menu
    const menu = (e: Event) => {
      if (hold || aim.current) e.preventDefault();
    };
    const options = { capture: true, passive: true } as const;
    el.addEventListener('pointerdown', down, options);
    el.addEventListener('pointermove', move, options);
    el.addEventListener('pointerup', up, options);
    el.addEventListener('pointercancel', up, options);
    el.addEventListener('contextmenu', menu, { capture: true });
    return () => {
      cancelHold();
      el.removeEventListener('pointerdown', down, options);
      el.removeEventListener('pointermove', move, options);
      el.removeEventListener('pointerup', up, options);
      el.removeEventListener('pointercancel', up, options);
      el.removeEventListener('contextmenu', menu, { capture: true });
      if (aim.current) endAim(false);
    };
  }, [gl, connected, get, canvasPoint, measure, aimAt, endAim]);

  /** Closes the magnifier (an aim ends without acting). */
  const closeLens = useCallback(() => {
    if (aim.current) endAim(false);
    else if (lensNow.current) show(null);
  }, [endAim, show]);
  // A resized canvas leaves the magnifier where the old one had it: closed
  const size = useThree((s) => s.size);
  useEffect(closeLens, [size.width, size.height, closeLens]);

  /**
   * A tap the board heard (`direct`: what its ray hit, if anything the
   * player can act on or a piece). A finger's is decided here and acted on;
   * returns false for any other click, which the caller acts on as before.
   */
  const tap = useCallback(
    (event: MouseEvent | undefined, direct: DirectHit | null): boolean => {
      // Only a click (never a long press's context menu)
      if (!event || event.type !== 'click' || !grid.current) return false;
      const pressed = press.current;
      const type = (event as Partial<PointerEvent>).pointerType || pressed?.type;
      if (type !== 'touch') return false;
      // The release of a finger that aimed: done already
      if (swallow.current) return true;
      if (
        pressed &&
        Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > CLICK_SLOP_PX
      ) {
        return false;
      }
      const point = canvasPoint(event.clientX, event.clientY);
      if (!point) return false;
      const { actions } = latest.current;
      const actionable = actions.actionable();
      const targets = measure(point.width, point.height, actionable);
      const hit = direct && targets.some((t) => t.id === direct.cell) ? direct.cell : null;
      const decision = decideTap(point.at, targets, {
        holding: actionable.held !== null,
        direct: hit,
        spread: spreadOf(record()),
      });
      if (decision.act === 'take') {
        const target = targets.find((t) => t.id === decision.id)!;
        actions.act(target.id, target.kind);
      } else if (decision.act === 'ask') {
        const candidates = decision.ids.map((id) => targets.find((t) => t.id === id)!);
        const view = {
          width: point.width,
          height: point.height,
          top: latest.current.lensTop(point.height),
        };
        show({
          mode: 'ask',
          lens: askingLens(point.at, candidates, view),
          candidates,
          aimed: null,
          finger: point.at,
        });
      } else {
        actions.miss(direct);
      }
      return true;
    },
    [grid, canvasPoint, measure, show, record],
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
