import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import '@fontsource/share-tech-mono/400.css';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  MeshBasicMaterial,
  NoToneMapping,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import { Bloom } from '../kit/Bloom';
import { AmbientParticles, Burst, Shards } from '../kit/fx';
import { BoardLabels } from '../kit/labels';
import { towerBoardY, towerLayout } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import { GradientSky } from '../kit/sky';
import { StauntonParts } from '../classic/pieces';
import type {
  BoardLayout,
  CaptureFxProps,
  CelebrationProps,
  Design,
  GridProps,
  LastMoveMarkerProps,
  MarkerProps,
  MoveFxProps,
  Vec3,
} from '../types';
import { DataLink, Delayed, HoloText, ScanBeam, Shockwave, useLife } from './fx';
import {
  ALERT,
  HOLO,
  HoloClock,
  PieceBody,
  glitchFor,
  holo,
  useDissolvingMaterial,
} from './pieces';
import { ProjectorTable, RoomFloor, ScanPlane, Walls } from './stage';

// Hologram: a war-room projection. Five boards of light hang in a tower
// over a round projector table, its engraved rings turning in the dark; the
// armies are flickering holograms — ice-cyan against amber — with scanlines
// crawling through them. Moves teleport, captures glitch apart.

const CYAN = HOLO.white;
const ICE = '#9dfcff';
const GREEN = '#58ff9c';
const GRID = '#2a8cff';

// --- Layout ---------------------------------------------------------------------

// The tower stands a little above the scene's centre, to leave the table
// room in frame beneath it.
const RAISE = 0.55;
const base = towerLayout({ spacing: 1.05, levelGap: 2.05, viewDirection: [0.24, 0.47, 1] });
const layout: BoardLayout = {
  ...base,
  // Low, squat click boxes (the lower part of each cell): a ray down to a
  // far square then passes over the nearer squares' boxes rather than
  // through them, so every destination can be clicked from above.
  toWorld: (cell, orientation) => {
    const [x, y, z] = base.toWorld(cell, orientation);
    return [x, y + RAISE - 0.1, z];
  },
  floorY: -0.4,
  cellSize: [base.cellSize[0], 0.6, base.cellSize[2]],
  halfExtents: [3.3, 5.65, 3.3],
};
const H = 2.5 * 1.05; // half a board's side
const LEVELS = [0, 1, 2, 3, 4].map((z) => towerBoardY(layout, z));
const TABLE_Y = LEVELS[0] - 1.75;
const TOP = LEVELS[4];

// --- The boards -------------------------------------------------------------------

// One material draws every level: a faint checker of light, glowing cell
// lines, a bright border and corner brackets just outside it. It brightens
// as the scan plane passes.
const MARGIN = 0.45;
const levelMaterial = new ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  side: DoubleSide,
  toneMapped: false,
  uniforms: {
    uTime: holo.uTime,
    uScanY: holo.uScanY,
    uH: { value: H },
    uLine: { value: new Color(GRID).multiplyScalar(0.6) },
    uFill: { value: new Color(GRID).multiplyScalar(0.05) },
    uBracket: { value: new Color(ICE).multiplyScalar(1.3) },
  },
  vertexShader: /* glsl */ `
    varying vec3 vWorld;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime; uniform float uScanY; uniform float uH;
    uniform vec3 uLine; uniform vec3 uFill; uniform vec3 uBracket;
    varying vec3 vWorld;
    float bar(vec2 c, vec2 lo, vec2 hi) {
      vec2 fw = fwidth(c);
      vec2 s = smoothstep(lo - fw, lo, c) * (1.0 - smoothstep(hi, hi + fw, c));
      return s.x * s.y;
    }
    void main() {
      vec2 p = vWorld.xz;
      vec2 ap = abs(p);
      float m = max(ap.x, ap.y);
      float inside = 1.0 - smoothstep(uH - 0.01, uH + 0.01, m);
      vec2 g = (p + uH) / (2.0 * uH) * 5.0;
      vec2 w = fwidth(g);
      vec2 d = abs(fract(g + 0.5) - 0.5);
      vec2 l = 1.0 - smoothstep(vec2(0.0), w * 1.3, d);
      float grid = max(l.x, l.y) * inside;
      float fw = fwidth(m);
      float border = 1.0 - smoothstep(fw * 0.5, fw * 2.0, abs(m - uH));
      vec2 cell = floor(g);
      float checker = mod(cell.x + cell.y, 2.0);
      // Corner brackets, a hair outside the board
      vec2 c = ap - vec2(uH + 0.16);
      float br = max(bar(c, vec2(-0.55, -0.03), vec2(0.03, 0.03)), bar(c, vec2(-0.03, -0.55), vec2(0.03, 0.03)));
      // Tick marks along each edge between the corners
      float tick = bar(vec2(ap.x - uH - 0.1, fract(p.y / (2.0 * uH) * 10.0 + 0.5) - 0.5), vec2(-0.02, -0.03), vec2(0.06, 0.03))
        + bar(vec2(ap.y - uH - 0.1, fract(p.x / (2.0 * uH) * 10.0 + 0.5) - 0.5), vec2(-0.02, -0.03), vec2(0.06, 0.03));
      tick *= step(m, uH + 0.3) * step(min(ap.x, ap.y), uH - 0.4);
      float scan = exp(-abs(vWorld.y - uScanY) * 2.5);
      vec3 col = uFill * (0.55 + 0.9 * checker) * inside
        + uLine * (grid * 0.5 + border * 1.2 + tick * 0.6)
        + uBracket * br;
      col *= 1.0 + scan * 0.8;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const levelPlane = new PlaneGeometry((H + MARGIN) * 2, (H + MARGIN) * 2);

// Faint uprights at the tower's corners, from the table to the top board.
const struts = (() => {
  const e = H + 0.16;
  const pos: number[] = [];
  for (const [x, z] of [
    [-e, -e],
    [-e, e],
    [e, -e],
    [e, e],
  ])
    pos.push(x, TABLE_Y, z, x, TOP, z);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  return g;
})();
const strutMaterial = new LineBasicMaterial({
  color: new Color(GRID).multiplyScalar(0.4),
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
});

const Grid = ({ layout: l, orientation }: GridProps) => (
  <group>
    {LEVELS.map((y, z) => (
      <mesh
        key={z}
        geometry={levelPlane}
        material={levelMaterial}
        position={[0, y, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        raycast={noRaycast}
        renderOrder={-5}
      />
    ))}
    <lineSegments geometry={struts} material={strutMaterial} raycast={noRaycast} />
    <BoardLabels
      layout={l}
      orientation={orientation}
      font='"Rajdhani", sans-serif'
      weight={700}
      color="#d8fdff"
      shadow="rgba(60, 242, 255, 0.9)"
      size={0.42}
      opacity={0.9}
    />
  </group>
);

// --- Markers ---------------------------------------------------------------------------

const hdr = (hex: string, k: number) => new Color(hex).multiplyScalar(k);
const glowMaterial = (hex: string, k: number, opacity = 1) =>
  new MeshBasicMaterial({
    color: hdr(hex, k),
    toneMapped: false,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });

/** Four L-shaped corner brackets round a square of half-side `half`, flat on the floor. */
const bracketGeometry = (half: number, arm: number, width: number) => {
  const pos: number[] = [];
  const quad = (x0: number, z0: number, x1: number, z1: number) =>
    pos.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z0, x1, 0, z1, x0, 0, z1);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const cx = sx * half;
      const cz = sz * half;
      quad(cx, cz, cx - sx * arm, cz - sz * width);
      quad(cx, cz, cx - sx * width, cz - sz * arm);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  return g;
};

const quietBrackets = bracketGeometry(0.36, 0.16, 0.045);
const quietDot = new CircleGeometry(0.1, 4);
const quietFill = glowMaterial(GREEN, 2.2);
const quietSoft = glowMaterial(GREEN, 0.6, 0.35);
const quietSquare = new PlaneGeometry(0.62, 0.62);

// A waypoint marker hovering over the reticle, so it reads from a low angle.
const pin = new OctahedronGeometry(0.1, 0);
const pinEdges = new EdgesGeometry(pin);
const pinFill = glowMaterial(GREEN, 0.9, 0.55);
const pinLine = new LineBasicMaterial({ color: hdr(GREEN, 2.4), toneMapped: false });
const pinStem = new BufferGeometry().setAttribute(
  'position',
  new BufferAttribute(new Float32Array([0, 0, 0, 0, 0.3, 0]), 3),
);
const stemMaterial = new LineBasicMaterial({
  color: hdr(GREEN, 1),
  toneMapped: false,
  transparent: true,
  opacity: 0.7,
});

const Quiet = ({ floor }: MarkerProps) => {
  const spin = useRef<Group>(null);
  const tip = useRef<Group>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const g = spin.current;
    if (g) {
      g.rotation.y = t * 0.9;
      g.scale.setScalar(1 + Math.sin(t * 4 + floor[0] * 2 + floor[2]) * 0.06);
    }
    if (tip.current) {
      tip.current.rotation.y = -t * 2;
      tip.current.position.y = 0.42 + Math.sin(t * 3 + floor[0] + floor[2] * 2) * 0.03;
    }
  });
  return (
    <group position={[floor[0], floor[1] + 0.02, floor[2]]}>
      <group ref={spin}>
        <mesh geometry={quietBrackets} material={quietFill} raycast={noRaycast} />
      </group>
      <lineSegments geometry={pinStem} material={stemMaterial} raycast={noRaycast} />
      <group ref={tip} position={[0, 0.42, 0]} scale={[1, 1.5, 1]}>
        <mesh geometry={pin} material={pinFill} raycast={noRaycast} />
        <lineSegments geometry={pinEdges} material={pinLine} raycast={noRaycast} />
      </group>
      <mesh
        geometry={quietDot}
        material={quietFill}
        rotation={[-Math.PI / 2, 0, 0]}
        raycast={noRaycast}
      />
      <mesh
        geometry={quietSquare}
        material={quietSoft}
        rotation={[-Math.PI / 2, 0, 0]}
        raycast={noRaycast}
      />
    </group>
  );
};

// A crosshair: ring, inward ticks, counter-rotating brackets, and a lock box
// of corner marks standing round the target piece.
const crossRing = new RingGeometry(0.4, 0.44, 64);
const crossTicks = (() => {
  const pos: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const w = 0.022;
    const r0 = 0.3;
    const r1 = 0.52;
    const p = (r: number, o: number) => [c * r - s * o, 0, s * r + c * o];
    pos.push(...p(r0, -w), ...p(r1, -w), ...p(r1, w), ...p(r0, -w), ...p(r1, w), ...p(r0, w));
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  return g;
})();
const crossBrackets = bracketGeometry(0.5, 0.16, 0.035);
const lockBox = (() => {
  const h = 0.44;
  const top = 1.08;
  const arm = 0.14;
  const pos: number[] = [];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      for (const y of [0.02, top]) {
        const dy = y < 0.5 ? arm : -arm;
        const x = sx * h;
        const z = sz * h;
        pos.push(x, y, z, x, y + dy, z);
        pos.push(x, y, z, x - sx * arm, y, z);
        pos.push(x, y, z, x, y, z - sz * arm);
      }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  return g;
})();
const captureFill = glowMaterial('#ff4a2e', 1.9);
const captureLock = new LineBasicMaterial({
  color: hdr('#ff5a3a', 2.2),
  toneMapped: false,
  transparent: true,
  depthWrite: false,
});

const Capture = ({ floor }: MarkerProps) => {
  const outer = useRef<Group>(null);
  const inner = useRef<Group>(null);
  const lock = useRef<Group>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (outer.current) outer.current.rotation.y = -t * 1.2;
    if (inner.current) inner.current.rotation.y = t * 0.6;
    if (lock.current) lock.current.scale.setScalar(1 + 0.06 * Math.sin(t * 7));
  });
  return (
    <group position={[floor[0], floor[1] + 0.025, floor[2]]}>
      <mesh
        geometry={crossRing}
        material={captureFill}
        rotation={[-Math.PI / 2, 0, 0]}
        raycast={noRaycast}
      />
      <group ref={inner}>
        <mesh geometry={crossTicks} material={captureFill} raycast={noRaycast} />
      </group>
      <group ref={outer}>
        <mesh geometry={crossBrackets} material={captureFill} raycast={noRaycast} />
      </group>
      <group ref={lock}>
        <lineSegments geometry={lockBox} material={captureLock} raycast={noRaycast} />
      </group>
    </group>
  );
};

// A light column: bright at its foot, gone by the top, with bands climbing it.
const columnMaterial = (hex: string, k: number, strobe = false) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    toneMapped: false,
    uniforms: { uColor: { value: hdr(hex, k) }, uTime: holo.uTime },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
      void main() {
        float fall = pow(1.0 - vUv.y, 1.8);
        float bands = 0.6 + 0.4 * pow(0.5 + 0.5 * sin(vUv.y * 40.0 - uTime * 6.0), 4.0);
        float pulse = ${strobe ? '0.35 + 0.65 * step(0.5, fract(uTime * 2.0))' : '0.85 + 0.15 * sin(uTime * 4.0)'};
        gl_FragColor = vec4(uColor, fall * bands * pulse * 0.75);
      }`,
  });
const column = new CylinderGeometry(1, 1, 1, 40, 1, true);

const arcRing = (inner: number, outer: number, arcs: number, gap: number) => {
  const geos = Array.from({ length: arcs }, (_, i) => {
    const len = (Math.PI * 2) / arcs - gap;
    return new RingGeometry(inner, outer, 24, 1, i * (len + gap), len);
  });
  const count = geos.reduce((n, g) => n + g.index!.count, 0);
  const pos = new Float32Array(count * 3);
  let o = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    const idx = g.index!;
    for (let i = 0; i < idx.count; i++) {
      const v = idx.getX(i);
      pos.set([p.getX(v), p.getY(v), p.getZ(v)], o);
      o += 3;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  return g;
};

const selectArcs = arcRing(0.36, 0.41, 3, 0.5);
const selectFill = glowMaterial(ICE, 2);
const selectBeam = columnMaterial(ICE, 0.7);

const Selection = ({ floor }: MarkerProps) => {
  const spin = useRef<Group>(null);
  useFrame((state) => {
    if (spin.current) spin.current.rotation.z = state.clock.elapsedTime * 2.2;
  });
  return (
    <group position={[floor[0], floor[1] + 0.03, floor[2]]}>
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <group ref={spin}>
          <mesh geometry={selectArcs} material={selectFill} raycast={noRaycast} />
        </group>
      </group>
      <mesh
        geometry={column}
        material={selectBeam}
        position={[0, 0.9, 0]}
        scale={[0.34, 1.8, 0.34]}
        raycast={noRaycast}
      />
    </group>
  );
};

// The last move: corner marks on both cells, and a dashed trace between them.
const lastBrackets = bracketGeometry(0.47, 0.12, 0.03);
const lastFrom = glowMaterial(ICE, 0.7, 0.8);
const lastTo = glowMaterial(ICE, 1.5);
const traceMaterial = new ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
  uniforms: { uColor: { value: hdr(ICE, 1.1) }, uTime: holo.uTime, uLen: { value: 1 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; uniform float uTime; uniform float uLen; varying vec2 vUv;
    void main() {
      float dash = step(0.45, fract(vUv.y * uLen * 3.0 - uTime * 1.5));
      gl_FragColor = vec4(uColor, dash * (0.25 + 0.55 * vUv.y));
    }`,
});
const traceTube = new CylinderGeometry(0.014, 0.014, 1, 6, 1, true);
const UP = new Vector3(0, 1, 0);

const LastMove = ({ from, to }: LastMoveMarkerProps) => {
  const { mid, len, quat } = useMemo(() => {
    const a = new Vector3(...from.floor);
    const d = new Vector3(...to.floor).sub(a);
    return {
      mid: a.clone().addScaledVector(d, 0.5).toArray() as Vec3,
      len: d.length(),
      quat: new Quaternion().setFromUnitVectors(UP, d.clone().normalize()),
    };
  }, [from, to]);
  useEffect(() => {
    traceMaterial.uniforms.uLen.value = len;
  }, [len]);
  return (
    <group position={[0, 0.015, 0]}>
      <mesh geometry={lastBrackets} material={lastFrom} position={from.floor} raycast={noRaycast} />
      <mesh geometry={lastBrackets} material={lastTo} position={to.floor} raycast={noRaycast} />
      <mesh
        geometry={traceTube}
        material={traceMaterial}
        position={mid}
        quaternion={quat}
        scale={[1, len, 1]}
        raycast={noRaycast}
      />
    </group>
  );
};

// Red alert: a strobing column, a warning ring turning round the king, and
// a CHECK readout over its head.
const alertColumn = columnMaterial(ALERT, 1.6, true);
const alertArcs = arcRing(0.44, 0.5, 6, 0.35);
const alertFill = glowMaterial(ALERT, 2.2);
const Check = ({ floor }: MarkerProps) => {
  const spin = useRef<Group>(null);
  useFrame((state) => {
    if (spin.current) spin.current.rotation.z = -state.clock.elapsedTime * 1.6;
  });
  return (
    <group position={floor}>
      <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <group ref={spin}>
          <mesh geometry={alertArcs} material={alertFill} raycast={noRaycast} />
        </group>
      </group>
      <mesh
        geometry={column}
        material={alertColumn}
        position={[0, 1.1, 0]}
        scale={[0.5, 2.2, 0.5]}
        raycast={noRaycast}
      />
      <HoloText text="CHECK" position={[0, 1.2, 0]} color={ALERT} width={2} lifeMs={1e9} />
    </group>
  );
};

// --- Effects --------------------------------------------------------------------------

const square = new PlaneGeometry(0.07, 0.07);
const squareMaterial = new MeshBasicMaterial({
  color: new Color(1.8, 1.8, 1.8),
  toneMapped: false,
  transparent: true,
  blending: AdditiveBlending,
  depthWrite: false,
  side: DoubleSide,
});

const MoveFx = ({ from, to, color, durationMs }: MoveFxProps) => {
  const c = HOLO[color];
  const f: Vec3 = [from[0], from[1] + layout.floorY, from[2]];
  const t: Vec3 = [to[0], to[1] + layout.floorY, to[2]];
  return (
    <>
      <ScanBeam floor={f} color={c} dir={-1} lifeMs={durationMs * 0.65} />
      <Shards
        position={[f[0], f[1] + 0.2, f[2]]}
        geometry={square}
        material={squareMaterial}
        colors={[c, c, '#ffffff']}
        count={26}
        speed={0.9}
        gravity={-1.2}
        upward={0.6}
        spread={0.3}
        spin={3}
        lifeMs={durationMs * 1.3}
        seed={3}
      />
      <DataLink
        from={[f[0], f[1] + 0.35, f[2]]}
        to={[t[0], t[1] + 0.35, t[2]]}
        color={c}
        lifeMs={durationMs * 0.9}
      />
      <Delayed ms={durationMs * 0.4}>
        <ScanBeam floor={t} color={c} dir={1} lifeMs={durationMs * 0.9} />
      </Delayed>
      <Delayed ms={durationMs * 0.55}>
        <Shockwave position={[t[0], t[1] + 0.02, t[2]]} color={c} radius={0.9} lifeMs={450} />
      </Delayed>
    </>
  );
};

// The captured piece glitches — jitters, stutters, slips — and burns away
// into blocks of light.
const Victim = ({
  type,
  color,
  lifeMs,
}: {
  type: CaptureFxProps['victim']['type'];
  color: CaptureFxProps['victim']['color'];
  lifeMs: number;
}) => {
  const group = useRef<Group>(null);
  const material = useDissolvingMaterial(color);
  const { t, done } = useLife(lifeMs);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const s = t.current;
    const k = Math.min((s * 1000) / lifeMs, 1);
    material.uniforms.uDissolve.value = k ** 0.8;
    g.visible = Math.sin(s * 110) > -0.7 + k * 0.5;
    g.position.x = Math.sin(s * 170) * 0.05 * k;
    g.position.z = Math.cos(s * 130) * 0.03 * k;
    g.scale.set(1 + k * 0.12, 1 + k * 0.04, 1 + k * 0.12);
  });
  if (done) return null;
  return (
    <group ref={group}>
      <StauntonParts type={type} material={material} groove={material} />
    </group>
  );
};

/** Makes the whole projection glitch for a moment. */
const Glitch = ({ ms, strength = 1 }: { ms: number; strength?: number }) => {
  useEffect(() => glitchFor(ms, strength), [ms, strength]);
  return null;
};

const CaptureFx = ({ floor, victim, durationMs }: CaptureFxProps) => {
  const c = HOLO[victim.color];
  return (
    <>
      <group position={floor}>
        <Victim type={victim.type} color={victim.color} lifeMs={durationMs * 0.62} />
      </group>
      <Glitch ms={220} />
      <Delayed ms={durationMs * 0.12}>
        <Shards
          position={[floor[0], floor[1] + 0.1, floor[2]]}
          geometry={square}
          material={squareMaterial}
          colors={[c, c, '#ffffff', ALERT]}
          count={70}
          speed={1.6}
          gravity={-0.6}
          upward={0.4}
          spread={0.45}
          spin={4}
          lifeMs={1100}
          seed={9}
        />
        <Shockwave
          position={[floor[0], floor[1] + 0.03, floor[2]]}
          color={ALERT}
          radius={1.3}
          lifeMs={520}
        />
      </Delayed>
    </>
  );
};

const Celebration = ({ floor, winner }: CelebrationProps) => {
  const c = winner ? HOLO[winner] : ICE;
  const lvl: Vec3 = [floor[0], floor[1] + 0.03, floor[2]];
  return (
    <>
      <Glitch ms={650} strength={1.6} />
      <ScanBeam floor={floor} color={ALERT} dir={1} lifeMs={1600} radius={0.5} height={3} />
      <Shockwave position={lvl} color={ALERT} radius={2.2} lifeMs={700} />
      <Delayed ms={250}>
        <Shockwave position={lvl} color={c} radius={3.6} lifeMs={1100} width={0.03} />
        <Shards
          position={[floor[0], floor[1] + 0.3, floor[2]]}
          geometry={square}
          material={squareMaterial}
          colors={[c, c, '#ffffff', ALERT]}
          count={180}
          speed={3}
          gravity={-0.4}
          upward={0.3}
          spread={0.5}
          spin={5}
          lifeMs={2200}
          seed={17}
        />
        <Burst
          position={[floor[0], floor[1] + 0.5, floor[2]]}
          colors={[c, '#ffffff']}
          count={120}
          speed={2.6}
          gravity={0.4}
          upward={0.2}
          lifeMs={1600}
          size={0.07}
        />
      </Delayed>
      <Delayed ms={350}>
        <HoloText text="CHECKMATE" position={[floor[0], floor[1] + 1.7, floor[2]]} color={c} />
      </Delayed>
    </>
  );
};

// --- HUD text glow -------------------------------------------------------------------

// The HUD variables cover the panels but not text glow, so while this design
// is on screen the stage adds a small stylesheet for it.
const HUD_CSS = `
[data-hologram-hud] { text-shadow: 0 0 6px rgba(60, 242, 255, 0.45); }
[data-testid="turn-indicator"] { text-shadow: 0 0 8px rgba(60, 242, 255, 0.85); }
`;
const useHudGlow = () => {
  useEffect(() => {
    const style = document.createElement('style');
    style.dataset.design = 'hologram';
    style.textContent = HUD_CSS;
    document.head.appendChild(style);
    const root = document.querySelector('[data-testid="r3f-canvas"]')?.parentElement?.parentElement;
    root?.setAttribute('data-hologram-hud', '');
    return () => {
      style.remove();
      root?.removeAttribute('data-hologram-hud');
    };
  }, []);
};

// --- Stage -------------------------------------------------------------------------

const Stage = () => {
  useHudGlow();
  const floorY = TABLE_Y - 2.4;
  return (
    <>
      <HoloClock from={TABLE_Y} to={TOP + 1.2} />
      <GradientSky top="#01050b" horizon="#061626" bottom="#010306" exponent={0.7} />
      <fog attach="fog" args={['#020912', 22, 55]} />
      <Walls y={floorY} />
      <RoomFloor y={floorY} />
      <ProjectorTable y={TABLE_Y} radius={4.1} top={TOP + 1.3} board={H + 0.16} floor={floorY} />
      <ScanPlane size={(H + MARGIN) * 2} />
      <AmbientParticles
        count={260}
        box={[7, TOP - TABLE_Y + 2, 7]}
        centre={[0, (TOP + TABLE_Y) / 2 + 0.5, 0]}
        velocity={[0, 0.14, 0]}
        sway={0.2}
        size={0.045}
        color="#bffaff"
        opacity={0.55}
        twinkle={0.6}
      />
      <Environment resolution={64} frames={1}>
        <Lightformer form="ring" intensity={2} color={CYAN} position={[0, 6, 0]} scale={5} />
        <Lightformer
          form="rect"
          intensity={0.6}
          color="#1d4d7a"
          position={[0, 2, 8]}
          scale={[12, 4, 1]}
        />
      </Environment>
      <ambientLight intensity={0.35} color="#3a6ea0" />
      <pointLight position={[0, TABLE_Y + 0.6, 0]} intensity={12} distance={9} color={CYAN} />
      <directionalLight position={[4, 8, 6]} intensity={0.5} color="#9fc8ff" />
      <Bloom strength={1} radius={0.55} threshold={0.72} />
    </>
  );
};

// Destination cells get no box fill: the reticles say it all.
const hidden = new MeshBasicMaterial({ visible: false });

const corners = (c: string, len = 12) =>
  [
    ['top left', `${len}px 2px`],
    ['top left', `2px ${len}px`],
    ['top right', `${len}px 2px`],
    ['top right', `2px ${len}px`],
    ['bottom left', `${len}px 2px`],
    ['bottom left', `2px ${len}px`],
    ['bottom right', `${len}px 2px`],
    ['bottom right', `2px ${len}px`],
  ]
    .map(([at, size]) => `linear-gradient(${c}, ${c}) ${at} / ${size} no-repeat`)
    .join(', ');

const hologram: Design = {
  id: 'hologram',
  name: 'Hologram',
  blurb: 'A war-room projection: flickering holo pieces over a projector table.',
  layout,
  continuous: true,
  canvas: { fov: 38, toneMapping: NoToneMapping, antialias: true },
  Stage,
  Grid,
  cellFills: { destination: hidden, lastMove: hidden },
  PieceBody,
  knightYaw: 0.95,
  markers: { Quiet, Capture, Selection, LastMove, Check },
  motion: { style: 'teleport', durationMs: 560, lift: 0 },
  MoveFx,
  CaptureFx,
  Celebration,
  toppleMatedKing: true,
  hoverLift: true,
  hud: {
    vars: {
      '--hud-font': '"Rajdhani", "Segoe UI", sans-serif',
      '--hud-mono': '"Share Tech Mono", ui-monospace, monospace',
      '--hud-bg': `${corners(CYAN)}, linear-gradient(180deg, rgba(6, 30, 48, 0.8), rgba(2, 12, 22, 0.84))`,
      '--hud-fg': '#cdfbff',
      '--hud-muted': 'rgba(60, 242, 255, 0.5)',
      '--hud-accent': 'rgba(60, 242, 255, 0.9)',
      '--hud-accent-fg': '#02121e',
      '--hud-border': '1px solid rgba(60, 242, 255, 0.38)',
      '--hud-radius': '0px',
      '--hud-shadow': '0 0 18px rgba(60, 242, 255, 0.14), inset 0 0 22px rgba(60, 242, 255, 0.07)',
      '--hud-blur': 'blur(3px)',
      '--hud-case': 'uppercase',
      '--hud-tracking': '0.14em',
      '--turn-bg': `${corners(ICE, 14)}, linear-gradient(180deg, rgba(8, 40, 60, 0.85), rgba(2, 14, 26, 0.88))`,
      '--turn-fg': '#e6feff',
      '--turn-size': '21px',
      '--turn-border': '1px solid rgba(157, 252, 255, 0.55)',
      '--turn-shadow': '0 0 20px rgba(60, 242, 255, 0.3)',
      '--modal-bg': `${corners(CYAN, 18)}, linear-gradient(180deg, rgba(8, 36, 56, 0.96), rgba(2, 10, 20, 0.97))`,
      '--modal-fg': '#d6fcff',
      '--modal-backdrop': 'rgba(0, 6, 12, 0.5)',
      '--modal-radius': '0px',
      '--modal-shadow': '0 0 50px rgba(60, 242, 255, 0.25)',
      '--button-bg': 'rgba(60, 242, 255, 0.14)',
      '--button-fg': '#dffdff',
      '--button-border': '1px solid rgba(60, 242, 255, 0.8)',
      '--button-radius': '0px',
      '--page-bg': 'radial-gradient(ellipse at 50% 70%, #0a2a40 0%, #020a14 65%)',
      '--page-fg': '#cdfbff',
    },
    overlay: {
      background:
        'repeating-linear-gradient(0deg, rgba(60, 242, 255, 0.035) 0px, rgba(60, 242, 255, 0.035) 1px, transparent 1px, transparent 3px), radial-gradient(ellipse at 50% 50%, transparent 60%, rgba(0, 6, 14, 0.6) 100%)',
    },
  },
};

export default hologram;
