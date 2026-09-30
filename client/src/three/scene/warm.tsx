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
import { keepPrograms, warmObjects } from './programs';
import { selectionMaterials } from './selection';

/** The warm-up under way: its objects, the one being drawn, and the next. */
interface Warming {
  group: Group;
  objects: Object3D[];
  materials: Material[];
  shown: Object3D | null;
  next: number;
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
 * picked up. One program a frame, those of a piece picked up first, so a
 * click in the meantime waits on one link at most. GameCanvas mounts it
 * once the board's first frame is drawn and the entrance is over, so it
 * never holds up either.
 */
export const WarmPrograms = () => {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const warming = useRef<Warming | null>(null);
  // A lost context comes back with none of its programs (three.js makes
  // them anew): warm them up again
  const [restored, setRestored] = useState(0);
  useEffect(() => {
    const canvas = gl.domElement;
    const again = () => setRestored((n) => n + 1);
    canvas.addEventListener('webglcontextrestored', again);
    return () => canvas.removeEventListener('webglcontextrestored', again);
  }, [gl]);

  // Before each frame: the object the last frame drew leaves, and the next
  // joins (asking for its frame), until all have been drawn once
  useFrame(() => {
    const w = warming.current;
    if (!w) return;
    if (w.shown) {
      w.group.remove(w.shown);
      w.shown = null;
    }
    if (w.next < w.objects.length) {
      w.shown = w.objects[w.next++];
      w.group.add(w.shown);
      invalidate();
      return;
    }
    scene.remove(w.group);
    markGlazeWarm(gl);
    const kept = keepPrograms(gl, w.materials);
    // The ones that kept no program (another material already keeps it) go
    for (const m of w.materials) if (!kept.has(m)) m.dispose();
    w.dispose();
    warming.current = null;
  });

  useEffect(() => {
    const selection = selectionMaterials(new Color(PALETTE.select));
    // In the order they are likely needed
    const meshes = [
      // The garden's copy, drawn from the first frame the camera rests
      backdropMaterial(),
      selection.columnMaterial,
      selection.floorMaterial,
      poolMaterial(0),
      markMaterial(),
      lineMaterial(),
      shimmerMaterial(),
      outlineMaterial(),
      // A piece at rest (the pieces change to it once it is warm) and a
      // captured piece burning away
      bodyMaterial('white', PieceType.Pawn, 0, 'steady'),
      bodyMaterial('white', PieceType.Pawn, 0, 'cut'),
      obsidianMaterial({}),
      pulseMaterial(),
    ];
    const points = [selection.moteMaterial];
    const { group, dispose } = warmObjects(meshes, points);
    // The motes with the rest of a piece picked up, then the others
    const objects = [...group.children];
    const [mote] = objects.splice(meshes.length, 1);
    objects.splice(3, 0, mote);
    group.clear();
    warming.current = {
      group,
      objects,
      materials: [...meshes, ...points],
      shown: null,
      next: 0,
      dispose,
    };
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
  }, [gl, scene, invalidate, restored]);
  return null;
};
