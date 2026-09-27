import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import type { Group } from 'three';
import { LAYER } from '../kit/layers';
import { FloorMarker, LastMoveTrace } from '../kit/markers';
import type { FloorMarkerStyle } from '../kit/markers';
import { noRaycast } from '../kit/noRaycast';
import type { LastMoveMarkerProps, MarkerProps } from '../types';
import { FRAME, MOTION, PALETTE } from './shared';

// Markers: targeting brackets flat on the glass. One family throughout:
// green brackets for a move, the same brackets in red with inward teeth for
// a capture, magenta brackets for the last move's squares (a little wider, so
// they nest round a move bracket on the same square), red brackets and a ring
// for check. The selection is the one place with motion: a bezel that locks
// on and turns slowly, and a column of light through every level, so the
// squares directly above and below the piece are easy to find.

const { pitch } = FRAME;
const MAX_FRAME = 1 / 30;

const MOVE: FloorMarkerStyle = {
  shape: 'brackets',
  color: PALETTE.move,
  captureColor: PALETTE.capture,
  opacity: 0.95,
  fill: 0.05,
  inset: 0.12,
  lineWidth: 0.065,
  bracketLength: 0.46,
  cornerRadius: 0.06,
};

export const Quiet = ({ floor, hovered }: MarkerProps) => (
  <FloorMarker floor={floor} pitch={pitch} {...MOVE} hovered={hovered} />
);

export const Capture = ({ floor, hovered }: MarkerProps) => (
  <FloorMarker floor={floor} pitch={pitch} {...MOVE} capture fill={0.09} hovered={hovered} />
);

// --- Selection -------------------------------------------------------------------

const bezelVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// A bezel: a solid ring with notches at the compass points reaching in and
// out through a dashed outer ring that turns slowly, and inside it a sonar
// sweep going round over a pool of light.
const bezelFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uTurn;
  uniform float uSweep;
  varying vec2 vP;
  void main() {
    float r = length(vP);
    float ang = atan(vP.y, vP.x);
    float fr = max(fwidth(r), 1e-4);
    float ring = 1.0 - smoothstep(0.024 - fr, 0.024 + fr, abs(r - 0.355));
    // Notches at the compass points, from inside the ring out past the dashes
    vec2 q = abs(vP);
    float across = min(q.x, q.y);
    float notch = (1.0 - smoothstep(0.018 - fr, 0.018 + fr, across))
      * smoothstep(0.25 - fr, 0.25 + fr, r) * (1.0 - smoothstep(0.49 - fr, 0.49 + fr, r));
    // Dashed outer ring
    float a = ang + uTurn;
    float dash = step(0.45, fract(a / 6.2831853 * 28.0));
    float outer = (1.0 - smoothstep(0.014 - fr, 0.014 + fr, abs(r - 0.44))) * dash;
    float pool = exp(-r * r / 0.06) * 0.42;
    // The sweep: bright at the beam, fading round behind it
    float behind = fract((uSweep - ang) / 6.2831853);
    float sweep = exp(-behind * 7.0) * 0.5 * (1.0 - smoothstep(0.32, 0.345, r));
    pool = max(pool, sweep);
    float s = max(max(ring, notch), outer * 0.85);
    float alpha = max(s, pool) * uAlpha;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(uColor * (1.0 + 0.25 * s), alpha);
    #include <colorspace_fragment>
  }`;

const bezelPlane = new PlaneGeometry(1, 1);

// A column of light through every level: faint, brighter where it crosses a
// platform, brightest at the selected piece's own level, gone at the ends.
const columnVertex = /* glsl */ `
  varying float vY;
  varying float vRim;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vY = w.y;
    vec3 n = normalize(mat3(modelMatrix) * normal);
    vec3 v = normalize(cameraPosition - w.xyz);
    vRim = 1.0 - abs(dot(n, v));
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const columnFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uLevels[5];
  uniform float uHome;
  uniform float uBottom;
  uniform float uTop;
  uniform float uGrow;
  varying float vY;
  varying float vRim;
  void main() {
    // Grows up and down from the selected level
    float reach = uGrow * (uTop - uBottom);
    if (abs(vY - uHome) > reach) discard;
    float cross_ = 0.0;
    for (int i = 0; i < 5; i++) cross_ = max(cross_, exp(-abs(vY - uLevels[i]) * 16.0));
    float ends = smoothstep(uBottom, uBottom + 0.5, vY) * (1.0 - smoothstep(uTop - 0.9, uTop, vY));
    // Brightest round the piece itself
    float home = exp(-abs(vY - uHome - 0.35) * 2.2);
    float a = (0.06 + 0.26 * cross_ + 0.16 * home) * (0.35 + vRim) * ends * uAlpha;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }`;

const COLUMN_RADIUS = 0.3;
const columnBottom = FRAME.levelY[0] - 0.05;
const columnTop = FRAME.levelY[4] + 1.1;
const columnGeometry = new CylinderGeometry(1, 1, 1, 32, 1, true);

const INTRO = 0.26; // seconds for the lock-on

/** The selected piece: a bezel that locks on, a column of light, and its square on every other level. */
export const Selection = ({ floor }: MarkerProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const bezel = useRef<Group>(null);
  const t = useRef(0);
  const { bezelMaterial, columnMaterial } = useMemo(
    () => ({
      bezelMaterial: new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        uniforms: {
          uColor: { value: new Color(PALETTE.select) },
          uAlpha: { value: 0 },
          uTurn: { value: 0 },
          uSweep: { value: 0 },
        },
        vertexShader: bezelVertex,
        fragmentShader: bezelFragment,
      }),
      columnMaterial: new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        uniforms: {
          uColor: { value: new Color(PALETTE.select) },
          uAlpha: { value: 0 },
          uLevels: { value: FRAME.levelY },
          uHome: { value: floor[1] },
          uBottom: { value: columnBottom },
          uTop: { value: columnTop },
          uGrow: { value: 0 },
        },
        vertexShader: columnVertex,
        fragmentShader: columnFragment,
      }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the home level is set below
    [],
  );
  useEffect(
    () => () => {
      bezelMaterial.dispose();
      columnMaterial.dispose();
    },
    [bezelMaterial, columnMaterial],
  );
  columnMaterial.uniforms.uHome.value = floor[1];
  // A new selection locks on afresh (Board passes a fresh array every render)
  const where = floor.join(',');
  useEffect(() => {
    t.current = 0;
    invalidate();
  }, [where, invalidate]);

  useFrame((_, delta) => {
    t.current += Math.min(delta, MAX_FRAME);
    const k = Math.min(t.current / INTRO, 1);
    // Lock-on: in from wide with a little overshoot, then a slow turn
    const back = 1 + 2.4 * (k - 1) ** 3 + 1.4 * (k - 1) ** 2;
    const g = bezel.current;
    if (g) g.scale.setScalar(pitch * (1.9 - 0.9 * back));
    bezelMaterial.uniforms.uAlpha.value = Math.min(k * 1.6, 1);
    bezelMaterial.uniforms.uTurn.value = t.current * 0.35;
    bezelMaterial.uniforms.uSweep.value = t.current * 2.1;
    columnMaterial.uniforms.uAlpha.value = Math.min(k * 1.2, 1);
    columnMaterial.uniforms.uGrow.value = Math.min(t.current / 0.45, 1);
    invalidate();
  });

  const others = FRAME.levelY.filter((y) => Math.abs(y - floor[1]) > 0.01);
  return (
    <>
      <group ref={bezel} position={[floor[0], floor[1] + 0.014, floor[2]]}>
        <mesh
          geometry={bezelPlane}
          material={bezelMaterial}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={LAYER.marker}
          raycast={noRaycast}
        />
      </group>
      <mesh
        geometry={columnGeometry}
        material={columnMaterial}
        position={[floor[0], (columnBottom + columnTop) / 2, floor[2]]}
        scale={[COLUMN_RADIUS, columnTop - columnBottom, COLUMN_RADIUS]}
        renderOrder={LAYER.trace}
        raycast={noRaycast}
      />
      {others.map((y) => (
        <FloorMarker
          key={y}
          floor={[floor[0], y, floor[2]]}
          pitch={pitch}
          shape="square"
          color={PALETTE.select}
          opacity={0.45}
          lineWidth={0.024}
          inset={0.04}
          cornerRadius={0.02}
        />
      ))}
    </>
  );
};

// --- Last move ---------------------------------------------------------------------

const LAST: FloorMarkerStyle = {
  shape: 'brackets',
  color: PALETTE.lastMove,
  inset: 0.04,
  lineWidth: 0.06,
  bracketLength: 0.4,
  cornerRadius: 0.06,
};

/** The last move: magenta brackets on both squares and the route between them, flowing to the destination. */
export const LastMove = ({ from, to }: LastMoveMarkerProps) => {
  // A new move's route is plotted as the piece lands (the move's own streak
  // of light flies the path first), not while it is still in the air.
  const group = useRef<Group>(null);
  const since = useRef(0);
  const invalidate = useThree((s) => s.invalidate);
  const route = JSON.stringify([from.floor, to.floor]);
  useLayoutEffect(() => {
    since.current = 0;
    if (group.current) group.current.visible = false;
    invalidate();
  }, [route, invalidate]);
  useFrame((_, delta) => {
    const g = group.current;
    if (!g || g.visible) return;
    since.current += Math.min(delta, MAX_FRAME) * 1000;
    g.visible = since.current >= MOTION.durationMs * 0.8;
    invalidate();
  });
  return (
    <group ref={group} visible={false}>
      <FloorMarker floor={from.floor} pitch={pitch} {...LAST} opacity={0.75} fill={0.05} />
      <FloorMarker floor={to.floor} pitch={pitch} {...LAST} opacity={1} fill={0.07} />
      <LastMoveTrace
        from={from.floor}
        to={to.floor}
        color={PALETTE.lastMove}
        edgeColor="#240a24"
        width={0.095}
        headLength={0.26}
        headWidth={0.26}
        chevrons={0.36}
        flowSpeed={0.3}
        arc={0.4}
        endInset={0.34}
        startInset={0.1}
      />
    </group>
  );
};

// --- Check ---------------------------------------------------------------------------

const beaconGeometry = new CylinderGeometry(1, 1, 1, 32, 1, true);
const CHECK_PERIOD = 2.8;

/** A short red column of light standing on the checked king's square, breathing slowly. */
const CheckBeacon = ({ floor }: { floor: MarkerProps['floor'] }) => {
  const invalidate = useThree((s) => s.invalidate);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        uniforms: { uColor: { value: new Color(PALETTE.check) }, uBreath: { value: 1 } },
        vertexShader: /* glsl */ `
          varying float vH;
          varying float vRim;
          void main() {
            vH = uv.y;
            vec4 w = modelMatrix * vec4(position, 1.0);
            vec3 n = normalize(mat3(modelMatrix) * normal);
            vRim = 1.0 - abs(dot(n, normalize(cameraPosition - w.xyz)));
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uBreath;
          varying float vH;
          varying float vRim;
          void main() {
            float a = pow(1.0 - vH, 1.4) * (0.25 + 0.75 * vRim) * 0.55 * uBreath;
            gl_FragColor = vec4(uColor, a);
            #include <colorspace_fragment>
          }`,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    material.uniforms.uBreath.value = 0.8 + 0.2 * Math.cos((2 * Math.PI * t) / CHECK_PERIOD);
    invalidate();
  });
  return (
    <mesh
      geometry={beaconGeometry}
      material={material}
      position={[floor[0], floor[1] + 0.55, floor[2]]}
      scale={[0.4, 1.1, 0.4]}
      renderOrder={LAYER.trace}
      raycast={noRaycast}
    />
  );
};

/**
 * A king in check: bold red brackets round its square, a ring at its base
 * and a short column of red light, all breathing slowly together.
 */
export const Check = ({ floor }: MarkerProps) => (
  <>
    <CheckBeacon floor={floor} />
    <FloorMarker
      floor={floor}
      pitch={pitch}
      shape="brackets"
      color={PALETTE.check}
      opacity={1}
      fill={0.16}
      inset={0.04}
      lineWidth={0.085}
      bracketLength={0.5}
      cornerRadius={0.06}
      breathe={0.3}
      breathePeriod={CHECK_PERIOD}
    />
    <FloorMarker
      floor={floor}
      pitch={pitch}
      shape="ring"
      color={PALETTE.check}
      opacity={0.9}
      lineWidth={0.045}
      ringRadius={0.33}
      breathe={0.3}
      breathePeriod={CHECK_PERIOD}
    />
  </>
);
