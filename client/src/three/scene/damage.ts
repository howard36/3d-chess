import { Box3, Matrix4, Vector3, Vector4 } from 'three';
import type {
  BufferAttribute,
  BufferGeometry,
  Camera,
  InterleavedBufferAttribute,
  Material,
  Mesh,
  Object3D,
  Points,
  PointsMaterial,
  Sprite,
  SpriteMaterial,
} from 'three';

// A frame at rest redraws only the part of the canvas that changed (the
// canvas keeps its last picture: preserveDrawingBuffer). Each drawn object of
// the tower leaves a signature (its matrix, geometry and material, every
// uniform), and where it was on screen; a frame whose objects all match the
// last frame's draws nothing, and otherwise it draws, scissored to the
// screen rect of the objects that changed (where they were and where they
// are), everything but the objects wholly outside that rect (cullOutside:
// they would write no pixel in it). Inside the rect the frame clears and
// draws exactly as a full frame does, and outside it nothing changed, so the
// picture is the full frame's. The garden is not looked at: it is drawn from its copy, which a
// change to the camera, the drawing buffer or the garden replaces with a
// full frame (backdropCache.tsx), as it does every frame that is not
// drawing from the copy. Every vertex shader of the tower places its
// vertices by the object's matrix (its geometry's bounds hold), sprites as
// three.js's sprite shader does, and points padded by their size.

/** A rect of the drawing buffer in device pixels, from its bottom left (gl's scissor). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What one object looked like in the last frame. */
interface Seen {
  sig: number[];
  /** Where it covered the screen (device px), or null for nowhere. */
  rect: Rect | null;
  /** Its rect could not be found (behind the camera): any change is a full frame. */
  unbounded: boolean;
}

export interface DamageState {
  seen: Map<Object3D, Seen>;
  /** The objects of this frame, filled as the tower is walked. */
  next: Map<Object3D, Seen>;
}

export const damageState = (): DamageState => ({ seen: new Map(), next: new Map() });

/** Forget the last frame (the next one is drawn whole). */
export const forgetDamage = (state: DamageState) => state.seen.clear();

/** Antialiasing and rounding: a changed object's rect grows by this (device px). */
const PAD = 2;

const isDrawable = (o: Object3D) =>
  (o as Mesh).isMesh || (o as Points).isPoints || (o as Sprite).isSprite || 'isLine' in o;

const materialsOf = (o: Object3D): Material[] => {
  const m = (o as Mesh).material;
  return m ? (Array.isArray(m) ? m : [m]) : [];
};

export const pushAll = (out: number[], values: ArrayLike<number>) => {
  for (let i = 0; i < values.length; i++) out.push(values[i]);
};

/** A value as numbers: numbers, vectors, colours, matrices, textures (and their version), arrays. */
export const pushValue = (out: number[], v: unknown): void => {
  if (typeof v === 'number') out.push(v);
  else if (typeof v === 'boolean') out.push(v ? 1 : 0);
  else if (v === null || v === undefined) out.push(NaN);
  else if (typeof v === 'string') out.push(v.length);
  else if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    const list = v as ArrayLike<unknown>;
    out.push(list.length);
    for (let i = 0; i < list.length; i++) pushValue(out, list[i]);
  } else if (typeof v === 'object') {
    const o = v as Record<string, unknown> & {
      elements?: ArrayLike<number>;
      isColor?: boolean;
      isTexture?: boolean;
      id?: number;
      version?: number;
    };
    if (o.elements) pushAll(out, o.elements);
    else if (o.isColor) out.push(o.r as number, o.g as number, o.b as number);
    else if (o.isTexture) out.push(o.id as number, o.version as number);
    else if ('x' in o && typeof o.x === 'number') {
      out.push(o.x, o.y as number);
      if ('z' in o) out.push(o.z as number);
      if ('w' in o) out.push(o.w as number);
    } else out.push(typeof o.id === 'number' ? o.id : NaN);
  }
};

/** Two signatures alike (here and the garden's, backdropCache.tsx). */
export const same = (a: number[], b: number[]) => {
  if (a.length !== b.length) return false;
  // NaN stands for "no value" and matches itself
  for (let i = 0; i < a.length; i++)
    if (a[i] !== b[i] && !(a[i] !== a[i] && b[i] !== b[i])) return false;
  return true;
};

/** Material keys whose values are not drawn (or are drawn through `uniforms`, read apart). */
const SKIP = new Set(['uuid', 'name', 'type', 'userData', 'uniforms', 'defines', 'extensions']);

const pushMaterial = (out: number[], m: Material) => {
  out.push((m as Material & { id: number }).id, m.version);
  const own = m as unknown as Record<string, unknown>;
  for (const key in own) {
    if (SKIP.has(key) || key.startsWith('_')) continue;
    const v = own[key];
    if (typeof v !== 'function') pushValue(out, v);
  }
  const uniforms = (m as Material & { uniforms?: Record<string, { value: unknown }> }).uniforms;
  if (uniforms) for (const name in uniforms) pushValue(out, uniforms[name].value);
};

const versionOf = (a: BufferAttribute | InterleavedBufferAttribute) =>
  (a as InterleavedBufferAttribute).isInterleavedBufferAttribute
    ? (a as InterleavedBufferAttribute).data.version
    : (a as BufferAttribute).version;

const pushGeometry = (out: number[], g: BufferGeometry) => {
  out.push(g.id, g.index ? g.index.version : -1, g.drawRange.start, g.drawRange.count);
  for (const name in g.attributes) {
    const a = g.attributes[name];
    out.push(versionOf(a), a.count);
  }
};

/** The signature of a drawn object: everything its pixels depend on, the camera aside. */
const signature = (o: Object3D, out: number[]) => {
  out.length = 0;
  pushAll(out, o.matrixWorld.elements);
  out.push(o.renderOrder);
  const g = (o as Mesh).geometry as BufferGeometry | undefined;
  if (g) pushGeometry(out, g);
  for (const m of materialsOf(o)) pushMaterial(out, m);
  const center = (o as Sprite).center;
  if ((o as Sprite).isSprite && center) out.push(center.x, center.y);
  return out;
};

/** A geometry's bounds, kept while its positions are unchanged. */
const bounds = new WeakMap<BufferGeometry, { version: number; count: number; box: Box3 }>();

const boxOf = (g: BufferGeometry): Box3 | null => {
  const position = g.attributes.position as BufferAttribute | undefined;
  if (!position) return null;
  const version = versionOf(position);
  const known = bounds.get(g);
  if (known && known.version === version && known.count === position.count) return known.box;
  const box = new Box3().setFromBufferAttribute(position as BufferAttribute);
  bounds.set(g, { version, count: position.count, box });
  return box;
};

const viewProjection = new Matrix4();
const clip = new Vector4();
const view = new Vector3();
const corner = new Vector3();

interface Projector {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** The nearest depth in front of the camera seen (view space, positive). */
  near: number;
  behind: boolean;
}

const startProjector = (p: Projector) => {
  p.minX = p.minY = Infinity;
  p.maxX = p.maxY = -Infinity;
  p.near = Infinity;
  p.behind = false;
};

/** Adds a world point to the projector's screen bounds (device px). */
const projectWorld = (p: Projector, point: Vector3, width: number, height: number) => {
  clip.set(point.x, point.y, point.z, 1).applyMatrix4(viewProjection);
  if (clip.w <= 1e-6) {
    p.behind = true;
    return;
  }
  const x = (clip.x / clip.w) * 0.5 + 0.5;
  const y = (clip.y / clip.w) * 0.5 + 0.5;
  p.minX = Math.min(p.minX, x * width);
  p.maxX = Math.max(p.maxX, x * width);
  p.minY = Math.min(p.minY, y * height);
  p.maxY = Math.max(p.maxY, y * height);
  p.near = Math.min(p.near, clip.w);
};

const scratch: number[] = [];

const projector: Projector = { minX: 0, minY: 0, maxX: 0, maxY: 0, near: 0, behind: false };

/**
 * Where an object covers the screen (device px), or null if nowhere it can be
 * found, or 'unbounded' when part of it is behind the camera.
 */
const screenRect = (
  o: Object3D,
  camera: Camera,
  width: number,
  height: number,
): Rect | null | 'unbounded' => {
  const p = projector;
  startProjector(p);
  let pad = PAD;
  if ((o as Sprite).isSprite) {
    // As three.js's sprite shader: a quad about the object's origin in view
    // space, its size the matrix's scale, turned by the material's rotation
    const s = o as Sprite;
    const e = o.matrixWorld.elements;
    const sx = Math.hypot(e[0], e[1], e[2]);
    const sy = Math.hypot(e[4], e[5], e[6]);
    const reach =
      Math.hypot((0.5 + Math.abs(s.center.x - 0.5)) * sx, (0.5 + Math.abs(s.center.y - 0.5)) * sy) *
      1.0001;
    view.setFromMatrixPosition(o.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
    const attenuated = (s.material as SpriteMaterial).sizeAttenuation !== false;
    const r = attenuated ? reach : reach * -view.z;
    for (let i = 0; i < 4; i++) {
      corner.set(view.x + (i & 1 ? r : -r), view.y + (i & 2 ? r : -r), view.z);
      clip.set(corner.x, corner.y, corner.z, 1).applyMatrix4(camera.projectionMatrix);
      if (clip.w <= 1e-6) return 'unbounded';
      const x = ((clip.x / clip.w) * 0.5 + 0.5) * width;
      const y = ((clip.y / clip.w) * 0.5 + 0.5) * height;
      p.minX = Math.min(p.minX, x);
      p.maxX = Math.max(p.maxX, x);
      p.minY = Math.min(p.minY, y);
      p.maxY = Math.max(p.maxY, y);
    }
  } else {
    const g = (o as Mesh).geometry as BufferGeometry | undefined;
    const box = g && boxOf(g);
    if (!box) return null;
    if (box.isEmpty()) return null;
    for (let i = 0; i < 8; i++) {
      corner
        .set(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        )
        .applyMatrix4(o.matrixWorld);
      projectWorld(p, corner, width, height);
    }
    if (p.behind) return 'unbounded';
    if ((o as Points).isPoints) {
      // A point is a square gl_PointSize across, at most at the nearest depth
      const m = (o as Points).material as PointsMaterial;
      const size = m.size ?? 1;
      pad += (m.sizeAttenuation !== false ? (size * height * 0.5) / p.near : size) * 0.5 + 1;
    } else if ('isLine' in o) pad += 1;
  }
  const x0 = Math.max(0, Math.floor(p.minX - pad));
  const y0 = Math.max(0, Math.floor(p.minY - pad));
  const x1 = Math.min(width, Math.ceil(p.maxX + pad));
  const y1 = Math.min(height, Math.ceil(p.maxY + pad));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

const unite = (a: Rect | null, b: Rect | null): Rect | null => {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
};

/**
 * The part of the screen this frame must redraw: the rect of every drawn
 * object of `root` (but those in `skip`) whose signature differs from the
 * last frame's, where it was and where it is, and of every object drawn last
 * time and not now. `full`: this frame is drawn whole anyway (only the
 * signatures are taken). Returns 'full' when the frame must be drawn whole,
 * null when nothing changed.
 */
export const damage = (
  state: DamageState,
  root: Object3D,
  skip: ReadonlySet<Object3D>,
  camera: Camera,
  width: number,
  height: number,
  full: boolean,
): Rect | null | 'full' => {
  viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const { seen, next } = state;
  let whole = full || seen.size === 0;
  let rect: Rect | null = null;
  const visit = (o: Object3D) => {
    if (!o.visible || skip.has(o)) return;
    if (isDrawable(o) && o.layers.test(camera.layers)) {
      const materials = materialsOf(o);
      if (materials.some((m) => m.visible)) {
        const last = seen.get(o);
        const sig = signature(o, scratch);
        const changed = !last || !same(sig, last.sig);
        let entry: Seen;
        // (a frame drawn whole may have moved the camera: every rect anew)
        if (!changed && !full && last) entry = last;
        else {
          const r = screenRect(o, camera, width, height);
          entry = {
            sig: changed || !last ? sig.slice() : last.sig,
            rect: r === 'unbounded' ? null : r,
            unbounded: r === 'unbounded',
          };
          if (!whole && changed) {
            if (entry.unbounded || last?.unbounded) whole = true;
            else rect = unite(unite(rect, last ? last.rect : null), entry.rect);
          }
        }
        next.set(o, entry);
      }
    }
    const children = o.children;
    for (let i = 0; i < children.length; i++) visit(children[i]);
  };
  visit(root);
  if (!whole)
    for (const [o, last] of seen)
      if (!next.has(o)) {
        if (last.unbounded) whole = true;
        else rect = unite(rect, last.rect);
      }
  state.seen = next;
  state.next = seen;
  seen.clear();
  return whole ? 'full' : rect;
};

/** Objects hidden for the frame being drawn in part, to be shown again after it. */
const culled: Object3D[] = [];

const meets = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Hides, for the frame about to be drawn in `rect`, each object of the last
 * damage() walk that lies wholly outside it: it would write no pixel there,
 * so the frame is the same without it, and the GPU is spared its vertices.
 * An object with children stays (they may lie inside), as does one whose
 * place on screen is not known. restoreCulled() shows them again.
 */
export const cullOutside = (state: DamageState, rect: Rect) => {
  for (const [o, seen] of state.seen)
    if (seen.rect && !meets(seen.rect, rect) && o.children.length === 0) {
      o.visible = false;
      culled.push(o);
    }
};

/** Shows again what cullOutside() hid. */
export const restoreCulled = () => {
  for (const o of culled) o.visible = true;
  culled.length = 0;
};
