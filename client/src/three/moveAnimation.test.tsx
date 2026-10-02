import { describe, expect, it } from 'vitest';
import { act } from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ReactThreeTestInstance } from '@react-three/test-renderer/dist/declarations/src/types/public.js';
import { Quaternion, Vector3 } from 'three';
import type { Group, Object3D } from 'three';
import { contactAtMs, GLIDE, glideEndMs, glidePose, planGlide, touchdownMs } from './glide';
import { MoveGlide } from './moveAnimation';
import {
  easeLift,
  Jolt,
  JOLT,
  Lift,
  liftEntry,
  ON_FLOOR,
  onToppled,
  Topple,
  TOPPLE_MS,
  TOPPLE_STRIKE,
  useGlide,
} from './pieceMotion';

type Vec = { x: number; y: number; z: number };
const FROM: [number, number, number] = [0, 0, 2];
const TO: [number, number, number] = [0, 0, 0];
const FOOT: [number, number, number] = [0, -0.4, 0];

async function glide(plan = planGlide(FROM, TO), onLanded?: () => void) {
  const renderer = await ReactThreeTestRenderer.create(
    <MoveGlide plan={plan} foot={FOOT} onLanded={onLanded}>
      <mesh userData={{ body: true }} />
    </MoveGlide>,
  );
  const scene = renderer.scene as ReactThreeTestInstance;
  const outer = scene.findAll((n) => n.props.userData?.moveGlide === true)[0]
    .instance as unknown as Group;
  const body = scene.findAll((n) => n.props.userData?.body === true)[0]
    .instance as unknown as Object3D;
  const frames = (n: number) => act(async () => renderer.advanceFrames(n, 0.01));
  return { outer, body, frames, pos: () => outer.position as Vec };
}

describe('planGlide', () => {
  it('takes longer the farther the piece goes, within bounds', () => {
    const near = planGlide([0, 0, 1], TO).travelMs;
    const far = planGlide([2, 2.7, 2], TO).travelMs;
    expect(far).toBeGreaterThan(near);
    expect(near).toBeGreaterThanOrEqual(GLIDE.minMs);
    expect(planGlide([4, 5.4, 4], TO).travelMs).toBe(GLIDE.maxMs);
  });

  it('crouches before a hop from the floor, not when the player already holds it up', () => {
    expect(planGlide(FROM, TO).crouchMs).toBe(GLIDE.crouchMs);
    expect(planGlide(FROM, TO, { lift: 0.11 }).crouchMs).toBe(0);
  });

  it('jumps a knight higher than it carries any other piece', () => {
    expect(planGlide(FROM, TO, { knight: true }).hop).toBeGreaterThan(
      planGlide([4, 5.4, 4], TO).hop,
    );
  });

  it('heads along the move across the board, and has no heading straight up', () => {
    expect(planGlide(FROM, TO).heading).toEqual([-0, -1]);
    expect(planGlide([0, 1.35, 0], TO).heading).toBeNull();
  });

  it('meets a victim short of its square, holds the hit, and lands harder', () => {
    const quiet = planGlide(FROM, TO);
    const capture = planGlide(FROM, TO, { capture: true });
    expect(quiet.contactMs).toBeNull();
    expect(capture.contactMs!).toBeGreaterThan(0);
    expect(capture.contactMs!).toBeLessThan(capture.travelMs);
    expect(touchdownMs(capture)).toBe(touchdownMs(quiet) + GLIDE.hitstopMs);
    expect(contactAtMs(capture)).toBe(capture.crouchMs + capture.contactMs!);
    expect(capture.squash).toBeGreaterThan(quiet.squash);
  });
});

describe('glidePose', () => {
  const plan = planGlide(FROM, TO);
  const air = (u: number) => glidePose(plan, plan.crouchMs + u * plan.travelMs);

  it('starts on the source square, crouching, and ends at rest on its own', () => {
    expect(glidePose(plan, 0).offset).toEqual(FROM);
    expect(glidePose(plan, plan.crouchMs / 2).scaleY).toBeLessThan(1);
    expect(glidePose(plan, glideEndMs(plan))).toEqual({
      offset: [0, 0, 0],
      scaleY: 1,
      lean: 0,
      progress: 1,
    });
  });

  it('arcs over the straight line and comes down onto the square', () => {
    const mid = air(0.5);
    expect(mid.offset[1]).toBeCloseTo(plan.hop);
    expect(mid.offset[2]).toBeCloseTo(1);
    // Still falling as it lands
    expect(air(0.95).offset[1]).toBeGreaterThan(0);
    expect(air(1).offset).toEqual([0, 0, 0]);
  });

  it('stretches in the air, leans back setting off and forward arriving, then squashes', () => {
    expect(air(0.5).scaleY).toBeGreaterThan(1);
    expect(air(0.25).lean).toBeLessThan(0);
    expect(air(0.75).lean).toBeGreaterThan(0);
    const down = touchdownMs(plan);
    const squash = Math.min(
      ...[10, 20, 30, 40, 50, 60].map((ms) => glidePose(plan, down + ms).scaleY),
    );
    expect(squash).toBeCloseTo(1 - plan.squash, 1);
    expect(squash).toBeLessThan(1 - plan.squash * 0.8);
  });

  it('sets off from where the player held it', () => {
    const held = planGlide(FROM, TO, { lift: 0.11 });
    expect(glidePose(held, 0).offset[1]).toBeCloseTo(0.11);
  });

  it('holds still while it hits its victim', () => {
    const capture = planGlide(FROM, TO, { capture: true });
    const at = contactAtMs(capture)!;
    const hit = glidePose(capture, at).offset;
    expect(glidePose(capture, at + capture.hitstopMs / 2).offset).toEqual(hit);
    expect(glidePose(capture, at + capture.hitstopMs).offset).toEqual(hit);
    expect(glidePose(capture, at + capture.hitstopMs + 20).offset[2]).toBeLessThan(hit[2]);
  });
});

describe('MoveGlide', () => {
  it('carries the piece along the plan, and is at rest once it has settled', async () => {
    const plan = planGlide(FROM, TO);
    const { frames, pos } = await glide(plan);
    expect(pos()).toMatchObject({ x: 0, y: 0, z: 2 });
    await frames(20);
    expect(pos().z).toBeCloseTo(glidePose(plan, 200).offset[2]);
    expect(pos().y).toBeGreaterThan(0);
    await frames(Math.ceil(glideEndMs(plan) / 10));
    expect(pos()).toMatchObject({ x: 0, y: 0, z: 0 });
  });

  it('shapes the piece about its foot, keeping its volume', async () => {
    const plan = planGlide(FROM, TO);
    const { body, frames } = await glide(plan);
    // Just after touchdown: squashed
    await frames(Math.ceil(touchdownMs(plan) / 10) + 3);
    const foot = new Vector3(...FOOT);
    const scale = new Vector3();
    body.updateWorldMatrix(true, false);
    body.matrixWorld.decompose(new Vector3(), new Quaternion(), scale);
    expect(scale.y).toBeLessThan(1);
    expect(scale.x * scale.x * scale.y).toBeCloseTo(1, 5);
    // The foot stays put on the floor as it squashes
    const local = foot.clone().applyMatrix4(body.matrixWorld);
    expect(local.y).toBeCloseTo(FOOT[1], 5);
  });

  it('reports its landing once, at touchdown', async () => {
    const plan = planGlide(FROM, TO, { capture: true });
    let landings = 0;
    const { frames } = await glide(plan, () => landings++);
    await frames(Math.floor(touchdownMs(plan) / 10) - 1);
    expect(landings).toBe(0);
    await frames(2);
    expect(landings).toBe(1);
    await frames(40);
    expect(landings).toBe(1);
  });
});

describe('useGlide', () => {
  it('tells the gliding body the levels it leaves and lands on, and how far along it is', async () => {
    let glide: ReturnType<typeof useGlide> = null;
    const Body = () => {
      glide = useGlide();
      return <mesh />;
    };
    const renderer = await ReactThreeTestRenderer.create(
      <MoveGlide plan={planGlide(FROM, TO)} foot={FOOT} fromLevel={0} toLevel={2}>
        <Body />
      </MoveGlide>,
    );
    expect(glide).toMatchObject({ fromLevel: 0, toLevel: 2 });
    const at: number[] = [glide!.progress.current];
    for (let i = 0; i < 16; i++) {
      await act(async () => renderer.advanceFrames(1, 0.03));
      at.push(glide!.progress.current);
    }
    expect(at[0]).toBe(0);
    expect(at[6]).toBeGreaterThan(0);
    expect(at[6]).toBeLessThan(1);
    expect(at[at.length - 1]).toBe(1);
    for (let i = 1; i < at.length; i++) expect(at[i]).toBeGreaterThanOrEqual(at[i - 1]);
  });

  it('is null for a body at rest', async () => {
    let glide: ReturnType<typeof useGlide> | undefined;
    const Body = () => {
      glide = useGlide();
      return <mesh />;
    };
    await ReactThreeTestRenderer.create(<Body />);
    expect(glide).toBeNull();
  });
});

describe('Lift and Topple', () => {
  it('raises a lifted piece, holds it still, and lowers it again', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Lift height={0.2} seconds={0.3}>
        <mesh />
      </Lift>,
    );
    const group = () =>
      (renderer.scene as ReactThreeTestInstance).children[0].instance as unknown as Group;
    await act(async () => renderer.advanceFrames(30, 0.03));
    const held: number[] = [];
    for (let i = 0; i < 30; i++) {
      await act(async () => renderer.advanceFrames(1, 0.03));
      held.push(group().position.y);
    }
    expect(new Set(held)).toEqual(new Set([0.2]));
    await renderer.update(
      <Lift height={0} seconds={0.3}>
        <mesh />
      </Lift>,
    );
    await act(async () => renderer.advanceFrames(40, 0.03));
    expect(group().position.y).toBe(0);
  });

  it('keeps ON_FLOOR decoration on the floor while the piece lifts, through any scale', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Lift height={0.2} seconds={0.3}>
        <group scale={0.5}>
          <group userData={{ ...ON_FLOOR, ring: true }} />
        </group>
        <mesh userData={{ body: true }} />
      </Lift>,
    );
    const scene = renderer.scene as ReactThreeTestInstance;
    const find = (key: string) =>
      scene.findAll((n) => n.props.userData?.[key] === true)[0].instance as unknown as Group;
    const worldY = (key: string) => find(key).getWorldPosition(new Vector3()).y;
    for (let i = 0; i < 30; i++) {
      await act(async () => renderer.advanceFrames(1, 0.03));
      // Pinned in the very frame the piece rises: no trailing, no bounce
      expect(worldY('ring')).toBeCloseTo(0, 6);
    }
    expect(worldY('body')).toBeGreaterThan(0.12);
    expect(find('ring').userData.floorDecal).toBe(true);
  });

  /** A timed Lift driven through a list of [height, seconds, frames] steps, its height each frame. */
  const timed = async (steps: [number, number, number][]) => {
    const Harness = ({ step }: { step: number }) => (
      <Lift height={steps[step][0]} seconds={steps[step][1]}>
        <mesh />
      </Lift>
    );
    const renderer = await ReactThreeTestRenderer.create(<Harness step={0} />);
    const group = (renderer.scene as ReactThreeTestInstance).children[0]
      .instance as unknown as Group;
    const seen: number[][] = [];
    for (let i = 0; i < steps.length; i++) {
      if (i > 0) await act(async () => renderer.update(<Harness step={i} />));
      const heights: number[] = [];
      for (let f = 0; f < steps[i][2]; f++) {
        await act(async () => renderer.advanceFrames(1, 1 / 60));
        heights.push(group.position.y);
      }
      seen.push(heights);
    }
    return seen;
  };
  const rising = (ys: number[]) => ys.every((y, i) => i === 0 || y >= ys[i - 1] - 1e-9);
  const falling = (ys: number[]) => ys.every((y, i) => i === 0 || y <= ys[i - 1] + 1e-9);

  it('eases a timed lift from where it is to its height, never past it, in the time asked', async () => {
    const [up, hold, down] = await timed([
      [0.1, 0.25, 30],
      [0.17, 0.5, 45],
      [0, 0.25, 45],
    ]);
    expect(rising(up)).toBe(true);
    expect(Math.max(...up)).toBeLessThanOrEqual(0.1);
    // A quarter second at 60 frames
    expect(up[13]).toBeLessThan(0.1);
    expect(up[16]).toBe(0.1);
    // It answers at once: well under way in the first frame, no pause
    expect(up[0]).toBeGreaterThan(0.015);
    expect(rising(hold)).toBe(true);
    expect(Math.max(...hold)).toBeLessThanOrEqual(0.17);
    expect(hold[25]).toBeLessThan(0.17);
    expect(hold[31]).toBe(0.17);
    // Leaving the held height takes the held time, the longer of the two
    expect(falling(down)).toBe(true);
    expect(Math.min(...down)).toBeGreaterThanOrEqual(0);
    expect(down[20]).toBeGreaterThan(0);
    expect(down[31]).toBe(0);
  });

  it('carries a timed lift on without slowing when it is sent higher on the way up', async () => {
    // Sent on late in the rise, and just after it set off (at its fastest)
    for (const frames of [8, 1]) {
      const [part, on] = await timed([
        [0.1, 0.25, frames],
        [0.17, 0.5, 40],
      ]);
      const all = [...part, ...on];
      expect(rising(all)).toBe(true);
      const before = part[part.length - 1] - (part.length > 1 ? part[part.length - 2] : 0);
      const after = on[0] - part[part.length - 1];
      expect(after).toBeGreaterThan(before * 0.9);
      expect(on[on.length - 1]).toBe(0.17);
      for (const y of all) expect(y).toBeLessThanOrEqual(0.17);
    }
  });

  it('turns a timed lift back at once, from where it is', async () => {
    const [part, back] = await timed([
      [0.2, 0.3, 9],
      [0, 0.3, 30],
    ]);
    expect(rising(part)).toBe(true);
    expect(falling([part[part.length - 1], ...back])).toBe(true);
    expect(part[part.length - 1] - back[0]).toBeLessThan(0.04);
    expect(back[back.length - 1]).toBe(0);
  });

  it('enters the ease where its speed matches the piece’s, if the piece is faster', () => {
    // From rest, turning back, or slower than the ease sets off: from the start
    expect(liftEntry(0.1, 0.5, 0)).toBe(0);
    expect(liftEntry(-0.1, 0.5, 0.3)).toBe(0);
    expect(liftEntry(0.1, 0, 0.3)).toBe(0);
    expect(liftEntry(0.1, 0.5, 0.2)).toBe(0);
    const t0 = liftEntry(0.1, 0.5, 1.2);
    expect(t0).toBeCloseTo(0.5, 6);
    // The rescaled ease leaves t0 at the speed asked
    const h = 1e-6;
    const rate = ((easeLift(t0 + h) - easeLift(t0)) / h / (1 - easeLift(t0))) * (0.1 / 0.5);
    expect(rate).toBeCloseTo(1.2, 3);
    // Far faster than the ease: no later than its latest entry
    expect(liftEntry(0.01, 0.5, 5)).toBe(0.8);
  });

  it('says once when a mated king strikes the floor, for the result card', async () => {
    let fell = 0;
    const stop = onToppled(() => fell++);
    const renderer = await ReactThreeTestRenderer.create(
      <Topple active>
        <mesh />
      </Topple>,
    );
    // Frames of 30 ms: still falling just short of the floor...
    await act(async () =>
      renderer.advanceFrames(Math.floor((TOPPLE_MS * TOPPLE_STRIKE) / 30) - 1, 0.03),
    );
    expect(fell).toBe(0);
    // ...and down once it has struck, told only once, through the bounce and
    // however long it lies there
    await act(async () => renderer.advanceFrames(20, 0.03));
    expect(fell).toBe(1);
    stop();
  });

  it('tips a mated king onto its side', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Topple active>
        <mesh />
      </Topple>,
    );
    await act(async () => renderer.advanceFrames(40, 0.03));
    const heading = (renderer.scene as ReactThreeTestInstance).children[0];
    const pivot = heading.children[0].children[0].instance as unknown as Group;
    expect(pivot.rotation.x).toBeLessThan(-1.2);
    // It falls across the view: the default camera looks down -z, so the
    // king tips toward +x (the camera's right), not toward or away from it.
    const top = new Vector3(0, 1, 0);
    (heading.instance as unknown as Group).updateMatrixWorld(true);
    pivot.localToWorld(top);
    expect(top.x).toBeGreaterThan(0.8);
    expect(Math.abs(top.z)).toBeLessThan(0.3);
  });

  it('hides the base decoration of a fallen king, and brings it back when it stands', async () => {
    const King = ({ down }: { down: boolean }) => (
      <Topple active={down}>
        <mesh name="body" />
        <group name="ring" userData={ON_FLOOR} />
      </Topple>
    );
    const renderer = await ReactThreeTestRenderer.create(<King down={false} />);
    const find = (name: string) =>
      (renderer.scene as ReactThreeTestInstance).find((n) => n.props.name === name)
        .instance as unknown as Object3D;
    await act(async () => renderer.advanceFrames(2, 0.03));
    expect(find('ring').visible).toBe(true);

    await act(async () => renderer.update(<King down />));
    await act(async () => renderer.advanceFrames(40, 0.03));
    expect(find('ring').visible).toBe(false);
    expect(find('body').visible).toBe(true);

    await act(async () => renderer.update(<King down={false} />));
    await act(async () => renderer.advanceFrames(2, 0.03));
    expect(find('ring').visible).toBe(true);
  });
});

describe('Jolt', () => {
  async function jolt(check: boolean, refused: number) {
    const tree = (c: boolean, r: number) => (
      <Jolt check={c} refused={r}>
        <mesh />
      </Jolt>
    );
    const renderer = await ReactThreeTestRenderer.create(tree(check, refused));
    const group = () =>
      (renderer.scene as ReactThreeTestInstance).children[0].instance as unknown as Group;
    const frames = (n: number) => act(async () => renderer.advanceFrames(n, 0.01));
    return {
      renderer,
      group,
      frames,
      update: (c: boolean, r: number) => renderer.update(tree(c, r)),
    };
  }

  it('rocks a king when he is put in check, then stands him still', async () => {
    const { group, frames, update } = await jolt(false, 0);
    await update(true, 0);
    await frames(6);
    const tilt = 2 * Math.acos(Math.min(1, Math.abs(group().quaternion.w)));
    expect(tilt).toBeGreaterThan(0.02);
    expect(tilt).toBeLessThanOrEqual(JOLT.checkAngle);
    await frames(Math.ceil(JOLT.checkMs / 10));
    expect(group().quaternion.w).toBe(1);
  });

  it('does not rock a king already in check when he appears (a reload)', async () => {
    const { group, frames } = await jolt(true, 0);
    await frames(10);
    expect(group().quaternion.w).toBe(1);
  });

  it('shakes a piece tapped in vain, each time, and comes back to its square', async () => {
    const { group, frames, update } = await jolt(false, 0);
    for (const count of [1, 2]) {
      await update(false, count);
      await frames(4);
      expect(group().position.length()).toBeGreaterThan(0.005);
      expect(group().position.y).toBe(0);
      await frames(Math.ceil(JOLT.refusedMs / 10));
      expect(group().position.length()).toBe(0);
    }
  });
});
