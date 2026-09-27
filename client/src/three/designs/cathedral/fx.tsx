import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import type { Group } from 'three';
import { PieceType } from '../../../engine/pieces';
import { easeInOutCubic } from '../../motion';
import { movePoint } from '../../movePath';
import { ChessPiece } from '../../pieces';
import { Burst, Shards } from '../kit/fx';
import { LAYER } from '../kit/layers';
import { towerFrame } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';
import type { BoardLayout, CaptureFxProps, CelebrationProps, MoveFxProps, Vec3 } from '../types';
import { ALABASTER, EBONY, GILT, IVORY, LEVEL, RUBY, SUNLIGHT } from './palette';
import { accentMaterial, bodyMaterial, footMaterials } from './pieces';

// Motion: a piece glides, trailing a few motes of gilt dust that settle and
// fade; as it lands, its pane lights up in the level's colour and a ring of
// candlelight runs out across the glass. A captured piece shatters into
// shards of its own stone and chips of jewel glass. At mate a rose of light
// in every level colour blooms under the fallen king, and gilt motes rise.

const MAX_FRAME = 1 / 20;

/** The level whose platform lies nearest a height. */
const levelAt = (layout: BoardLayout, y: number) => {
  const { levelY } = towerFrame(layout);
  let best = 0;
  levelY.forEach((ly, z) => {
    if (Math.abs(ly - y) < Math.abs(levelY[best] - y)) best = z;
  });
  return best;
};

/** Runs `step(seconds since mount)` every frame until it returns false, then unmounts. */
const useTimeline = (step: (t: number) => boolean) => {
  const invalidate = useThree((s) => s.invalidate);
  const [done, setDone] = useState(false);
  const t = useRef(0);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    if (done) return;
    t.current += Math.min(delta, MAX_FRAME);
    if (step(t.current)) invalidate();
    else setDone(true);
  });
  return done;
};

// --- A ring of light on the glass ---------------------------------------------------

const rippleFragment = /* glsl */ `
  uniform vec3 uRing;
  uniform vec3 uPane;
  uniform float uRadius;
  uniform float uRingAlpha;
  uniform float uPaneAlpha;
  uniform float uWidth;
  varying vec2 vP;
  void main() {
    float r = length(vP);
    float x = (r - uRadius) / uWidth;
    float ring = exp(-x * x) * uRingAlpha;
    vec2 q = abs(vP) - vec2(0.4);
    float box = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.06;
    float pane = (1.0 - smoothstep(-0.28, 0.02, box)) * uPaneAlpha;
    vec3 col = uRing * ring + uPane * pane;
    float a = ring + pane;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;

const quadVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = uv - 0.5;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const unitQuad = new PlaneGeometry(1, 1);

/**
 * Light running out across a pane: its glass glowing in `pane` while a ring
 * of `ring` spreads from the centre. Starts after `delay` seconds and lasts
 * `life`.
 */
const Ripple = ({
  floor,
  pitch,
  ring,
  pane,
  delay = 0,
  life = 0.55,
  reach = 0.62,
}: {
  floor: Vec3;
  pitch: number;
  ring: string;
  pane: string;
  delay?: number;
  life?: number;
  reach?: number;
}) => {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        uniforms: {
          uRing: { value: new Color(ring) },
          uPane: { value: new Color(pane) },
          uRadius: { value: 0 },
          uRingAlpha: { value: 0 },
          uPaneAlpha: { value: 0 },
          uWidth: { value: 0.03 },
        },
        vertexShader: quadVertex,
        fragmentShader: rippleFragment,
      }),
    [ring, pane],
  );
  useEffect(() => () => material.dispose(), [material]);
  const size = pitch * 1.6;
  const done = useTimeline((t) => {
    const k = (t - delay) / life;
    const u = material.uniforms;
    if (k < 0) return true;
    const e = 1 - (1 - Math.min(k, 1)) ** 3;
    u.uRadius.value = (0.12 + (reach - 0.12) * e) / 1.6;
    u.uWidth.value = (0.035 + 0.05 * e) / 1.6;
    u.uRingAlpha.value = 0.9 * (1 - Math.min(k, 1)) ** 1.5;
    u.uPaneAlpha.value = 0.55 * Math.max(0, 1 - k * 1.1) ** 2;
    return k < 1;
  });
  if (done) return null;
  return (
    <mesh
      geometry={unitQuad}
      material={material}
      position={[floor[0], floor[1] + 0.01, floor[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={[size, size, 1]}
      renderOrder={LAYER.marker + 0.5}
      raycast={noRaycast}
    />
  );
};

// --- Gilt dust behind a gliding piece ---------------------------------------------

const dustVertex = /* glsl */ `
  uniform float uT;
  uniform float uLife;
  uniform float uScale;
  attribute float aBorn;
  attribute vec3 aDrift;
  varying float vAlpha;
  void main() {
    float age = uT - aBorn;
    float k = clamp(age / uLife, 0.0, 1.0);
    vAlpha = age < 0.0 ? 0.0 : (1.0 - k) * (1.0 - k) * smoothstep(0.0, 0.06, age);
    vec3 p = position + aDrift * age;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = 0.05 * (1.0 - 0.5 * k) * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const dustFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }`;

const DUST = 26;

const Dust = ({
  from,
  to,
  arc,
  durationMs,
  lift,
}: {
  from: Vec3;
  to: Vec3;
  arc: number;
  durationMs: number;
  lift: number;
}) => {
  const duration = durationMs / 1000;
  const life = 0.6;
  const { geometry, material } = useMemo(() => {
    const random = rng(5);
    const pos = new Float32Array(DUST * 3);
    const born = new Float32Array(DUST);
    const drift = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i++) {
      const k = (i + random() * 0.8) / DUST;
      const p = movePoint(from, to, easeInOutCubic(k * 0.92), arc);
      pos.set(
        [
          p[0] + (random() - 0.5) * 0.14,
          p[1] + lift * (0.25 + random() * 0.9),
          p[2] + (random() - 0.5) * 0.14,
        ],
        i * 3,
      );
      born[i] = k * duration * 0.92;
      drift.set([(random() - 0.5) * 0.12, 0.05 + random() * 0.12, (random() - 0.5) * 0.12], i * 3);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    geometry.setAttribute('aBorn', new BufferAttribute(born, 1));
    geometry.setAttribute('aDrift', new BufferAttribute(drift, 3));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uT: { value: 0 },
        uLife: { value: life },
        uScale: { value: 400 },
        uColor: { value: new Color(SUNLIGHT) },
      },
      vertexShader: dustVertex,
      fragmentShader: dustFragment,
    });
    return { geometry, material };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a trail is laid once per move
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const done = useTimeline((t) => {
    material.uniforms.uT.value = t;
    material.uniforms.uScale.value = (size.height * dpr) / (2 * Math.tan((36 * Math.PI) / 360));
    return t < duration + life;
  });
  if (done) return null;
  return (
    <points
      geometry={geometry}
      material={material}
      renderOrder={LAYER.trace + 0.7}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

/** The glide's company: gilt dust behind the piece, and light across its pane as it lands. */
export const makeMoveFx = (layout: BoardLayout, pieceScale: number) => {
  const { pitch } = towerFrame(layout);
  const MoveFx = ({ from, to, durationMs, arc = 0 }: MoveFxProps) => {
    const floorFrom: Vec3 = [from[0], from[1] + layout.floorY, from[2]];
    const floorTo: Vec3 = [to[0], to[1] + layout.floorY, to[2]];
    const level = levelAt(layout, floorTo[1]);
    return (
      <>
        <Dust
          from={floorFrom}
          to={floorTo}
          arc={arc}
          durationMs={durationMs}
          lift={0.35 * pieceScale}
        />
        <Ripple
          floor={floorTo}
          pitch={pitch}
          ring={IVORY}
          pane={LEVEL[level]}
          delay={(durationMs / 1000) * 0.92}
        />
      </>
    );
  };
  return MoveFx;
};

// --- Capture: the victim shatters -----------------------------------------------------

const shardGeometry = (() => {
  // A sliver of glass or stone: a thin, sharp triangle
  const g = new BufferGeometry();
  g.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([0, 0.07, 0, -0.03, -0.035, 0.008, 0.035, -0.03, -0.008]),
      3,
    ),
  );
  g.computeVertexNormals();
  return g;
})();

const shardMaterial = new MeshStandardMaterial({
  color: '#ffffff',
  roughness: 0.3,
  metalness: 0.1,
  side: DoubleSide,
  emissive: '#1a0c06',
});

/**
 * The captured piece stands until the attacker reaches it, then bursts into
 * shards of its own stone mixed with chips of ruby and of its level's glass,
 * with a flash of ruby light across the pane.
 */
export const makeCaptureFx = (layout: BoardLayout, pieceScale: number) => {
  const { pitch } = towerFrame(layout);
  const CaptureFx = ({ floor, victim, victimFacing, durationMs }: CaptureFxProps) => {
    const group = useRef<Group>(null);
    const level = levelAt(layout, floor[1]);
    const impact = (durationMs / 1000) * 0.88;
    const [broken, setBroken] = useState(false);
    const done = useTimeline((t) => {
      const g = group.current;
      if (g && !broken) {
        // A shiver just before it breaks
        const k = Math.max(0, (t - impact + 0.12) / 0.12);
        g.rotation.z = Math.sin(t * 90) * 0.02 * k;
      }
      if (t >= impact && !broken) setBroken(true);
      return t < impact + 1.2;
    });
    const stone = victim.color === 'white' ? ALABASTER : EBONY;
    const colors = useMemo(
      () => [stone, stone, stone, LEVEL[level], RUBY, stone, LEVEL[level], stone],
      [stone, level],
    );
    if (done) return null;
    const centre: Vec3 = [floor[0], floor[1] + 0.3 * pieceScale, floor[2]];
    return (
      <>
        {!broken && (
          <group ref={group} position={floor} scale={pieceScale}>
            <group rotation={[0, victim.type === PieceType.Knight ? (victimFacing ?? 0) : 0, 0]}>
              <ChessPiece
                type={victim.type}
                parts={{
                  body: bodyMaterial(victim.color),
                  accent: accentMaterial(victim.type, victim.color),
                  foot: footMaterials[level],
                }}
              />
            </group>
          </group>
        )}
        {broken && (
          <>
            <Shards
              position={centre}
              geometry={shardGeometry}
              material={shardMaterial}
              colors={colors}
              count={40}
              speed={2.4}
              gravity={5}
              lifeMs={900}
              spin={9}
              upward={0.55}
              spread={0.2}
              scale={1.5}
              seed={9}
            />
            <Burst
              position={centre}
              colors={[RUBY, GILT, LEVEL[level]]}
              count={26}
              speed={1.6}
              gravity={1.5}
              lifeMs={650}
              size={0.07}
              upward={0.4}
            />
            <Ripple floor={floor} pitch={pitch} ring={RUBY} pane={RUBY} life={0.6} reach={0.7} />
          </>
        )}
      </>
    );
  };
  return CaptureFx;
};

// --- Mate: a rose of light under the fallen king -----------------------------------

const bloomFragment = /* glsl */ `
  uniform vec3 uColors[5];
  uniform vec3 uGold;
  uniform float uGrow;
  uniform float uAlpha;
  varying vec2 vP;
  void main() {
    vec2 p = vP * 2.0 / max(uGrow, 0.001);
    float r = length(p);
    float ang = atan(p.y, p.x);
    // Ten petals round a gilt ring, each in a level's colour
    float seg = 6.2831853 / 10.0;
    float i = floor((ang + 3.14159265) / seg);
    float phi = mod(ang + 3.14159265, seg) / seg - 0.5;
    float petalR = 0.55 + 0.4 * sqrt(max(0.0, 1.0 - 4.0 * phi * phi));
    float petal = (1.0 - smoothstep(petalR - 0.03, petalR, r)) * smoothstep(0.32, 0.36, r);
    int k = int(mod(i, 5.0));
    vec3 c = uColors[0];
    if (k == 1) c = uColors[1];
    if (k == 2) c = uColors[2];
    if (k == 3) c = uColors[3];
    if (k == 4) c = uColors[4];
    float edge = abs(r - petalR) < 0.03 ? 1.0 : 0.0;
    float x = (r - 0.34) / 0.02;
    float ring = exp(-x * x);
    vec3 col = c * petal * 0.95 + uGold * ring * 1.2;
    float a = (petal * 0.6 + ring * 0.9) * uAlpha;
    col += uGold * edge * petal * 0.2;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;

/** The mate: a rose of light in the five level colours blooms under the fallen king, gilt motes rising. */
export const makeCelebration = (layout: BoardLayout) => {
  const { pitch } = towerFrame(layout);
  const Celebration = ({ floor }: CelebrationProps) => {
    const invalidate = useThree((s) => s.invalidate);
    const material = useMemo(
      () =>
        new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          side: DoubleSide,
          uniforms: {
            uColors: { value: LEVEL.map((c) => new Color(c)) },
            uGold: { value: new Color(GILT) },
            uGrow: { value: 0 },
            uAlpha: { value: 0 },
          },
          vertexShader: quadVertex,
          fragmentShader: bloomFragment,
        }),
      [],
    );
    useEffect(() => () => material.dispose(), [material]);
    const t = useRef(0);
    useEffect(() => invalidate(), [invalidate]);
    useFrame((_, delta) => {
      if (t.current > 1.4) return;
      t.current += Math.min(delta, MAX_FRAME);
      const k = Math.min(t.current / 1.1, 1);
      const e = 1 - (1 - k) ** 3;
      material.uniforms.uGrow.value = e;
      // Blooms bright, then settles to a quiet glow that stays
      material.uniforms.uAlpha.value = 0.55 + 0.45 * Math.sin(Math.min(k, 1) * Math.PI);
      invalidate();
    });
    const size = pitch * 2.6;
    return (
      <>
        <mesh
          geometry={unitQuad}
          material={material}
          position={[floor[0], floor[1] + 0.012, floor[2]]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[size, size, 1]}
          renderOrder={LAYER.marker + 0.6}
          raycast={noRaycast}
        />
        <Burst
          position={[floor[0], floor[1] + 0.1, floor[2]]}
          colors={[GILT, SUNLIGHT, IVORY]}
          count={44}
          speed={1.1}
          gravity={-0.5}
          lifeMs={1600}
          size={0.07}
          upward={0.85}
          delayMs={250}
        />
      </>
    );
  };
  return Celebration;
};
