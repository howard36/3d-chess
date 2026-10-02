import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, Color, DoubleSide, PlaneGeometry } from 'three';
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Group, Mesh } from 'three';
import { PieceType } from '../../engine/pieces';
import { MOVE_ANIMATION, prefersReducedMotion } from '../motion';
import { LAYER } from './layers';
import { noRaycast } from '../noRaycast';
import type { CaptureFxProps, CelebrationProps, PieceColor, Vec3 } from '../types';
import { FRAME, KNIGHT_YAW, LEVEL_COLORS, levelAt, MARGIN, PALETTE, PIECE_SCALE } from './palette';
import { easeOutCubic, easeOutQuad } from './ease';
import { wholePiece } from './occlusion';
import { fragmentsOf, shardRandom } from './fragments';
import type { Fragment } from './fragments';
import { toppled } from '../toppled';
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

/** The hit: the victim knocked over away from the attacker, and a ring on the glass. */
export const KNOCK = {
  /** How long it takes to fall as far as it goes, and how far (radians). */
  ms: 460,
  angle: 1.2,
  /** How far it slides away meanwhile (piece units). */
  slide: 0.16,
  /** Its outline's flash as it is hit. */
  flash: 0.9,
  /** The ring of light on the glass at its foot: how far it spreads, and for how long. */
  ringReach: 0.85,
  ringMs: 420,
};
// The rim of the base the victim tips over on (piece units), as a king's in Topple
const PIVOT = 0.22;

export const CaptureFx = ({
  floor,
  victim,
  hitMs,
  landMs,
  heading,
  victimFacing,
  orientation,
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
  const whole = useRef<Group>(null);
  const ghost = useRef<Group>(null);
  const aim = useRef<Group>(null);
  const tip = useRef<Group>(null);
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
  // The attacker is on its way: the victim stands until it is hit, then its
  // outline flashes, a ring of light spreads on the glass at its foot, and
  // it is knocked over away from the attacker, burning away as it falls
  const alive = useLife(
    Math.max(hitMs + CAPTURE_MS, hitMs + KNOCK.ringMs),
    (ms) => {
      const since = ms - hitMs;
      const hit = since >= 0;
      const k = Math.max(since, 0) / CAPTURE_MS;
      const burn = Math.min(k / 0.65, 1);
      body.uniforms.uCut.value = hit ? burn * 1.05 : -1;
      if (whole.current) whole.current.visible = burn < 1;
      // Knocked over: falling faster as it goes, sliding away
      const kk = Math.min(Math.max(since, 0) / KNOCK.ms, 1);
      if (tip.current) tip.current.rotation.x = -KNOCK.angle * (0.3 * kk + 0.7 * kk * kk);
      if (aim.current) aim.current.position.z = -KNOCK.slide * easeOutQuad(kk);
      // Its outline in light flashes as it is hit, then rises a little from it and fades
      const glow = hit ? 0.45 * Math.sin(Math.PI * Math.min(k, 1)) : 0;
      const flash = hit ? KNOCK.flash * Math.max(0, 1 - k / 0.25) : 0;
      outline.uniforms.uOpacity.value = Math.max(glow, flash);
      if (ghost.current) ghost.current.position.y = 0.16 * easeOutQuad(k);
      // The ring spreads from its foot from the moment it is hit
      const r = hit ? Math.min(since / KNOCK.ringMs, 1) : 0;
      ring.uniforms.uRadius.value = KNOCK.ringReach * easeOutCubic(r);
      ring.uniforms.uOpacity.value = hit && r < 1 ? Math.min(r * 20, 1) * (1 - r) ** 1.5 : 0;
      if (ringMesh.current) ringMesh.current.visible = hit && r < 1;
    },
    landMs,
  );
  if (!alive) return null;
  const turn =
    victim.type === PieceType.Knight
      ? (victimFacing ?? knightYaw(victim.type, victim.color, orientation as PieceColor))
      : 0;
  // (the piece keeps its own facing however it is aimed to fall)
  const facing: [number, number, number] = [0, turn - yaw, 0];
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
                  <group ref={ghost} rotation={facing}>
                    <mesh
                      geometry={geometry}
                      material={outline}
                      renderOrder={LAYER.trace}
                      raycast={noRaycast}
                    />
                  </group>
                </group>
              </group>
            </group>
          </group>
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
export const Celebration = ({ floor, delayMs = 0 }: CelebrationProps) => {
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
  const wait = PULSE_DELAY_MS + delayMs;
  const alive = useLife(wait + (still ? 0 : lifeMs), (ms) => {
    if (still) return;
    const x = Math.min(Math.max(ms - wait, 0) / lifeMs, 1);
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

// --- A shattering king ----------------------------------------------------------------------

/** The shattered king: his teeter before he breaks, and the pull on his shards. */
export const SHATTER = {
  /** The teeter's highest rock (radians) and how many rocks. */
  rock: 0.12,
  rocks: 3,
  gravity: 9,
  /** His outline's flash as he breaks. */
  flash: 1,
  flashMs: 260,
};

/** How each shard leaves the break (piece units, seconds): out from the middle, up, and down onto the glass. */
const burst = (shards: Fragment[]) =>
  shards.map(({ centre, below }, i) => {
    const r = (k: number) => shardRandom(i, k);
    const out = new Vector3(centre.x, 0, centre.z);
    if (out.lengthSq() < 1e-6) out.set(r(1) - 0.5, 0, r(2) - 0.5);
    out.normalize().multiplyScalar(0.6 + 1.1 * r(3));
    const velocity = out.add(new Vector3(0, 0.6 + 1.4 * r(5), 0));
    const axis = new Vector3(r(7) - 0.5, r(8) - 0.5, r(9) - 0.5).normalize();
    const spin = 5 * (0.5 + r(10)) * (r(11) < 0.5 ? -1 : 1);
    const h = Math.max(centre.y - below, 0);
    const g = SHATTER.gravity;
    const landsAt = (velocity.y + Math.sqrt(velocity.y ** 2 + 2 * g * h)) / g;
    return { velocity, axis, spin, landsAt };
  });

/**
 * A mated king who breaks rather than falls: he rocks on his foot, each
 * rock wider, for `delayMs`, then flashes and bursts into shards that come
 * down round him on the glass, where they stay. From history (`live`
 * false), or with reduced motion, the shards are simply lying there.
 */
export const KingShatter = ({
  floor,
  color,
  delayMs,
  live,
}: {
  floor: Vec3;
  color: PieceColor;
  delayMs: number;
  live: boolean;
}) => {
  const level = levelAt(floor[1]);
  const body = useMemo(() => bodyMaterial(color, PieceType.King, level, 'cut'), [color, level]);
  useRetireOnUnmount(body);
  const outline = useMemo(outlineMaterial, []);
  useRetireOnUnmount(outline);
  const shards = useMemo(() => fragmentsOf(PieceType.King), []);
  const flight = useMemo(() => burst(shards), [shards]);
  const whole = useRef<Group>(null);
  const rock = useRef<Group>(null);
  const pieces = useRef<Group>(null);
  const shardMeshes = useRef<(Mesh | null)[]>([]);
  const broke = useRef(false);
  const scratch = useMemo(
    () => ({ q: new Quaternion(), m: new Matrix4(), v: new Vector3(), p: new Vector3() }),
    [],
  );
  const settled = !live || prefersReducedMotion();
  const restMs = delayMs + 1000 * Math.max(...flight.map((f) => f.landsAt)) + 50;
  const place = (ms: number) => {
    const since = ms - delayMs;
    if (since < 0) {
      // Rocking on his foot, each time wider
      const v = ms / delayMs;
      if (rock.current)
        rock.current.rotation.z = SHATTER.rock * v * Math.sin(Math.PI * SHATTER.rocks * v);
      return;
    }
    if (!broke.current) {
      broke.current = true;
      if (whole.current) whole.current.visible = false;
      if (pieces.current) pieces.current.visible = true;
      // His fall is over (the result card waits for it)
      if (live) toppled();
    }
    outline.uniforms.uOpacity.value = SHATTER.flash * Math.max(0, 1 - since / SHATTER.flashMs);
    const t = since / 1000;
    const { q, m, v, p } = scratch;
    shards.forEach(({ centre }, i) => {
      const mesh = shardMeshes.current[i];
      if (!mesh) return;
      const f = flight[i];
      const air = Math.min(t, f.landsAt);
      p.copy(f.velocity).multiplyScalar(air);
      p.y -= 0.5 * SHATTER.gravity * air * air;
      q.setFromAxisAngle(f.axis, f.spin * air);
      v.copy(centre).applyQuaternion(q);
      m.makeRotationFromQuaternion(q);
      m.setPosition(centre.x + p.x - v.x, centre.y + p.y - v.y, centre.z + p.z - v.z);
      mesh.matrix.copy(m);
    });
  };
  // Runs its course, then leaves the shards where they lie (no more frames)
  useLife(settled ? 0 : restMs, (ms) => place(settled ? restMs : ms), restMs);
  useLayoutEffect(() => {
    if (settled) place(restMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);
  return (
    <group position={floor} scale={PIECE_SCALE}>
      <group ref={rock}>
        <group ref={whole}>
          <mesh geometry={wholePiece(PieceType.King)} material={body} raycast={noRaycast} />
          <mesh
            geometry={wholePiece(PieceType.King)}
            material={outline}
            renderOrder={LAYER.trace}
            raycast={noRaycast}
          />
        </group>
      </group>
      <group ref={pieces} visible={false}>
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
    </group>
  );
};
