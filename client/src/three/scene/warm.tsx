import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color } from 'three';
import type { Group, Material, Object3D } from 'three';
import { backdropMaterial } from './backdropCache';
import { obsidianMaterial } from './blades';
import { outlineMaterial, pulseMaterial } from './fx';
import { lineMaterial } from './line';
import { markMaterial, shimmerMaterial } from './markers';
import { PALETTE } from './palette';
import { PieceType } from '../../engine/pieces';
import { bodyMaterial, markGlazeWarm, poolMaterial } from './pieces';
import { keepPrograms, linkAhead, warmObjects } from './programs';
import { selectionMaterials } from './selection';

/** The warm-up under way: its objects, and whether they have been drawn. */
interface Warming {
  group: Group;
  objects: Object3D[];
  materials: Material[];
  drawn: boolean;
  /** Every program linked ahead (linkAhead): the drawing can start. */
  linked: boolean;
  dispose: () => void;
}

/**
 * Warms up the shader programs of the marks of play that are not on the
 * board yet (a piece picked up and its hover pool, the last move's mark,
 * line and shimmer, check's blades, a capture's outline, mate's pulse):
 * draws each once, touching no pixel (warmObjects), then keeps their
 * programs (keepPrograms). A program's first draw compiles and links it and
 * waits on the GPU for it, a long task; this way it comes after the
 * entrance instead of in the frame of the first move or the first piece
 * picked up. All are linked first (linkAhead: the page waits on none of
 * them), then drawn together in one frame: linked ahead, a draw links
 * nothing, so each frame more would only draw the whole scene again.
 * GameCanvas mounts it once the board's first frame is drawn and its
 * entrance has begun, so the GPU links them under the entrance (a pick just
 * after it found them still linking, seconds in software), and has it draw
 * them (`draw`) once the entrance is over.
 */
export const WarmPrograms = ({ draw = true }: { draw?: boolean }) => {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const warming = useRef<Warming | null>(null);
  const drawing = useRef(draw);
  drawing.current = draw;
  useEffect(() => {
    if (draw) invalidate();
  }, [draw, invalidate]);
  // A lost context comes back with none of its programs (three.js makes
  // them anew): warm them up again
  const [restored, setRestored] = useState(0);
  useEffect(() => {
    const canvas = gl.domElement;
    const again = () => setRestored((n) => n + 1);
    canvas.addEventListener('webglcontextrestored', again);
    return () => canvas.removeEventListener('webglcontextrestored', again);
  }, [gl]);

  // Before a frame: all the objects join (asking for the frame); before the
  // next, once they have been drawn, they leave
  useFrame(() => {
    const w = warming.current;
    if (!w?.linked || !drawing.current) return;
    if (!w.drawn) {
      w.group.add(...w.objects);
      w.drawn = true;
      invalidate();
      return;
    }
    scene.remove(w.group);
    // The pieces change to the glaze at rest in the next frame: ask for it
    // now, so that change is not made in a player's frame
    markGlazeWarm(gl);
    // For e2e (programs.spec.ts): from here no move or selection links a program
    gl.domElement.dataset.warm = 'done';
    invalidate();
    const kept = keepPrograms(gl, w.materials);
    // The ones that kept no program (another material already keeps it) go
    for (const m of w.materials) if (!kept.has(m)) m.dispose();
    w.dispose();
    warming.current = null;
  });

  useEffect(() => {
    const selection = selectionMaterials(new Color(PALETTE.select));
    const bare = [backdropMaterial()];
    const meshes = [
      selection.columnMaterial,
      selection.floorMaterial,
      poolMaterial(0),
      markMaterial(),
      // A captured piece burning away (a capture can come with the first moves)
      bodyMaterial('white', PieceType.Pawn, 0, 'cut'),
      lineMaterial(),
      shimmerMaterial(),
      outlineMaterial(),
      // A piece at rest (the pieces change to it once it is warm)
      bodyMaterial('white', PieceType.Pawn, 0, 'steady'),
      obsidianMaterial({}),
      pulseMaterial(),
    ];
    const points = [selection.moteMaterial];
    const { group, dispose } = warmObjects(meshes, points, bare);
    const w: Warming = {
      group,
      objects: [...group.children],
      materials: [...bare, ...meshes, ...points],
      drawn: false,
      linked: false,
      dispose,
    };
    const ready = () => {
      if (warming.current !== w) return;
      w.linked = true;
      invalidate();
    };
    warming.current = w;
    linkAhead(gl, group, camera, ready, scene);
    group.clear();
    scene.add(group);
    invalidate();
    return () => {
      const w = warming.current;
      if (!w) return;
      // Gone before it was done: nothing more is kept
      scene.remove(w.group);
      for (const m of w.materials) m.dispose();
      w.dispose();
      warming.current = null;
    };
  }, [gl, scene, camera, invalidate, restored]);
  return null;
};
