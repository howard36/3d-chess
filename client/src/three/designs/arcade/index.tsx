import '@fontsource/press-start-2p/400.css';
import pixelFontUrl from '@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff2';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  LineBasicMaterial,
  MeshBasicMaterial,
  NearestFilter,
  NoToneMapping,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
} from 'three';
import type { Group, InstancedMesh, Mesh } from 'three';
import { CELLS } from '../../layout';
import type { Orientation } from '../../layout';
import { Bloom } from '../kit/Bloom';
import { CheckBeacon, ScreenShake } from '../kit/fx';
import { latticeLayout } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';
import type {
  CaptureFxProps,
  CelebrationProps,
  Design,
  GridProps,
  LastMoveMarkerProps,
  MarkerProps,
  MoveFxProps,
} from '../types';
import { Banner, DoomedPiece, Fireworks, PixelPop, VoxelExplosion, WarpStreak } from './fx';
import { PixelLabels } from './labels';
import { PieceBody, setCheckFlash } from './pieces';

// Arcade: the board as an 8-bit game. Voxel pieces, sprites given depth,
// stand on neon floor tiles inside a lattice framed by chasing marquee
// lights, over a scrolling starfield; the canvas is drawn at half resolution
// and blown up with hard pixel edges, under a faint CRT.

const layout = latticeLayout(1.32);
const [HX, HY, HZ] = layout.halfExtents;

const BG = '#1a0b2e';
const GREEN = '#39ff88';
const YELLOW = '#ffe23d';
const PINK = '#ff3fb4';
const CYAN = '#2ee6ff';
const RED = '#ff3355';
// One neon per level, near (A) to far (E): the depth reads as colour.
const LEVEL_COLORS = ['#39ff88', '#2ef5c8', '#2ee6ff', '#3da0ff', '#7b7dff'];

/** Colour boosted past 1, so the bloom picks it up. */
const neon = (hex: string, k = 1.6) => new Color(hex).multiplyScalar(k);

// The HUD's pixel face at a size that suits a panel: Press Start 2P drawn
// about two thirds of its usual size (a font-face of its own, so nothing else
// that uses the font changes).
const HUD_FONT = 'Arcade Pixel';
if (typeof document !== 'undefined' && !document.getElementById('arcade-pixel-font')) {
  const style = document.createElement('style');
  style.id = 'arcade-pixel-font';
  style.textContent = `@font-face { font-family: '${HUD_FONT}'; src: url(${pixelFontUrl}) format('woff2'); size-adjust: 68%; font-display: swap; }`;
  document.head.appendChild(style);
}

const pixelTexture = (size: number, paint: (ctx: CanvasRenderingContext2D) => void) => {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  paint(c.getContext('2d')!);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  return t;
};

// --- The lattice -----------------------------------------------------------------

// Each cell's floor as a neon square, coloured by level. Built per
// orientation: viewing as Black puts the levels the other way round.
const floorLines = (orientation: Orientation) => {
  const pos: number[] = [];
  const col: number[] = [];
  const c = new Color();
  const s = 0.42;
  for (const cell of CELLS) {
    const [x, y, z] = layout.toWorld(cell, orientation);
    const fy = y + layout.floorY + 0.002;
    const corners = [
      [x - s, z - s],
      [x + s, z - s],
      [x + s, z + s],
      [x - s, z + s],
    ];
    c.set(LEVEL_COLORS[cell.z]);
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i];
      const [bx, bz] = corners[(i + 1) % 4];
      pos.push(ax, fy, az, bx, fy, bz);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  return g;
};

// A frame round each level's slice of the cube, like the layers of a
// parallax backdrop.
const levelFrames = (orientation: Orientation) => {
  const pos: number[] = [];
  const col: number[] = [];
  const c = new Color();
  const x0 = HX - 0.05;
  const y0 = HY - 0.05;
  for (let level = 0; level < 5; level++) {
    const [, , z] = layout.toWorld({ x: 0, y: 0, z: level }, orientation);
    c.set(LEVEL_COLORS[level]);
    const corners = [
      [-x0, -y0],
      [x0, -y0],
      [x0, y0],
      [-x0, y0],
    ];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = corners[i];
      const [bx, by] = corners[(i + 1) % 4];
      pos.push(ax, ay, z, bx, by, z);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  return g;
};

const floorMaterial = new LineBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.6,
  depthWrite: false,
  toneMapped: false,
});
const frameMaterial = new LineBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.2,
  depthWrite: false,
  toneMapped: false,
});

// Marquee lights: a chain of voxel bulbs round the twelve edges of the cube,
// with a light chasing along it.
const BULB = 0.12;
const bulbs = (() => {
  const e = [HX + 0.12, HY + 0.12, HZ + 0.12];
  const out: [number, number, number][] = [];
  const step = 0.26;
  // Each edge runs along one axis at a pair of signs for the other two
  for (let axis = 0; axis < 3; axis++) {
    const [a, b] = [0, 1, 2].filter((i) => i !== axis);
    for (const [sa, sb] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      // The upright nearest the opening view would run across the front
      // pieces: leave it out.
      if (axis === 1 && sa === 1 && sb === 1) continue;
      const n = Math.round((e[axis] * 2) / step);
      for (let i = 0; i <= n; i++) {
        const p: [number, number, number] = [0, 0, 0];
        p[axis] = -e[axis] + (i * e[axis] * 2) / n;
        p[a] = sa * e[a];
        p[b] = sb * e[b];
        out.push(p);
      }
    }
  }
  return out;
})();
const bulbGeometry = new BoxGeometry(BULB, BULB, BULB);
const bulbMaterial = new MeshBasicMaterial({ toneMapped: false });
const BULB_DIM = new Color('#4a1a7a');
const BULB_LIT = [neon(PINK, 1.7), neon(YELLOW, 1.5), neon(CYAN, 1.6)];

const Marquee = () => {
  const mesh = useRef<InstancedMesh>(null);
  const last = useRef(-1);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const o = new Object3D();
    bulbs.forEach((p, i) => {
      o.position.set(...p);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, BULB_DIM);
    });
    m.instanceMatrix.needsUpdate = true;
  }, []);
  useFrame((state) => {
    const m = mesh.current;
    const step = Math.floor(state.clock.elapsedTime * 10);
    if (!m || step === last.current) return;
    last.current = step;
    bulbs.forEach((_, i) => {
      const lit = (i + step) % 6;
      m.setColorAt(
        i,
        lit === 0 ? BULB_LIT[Math.floor(i / 6) % 3] : lit === 1 ? BULB_LIT[0] : BULB_DIM,
      );
    });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh
      ref={mesh}
      args={[bulbGeometry, bulbMaterial, bulbs.length]}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

const Grid = ({ orientation }: GridProps) => {
  const floors = useMemo(() => floorLines(orientation), [orientation]);
  const frames = useMemo(() => levelFrames(orientation), [orientation]);
  useEffect(
    () => () => {
      floors.dispose();
      frames.dispose();
    },
    [floors, frames],
  );
  return (
    <group>
      <lineSegments geometry={floors} material={floorMaterial} raycast={noRaycast} />
      <lineSegments geometry={frames} material={frameMaterial} raycast={noRaycast} />
      <Marquee />
      <PixelLabels
        layout={layout}
        orientation={orientation}
        color={YELLOW}
        shadow={PINK}
        levelColors={LEVEL_COLORS}
      />
    </group>
  );
};

// --- Markers -----------------------------------------------------------------------

const cubeGeometry = new BoxGeometry(1, 1, 1);
const glowMaterial = (hex: string, k = 1.6) =>
  new MeshBasicMaterial({ color: neon(hex, k), toneMapped: false });
const greenGlow = glowMaterial(GREEN);
const redGlow = glowMaterial(RED, 1.8);
const yellowGlow = glowMaterial(YELLOW, 1.5);

// A flat pixel-art square: a hard outline, optionally filled.
const squareTexture = (fill: boolean) =>
  pixelTexture(16, (ctx) => {
    ctx.fillStyle = '#ffffff';
    if (fill) {
      ctx.globalAlpha = 0.45;
      ctx.fillRect(1, 1, 14, 14);
      ctx.globalAlpha = 1;
    }
    ctx.fillRect(1, 1, 14, 2);
    ctx.fillRect(1, 13, 14, 2);
    ctx.fillRect(1, 1, 2, 14);
    ctx.fillRect(13, 1, 2, 14);
  });
const tileGeometry = new PlaneGeometry(0.84, 0.84).rotateX(-Math.PI / 2);
const tileMaterial = (hex: string, fill: boolean, opacity = 1) =>
  new MeshBasicMaterial({
    map: squareTexture(fill),
    color: neon(hex, 1.3),
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
  });
const quietTile = tileMaterial(GREEN, false, 0.9);

/** A blinking pixel block over a green tile; the blocks blink in a chase. */
const Quiet = ({ floor }: MarkerProps) => {
  const block = useRef<Mesh>(null);
  const phase = Math.round((floor[0] + floor[1] + floor[2]) * 2);
  useFrame((state) => {
    const b = block.current;
    if (!b) return;
    const beat = Math.floor(state.clock.elapsedTime * 6) + phase;
    b.visible = beat % 4 !== 0;
    b.position.y = 0.24 + (beat % 2) * 0.05;
  });
  return (
    <group position={floor}>
      <mesh
        ref={block}
        geometry={cubeGeometry}
        material={greenGlow}
        scale={0.14}
        position={[0, 0.24, 0]}
        raycast={noRaycast}
      />
      <mesh
        geometry={tileGeometry}
        material={quietTile}
        position={[0, 0.006, 0]}
        raycast={noRaycast}
      />
    </group>
  );
};

// A ring of pixels, as a circle comes out on a coarse grid.
const PIXEL_RING = (() => {
  const out: [number, number][] = [];
  const r = 5.6;
  for (let i = -7; i <= 7; i++)
    for (let j = -7; j <= 7; j++) {
      const d = Math.hypot(i, j);
      if (d > r - 0.5 && d <= r + 0.5) out.push([i, j]);
    }
  return out;
})();
const RING_PIXEL = 0.075;

/** A red pixel ring round the piece that can be taken, flashing. */
const Capture = ({ floor }: MarkerProps) => {
  const ring = useRef<Group>(null);
  useFrame((state) => {
    const g = ring.current;
    if (!g) return;
    const beat = Math.floor(state.clock.elapsedTime * 6) % 2;
    g.scale.setScalar(beat ? 1.08 : 1);
  });
  return (
    <group ref={ring} position={[floor[0], floor[1] + 0.04, floor[2]]}>
      {PIXEL_RING.map(([i, j]) => (
        <mesh
          key={`${i},${j}`}
          geometry={cubeGeometry}
          material={redGlow}
          position={[i * RING_PIXEL, 0, j * RING_PIXEL]}
          scale={RING_PIXEL}
          raycast={noRaycast}
        />
      ))}
    </group>
  );
};

// Corner brackets of a pixel frame, each an L of three blocks.
const BRACKETS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
].flatMap(([sx, sz]) => [
  [sx * 0.42, sz * 0.42],
  [sx * 0.32, sz * 0.42],
  [sx * 0.42, sz * 0.32],
]);

/** A yellow pixel frame that pulses in and out round the chosen piece. */
const Selection = ({ floor }: MarkerProps) => {
  const frame = useRef<Group>(null);
  useFrame((state) => {
    const g = frame.current;
    if (!g) return;
    g.scale.setScalar(Math.floor(state.clock.elapsedTime * 4) % 2 ? 1.1 : 1);
  });
  return (
    <group ref={frame} position={[floor[0], floor[1] + 0.05, floor[2]]}>
      {BRACKETS.map(([x, z], i) => (
        <mesh
          key={i}
          geometry={cubeGeometry}
          material={yellowGlow}
          position={[x, 0, z]}
          scale={0.1}
          raycast={noRaycast}
        />
      ))}
    </group>
  );
};

const fromTile = tileMaterial(CYAN, false, 0.7);
const toTile = tileMaterial(YELLOW, true, 0.9);
const LastMove = ({ from, to }: LastMoveMarkerProps) => (
  <>
    <mesh
      geometry={tileGeometry}
      material={fromTile}
      position={[from.floor[0], from.floor[1] + 0.004, from.floor[2]]}
      raycast={noRaycast}
    />
    <mesh
      geometry={tileGeometry}
      material={toTile}
      position={[to.floor[0], to.floor[1] + 0.004, to.floor[2]]}
      raycast={noRaycast}
    />
  </>
);

// A pixel "!" over the king in check.
const BANG: [number, number][] = [
  [0, 0],
  [0, 2],
  [0, 3],
  [0, 4],
];
const checkTile = tileMaterial(RED, true, 1);

/** The king flashes red, with a red tile under it and a "!" over it. */
const Check = ({ floor }: MarkerProps) => {
  const bang = useRef<Group>(null);
  useFrame((state) => {
    const beat = Math.floor(state.clock.elapsedTime * 5) % 2;
    setCheckFlash(beat === 1);
    if (bang.current) bang.current.visible = beat === 1;
  });
  return (
    <>
      <CheckBeacon floor={floor} color={RED} radius={0.46} height={1.05} />
      <group position={floor}>
        <mesh
          geometry={tileGeometry}
          material={checkTile}
          position={[0, 0.005, 0]}
          raycast={noRaycast}
        />
        <group ref={bang} position={[0, 0.95, 0]}>
          {BANG.map(([x, y], i) => (
            <mesh
              key={i}
              geometry={cubeGeometry}
              material={redGlow}
              position={[x, y * 0.068, 0]}
              scale={0.068}
              raycast={noRaycast}
            />
          ))}
        </group>
      </group>
    </>
  );
};

// --- Effects -----------------------------------------------------------------------

const MoveFx = ({ from, to, color, durationMs }: MoveFxProps) => {
  const floorOf = (p: typeof from) => [p[0], p[1] + layout.floorY + 0.3, p[2]] as typeof from;
  return (
    <>
      <PixelPop position={floorOf(from)} color={color} seed={3} />
      <WarpStreak from={floorOf(from)} to={floorOf(to)} color={color} durationMs={durationMs} />
      <PixelPop position={floorOf(to)} color={color} delayMs={durationMs * 0.5} seed={7} />
    </>
  );
};

const CaptureFx = ({ floor, victim, durationMs }: CaptureFxProps) => (
  <>
    <DoomedPiece type={victim.type} color={victim.color} floor={floor} delayMs={durationMs * 0.5} />
    <VoxelExplosion
      type={victim.type}
      color={victim.color}
      floor={floor}
      delayMs={durationMs * 0.5}
    />
  </>
);

/** A screen shake that waits for its moment (the mated king hitting the floor). */
const DelayedShake = ({
  delayMs,
  intensity,
  durationMs,
}: {
  delayMs: number;
  intensity: number;
  durationMs: number;
}) => {
  const [on, setOn] = useState(false);
  const elapsed = useRef(0);
  const invalidate = useThree((s) => s.invalidate);
  useFrame((_, delta) => {
    if (on) return;
    elapsed.current += Math.min(delta, 1 / 30) * 1000;
    if (elapsed.current >= delayMs) setOn(true);
    else invalidate();
  });
  return on ? <ScreenShake intensity={intensity} durationMs={durationMs} /> : null;
};

const Celebration = ({ floor, winner }: CelebrationProps) => (
  <>
    <DelayedShake delayMs={480} intensity={14} durationMs={520} />
    <Fireworks centre={floor} />
    <Banner position={[0, HY + 0.9, 0]} text={winner ? 'CHECKMATE!' : 'GAME OVER'} />
  </>
);

// --- Stage -------------------------------------------------------------------------

const STARS = 900;
const starMaterial = new ShaderMaterial({
  transparent: false,
  depthWrite: false,
  fog: false,
  vertexColors: true,
  uniforms: { uTime: { value: 0 } },
  vertexShader: /* glsl */ `
    uniform float uTime;
    attribute float aSeed; attribute float aSize;
    varying vec3 vColor; varying float vOn;
    void main() {
      vColor = color;
      vec3 p = position;
      // Scroll downward like a shoot-'em-up, near stars faster
      p.y = mod(p.y - uTime * (0.4 + aSeed * 1.2) + 45.0, 90.0) - 45.0;
      float blink = step(0.82, aSeed) * step(0.5, fract(uTime * (0.7 + aSeed) + aSeed * 13.0));
      vOn = 1.0 - blink;
      gl_PointSize = aSize;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    varying vec3 vColor; varying float vOn;
    void main() {
      if (vOn < 0.5) discard;
      gl_FragColor = vec4(vColor, 1.0);
      #include <colorspace_fragment>
    }`,
});
const starGeometry = (() => {
  const random = rng(77);
  const pos = new Float32Array(STARS * 3);
  const col = new Float32Array(STARS * 3);
  const seed = new Float32Array(STARS);
  const size = new Float32Array(STARS);
  const palette = ['#ffffff', '#ffffff', '#fff3b0', '#9ff3ff', '#ff9bf0', '#b8a4ff'].map(
    (h) => new Color(h),
  );
  for (let i = 0; i < STARS; i++) {
    // A shell round the vertical axis, so scrolling never crosses the board
    const a = random() * Math.PI * 2;
    const r = 22 + random() * 26;
    pos.set([Math.cos(a) * r, (random() - 0.5) * 90, Math.sin(a) * r], i * 3);
    const c = palette[Math.floor(random() * palette.length)];
    col.set([c.r, c.g, c.b], i * 3);
    seed[i] = random();
    size[i] = random() > 0.85 ? 2 : 1;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setAttribute('aSeed', new BufferAttribute(seed, 1));
  g.setAttribute('aSize', new BufferAttribute(size, 1));
  return g;
})();

const Stars = () => {
  useFrame((state) => {
    starMaterial.uniforms.uTime.value = state.clock.elapsedTime;
  });
  return (
    <points
      geometry={starGeometry}
      material={starMaterial}
      raycast={noRaycast}
      frustumCulled={false}
      renderOrder={-900}
    />
  );
};

// A ringed pixel-art planet, dithered in four tones.
const planetTexture = pixelTexture(48, (ctx) => {
  const tones = ['#162a5c', '#1f5fa0', '#2ea8ff', '#a8f4ff'];
  const ring = ['#b0561f', '#ff9a2e', '#ffe23d'];
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const tilt = -0.38;
  const ringAt = (x: number, y: number) => {
    const rx = x * Math.cos(tilt) - y * Math.sin(tilt);
    const ry = x * Math.sin(tilt) + y * Math.cos(tilt);
    const e = (rx / 22) ** 2 + (ry / 5.2) ** 2;
    return e > 0.62 && e < 1 ? { front: ry > 0, k: e } : null;
  };
  for (let py = 0; py < 48; py++)
    for (let px = 0; px < 48; px++) {
      const x = px - 23.5;
      const y = py - 23.5;
      const d = Math.hypot(x, y) / 14;
      const r = ringAt(x, y);
      let color: string | null = null;
      if (d <= 1) {
        const nz = Math.sqrt(1 - Math.min(d * d, 1));
        const light = Math.max(0, (-x / 14) * 0.55 + (-y / 14) * 0.45 + nz * 0.7);
        const band = Math.sin(y * 0.9) * 0.08;
        const v =
          Math.min(0.999, light * 0.95 + band) * 4 + bayer[(py % 4) * 4 + (px % 4)] / 16 - 0.5;
        color = tones[Math.max(0, Math.min(3, Math.floor(v)))];
      }
      if (r && (r.front || d > 1)) color = ring[r.k > 0.86 ? 0 : r.k > 0.74 ? 1 : 2];
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(px, py, 1, 1);
      }
    }
});

/** Draws the canvas's half-resolution frame with hard pixel edges. */
const PixelUpscale = () => {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const el = gl.domElement;
    const before = el.style.imageRendering;
    el.style.imageRendering = 'pixelated';
    return () => {
      el.style.imageRendering = before;
    };
  }, [gl]);
  return null;
};

const Stage = () => (
  <>
    <PixelUpscale />
    <color attach="background" args={[BG]} />
    <Stars />
    <sprite position={[-4, -5, -40]} scale={10} raycast={noRaycast} renderOrder={-800}>
      <spriteMaterial map={planetTexture} depthWrite={false} fog={false} toneMapped={false} />
    </sprite>
    <ambientLight intensity={0.5} />
    <directionalLight position={[2, 10, 3]} intensity={0.55} />
    <directionalLight position={[3, 3, 10]} intensity={0.35} />
    <directionalLight position={[-8, 2, 1]} intensity={0.12} color="#c9a8ff" />
    <Bloom strength={0.75} radius={0.35} threshold={1} />
  </>
);

// Destination and last-move cells get no box fill: the markers say it all.
const hidden = new MeshBasicMaterial({ visible: false });

const arcade: Design = {
  id: 'arcade',
  name: 'Arcade',
  blurb: 'Chunky voxels, pixel rendering and a CRT glow.',
  layout,
  continuous: true,
  canvas: { fov: 40, toneMapping: NoToneMapping, dpr: 0.5, pixelated: true, antialias: false },
  Stage,
  Grid,
  cellFills: { destination: hidden, lastMove: hidden },
  PieceBody,
  knightYaw: 0.3,
  markers: { Quiet, Capture, Selection, LastMove, Check },
  motion: { style: 'teleport', durationMs: 380, lift: 0 },
  MoveFx,
  CaptureFx,
  Celebration,
  toppleMatedKing: true,
  hoverLift: false,
  hud: {
    vars: {
      '--hud-font': `"${HUD_FONT}", "Press Start 2P", monospace`,
      '--hud-mono': `"${HUD_FONT}", "Press Start 2P", monospace`,
      '--hud-bg': '#12071f',
      '--hud-fg': '#ffe7a0',
      '--hud-muted': '#8a5cc7',
      '--hud-accent': GREEN,
      '--hud-accent-fg': '#12071f',
      '--hud-border': `3px solid ${GREEN}`,
      '--hud-radius': '0px',
      '--hud-shadow': '4px 4px 0 #b04cff',
      '--hud-blur': 'none',
      '--hud-case': 'uppercase',
      '--hud-tracking': '0.04em',
      '--turn-bg': '#12071f',
      '--turn-fg': YELLOW,
      '--turn-size': '15px',
      '--turn-border': `3px solid ${YELLOW}`,
      '--turn-shadow': `4px 4px 0 ${PINK}`,
      '--modal-bg': '#12071f',
      '--modal-fg': '#ffe7a0',
      '--modal-backdrop': 'rgba(10, 2, 20, 0.55)',
      '--modal-radius': '0px',
      '--modal-shadow': '8px 8px 0 #b04cff',
      '--button-bg': GREEN,
      '--button-fg': '#12071f',
      '--button-border': '3px solid #ffffff',
      '--button-radius': '0px',
      '--page-bg': BG,
      '--page-fg': '#ffe7a0',
    },
    overlay: {
      background:
        'repeating-linear-gradient(to bottom, rgba(8, 0, 16, 0.2) 0px, rgba(8, 0, 16, 0.2) 2px, rgba(0, 0, 0, 0) 2px, rgba(0, 0, 0, 0) 4px), radial-gradient(ellipse at 50% 50%, rgba(0, 0, 0, 0) 58%, rgba(6, 0, 14, 0.55) 100%)',
    },
  },
};

export default arcade;
