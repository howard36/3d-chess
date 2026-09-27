import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  MeshStandardMaterial,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type { Group } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LAYER } from '../kit/layers';
import { LastMoveLine } from '../kit/line';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { BRASS, BRASS_DEEP, LEVELS, ROPE, ROPE_DEEP, SPOT, WIRE, WIRE_GLINT } from './palette';
import { SPOTLIGHT } from './pieces';

// Gallery's marks, in the language of a museum floor:
//
// - Where a piece may go: a brass inlay ring set into the glass, a finer
//   ring inside it, and a soft pool of warm light, as a lit spot awaiting
//   its exhibit.
// - A capture: the same brass ring, circled by a twisted crimson velvet rope
//   round the piece to be taken.
// - The selection: a framing projector strikes up over the piece (a square
//   beam of light with dust motes turning in it, cut to a square of light on
//   the glass: square, so it is never taken for a round move mark), and the
//   piece turns slowly on its plinth (pieces.tsx).
// - The last move: a platinum hanging wire, thin and taut, from the centre
//   of the square the piece left (marked by a dotted ring, the outline of
//   where it stood) to the one it reached (a fine platinum ring round it).
// - Check: a small barrier of brass stanchions and red rope rises round the
//   king: do not touch. Calm and still once it stands.
//
// Every flat mark is one quad shaded by a signed distance, crisp at any
// angle, drawn after the glass so it reads through the levels above.

export const makeMarkers = (pitch: number, moveMs: number, levelY: number[]) => {
  /** The level whose platform a floor point lies on. */
  const levelAt = (y: number) =>
    levelY.reduce((best, ly, z) => (Math.abs(ly - y) < Math.abs(levelY[best] - y) ? z : best), 0);

  // --- Flat marks ------------------------------------------------------------------

  const vertex = /* glsl */ `
    varying vec2 vP;
    uniform float uQuad;
    void main() {
      vP = (uv - 0.5) * uQuad;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;

  const fragment = /* glsl */ `
    #define TAU 6.28318530718
    uniform int uKind;
    uniform vec3 uColor;
    uniform vec3 uColor2;
    uniform vec3 uColor3;
    uniform float uRadius;
    uniform float uWidth;
    uniform float uOpacity;
    uniform float uFill;
    uniform float uHover;
    uniform float uDots;
    uniform float uReveal;
    varying vec2 vP;

    float band(float d, float w) {
      float s = abs(d) - w * 0.5;
      float aa = max(fwidth(s), 1e-4);
      return 1.0 - smoothstep(-aa, aa, s);
    }

    void main() {
      float r = length(vP);
      float ang = atan(vP.y, vP.x);
      // Draw-in: the stroke sweeps round from the side nearest the viewer
      float sweep = fract(ang / TAU + 0.25);
      float revealed = 1.0 - smoothstep(uReveal - 0.02, uReveal, sweep);
      vec3 col = uColor;
      float a = 0.0;
      if (uKind == 0) {
        // Brass inlay ring, a finer ring inside it in the colour of the level
        // the mark lies on, and a pool of warm light
        float w = uWidth * (1.0 + 0.45 * uHover);
        float ring = band(r - uRadius, w);
        float inner = band(r - uRadius * 0.72, uWidth * 0.62) * 0.9;
        // The ring's metal: a bright line along its middle, deeper at its edges
        float core = band(r - uRadius, w * 0.35);
        vec3 brass = mix(uColor2, uColor, 0.55 + 0.45 * core);
        brass = mix(brass, vec3(1.0, 0.96, 0.86), 0.25 * core);
        vec3 stroke = (brass * ring + uColor3 * inner) / max(ring + inner, 1e-4);
        float strokeA = max(ring, inner);
        float pool = exp(-r * r / (uRadius * uRadius * 0.45)) * (uFill + 0.5 * uHover);
        a = max(strokeA * uOpacity * (1.0 + 0.3 * uHover), pool);
        col = mix(uColor * 1.15, stroke, clamp(strokeA * 2.0, 0.0, 1.0));
        col *= 1.0 + 0.35 * uHover;
      } else if (uKind == 1) {
        // Twisted velvet rope: strands on a slant round the ring
        float d = r - uRadius;
        float w = uWidth * (1.0 + 0.2 * uHover);
        float ring = band(d, w);
        float twist = fract(ang / TAU * uDots + d / w * 0.9);
        float strand = smoothstep(0.0, 0.18, twist) * smoothstep(1.0, 0.55, twist);
        // Round across the rope: lit along the top, shadowed at the edges
        float round = 1.0 - pow(abs(d) / (w * 0.5), 2.0);
        col = mix(uColor2, uColor, strand * (0.55 + 0.45 * clamp(round, 0.0, 1.0)));
        col *= 1.0 + 0.3 * uHover;
        a = ring * uOpacity + (1.0 - smoothstep(uRadius - w, uRadius, r)) * uFill;
      } else if (uKind == 2) {
        // A platinum wire ring, solid or dotted
        float ring = band(r - uRadius, uWidth);
        if (uDots > 0.0) {
          float t = fract(ang / TAU * uDots);
          float arcLen = TAU * uRadius / uDots;
          float dd = abs(t - 0.5) * arcLen;
          float aa = max(fwidth(dd), 1e-4);
          ring = band(r - uRadius, uWidth * 1.5) * (1.0 - smoothstep(uWidth * 0.8 - aa, uWidth * 0.8 + aa, dd));
        }
        a = ring * uOpacity + exp(-r * r / (uRadius * uRadius * 0.5)) * uFill;
      } else {
        // A framing projector's light on the glass: a square of light cut to
        // the square, soft inside, with a crisp shuttered edge
        vec2 q = abs(vP) - vec2(uRadius - 0.06);
        float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.06;
        float edge = 1.0 - smoothstep(-uWidth, 0.0, d);
        float body = edge * (0.5 + 0.5 * exp(-r * r / (uRadius * uRadius * 0.5)));
        float rim = band(d + uWidth * 0.5, uWidth * 0.6);
        a = (body * uFill + rim * uOpacity);
      }
      a *= revealed;
      if (a < 0.003) discard;
      gl_FragColor = vec4(col, min(a, 1.0));
      #include <colorspace_fragment>
    }`;

  const KIND = { pool: 0, rope: 1, wire: 2, spot: 3 } as const;

  interface MarkStyle {
    kind: keyof typeof KIND;
    color: string;
    color2?: string;
    /** The level's colour, for the brass ring's fine inner ring. */
    color3?: string;
    radius: number;
    width: number;
    opacity?: number;
    fill?: number;
    hovered?: boolean;
    dots?: number;
    additive?: boolean;
    /** Sweep the mark in over this long when it mounts, after `delayMs`. */
    drawMs?: number;
    delayMs?: number;
    /** Scales the whole mark's opacity (e.g. the spotlight's strike). */
    intensity?: { value: number };
    lift?: number;
  }

  const planes = new Map<number, PlaneGeometry>();
  const planeFor = (size: number) => {
    let g = planes.get(size);
    if (!g) {
      g = new PlaneGeometry(size, size);
      planes.set(size, g);
    }
    return g;
  };

  const Mark = ({
    floor,
    kind,
    color,
    color2,
    color3,
    radius,
    width,
    opacity = 0.9,
    fill = 0,
    hovered = false,
    dots = 0,
    additive = false,
    drawMs = 0,
    delayMs = 0,
    intensity,
    lift = 0.012,
  }: MarkStyle & { floor: Vec3 }) => {
    const invalidate = useThree((s) => s.invalidate);
    const quad = Math.ceil((radius + width) * 2.3 * 100) / 100;
    const material = useMemo(
      () =>
        new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
          blending: additive ? AdditiveBlending : NormalBlending,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          uniforms: {
            uKind: { value: KIND[kind] },
            uColor: { value: new Color(color) },
            uColor2: { value: new Color(color2 ?? color) },
            uColor3: { value: new Color(color3 ?? color) },
            uRadius: { value: radius },
            uWidth: { value: width },
            uOpacity: { value: opacity },
            uFill: { value: fill },
            uHover: { value: 0 },
            uDots: { value: dots },
            uReveal: { value: drawMs > 0 ? 0 : 1.05 },
            uQuad: { value: quad },
          },
          vertexShader: vertex,
          fragmentShader: fragment,
        }),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- built once per mark
      [],
    );
    useEffect(() => () => material.dispose(), [material]);
    const u = material.uniforms;
    u.uHover.value = hovered ? 1 : 0;
    u.uOpacity.value = opacity;
    u.uFill.value = fill;
    const elapsed = useRef(-delayMs);
    useFrame((_, delta) => {
      if (intensity) {
        u.uOpacity.value = opacity * intensity.value;
        u.uFill.value = fill * intensity.value;
      }
      if (u.uReveal.value >= 1.05) return;
      elapsed.current += Math.min(delta, 1 / 20) * 1000;
      const t = Math.max(0, elapsed.current) / drawMs;
      u.uReveal.value = t >= 1 ? 1.05 : 1 - (1 - t) ** 3;
      invalidate();
    });
    return (
      <mesh
        geometry={planeFor(quad)}
        material={material}
        position={[floor[0], floor[1] + lift, floor[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={LAYER.marker}
        raycast={noRaycast}
      />
    );
  };

  // --- Destinations ----------------------------------------------------------------

  const RING = 0.34 * pitch;
  const RING_W = 0.04 * pitch;
  const ROPE_R = 0.455 * pitch;
  const ROPE_W = 0.058 * pitch;

  const Quiet = ({ floor, hovered }: MarkerProps) => (
    <Mark
      floor={floor}
      kind="pool"
      color={BRASS}
      color2={BRASS_DEEP}
      color3={LEVELS[levelAt(floor[1])]}
      radius={RING}
      width={RING_W}
      opacity={0.95}
      fill={0.16}
      hovered={hovered}
    />
  );

  const Capture = ({ floor, hovered }: MarkerProps) => (
    <>
      <Mark
        floor={floor}
        kind="pool"
        color={BRASS}
        color2={BRASS_DEEP}
        color3={LEVELS[levelAt(floor[1])]}
        radius={RING + 0.02 * pitch}
        width={RING_W}
        opacity={0.95}
        fill={0.08}
        hovered={hovered}
      />
      <Mark
        floor={floor}
        kind="rope"
        color={ROPE}
        color2={ROPE_DEEP}
        radius={ROPE_R}
        width={ROPE_W}
        opacity={1}
        fill={0.07}
        dots={26}
        hovered={hovered}
      />
    </>
  );

  // --- The selection: a framing projector strikes up ------------------------------

  // A framing projector's beam: a square pyramid of light from high above,
  // cut to the square the piece stands on
  const CONE_H = 1.22 * pitch;
  const CONE_R = 0.43 * pitch;
  const cone = new CylinderGeometry(
    0.05 * pitch * Math.SQRT2,
    CONE_R * Math.SQRT2,
    CONE_H,
    4,
    1,
    true,
  )
    .rotateY(Math.PI / 4)
    .translate(0, CONE_H / 2, 0);
  const coneMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    uniforms: { uColor: { value: new Color(SPOT) }, uI: SPOTLIGHT },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vFacing;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vFacing = abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uI;
      varying vec2 vUv;
      varying float vFacing;
      void main() {
        float v = vUv.y;
        // Brightest low in the beam, fading away up toward its far source
        // The beam starts above the tallest piece, so it never lies over the
        // selected piece's body; below that, the square of light on the glass
        // and the motes carry it down
        float along = smoothstep(1.0, 0.86, v) * (0.45 + 0.55 * v) * smoothstep(0.6, 0.75, v);
        float a = 0.075 * along * pow(vFacing, 1.4) * uI;
        gl_FragColor = vec4(uColor * a, 1.0);
        #include <colorspace_fragment>
      }`,
  });

  const MOTES = 26;
  const moteGeometry = (() => {
    const random = rng(41);
    const g = new BufferGeometry();
    const seed = new Float32Array(MOTES * 4);
    for (let i = 0; i < MOTES; i++) {
      seed[i * 4] = random();
      seed[i * 4 + 1] = random();
      seed[i * 4 + 2] = random();
      seed[i * 4 + 3] = random();
    }
    g.setAttribute('position', new BufferAttribute(new Float32Array(MOTES * 3), 3));
    g.setAttribute('aSeed', new BufferAttribute(seed, 4));
    g.boundingSphere = null;
    return g;
  })();
  const moteClock = { value: 0 };
  const moteMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: moteClock,
      uI: SPOTLIGHT,
      uH: { value: CONE_H },
      uR: { value: CONE_R },
      uTop: { value: 0.06 * pitch },
      uColor: { value: new Color('#fff1d0') },
      uScale: { value: 1 },
      uFade: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime;
      uniform float uH;
      uniform float uR;
      uniform float uTop;
      uniform float uScale;
      varying float vGlint;
      void main() {
        // Each mote drifts slowly down and round the beam, wrapping at the floor
        float y = fract(aSeed.x - uTime * (0.012 + 0.02 * aSeed.w)) * 0.9 + 0.05;
        float radius = mix(uR, uTop, y) * 0.85 * sqrt(aSeed.y);
        float ang = aSeed.z * 6.2831 + uTime * (0.08 + 0.1 * aSeed.w) * (aSeed.w > 0.5 ? 1.0 : -1.0);
        vec3 p = vec3(cos(ang) * radius, y * uH, sin(ang) * radius);
        p.x += 0.015 * sin(uTime * 0.7 + aSeed.z * 20.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // A mote glints as it turns through the light
        vGlint = (0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * (1.3 + aSeed.w) + aSeed.x * 30.0), 3.0))
          * smoothstep(1.0, 0.7, y) * smoothstep(0.0, 0.12, y);
        gl_PointSize = uScale * (0.9 + 1.2 * aSeed.w) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uI;
      uniform float uFade;
      varying float vGlint;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(c)) * vGlint * uI * uFade * 0.9;
        gl_FragColor = vec4(uColor * a, 1.0);
        #include <colorspace_fragment>
      }`,
  });

  // The lamp strikes: a flash, a dip, then up to full, like a real fitting
  const strike = (ms: number) => {
    if (ms < 0) return 0;
    if (ms < 50) return 0.75 * (ms / 50);
    if (ms < 110) return 0.75 - 0.5 * ((ms - 50) / 60);
    if (ms < 330) return 0.25 + 0.75 * (1 - (1 - (ms - 110) / 220) ** 2);
    return 1;
  };

  const MOTES_MS = 6000;
  const MOTES_FADE_MS = 1500;

  const Selection = ({ floor }: MarkerProps) => {
    const invalidate = useThree((s) => s.invalidate);
    const size = useThree((s) => s.size);
    const elapsed = useRef(0);
    // Board keeps this mounted when the selection moves to another piece:
    // the lamp strikes up afresh over each new one
    const at = floor.join();
    useEffect(() => {
      elapsed.current = 0;
      SPOTLIGHT.value = 0;
      invalidate();
      return () => {
        SPOTLIGHT.value = 0;
      };
    }, [at, invalidate]);
    // Point size in pixels at 1 world unit away
    moteMaterial.uniforms.uScale.value = size.height * 0.03;
    // The motes drift while the player first considers, then settle out of
    // the beam: after that the scene holds still until something changes
    useFrame((state, delta) => {
      if (elapsed.current > MOTES_MS + MOTES_FADE_MS) return;
      elapsed.current += Math.min(delta, 1 / 20) * 1000;
      SPOTLIGHT.value = strike(elapsed.current);
      moteClock.value = state.clock.elapsedTime;
      moteMaterial.uniforms.uFade.value =
        1 - Math.min(Math.max((elapsed.current - MOTES_MS) / MOTES_FADE_MS, 0), 1);
      invalidate();
    });
    return (
      <group position={floor}>
        <Mark
          floor={[0, 0, 0]}
          kind="spot"
          color={SPOT}
          radius={CONE_R}
          width={0.035 * pitch}
          opacity={0.75}
          fill={0.3}
          additive
          intensity={SPOTLIGHT}
          lift={0.006}
        />
        <mesh
          geometry={cone}
          material={coneMaterial}
          renderOrder={LAYER.trace}
          raycast={noRaycast}
        />
        <points
          geometry={moteGeometry}
          material={moteMaterial}
          renderOrder={LAYER.trace}
          frustumCulled={false}
          raycast={noRaycast}
        />
      </group>
    );
  };

  // --- The last move: a platinum wire --------------------------------------------

  const LastMove = ({ from, to, fresh = false, arc = 0 }: LastMoveMarkerProps) => (
    <>
      <Mark
        floor={from.floor}
        kind="wire"
        color={WIRE}
        radius={0.3 * pitch}
        width={0.024 * pitch}
        opacity={0.95}
        fill={0.05}
        dots={18}
      />
      <Mark
        floor={to.floor}
        kind="wire"
        color={WIRE}
        radius={0.4 * pitch}
        width={0.02 * pitch}
        opacity={0.9}
        fill={0.1}
        drawMs={fresh ? 360 : 0}
        delayMs={fresh ? moveMs * 0.75 : 0}
      />
      <LastMoveLine
        from={from.floor}
        to={to.floor}
        arc={arc}
        color={WIRE}
        pulseColor={WIRE_GLINT}
        radius={0.011}
        opacity={0.9}
        shade={0.45}
        pulse={0.7}
        pulseLength={0.35}
        flowSpeed={0.55}
        lift={0.03}
        drawInMs={fresh ? 320 : 0}
      />
    </>
  );

  // --- Check: do not touch --------------------------------------------------------

  const POST_H = 0.24 * pitch;
  const CORNER = 0.39 * pitch;
  const corners: Vec3[] = [
    [-CORNER, 0, -CORNER],
    [CORNER, 0, -CORNER],
    [CORNER, 0, CORNER],
    [-CORNER, 0, CORNER],
  ];
  const postGeometry = mergeGeometries(
    corners.flatMap(([x, , z]) => [
      new CylinderGeometry(0.045 * pitch, 0.05 * pitch, 0.014 * pitch, 16).translate(
        x,
        0.007 * pitch,
        z,
      ),
      new CylinderGeometry(0.011 * pitch, 0.011 * pitch, POST_H, 8).translate(x, POST_H / 2, z),
      new SphereGeometry(0.022 * pitch, 12, 8).translate(x, POST_H + 0.01 * pitch, z),
    ]),
  );
  const ropeGeometry = mergeGeometries(
    corners.map((a, i) => {
      const b = corners[(i + 1) % 4];
      const y = POST_H * 0.88;
      const points = Array.from({ length: 9 }, (_, k) => {
        const t = k / 8;
        return new Vector3(
          a[0] + (b[0] - a[0]) * t,
          y - 0.07 * pitch * 4 * t * (1 - t),
          a[2] + (b[2] - a[2]) * t,
        );
      });
      return new TubeGeometry(new CatmullRomCurve3(points), 16, 0.013 * pitch, 6, false);
    }),
  );
  const postMaterial = new MeshStandardMaterial({
    color: BRASS,
    metalness: 0.35,
    roughness: 0.3,
    emissive: new Color(BRASS_DEEP),
    emissiveIntensity: 0.35,
  });
  const ropeMaterial = new MeshStandardMaterial({
    color: ROPE,
    roughness: 0.85,
    emissive: new Color(ROPE),
    emissiveIntensity: 0.35,
  });

  const Check = ({ floor }: MarkerProps) => {
    const group = useRef<Group>(null);
    const elapsed = useRef(0);
    const invalidate = useThree((s) => s.invalidate);
    useFrame((_, delta) => {
      const g = group.current;
      if (!g || elapsed.current >= 420) return;
      elapsed.current += Math.min(delta, 1 / 20) * 1000;
      // The barrier rises out of the glass and settles
      const t = Math.min(elapsed.current / 420, 1);
      const back = 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
      g.scale.set(1, Math.max(back, 0.001), 1);
      invalidate();
    });
    return (
      <>
        <Mark
          floor={floor}
          kind="rope"
          color={ROPE}
          color2={ROPE_DEEP}
          radius={0.43 * pitch}
          width={0.03 * pitch}
          opacity={0.55}
          fill={0.1}
          dots={30}
        />
        <group ref={group} position={floor} scale={[1, 0.001, 1]}>
          <mesh geometry={postGeometry} material={postMaterial} raycast={noRaycast} />
          <mesh geometry={ropeGeometry} material={ropeMaterial} raycast={noRaycast} />
        </group>
      </>
    );
  };

  return { Quiet, Capture, Selection, LastMove, Check };
};
