import { describe, expect, it } from 'vitest';
import { act } from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ReactThreeTestInstance } from '@react-three/test-renderer/dist/declarations/src/types/public.js';
import { Vector3 } from 'three';
import type { Group, Mesh } from 'three';
import { MoveGlide } from './moveAnimation';
import {
  FLOOR_DECAL,
  LIFT_DEFAULTS,
  Lift,
  ON_FLOOR,
  pieceLift,
  SELECTION_BOB,
  Topple,
  useGlide,
} from './designs/kit/motion';
import type { DesignMotion } from './designs/types';

type Vec = { x: number; y: number; z: number };
const FROM: [number, number, number] = [0, 0, 2];
const TO: [number, number, number] = [0, 0, 0];

async function glide(motion: DesignMotion, arc = 0, from = FROM) {
  const renderer = await ReactThreeTestRenderer.create(
    <MoveGlide from={from} to={TO} motion={motion} floorY={-0.5} arc={arc}>
      <mesh userData={{ body: true }} />
    </MoveGlide>,
  );
  const scene = renderer.scene as ReactThreeTestInstance;
  const outer = scene.findAll((n) => n.props.userData?.moveGlide === true)[0]
    .instance as unknown as Group;
  // The scaling group sits between the glide and the piece (bounce, teleport)
  const scaler = () => {
    let g = (scene.findAll((n) => n.props.userData?.body === true)[0].instance as unknown as Group)
      .parent;
    while (g && g !== outer && g.scale.x === 1 && g.scale.y === 1) g = g.parent;
    return g === outer ? null : g;
  };
  const frames = (n: number) => act(async () => renderer.advanceFrames(n, 0.03));
  return { outer, scaler, frames, pos: () => outer.position as Vec };
}

describe('MoveGlide styles', () => {
  it('slides in a straight line, without lifting', async () => {
    const { frames, pos } = await glide({ style: 'slide', durationMs: 300, lift: 0.5 });
    expect(pos().z).toBeCloseTo(2);
    await frames(5);
    expect(pos().y).toBe(0);
    expect(pos().z).toBeGreaterThan(0);
    expect(pos().z).toBeLessThan(2);
    await frames(6);
    expect(pos()).toMatchObject({ x: 0, y: 0, z: 0 });
  });

  it('teleports: shrinks away at the source, pops in at the destination', async () => {
    const { frames, pos, scaler } = await glide({ style: 'teleport', durationMs: 300, lift: 0 });
    await frames(3); // ~90ms: still at the source, shrinking
    expect(pos().z).toBeCloseTo(2);
    expect(scaler()!.scale.x).toBeLessThan(1);
    await frames(3); // ~180ms: already home, growing back
    expect(pos().z).toBe(0);
    await frames(6);
    expect(scaler()).toBeNull(); // back to full size
  });

  it('glides every style but teleport in a straight line, even between levels', async () => {
    for (const style of ['hop', 'slide', 'bounce'] as const) {
      // Two levels up and two ranks back: the offset shrinks along one line
      const { frames, pos } = await glide({ style, durationMs: 300, lift: 0.6 }, 0, [0, 2, 2]);
      for (let i = 0; i < 9; i++) {
        await frames(1);
        const { x, y, z } = pos();
        expect(x).toBe(0);
        expect(y).toBeCloseTo(z, 6);
        expect(z).toBeGreaterThanOrEqual(0);
        expect(z).toBeLessThanOrEqual(2);
      }
    }
  });

  it('arcs a knight over a constant height above the line, whatever the level change', async () => {
    for (const from of [FROM, [0, 2, 1] as [number, number, number]]) {
      const { frames, pos } = await glide({ style: 'hop', durationMs: 300 }, 0.6, from);
      // Halfway through the glide (the ease is symmetric): the arc's peak
      await frames(5);
      expect(pos().y - from[1] / 2).toBeCloseTo(0.6, 1);
      await frames(8);
      expect(pos()).toMatchObject({ x: 0, y: 0, z: 0 });
    }
  });

  it('bounces: squashes on landing and settles back to shape', async () => {
    const { frames, pos, scaler } = await glide({ style: 'bounce', durationMs: 300, lift: 0.6 });
    await frames(5);
    expect(pos().y).toBe(0); // gliding, not lifted
    expect(scaler()).not.toBeNull(); // stretched as it travels
    await frames(6); // landed, squashing
    expect(pos().z).toBeCloseTo(0);
    expect(scaler()).not.toBeNull();
    await frames(12);
    expect(scaler()).toBeNull();
    expect(pos()).toMatchObject({ x: 0, y: 0, z: 0 });
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
      <MoveGlide
        from={FROM}
        to={TO}
        motion={{ style: 'slide', durationMs: 300 }}
        fromLevel={0}
        toLevel={2}
      >
        <Body />
      </MoveGlide>,
    );
    expect(glide).toMatchObject({ fromLevel: 0, toLevel: 2 });
    const at: number[] = [glide!.progress.current];
    for (let i = 0; i < 12; i++) {
      await act(async () => renderer.advanceFrames(1, 0.03));
      at.push(glide!.progress.current);
    }
    expect(at[0]).toBe(0);
    expect(at[5]).toBeGreaterThan(0);
    expect(at[5]).toBeLessThan(1);
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
  it('raises a lifted piece and lowers it again', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Lift height={0.2}>
        <mesh />
      </Lift>,
    );
    const group = () =>
      (renderer.scene as ReactThreeTestInstance).children[0].instance as unknown as Group;
    await act(async () => renderer.advanceFrames(30, 0.03));
    expect(group().position.y).toBeGreaterThan(0.12);
    await renderer.update(
      <Lift height={0}>
        <mesh />
      </Lift>,
    );
    await act(async () => renderer.advanceFrames(40, 0.03));
    expect(group().position.y).toBe(0);
  });

  it('holds a lifted piece still, and bobs it only when asked', async () => {
    const heights = async (bob?: number) => {
      const renderer = await ReactThreeTestRenderer.create(
        <Lift height={0.2} bob={bob}>
          <mesh />
        </Lift>,
      );
      const group = (renderer.scene as ReactThreeTestInstance).children[0]
        .instance as unknown as Group;
      await act(async () => renderer.advanceFrames(40, 0.03));
      const seen: number[] = [];
      // A little over one bob (about two seconds)
      for (let i = 0; i < 70; i++) {
        await act(async () => renderer.advanceFrames(1, 0.03));
        seen.push(group.position.y);
      }
      return seen;
    };
    const still = await heights();
    expect(new Set(still)).toEqual(new Set([0.2]));
    const bobbing = await heights(SELECTION_BOB);
    expect(Math.max(...bobbing) - Math.min(...bobbing)).toBeGreaterThan(SELECTION_BOB);
    for (const y of bobbing) expect(Math.abs(y - 0.2)).toBeLessThanOrEqual(SELECTION_BOB + 1e-3);
  });

  it('keeps ON_FLOOR decoration on the floor while the piece lifts, through any scale', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Lift height={0.2}>
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

  it('fills in a design’s piece lift: no bob unless it opts in', () => {
    expect(pieceLift(undefined)).toBeNull();
    expect(pieceLift(false)).toBeNull();
    expect(pieceLift(true)).toEqual(LIFT_DEFAULTS);
    expect(LIFT_DEFAULTS.bob).toBe(0);
    expect(pieceLift({ bob: SELECTION_BOB })).toEqual({ ...LIFT_DEFAULTS, bob: SELECTION_BOB });
    expect(pieceLift({ selected: 0.3 })).toEqual({ hover: 0.08, selected: 0.3, bob: 0 });
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
        <mesh name="ring" userData={FLOOR_DECAL} />
      </Topple>
    );
    const renderer = await ReactThreeTestRenderer.create(<King down={false} />);
    const find = (name: string) =>
      (renderer.scene as ReactThreeTestInstance).find((n) => n.props.name === name)
        .instance as unknown as Mesh;
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
