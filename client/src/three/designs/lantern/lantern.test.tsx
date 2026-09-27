import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ReactThreeTestInstance } from '@react-three/test-renderer/dist/declarations/src/types/public.js';
import type { Mesh, MeshStandardMaterial, ShaderMaterial } from 'three';
import { PieceType } from '../../../engine/pieces';
import { hexToOklch } from '../kit/colors';
import type { WoodUniforms } from './pieces';
import design from './index';
import { LEVELS } from './palette';

// The embers paint a canvas sprite, which jsdom cannot draw
vi.mock('../kit/fx', () => ({ Burst: () => null }));

const meshes = (scene: ReactThreeTestInstance) =>
  scene.findAll((n) => n.type === 'Mesh').map((n) => n.instance as unknown as Mesh);

const FLOOR: [number, number, number] = [0, -0.35, 0];

describe('lantern', () => {
  it('colours its levels with five real, distinct hues', () => {
    expect(LEVELS).toHaveLength(5);
    const hues = LEVELS.map((hex) => hexToOklch(hex));
    for (const { c } of hues) expect(c).toBeGreaterThan(0.08);
    for (let i = 1; i < hues.length; i++) {
      expect(Math.abs(hues[i].h - hues[i - 1].h)).toBeGreaterThan(25);
    }
  });

  it('draws its marks flat on the paper, never taking a click', async () => {
    const { Quiet, Capture } = design.markers;
    const r = await ReactThreeTestRenderer.create(
      <>
        <Quiet floor={FLOOR} centre={[0, 0, 0]} />
        <Capture floor={FLOOR} centre={[0, 0, 0]} hovered />
      </>,
    );
    const marks = meshes(r.scene as ReactThreeTestInstance);
    expect(marks).toHaveLength(2);
    for (const m of marks) {
      expect(m.raycast.length).toBe(0);
      expect(m.rotation.x).toBeCloseTo(-Math.PI / 2);
      expect((m.material as ShaderMaterial).depthWrite).toBe(false);
    }
  });

  it('swells the selection glow and rolls one ripple out, then settles', async () => {
    const { Selection } = design.markers;
    const r = await ReactThreeTestRenderer.create(<Selection floor={FLOOR} centre={[0, 0, 0]} />);
    const [glow, , ripple] = meshes(r.scene as ReactThreeTestInstance);
    const glowU = (glow.material as ShaderMaterial).uniforms;
    const rippleU = (ripple.material as ShaderMaterial).uniforms;
    await act(async () => r.advanceFrames(6, 1 / 30));
    const radius = rippleU.uRings.value[0].x as number;
    expect(glowU.uOpacity.value).toBeGreaterThan(0.5);
    await act(async () => r.advanceFrames(60, 1 / 30));
    expect(rippleU.uRings.value[0].x).toBeGreaterThan(radius);
    // Gone once it has rolled out
    expect(rippleU.uRings.value[0].z).toBeLessThan(0.01);
  });

  it('burns a captured piece away from the foot up, like paper', async () => {
    const CaptureFx = design.CaptureFx!;
    const r = await ReactThreeTestRenderer.create(
      <CaptureFx
        orientation="white"
        floor={FLOOR}
        centre={[0, 0, 0]}
        victim={{ type: PieceType.Bishop, color: 'white' }}
        durationMs={440}
      />,
    );
    const body = meshes(r.scene as ReactThreeTestInstance).find(
      (m) => (m.material as MeshStandardMaterial).isMeshStandardMaterial,
    )!;
    const material = body.material as MeshStandardMaterial;
    const u = material.userData.uniforms as WoodUniforms;
    await act(async () => r.advanceFrames(6, 1 / 30));
    const early = u.uBurn.value;
    expect(u.uGlow.value).toBeGreaterThan(0.5);
    await act(async () => r.advanceFrames(12, 1 / 30));
    // Burnt past the top of the bishop by the time the capturer lands
    expect(u.uBurn.value).toBeGreaterThan(early);
    expect(u.uBurn.value).toBeGreaterThan(0.9);
  });
});
