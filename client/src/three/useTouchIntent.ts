import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import { Matrix4, Raycaster, Vector2, Vector3 } from 'three';
import type { Camera, Mesh, Object3D } from 'three';
import { FINGER_SLOP_PX } from './tap';
import { decideTap, tapTarget } from './tapIntent';
import type { ScreenPoint, TapTarget } from './tapIntent';

// The scene side of a finger's taps (tapIntent.ts): a finger's tap is read
// from its own touch and lift, where the board's targets stood on screen as
// it touched, then decided and acted on. A mouse click (or a pen's) keeps
// exactly the hit it makes.
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

const v = new Vector3();

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
 * capture takes. `cellOf` names the cell a piece's group stands on.
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
  const add = (cell: string, more: ScreenPoint[]) =>
    points.set(cell, [...(points.get(cell) ?? []), ...more]);
  grid.traverse((o) => {
    if (o.userData.cube) {
      const cell = o.userData.zxy as string;
      if (!actionable.destinations.has(cell)) return;
      add(cell, screenPoints(o as Mesh, o.matrixWorld, camera, width, height));
    } else if (o.userData.piece) {
      const cell = cellOf(o);
      const proxy = o.children.find((c) => c.userData.hitProxy) as Mesh | undefined;
      if (!cell || !proxy) return;
      if (actionable.pieces.has(cell) || actionable.destinations.has(cell)) {
        add(cell, screenPoints(proxy, proxy.matrixWorld, camera, width, height));
      }
    }
  });
  return [...points].map(([cell, shape]) =>
    tapTarget(cell, actionable.destinations.has(cell) ? 'destination' : 'piece', shape),
  );
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
 * FINGER_SLOP_PX of where it touched, however long it rested, is decided
 * (tapIntent.ts) and acted on, as the board stood when it touched. `tap` is
 * for the click handlers: true for any click a finger made (decided already,
 * or a drag), false for a mouse's, which the board handles as it always has.
 * `pieceCell` names the cell a piece's group stands on.
 */
export function useTouchIntent(
  grid: RefObject<Object3D | null>,
  pieceCell: (piece: Object3D) => string | undefined,
  actions: TouchActions,
) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const connected = useThree((s) => s.events.connected) as HTMLElement | null | undefined;

  const latest = useRef({ grid, pieceCell, actions });
  useLayoutEffect(() => {
    latest.current = { grid, pieceCell, actions };
  });
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

  /** Decides a finger's tap at `at` with the board seen through `view`, and acts on it. */
  const decide = useCallback((at: ScreenPoint, view: Camera, width: number, height: number) => {
    const { grid, pieceCell, actions } = latest.current;
    const root = grid.current;
    if (!root) return;
    const actionable = actions.actionable();
    const targets = measureTapTargets(root, view, width, height, actionable, pieceCell);
    const direct = directHit(root, view, at, width, height, actionable.destinations, pieceCell);
    const hit = direct && targets.some((t) => t.id === direct.cell) ? direct.cell : null;
    const decision = decideTap(at, targets, { holding: actionable.held !== null, direct: hit });
    if (decision.act === 'take') {
      const target = targets.find((t) => t.id === decision.id)!;
      actions.act(target.id, target.kind);
    } else {
      actions.miss(direct);
    }
  }, []);

  useEffect(() => {
    // (r3f's event wrapper round the canvas; a test renderer has none)
    const el = connected || gl.domElement;
    if (typeof el?.addEventListener !== 'function') return;
    // The finger down now, while it may still be a tap: where it touched, and
    // the view as it was then (the view turns under a finger that rolls)
    let finger: { id: number; x: number; y: number; view: Camera } | null = null;
    const fingers = new Set<number>();
    const down = (e: PointerEvent) => {
      pressedBy.current = e.pointerType;
      if (e.pointerType !== 'touch') return;
      fingers.add(e.pointerId);
      // A second finger (a pinch) is no tap
      finger =
        fingers.size === 1
          ? { id: e.pointerId, x: e.clientX, y: e.clientY, view: camera.clone() }
          : null;
    };
    const move = (e: PointerEvent) => {
      // A finger that travels turns the view: no tap
      if (finger && e.pointerId === finger.id) {
        if (Math.hypot(e.clientX - finger.x, e.clientY - finger.y) > FINGER_SLOP_PX) finger = null;
      }
    };
    const up = (e: PointerEvent) => {
      fingers.delete(e.pointerId);
      const was = finger;
      if (!was || e.pointerId !== was.id) return;
      finger = null;
      if (e.type !== 'pointerup') return;
      if (Math.hypot(e.clientX - was.x, e.clientY - was.y) > FINGER_SLOP_PX) return;
      // A tap: what the finger touched, as the board stood then
      const point = canvasPoint(was.x, was.y);
      if (point) decide(point.at, was.view, point.width, point.height);
    };
    // A long press is a slow tap, never the page's menu
    const menu = (e: Event) => {
      if (finger) e.preventDefault();
    };
    const options = { capture: true, passive: true } as const;
    el.addEventListener('pointerdown', down, options);
    el.addEventListener('pointermove', move, options);
    el.addEventListener('pointerup', up, options);
    el.addEventListener('pointercancel', up, options);
    el.addEventListener('contextmenu', menu, { capture: true });
    return () => {
      el.removeEventListener('pointerdown', down, options);
      el.removeEventListener('pointermove', move, options);
      el.removeEventListener('pointerup', up, options);
      el.removeEventListener('pointercancel', up, options);
      el.removeEventListener('contextmenu', menu, { capture: true });
    };
  }, [gl, connected, camera, canvasPoint, decide]);

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

  return { tap };
}
