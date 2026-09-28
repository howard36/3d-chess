import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, Color, DoubleSide, PlaneGeometry, ShaderMaterial } from 'three';
import type { Mesh } from 'three';
import { PieceType } from '../../../engine/pieces';
import { prefersReducedMotion } from '../../motion';
import { pieceSet, pieceTop } from '../../pieces';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import type { CaptureFxProps, CelebrationProps } from '../types';
import { FRAME, KNIGHT_YAW, MARGIN, PALETTE, PIECE_SCALE } from './palette';
import { wholePiece } from './pieces';
import { mate } from './plates';
import { hallWave } from './stage';

// --- A capture: the taken piece goes out like a lamp ------------------------------------

// As the capturing piece arrives, the one it takes dims from the crown down
// into the board, a thin line of warm light running down it at the edge of
// what is left, and is gone as the other settles. Calm, and quick.

const fadeVertex = /* glsl */ `
  varying float vY;
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vY = position.y;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const fadeFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uEdge;
  uniform float uCut;
  uniform float uFade;
  varying float vY;
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    if (vY > uCut) discard;
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(cameraPosition - vW);
    float lit = 0.55 + 0.45 * max(dot(n, normalize(vec3(-0.3, 0.8, 0.4))), 0.0);
    float rim = pow(1.0 - abs(dot(n, v)), 2.4);
    vec3 col = uColor * lit + uEdge * rim * 0.25;
    // The edge of what is left: a thin band of warm light
    float band = 1.0 - smoothstep(0.0, 0.035, uCut - vY);
    col = mix(col, uEdge, band * 0.85);
    gl_FragColor = vec4(col * uFade, 1.0);
    #include <colorspace_fragment>
  }`;

export const CaptureFx = ({ floor, victim, victimFacing, durationMs }: CaptureFxProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const [done, setDone] = useState(false);
  const top = pieceTop(pieceSet(), victim.type);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uColor: { value: new Color(victim.color === 'white' ? PALETTE.ivory : PALETTE.ebony) },
          uEdge: { value: new Color(PALETTE.lamp) },
          uCut: { value: top + 0.01 },
          uFade: { value: 1 },
        },
        vertexShader: fadeVertex,
        fragmentShader: fadeFragment,
      }),
    [victim.color, top],
  );
  useEffect(() => () => material.dispose(), [material]);
  const elapsed = useRef(0);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    if (done) return;
    elapsed.current += Math.min(delta, 1 / 20) * 1000;
    const start = durationMs * 0.35;
    const length = durationMs * 0.75;
    const t = prefersReducedMotion() ? 1 : Math.max(0, (elapsed.current - start) / length);
    const e = t * t * (3 - 2 * t);
    material.uniforms.uCut.value = (top + 0.01) * (1 - e);
    material.uniforms.uFade.value = 1 - 0.5 * e;
    if (t >= 1) setDone(true);
    else invalidate();
  });
  if (done) return null;
  const yaw =
    victim.type === PieceType.Knight
      ? (victimFacing ?? (victim.color === 'white' ? -KNIGHT_YAW : KNIGHT_YAW))
      : 0;
  return (
    <group position={floor} rotation={[0, yaw, 0]} scale={PIECE_SCALE}>
      <mesh geometry={wholePiece(victim.type)} material={material} raycast={noRaycast} />
    </group>
  );
};

// --- Mate: the hall falls quiet ------------------------------------------------------------

// When the king topples, a square of lamp light breathes out from its
// square across its board to the border, once, and a slow wave of light runs
// out through the hall's boards, as if the whole room had looked up.

const waveVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const waveFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec2 uFrom;
  uniform float uEdge;
  uniform float uT;
  varying vec2 vP;
  void main() {
    // Only on the board the king stood on
    if (max(abs(vP.x), abs(vP.y)) > uEdge) discard;
    vec2 d = abs(vP - uFrom);
    float r = max(d.x, d.y);
    float front = uT * 5.2;
    float band = exp(-pow((r - front) / 0.18, 2.0));
    float a = band * (1.0 - smoothstep(0.55, 1.0, uT)) * 0.5;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }`;

const WAVE_MS = 1600;
const HALL_WAVE_S = 3.5;

export const Celebration = ({ floor }: CelebrationProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const mesh = useRef<Mesh>(null);
  const edge = FRAME.half + MARGIN;
  const { geometry, material } = useMemo(
    () => ({
      geometry: new PlaneGeometry(edge * 2, edge * 2).rotateX(-Math.PI / 2),
      material: new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
        uniforms: {
          uColor: { value: new Color(PALETTE.lamp) },
          uFrom: { value: [floor[0], floor[2]] },
          uEdge: { value: edge },
          uT: { value: 0 },
        },
        vertexShader: waveVertex,
        fragmentShader: waveFragment,
      }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mate
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      hallWave.value = -1;
    },
    [geometry, material],
  );
  // The mated king's crown goes out (his plate's clock stops: Check's `mated`)
  useLayoutEffect(() => {
    mate.over = true;
    return () => {
      mate.over = false;
    };
  }, []);
  const elapsed = useRef(0);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    if (prefersReducedMotion()) return;
    const t = elapsed.current;
    if (t / 1000 > HALL_WAVE_S) {
      hallWave.value = -1;
      if (mesh.current) mesh.current.visible = false;
      return;
    }
    elapsed.current += Math.min(delta, 1 / 20) * 1000;
    material.uniforms.uT.value = Math.min(elapsed.current / WAVE_MS, 1);
    // The hall's wave starts once the king is down
    hallWave.value = Math.max(elapsed.current / 1000 - 0.6, -0.001);
    invalidate();
  });
  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      material={material}
      position={[0, floor[1] + 0.008, 0]}
      renderOrder={LAYER.marker - 0.2}
      raycast={noRaycast}
    />
  );
};
