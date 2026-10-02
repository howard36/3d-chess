import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, Color, DoubleSide, PlaneGeometry } from 'three';
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Group, Mesh } from 'three';
import { PieceType } from '../../engine/pieces';
import { MOVE_ANIMATION, prefersReducedMotion } from '../motion';
import { LAYER } from './layers';
import { noRaycast } from '../noRaycast';
import type { CaptureFxProps, CelebrationProps, PieceColor } from '../types';
import { FRAME, KNIGHT_YAW, LEVEL_COLORS, levelAt, MARGIN, PALETTE, PIECE_SCALE } from './palette';
import { easeOutCubic, easeOutQuad } from './ease';
import { wholePiece } from './occlusion';
import { fragmentsOf, shardRandom } from './fragments';
import type { Fragment } from './fragments';
import { overlayMaterial } from './overlay';
import { bodyMaterial } from './pieces';
import { gardenBoost } from './stage';
import { useRetireOnUnmount } from './programs';

// Motion in light, kept brief. A captured piece is hit as the attacker
// reaches it: its outline, drawn in light as the garden's sculptures are,
// flashes, and a small ring of light spreads on the glass at its foot. Then
// it is knocked over, away from the attacker, burning away from the crown
// down behind a thin edge of white light as it falls, while its outline
// rises a little from it and fades. At mate, as the king starts to fall, one
// pulse of light spreads from his foot across his own level, and the
// colossal pieces in the garden brighten for a breath and settle back.

/** A frame's step of loose time: once a glide is over, a slow frame may take up to this much. */
const LOOSE_MS = 125;

/**
 * Advances a one-shot effect on r3f's clock; returns false once it has run
 * its course. Until `tightUntil` (the piece's glide) time is clamped as the
 * glide's is; after it loosely, so what follows a landing clears in about
 * its own time even on a machine drawing a frame a second.
 */
const useLife = (lifeMs: number, step: (ms: number) => void, tightUntil = 0) => {
  const invalidate = useThree((s) => s.invalidate);
  const elapsed = useRef(0);
  const [alive, setAlive] = useState(true);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    if (!alive) return;
    const clamp = elapsed.current < tightUntil ? MOVE_ANIMATION.maxFrameMs : LOOSE_MS;
    elapsed.current += Math.min(delta * 1000, clamp);
    if (elapsed.current >= lifeMs) {
      step(lifeMs);
      invalidate();
      setAlive(false);
      return;
    }
    step(elapsed.current);
    invalidate();
  });
  return alive;
};

/** The yaw Board gives a knight of this colour (see knightFacing in Board.tsx). */
const knightYaw = (piece: PieceType, color: PieceColor, orientation: PieceColor) =>
  piece === PieceType.Knight ? (color === orientation ? 1 : -1) * (Math.PI / 2 - KNIGHT_YAW) : 0;

// --- Capture ------------------------------------------------------------------------------

export const outlineMaterial = () =>
  overlayMaterial({
    blending: AdditiveBlending,
    uniforms: { uColor: { value: new Color(PALETTE.neon) }, uOpacity: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
        gl_FragColor = vec4(uColor * (1.5 * f) * uOpacity, 1.0);
        #include <colorspace_fragment>
      }`,
  });

const CAPTURE_MS = 820;

/** The capture's tunings, by style. */
export const KNOCK = {
  /** Topple: how long the victim takes to fall as far as it goes, and how far (radians). */
  ms: 460,
  angle: 1.2,
  /** How far it slides away meanwhile (piece units). */
  slide: 0.16,
  /** Its outline's flash as it is hit. */
  flash: 0.9,
  /** The ring of light on the glass at its foot: how far it spreads, and for how long. */
  ringReach: 0.85,
  ringMs: 420,
  /** Crumble and shatter: the pull on the shards (piece units a second, squared). */
  gravity: 9,
  /** When the shards start to burn away after the hit, and how long it takes. */
  shardsBurnAt: 520,
  shardsBurnMs: 480,
  /** Sink: how deep it sinks (piece units) and how long it takes. */
  sinkDepth: 1.1,
  sinkMs: 700,
};
// The rim of the base the victim tips over on (piece units), as a king's in Topple
const PIVOT = 0.22;

/** A shard's flight: where it sets off to, how it spins, and when it lands. */
interface Flight {
  velocity: Vector3;
  axis: Vector3;
  spin: number;
  landsAt: number;
}

/**
 * How each shard leaves the hit (seconds, piece units, in the piece's own
 * frame; `forward` is the attacker's way in it): a crumble drops them where they stand,
 * spreading a little; a shatter flings them out from the middle and on
 * along the attacker's way.
 */
const flights = (shards: Fragment[], shatter: boolean, forward: Vector3): Flight[] =>
  shards.map(({ centre, below }, i) => {
    const r = (k: number) => shardRandom(i, k);
    const out = new Vector3(centre.x, 0, centre.z);
    if (out.lengthSq() < 1e-6) out.set(r(1) - 0.5, 0, r(2) - 0.5);
    out.normalize();
    const velocity = shatter
      ? out
          .multiplyScalar(0.7 + 0.9 * r(3))
          .add(forward.clone().multiplyScalar(0.9 + 0.8 * r(6)))
          .add(new Vector3(0.4 * (r(4) - 0.5), 0.9 + 1.2 * r(5), 0))
      : out.multiplyScalar(0.35 + 0.45 * r(3)).add(new Vector3(0, 0.25 * r(5), 0));
    const axis = new Vector3(r(7) - 0.5, r(8) - 0.5, r(9) - 0.5).normalize();
    const spin = (shatter ? 6 : 2.5) * (0.5 + r(10)) * (r(11) < 0.5 ? -1 : 1);
    // It lands when its lowest point reaches the glass: centre.y + vy t - g t^2 / 2 = below
    const h = centre.y - below;
    const g = KNOCK.gravity;
    const landsAt = (velocity.y + Math.sqrt(velocity.y ** 2 + 2 * g * Math.max(h, 0))) / g;
    return { velocity, axis, spin, landsAt };
  });

export const CaptureFx = ({
  floor,
  victim,
  hitMs,
  landMs,
  heading,
  victimFacing,
  orientation,
  style = 'topple',
}: CaptureFxProps) => {
  const geometry = wholePiece(victim.type);
  const level = levelAt(floor[1]);
  // The victim in its own glaze (the live piece's) until it burns
  // (its own program, the burn's: retired, never disposed, so the next
  // capture's frame links nothing; programs.ts)
  const body = useMemo(
    () => bodyMaterial(victim.color, victim.type, level, 'cut'),
    [victim.color, victim.type, level],
  );
  useRetireOnUnmount(body);
  const outline = useMemo(outlineMaterial, []);
  useRetireOnUnmount(outline);
  // The ring is mate's pulse, small (its program is warm already)
  const [fx, , fz] = floor;
  const ring = useMemo(() => pulseMaterial(fx, fz, level), [fx, fz, level]);
  useRetireOnUnmount(ring);
  const breaks = style === 'crumble' || style === 'shatter';
  const shards = useMemo(() => (breaks ? fragmentsOf(victim.type) : []), [breaks, victim.type]);
  const shardMeshes = useRef<(Mesh | null)[]>([]);
  const whole = useRef<Group>(null);
  const ghost = useRef<Group>(null);
  const aim = useRef<Group>(null);
  const tip = useRef<Group>(null);
  const pieces = useRef<Group>(null);
  const ringMesh = useRef<Mesh>(null);
  const camera = useThree((s) => s.camera);
  // Which way it goes: on along the attacker's way, or (for a blow from
  // straight above or below) to the right as seen from the camera
  const away = useMemo(() => {
    if (heading) return heading;
    const right = new Vector3(-(floor[2] - camera.position.z), 0, floor[0] - camera.position.x);
    return right.lengthSq() > 1e-9 ? ([right.x, right.z] as const) : ([1, 0] as const);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fixed when the capture arrives
  }, []);
  const yaw = Math.atan2(-away[0], -away[1]);
  const turn =
    victim.type === PieceType.Knight
      ? (victimFacing ?? knightYaw(victim.type, victim.color, orientation as PieceColor))
      : 0;
  // The piece keeps its own facing however it is aimed to fall
  const facingYaw = turn - yaw;
  const flight = useMemo(
    () =>
      flights(
        shards,
        style === 'shatter',
        new Vector3(Math.sin(facingYaw), 0, -Math.cos(facingYaw)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fixed when the capture arrives
    [shards, style],
  );
  const scratch = useMemo(
    () => ({ q: new Quaternion(), m: new Matrix4(), v: new Vector3(), p: new Vector3() }),
    [],
  );
  const lifeMs =
    style === 'topple' || style === 'burn'
      ? hitMs + CAPTURE_MS
      : style === 'sink'
        ? hitMs + KNOCK.sinkMs
        : hitMs + KNOCK.shardsBurnAt + KNOCK.shardsBurnMs;

  // The attacker is on its way: the victim stands until it is hit, and goes
  // as it is hit, in the chosen style; a ring of light spreads on the glass
  // at its foot
  const alive = useLife(
    Math.max(lifeMs, hitMs + KNOCK.ringMs),
    (ms) => {
      const since = ms - hitMs;
      const hit = since >= 0;
      const k = Math.max(since, 0) / CAPTURE_MS;
      const r = hit ? Math.min(since / KNOCK.ringMs, 1) : 0;
      ring.uniforms.uRadius.value = KNOCK.ringReach * easeOutCubic(r);
      ring.uniforms.uOpacity.value = hit && r < 1 ? Math.min(r * 20, 1) * (1 - r) ** 1.5 : 0;
      if (ringMesh.current) ringMesh.current.visible = hit && r < 1;
      let outlineOpacity = 0;

      if (style === 'topple' || style === 'burn') {
        // Burns away from the crown down; toppled, it is knocked over away
        // from the attacker as it burns, its outline flashing as it is hit
        const burn = Math.min(k / 0.65, 1);
        body.uniforms.uCut.value = hit ? burn * 1.05 : -1;
        if (whole.current) whole.current.visible = burn < 1;
        const glow = hit ? 0.45 * Math.sin(Math.PI * Math.min(k, 1)) : 0;
        outlineOpacity = glow;
        if (style === 'topple') {
          const kk = Math.min(Math.max(since, 0) / KNOCK.ms, 1);
          if (tip.current) tip.current.rotation.x = -KNOCK.angle * (0.3 * kk + 0.7 * kk * kk);
          if (aim.current) aim.current.position.z = -KNOCK.slide * easeOutQuad(kk);
          outlineOpacity = Math.max(glow, hit ? KNOCK.flash * Math.max(0, 1 - k / 0.25) : 0);
        }
        if (ghost.current) ghost.current.position.y = 0.16 * easeOutQuad(k);
      } else if (style === 'sink') {
        // Down through its square, burning from the crown as it goes
        const s = Math.min(Math.max(since, 0) / KNOCK.sinkMs, 1);
        if (aim.current) aim.current.position.y = -KNOCK.sinkDepth * s * s;
        body.uniforms.uCut.value = hit ? s * 1.05 : -1;
        if (whole.current) whole.current.visible = s < 1;
        outlineOpacity = hit ? 0.5 * (1 - s) : 0;
      } else {
        // Broken: the shards fall (or fly) and lie on the glass, then burn away
        if (whole.current) whole.current.visible = !hit;
        if (pieces.current) pieces.current.visible = hit;
        const burn = Math.min(Math.max(since - KNOCK.shardsBurnAt, 0) / KNOCK.shardsBurnMs, 1);
        body.uniforms.uCut.value = burn > 0 ? burn * 1.05 : -1;
        const t = Math.max(since, 0) / 1000;
        const { q, m, v, p } = scratch;
        shards.forEach(({ centre }, i) => {
          const mesh = shardMeshes.current[i];
          if (!mesh) return;
          const f = flight[i];
          const air = Math.min(t, f.landsAt);
          // Where its middle has gone, and how far it has turned
          p.copy(f.velocity).multiplyScalar(air);
          p.y -= 0.5 * KNOCK.gravity * air * air;
          q.setFromAxisAngle(f.axis, f.spin * air);
          v.copy(centre).applyQuaternion(q);
          m.makeRotationFromQuaternion(q);
          m.setPosition(centre.x + p.x - v.x, centre.y + p.y - v.y, centre.z + p.z - v.z);
          mesh.matrix.copy(m);
        });
      }
      outline.uniforms.uOpacity.value = outlineOpacity;
    },
    landMs,
  );
  if (!alive) return null;
  const facing: [number, number, number] = [0, facingYaw, 0];
  return (
    <>
      <group position={floor} scale={PIECE_SCALE}>
        <group rotation={[0, yaw, 0]}>
          <group ref={aim}>
            <group position={[0, 0, -PIVOT]}>
              <group ref={tip}>
                <group position={[0, 0, PIVOT]}>
                  <group ref={whole}>
                    <mesh
                      geometry={geometry}
                      material={body}
                      rotation={facing}
                      raycast={noRaycast}
                    />
                  </group>
                  {!breaks && (
                    <group ref={ghost} rotation={facing}>
                      <mesh
                        geometry={geometry}
                        material={outline}
                        renderOrder={LAYER.trace}
                        raycast={noRaycast}
                      />
                    </group>
                  )}
                </group>
              </group>
            </group>
          </group>
          {breaks && (
            <group ref={pieces} rotation={facing} visible={false}>
              {shards.map((shard, i) => (
                <mesh
                  key={i}
                  ref={(mesh) => {
                    shardMeshes.current[i] = mesh;
                  }}
                  geometry={shard.geometry}
                  material={body}
                  matrixAutoUpdate={false}
                  raycast={noRaycast}
                />
              ))}
            </group>
          )}
        </group>
      </group>
      <mesh
        ref={ringMesh}
        visible={false}
        geometry={levelPlane}
        material={ring}
        position={[0, FRAME.levelY[level] + 0.014, 0]}
        renderOrder={LAYER.marker - 0.2}
        raycast={noRaycast}
      />
    </>
  );
};

// --- Mate ---------------------------------------------------------------------------------

// One pulse of light leaves the mated king's foot as he starts to fall and
// spreads across his own level's glass: a ring growing from him, a white
// front with a glow of the level's colour behind it, at an even speed, so it takes longer from a corner than from the middle. The
// result card doesn't wait for it; it plays on behind the card. The garden's
// colossal pieces brighten for a breath with it.

const pulseFragment = /* glsl */ `
  uniform vec3 uFront;
  uniform vec3 uTint;
  uniform vec2 uFrom;
  uniform float uRadius;
  uniform float uOpacity;
  uniform float uReach;
  varying vec3 vWorld;
  void main() {
    // Only on the glass: nothing past its edge
    if (max(abs(vWorld.x), abs(vWorld.z)) > uReach) discard;
    float r = length(vWorld.xz - uFrom);
    float d = r - uRadius;
    float fw = max(fwidth(r), 1e-4);
    float line = 1.0 - smoothstep(0.012, 0.012 + fw * 1.5, abs(d));
    float halo = exp(-d * d / (0.06 * 0.06)) * 0.35;
    float wake = exp(min(d, 0.0) / 0.45) * step(d, 0.0) * 0.2;
    vec3 col = mix(uTint, uFront, clamp(line + halo, 0.0, 1.0));
    float a = (line * 0.85 + halo + wake) * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col * a, a);
    #include <colorspace_fragment>
  }`;

const pulseVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const REACH = FRAME.half + MARGIN;
const levelPlane = new PlaneGeometry(REACH * 2, REACH * 2).rotateX(-Math.PI / 2);
/** The pulse leaves this soon after the king starts to fall. */
const PULSE_DELAY_MS = 60;
/** How fast the pulse's front spreads (world units, one per square, a second). */
export const PULSE_SPEED = 4.2;

/** How far the pulse must spread from `(x, z)`: to the farthest corner of the level's glass. */
const farthestCorner = (x: number, z: number) =>
  Math.max(
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => Math.hypot(sx * REACH - x, sz * REACH - z))),
  );

/** How long the pulse from `(x, z)` lasts (seconds). */
export const pulseSeconds = (x: number, z: number) =>
  // The front reaches the far corner at 95% of the pulse's life, as it fades
  (farthestCorner(x, z) + 0.15) / PULSE_SPEED / 0.95;

/** The mate pulse's material (Celebration), from the king's foot at (x, z) on `level`. */
export const pulseMaterial = (x = 0, z = 0, level = 0) =>
  overlayMaterial({
    side: DoubleSide,
    blending: AdditiveBlending,
    uniforms: {
      uFront: { value: new Color(PALETTE.light) },
      uTint: { value: new Color(LEVEL_COLORS[level]) },
      uFrom: { value: [x, z] },
      uRadius: { value: 0 },
      uOpacity: { value: 0 },
      uReach: { value: REACH },
    },
    vertexShader: pulseVertex,
    fragmentShader: pulseFragment,
  });

/**
 * Mate: one pulse of light from the king's foot across his level as he
 * falls, and the garden's colossal pieces brighten for a breath.
 */
export const Celebration = ({ floor }: CelebrationProps) => {
  const [kx, ky, kz] = floor;
  const level = levelAt(ky);
  const material = useMemo(() => pulseMaterial(kx, kz, level), [kx, kz, level]);
  useRetireOnUnmount(material);
  useEffect(
    () => () => {
      gardenBoost.value = 0;
    },
    [],
  );
  const reach = farthestCorner(kx, kz) + 0.15;
  const lifeMs = pulseSeconds(kx, kz) * 1000;
  const still = prefersReducedMotion();
  // (With reduced motion nothing crosses the board, so it is over at once)
  const alive = useLife(PULSE_DELAY_MS + (still ? 0 : lifeMs), (ms) => {
    if (still) return;
    const x = Math.min(Math.max(ms - PULSE_DELAY_MS, 0) / lifeMs, 1);
    // An even pace, reaching the farthest corner just before it has faded
    material.uniforms.uRadius.value = reach * Math.min(x / 0.95, 1);
    material.uniforms.uOpacity.value = x > 0 ? Math.min(x * 14, 1) * (1 - x) ** 0.5 : 0;
    gardenBoost.value = 0.9 * Math.sin(Math.PI * x) ** 2;
  });
  if (!alive) return null;
  return (
    <mesh
      geometry={levelPlane}
      material={material}
      position={[0, FRAME.levelY[level] + 0.014, 0]}
      renderOrder={LAYER.marker - 0.2}
      raycast={noRaycast}
    />
  );
};
