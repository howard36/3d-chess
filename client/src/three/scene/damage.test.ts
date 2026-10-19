import { describe, expect, it } from 'vitest';
import {
  BoxGeometry,
  Color,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Texture,
  Vector3,
} from 'three';
import type { Object3D } from 'three';
import { cullOutside, damage, damageState, forgetDamage, restoreCulled } from './damage';
import type { Rect } from './damage';

// A frame at rest redraws only the screen rect of what changed since the
// last frame: where a changed object was and where it is.

const W = 800;
const H = 600;

const camera = () => {
  const c = new PerspectiveCamera(36, W / H, 0.1, 1000);
  c.position.set(0, 0, 10);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
};

const box = (x: number, y = 0) => {
  const m = new Mesh(
    new BoxGeometry(1, 1, 1),
    new ShaderMaterial({
      uniforms: {
        uGlow: { value: 0 },
        uMap: { value: null },
        uAt: { value: new Vector3() },
        uTint: { value: new Color() },
      },
    }),
  );
  m.position.set(x, y, 0);
  return m;
};

/** A scene of three boxes, the first frame (drawn whole) already taken. */
const setUp = (cam = camera()) => {
  const root = new Group();
  const boxes = [box(-3), box(0), box(3)];
  root.add(...boxes);
  const state = damageState();
  const frame = (full = false, skip: ReadonlySet<Object3D> = new Set()) => {
    root.updateMatrixWorld(true);
    return damage(state, root, skip, cam, W, H, full);
  };
  expect(frame()).toBe('full');
  return { root, boxes, cam, state, frame };
};

const contains = (outer: Rect, inner: Rect) =>
  outer.x <= inner.x &&
  outer.y <= inner.y &&
  outer.x + outer.w >= inner.x + inner.w &&
  outer.y + outer.h >= inner.y + inner.h;

/** Where a box alone covers the screen, as the damage of a frame that only adds it. */
const rectOf = (x: number, y = 0, cam = camera()) => {
  const { root, frame } = setUp(cam);
  const extra = box(x, y);
  root.add(extra);
  return frame() as Rect;
};

describe('damage', () => {
  it('draws nothing when nothing changed', () => {
    const { frame } = setUp();
    expect(frame()).toBeNull();
    expect(frame()).toBeNull();
  });

  it('draws whole the first frame, a frame asked whole, and after a lost context', () => {
    const { frame, state } = setUp();
    expect(frame(true)).toBe('full');
    expect(frame()).toBeNull();
    forgetDamage(state);
    expect(frame()).toBe('full');
  });

  it('covers a moved object where it was and where it is, and nothing else', () => {
    const { boxes, frame } = setUp();
    boxes[2].position.x = 2.5;
    const r = frame() as Rect;
    expect(contains(r, rectOf(3))).toBe(true);
    expect(contains(r, rectOf(2.5))).toBe(true);
    // The other boxes are left as they are
    const middle = rectOf(0);
    expect(r.x).toBeGreaterThanOrEqual(middle.x + middle.w);
    expect(r.w * r.h).toBeLessThan(W * H * 0.1);
    expect(frame()).toBeNull();
    // Up and down as well as across
    boxes[2].position.y = 1.5;
    const up = frame() as Rect;
    expect(contains(up, rectOf(2.5))).toBe(true);
    expect(contains(up, rectOf(2.5, 1.5))).toBe(true);
  });

  it('takes every rect anew on a frame drawn whole (the camera may have moved)', () => {
    const cam = camera();
    const { boxes, frame } = setUp(cam);
    cam.position.set(4, 3, 9);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    expect(frame(true)).toBe('full');
    boxes[2].position.x = 2.5;
    const r = frame() as Rect;
    // Where it was, seen from where the camera is now
    expect(contains(r, rectOf(3, 0, cam))).toBe(true);
    expect(contains(r, rectOf(2.5, 0, cam))).toBe(true);
  });

  it('sees a uniform, a texture and a material change', () => {
    const { boxes, frame } = setUp();
    const material = boxes[0].material as ShaderMaterial;
    material.uniforms.uGlow.value = 0.5;
    expect(contains(frame() as Rect, rectOf(-3))).toBe(true);
    const texture = new Texture();
    material.uniforms.uMap.value = texture;
    expect(frame()).not.toBeNull();
    expect(frame()).toBeNull();
    texture.needsUpdate = true;
    expect(frame()).not.toBeNull();
    // A vector's every part, a colour, the draw order
    (material.uniforms.uAt.value as Vector3).z = 1;
    expect(frame()).not.toBeNull();
    (material.uniforms.uTint.value as Color).setRGB(0, 0, 1);
    expect(frame()).not.toBeNull();
    boxes[0].renderOrder = 5;
    expect(frame()).not.toBeNull();
    expect(frame()).toBeNull();
    material.transparent = true;
    expect(frame()).not.toBeNull();
    boxes[0].material = new ShaderMaterial();
    expect(frame()).not.toBeNull();
    expect(frame()).toBeNull();
  });

  it('sees positions changed in place and a draw range', () => {
    const { boxes, frame } = setUp();
    const position = boxes[1].geometry.attributes.position as BufferAttribute;
    position.setX(0, 2);
    position.needsUpdate = true;
    const r = frame() as Rect;
    // The new bounds reach out to x = 2
    expect(contains(r, rectOf(1.5))).toBe(true);
    boxes[1].geometry.setDrawRange(0, 6);
    expect(frame()).not.toBeNull();
  });

  it('covers an object hidden, removed or added, and skips what it is told to', () => {
    const { root, boxes, frame } = setUp();
    boxes[0].visible = false;
    expect(contains(frame() as Rect, rectOf(-3))).toBe(true);
    root.remove(boxes[1]);
    expect(contains(frame() as Rect, rectOf(0))).toBe(true);
    const skipped = box(1.5);
    root.add(skipped);
    expect(frame(false, new Set([skipped]))).toBeNull();
    (boxes[2].material as ShaderMaterial).visible = false;
    expect(contains(frame() as Rect, rectOf(3))).toBe(true);
  });

  it('draws whole when a changed object reaches behind the camera', () => {
    const { boxes, frame } = setUp();
    boxes[1].position.z = 10;
    expect(frame()).toBe('full');
    // ...and when it leaves from there
    boxes[1].position.z = 0;
    expect(frame()).toBe('full');
    expect(frame()).toBeNull();
  });

  it('bounds a sprite by its scale about its centre, and points by their size', () => {
    const { root, frame } = setUp();
    const sprite = new Sprite(new SpriteMaterial());
    sprite.position.set(0, 2, 0);
    sprite.scale.set(1, 1, 1);
    root.add(sprite);
    const small = frame() as Rect;
    sprite.scale.set(2, 2, 1);
    const large = frame() as Rect;
    expect(contains(large, small)).toBe(true);
    expect(large.w).toBeGreaterThan(small.w * 1.5);
    // At 10 units, a unit is about H / (2 tan 18°) / 10 px
    const unit = H / (2 * Math.tan((18 * Math.PI) / 180)) / 10;
    expect(large.w).toBeGreaterThanOrEqual(2 * unit);
    // Off its centre, it reaches farther that way
    sprite.center.set(0, 0.5);
    const shifted = frame() as Rect;
    expect(shifted.x + shifted.w).toBeGreaterThan(large.x + large.w + unit / 2);

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, -2, 0]), 3));
    const points = new Points(geometry, new PointsMaterial({ size: 0.5 }));
    root.add(points);
    const r = frame() as Rect;
    const at = new Vector3(0, -2, 0).project(camera());
    const y = (at.y * 0.5 + 0.5) * H;
    // gl_PointSize = size * (H / 2) / depth, half of it each side
    expect(r.y).toBeLessThanOrEqual(y - (0.5 * H * 0.5) / 10 / 2);
    expect(r.y + r.h).toBeGreaterThanOrEqual(y + (0.5 * H * 0.5) / 10 / 2);
  });

  it('hides for one frame the objects wholly outside its rect, and shows them again', () => {
    const { boxes, frame, state } = setUp();
    boxes[2].position.x = 2.5;
    const r = frame() as Rect;
    cullOutside(state, r);
    expect(boxes.map((b) => b.visible)).toEqual([false, false, true]);
    restoreCulled();
    expect(boxes.map((b) => b.visible)).toEqual([true, true, true]);
    // An object with children stays, whatever its own place
    boxes[0].add(box(2.5));
    frame();
    cullOutside(state, r);
    expect(boxes[0].visible).toBe(true);
    restoreCulled();
  });
});
