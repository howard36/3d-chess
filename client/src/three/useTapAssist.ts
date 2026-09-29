import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import type { Camera, Mesh, Object3D } from 'three';
import { CLICK_SLOP_PX } from './tap';
import { resolveTap } from './tapAssist';
import type { ScreenPoint, TapTarget } from './tapAssist';

// The scene side of tap assist (tapAssist.ts): which kind of pointer pressed,
// and where the board's actionable targets stand on screen. Only a finger's
// tap is ever assisted; a mouse click (or a pen's) keeps exactly the hit it
// makes.

/** What the player can act on right now, by cell (ZXY). */
export interface Actionable {
  /** Own pieces that can be picked up (the held one included: a tap puts it down). */
  pieces: ReadonlySet<string>;
  /** The held piece's destinations, captures included. */
  destinations: ReadonlySet<string>;
  /** Whether a piece is held. */
  holding: boolean;
}

export interface AssistedTap {
  cell: string;
  kind: TapTarget['kind'];
}

const v = new Vector3();

/** A mesh's vertices on screen, in CSS px of a `width` x `height` canvas (points behind the camera left out). */
const outlineOf = (mesh: Mesh, camera: Camera, width: number, height: number): ScreenPoint[] => {
  const position = mesh.geometry?.getAttribute('position');
  if (!position) return [];
  const out: ScreenPoint[] = [];
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).project(camera);
    if (v.z > 1) continue;
    out.push([((v.x + 1) / 2) * width, ((1 - v.y) / 2) * height]);
  }
  return out;
};

/**
 * Tap assist for the board under `grid`: returns a function that, given a
 * click the board could not act on, says which actionable cell a finger's tap
 * there was meant for (null for a mouse click, or when nothing is in reach).
 * `pieceCell` names the cell a piece's group stands on.
 */
export function useTapAssist(
  grid: RefObject<Object3D | null>,
  pieceCell: (piece: Object3D) => string | undefined,
): (event: MouseEvent | undefined, actionable: Actionable) => AssistedTap | null {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const connected = useThree((s) => s.events.connected) as HTMLElement | null | undefined;
  // The last press: a click carries its pointer's type in most browsers, but
  // not all, so the press that started it is the fallback
  const press = useRef<{ type: string; x: number; y: number } | null>(null);
  useEffect(() => {
    const el = connected ?? gl.domElement;
    // (A test renderer's stand-in canvas takes no listeners)
    if (typeof el?.addEventListener !== 'function') return;
    const down = (e: PointerEvent) => {
      press.current = { type: e.pointerType, x: e.clientX, y: e.clientY };
    };
    el.addEventListener('pointerdown', down, { capture: true, passive: true });
    return () => el.removeEventListener('pointerdown', down, { capture: true });
  }, [gl, connected]);

  const latestPieceCell = useRef(pieceCell);
  useLayoutEffect(() => {
    latestPieceCell.current = pieceCell;
  });

  return useCallback(
    (event: MouseEvent | undefined, actionable: Actionable): AssistedTap | null => {
      // Only a click (never a long press's context menu), from a finger
      if (!event || event.type !== 'click' || !grid.current) return null;
      const pressed = press.current;
      const type = (event as Partial<PointerEvent>).pointerType || pressed?.type;
      if (type !== 'touch') return null;
      if (
        pressed &&
        Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > CLICK_SLOP_PX
      ) {
        return null;
      }
      const rect = gl.domElement.getBoundingClientRect?.();
      if (!rect || rect.width === 0 || rect.height === 0) return null;
      const tap: ScreenPoint = [event.clientX - rect.left, event.clientY - rect.top];

      // Every actionable target's hit shape on screen: a piece's hit proxy
      // (PieceMesh), a destination square's click box, and for a capture both
      grid.current.updateWorldMatrix(true, true);
      camera.updateMatrixWorld();
      const outlines = new Map<string, ScreenPoint[]>();
      const add = (cell: string, mesh: Mesh | undefined) => {
        if (!mesh) return;
        const points = outlineOf(mesh, camera, rect.width, rect.height);
        outlines.set(cell, [...(outlines.get(cell) ?? []), ...points]);
      };
      grid.current.traverse((o) => {
        if (o.userData.cube) {
          if (actionable.destinations.has(o.userData.zxy)) add(o.userData.zxy, o as Mesh);
        } else if (o.userData.piece) {
          const cell = latestPieceCell.current(o);
          if (cell && (actionable.pieces.has(cell) || actionable.destinations.has(cell))) {
            add(cell, o.children.find((c) => c.userData.hitProxy) as Mesh | undefined);
          }
        }
      });
      const targets: TapTarget[] = [...outlines].map(([cell, outline]) => ({
        id: cell,
        kind: actionable.destinations.has(cell) ? 'destination' : 'piece',
        outline,
      }));
      const chosen = resolveTap(tap, targets, actionable.holding);
      return chosen && { cell: chosen.id, kind: chosen.kind };
    },
    [grid, gl, camera],
  );
}
