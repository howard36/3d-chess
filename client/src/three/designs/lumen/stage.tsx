import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DodecahedronGeometry,
  EdgesGeometry,
  IcosahedronGeometry,
  LinearMipmapLinearFilter,
  LineBasicMaterial,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  ShaderMaterial,
  TorusKnotGeometry,
  Vector3,
  WireframeGeometry,
} from 'three';
import type { DirectionalLight } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PROFILES, sampleProfile } from '../../pieces';
import type { Profile } from '../../pieces';
import { noRaycast } from '../kit/noRaycast';
import { GradientSky } from '../kit/sky';
import { rng } from '../kit/textures';
import { TOWER_MASK, withTowerMask } from './mask';
import { rig } from './pieces';
import { APERTURE, FLOOR_Y, FRAME, PALETTE, TABLE_RADIUS, TABLE_Y } from './palette';

// The studio after hours. The tower stands over a round projector table, a
// quiet dark-steel emitter, a faint curtain of striated light rising from it.
// Round the room, in the gloom: plinths bearing holographic studies (wire
// forms, an architectural model), a glass wall of tall windows onto a night
// city blurred to bokeh, a few soft light panels and quiet indicator glows,
// and a floor of dark tiles with the projection bay marked out in light.
// Everything is still (nothing moves behind the tower), low in contrast, and
// arranged all the way round, so the room reads the same from every side,
// low down and from straight above. Whatever lies behind the tower, seen
// through its panes, is held down by the tower mask (mask.ts): props to
// nothing, the wall and the floor's reflection to a murmur. The tower is the
// one lit object in a dark room.

// --- The glass wall -------------------------------------------------------------------

const WALL_RADIUS = 30;
const WALL_HEIGHT = 26;
// Heights on the wall (world y): the window sill, the horizon, the head
const SILL_Y = -2.2;
const HORIZON_Y = 2.6;
const HEAD_Y = 10.5;

/** The wall's panorama, painted once: windows, city bokeh, light panels. */
const panorama = (): CanvasTexture => {
  const W = 2048;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  // A CPU canvas: painting through a software GPU (the review machine's)
  // would stall the first frame for a long time
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const rowOf = (y: number) => H * (1 - (y - FLOOR_Y) / WALL_HEIGHT);
  const sill = rowOf(SILL_Y);
  const horizon = rowOf(HORIZON_Y);
  const head = rowOf(HEAD_Y);
  const random = rng(11);

  // The room's dark wall
  ctx.fillStyle = '#04060c';
  ctx.fillRect(0, 0, W, H);
  // Through the glass: a night sky, hazier toward the horizon
  const sky = ctx.createLinearGradient(0, head, 0, sill);
  sky.addColorStop(0, '#070a15');
  sky.addColorStop(0.5, '#11172e');
  sky.addColorStop(0.62, '#141a33');
  sky.addColorStop(1, '#090c18');
  ctx.fillStyle = sky;
  ctx.fillRect(0, head, W, sill - head);

  // The skyline, soft: blocks a shade darker than the haze
  ctx.save();
  ctx.filter = 'blur(3px)';
  for (let x = -40; x < W + 40; ) {
    const w = 14 + random() * 46;
    const h = 6 + random() ** 2 * 60;
    ctx.fillStyle = random() < 0.5 ? '#070914' : '#080b17';
    ctx.fillRect(x, horizon - h, w, sill - horizon + h);
    x += w * (0.6 + random() * 0.5);
  }
  ctx.restore();

  // City lights, blurred to bokeh: small and dense at the horizon, larger
  // and sparser nearer
  // Amber-white streetlight and pale white: none of them a level's hue, and
  // none near the gold, coral or ice of the markers
  const hues = ['#ffd2a8', '#ffdcb8', '#ffe6cc', '#fff0e0', '#dfe6f2', '#c8d2e2'];
  const disc = (x: number, y: number, r: number, color: string, alpha: number) => {
    // Copies across the seam only where the disc reaches it
    for (const dx of [0, -W, W]) {
      if (dx !== 0 && Math.abs(x + dx - W / 2) > W / 2 + r) continue;
      const g = ctx.createRadialGradient(x + dx, y, 0, x + dx, y, r);
      g.addColorStop(0, color);
      g.addColorStop(0.55, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = alpha;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x + dx, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 900; i++) {
    const depth = random() ** 1.6;
    const y = horizon - 6 + depth * (sill - horizon + 4);
    const r = 1.2 + depth * 7 * (0.5 + random());
    const x = random() * W;
    disc(
      x,
      y,
      r,
      hues[Math.floor(random() * hues.length)],
      0.05 + random() * 0.16 * (1 - depth * 0.5),
    );
  }
  // A few lights high in the towers
  for (let i = 0; i < 70; i++) {
    disc(
      random() * W,
      horizon - 4 - random() * 50,
      1 + random() * 2,
      '#ffe2c2',
      0.08 + random() * 0.1,
    );
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // Mullions and a transom; every so often a solid bay with a soft light panel
  const bays = 16;
  const bay = W / bays;
  const transom = rowOf(7.2);
  for (let i = 0; i < bays; i++) {
    const x = i * bay;
    if (i % 5 === 2) {
      ctx.fillStyle = '#05070e';
      ctx.fillRect(x, head - 6, bay, sill - head + 12);
      // A tall, soft light panel
      const px = x + bay * 0.3;
      const pw = bay * 0.4;
      const glow = ctx.createLinearGradient(px, 0, px + pw, 0);
      glow.addColorStop(0, 'rgba(150, 180, 255, 0)');
      glow.addColorStop(0.5, 'rgba(200, 210, 232, 0.14)');
      glow.addColorStop(1, 'rgba(150, 180, 255, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(px, head + 20, pw, sill - head - 40);
    }
    ctx.fillStyle = '#03050a';
    ctx.fillRect(x - 3, head - 8, 7, sill - head + 16);
    ctx.fillStyle = 'rgba(120, 130, 160, 0.16)';
    ctx.fillRect(x + 4, head - 8, 1, sill - head + 16);
    // The room's own light, softly caught in the glass beside each mullion
    const sheen = ctx.createLinearGradient(x + 5, 0, x + 40, 0);
    sheen.addColorStop(0, 'rgba(170, 180, 205, 0.07)');
    sheen.addColorStop(1, 'rgba(170, 180, 205, 0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(x + 5, head, 35, sill - head);
  }
  ctx.fillStyle = '#03050a';
  ctx.fillRect(0, transom - 3, W, 5);
  ctx.fillRect(0, head - 8, W, 9);
  ctx.fillRect(0, sill - 2, W, 8);
  // A cove light under the sill, and quiet indicator glows along it
  const cove = ctx.createLinearGradient(0, sill + 6, 0, sill + 26);
  cove.addColorStop(0, 'rgba(215, 222, 235, 0.1)');
  cove.addColorStop(1, 'rgba(215, 222, 235, 0)');
  ctx.fillStyle = cove;
  ctx.fillRect(0, sill + 6, W, 20);
  const leds = ['#9fe8c4', '#e8ecf4', '#e8ecf4'];
  for (let i = 0; i < bays; i++) {
    if (random() < 0.45) continue;
    const x = i * bay + bay * (0.2 + random() * 0.6);
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = leds[Math.floor(random() * leds.length)];
    ctx.fillRect(x, sill + 14, 2, 2);
  }
  ctx.globalAlpha = 1;

  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
};

// Behind the tower the wall is held down to a murmur (mask.ts)
const wallVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const wallFragment = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying vec3 vWorld;
  ${TOWER_MASK}
  void main() {
    vec3 col = texture2D(uMap, vUv).rgb * towerMask(vWorld, 0.3);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

let pano: CanvasTexture | null = null;
/** The panorama, painted on first use and shared by the wall and the floor's reflection. */
const panoramaTexture = () => (pano ??= panorama());

const GlassWall = () => {
  const { geometry, material } = useMemo(() => {
    const geometry = new CylinderGeometry(WALL_RADIUS, WALL_RADIUS, WALL_HEIGHT, 96, 1, true);
    geometry.translate(0, FLOOR_Y + WALL_HEIGHT / 2, 0);
    const material = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: { uMap: { value: panoramaTexture() } },
      vertexShader: wallVertex,
      fragmentShader: wallFragment,
    });
    return { geometry, material };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return <mesh geometry={geometry} material={material} renderOrder={-950} raycast={noRaycast} />;
};

// --- The floor --------------------------------------------------------------------------

/** Warm pools of light on the floor (x, z, radius), under lamps over three of the studies. */
const LAMPS = [
  [158, 18.5],
  [240, 16.5],
  [22, 16.5],
].map(([deg, r]) => {
  const a = (deg * Math.PI) / 180;
  return new Vector3(Math.sin(a) * r, Math.cos(a) * r, 2.4);
});

const floorVertex = /* glsl */ `
  varying vec2 vP;
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vP = w.xz;
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const floorFragment = /* glsl */ `
  uniform vec3 uFloor;
  uniform vec3 uSeam;
  uniform vec3 uLight;
  uniform float uBay;
  uniform float uTable;
  uniform sampler2D uPano;
  uniform vec3 uWall;
  uniform vec3 uLamp;
  uniform vec3 uLamps[3];
  ${TOWER_MASK}
  varying vec2 vP;
  varying vec3 vWorld;
  // The glass wall as the polished floor reflects it: the view ray bounced
  // off the floor, met with the wall's cylinder, and sampled from a small
  // mip of its panorama, so the city and the light panels come back blurred
  vec3 reflection() {
    vec3 view = normalize(vWorld - cameraPosition);
    vec3 d = reflect(view, vec3(0.0, 1.0, 0.0));
    vec2 o = vWorld.xz;
    float a = max(dot(d.xz, d.xz), 1e-5);
    float b = dot(o, d.xz);
    float c = dot(o, o) - uWall.x * uWall.x;
    float t = (-b + sqrt(max(b * b - a * c, 0.0))) / a;
    vec3 hit = vWorld + d * t;
    float v = (hit.y - uWall.y) / uWall.z;
    float u = atan(hit.x, hit.z) / 6.2831853;
    vec3 col = textureLod(uPano, vec2(u, clamp(v, 0.0, 1.0)), 2.2).rgb;
    col *= 1.0 - smoothstep(0.8, 1.0, v);
    float fresnel = 0.06 + 0.94 * pow(1.0 - abs(view.y), 3.0);
    return col * fresnel;
  }
  // Seams of floor panels laid in a running bond (not a chessboard)
  float seams(vec2 p, vec2 size, float width) {
    vec2 q = p / size;
    // Derivatives of the unshifted position: the bond's offset jumps
    vec2 fw = max(fwidth(q), vec2(1e-4));
    q.x += 0.5 * mod(floor(q.y), 2.0);
    vec2 d = abs(fract(q - 0.5) - 0.5);
    vec2 w = width / size;
    vec2 l = 1.0 - smoothstep(w, w + fw * 1.5, d);
    // Fine lines fade away where they would shimmer
    return max(l.x, l.y) * (1.0 - smoothstep(0.08, 0.3, max(fw.x, fw.y)));
  }
  void main() {
    float r = length(vP);
    // Dark floor panels, their seams faint
    float seam = seams(vP + vec2(1.2, 0.6), vec2(2.4, 1.2), 0.012);
    // The projection bay: a square marked out in light round the table
    vec2 q = abs(vP);
    float bayD = abs(max(q.x, q.y) - uBay);
    float fwb = max(fwidth(bayD), 1e-4);
    float bay = 1.0 - smoothstep(0.012, 0.012 + fwb * 1.5, bayD);
    float bayGlow = exp(-bayD * bayD / 0.08) * 0.25;
    float inBay = 1.0 - smoothstep(uBay - 0.05, uBay + 0.05, max(q.x, q.y));
    // The table's light spilling onto the floor round its foot
    float pool = exp(-pow(max(r - uTable, 0.0) / 3.2, 2.0)) * 0.55;
    float away = 1.0 - smoothstep(10.0, 28.0, r);
    // Warm pools under the lamps over a few of the studies
    float lamps = 0.0;
    for (int i = 0; i < 3; i++) {
      vec2 dl = vP - uLamps[i].xy;
      lamps += exp(-dot(dl, dl) / (uLamps[i].z * uLamps[i].z));
    }
    vec3 col = uFloor * (0.9 + 0.25 * inBay);
    // Clear floor round the table: nothing sharp shows through the panes
    float clear = smoothstep(uTable + 0.8, uTable + 3.0, r);
    // Nothing on the floor shows through the tower; the reflection only a murmur
    float hidden = towerMask(vWorld, 0.0);
    col += uSeam * seam * 0.3 * away * clear * mix(0.3, 1.0, hidden);
    col += uLight * (bay * 0.1 + bayGlow * 0.2) * away * hidden;
    col += uLight * pool * 0.05 * hidden;
    col += uLamp * lamps * 0.07 * hidden;
    col += reflection() * 1.1 * towerMask(vWorld, 0.3);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const Floor = () => {
  const { geometry, material } = useMemo(
    () => ({
      geometry: new PlaneGeometry(64, 64).rotateX(-Math.PI / 2),
      material: new ShaderMaterial({
        uniforms: {
          uFloor: { value: new Color(PALETTE.floor) },
          uSeam: { value: new Color(PALETTE.floorSeam) },
          uLight: { value: new Color(PALETTE.projector) },
          uBay: { value: 8.5 },
          uTable: { value: TABLE_RADIUS },
          uPano: { value: panoramaTexture() },
          uWall: { value: new Vector3(WALL_RADIUS, FLOOR_Y, WALL_HEIGHT) },
          uLamp: { value: new Color(PALETTE.lamp) },
          uLamps: { value: LAMPS },
        },
        vertexShader: floorVertex,
        fragmentShader: floorFragment,
      }),
    }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return (
    <mesh geometry={geometry} material={material} position={[0, FLOOR_Y, 0]} raycast={noRaycast} />
  );
};

// --- The projector table ------------------------------------------------------------------

const tableTopFragment = /* glsl */ `
  uniform vec3 uGlass;
  uniform vec3 uLight;
  uniform vec3 uDeep;
  uniform float uAperture;
  uniform float uRadius;
  varying vec2 vP;
  varying vec3 vWorld;
  ${TOWER_MASK}
  float hexCell(vec2 p) {
    // Distance to the edge of the nearest cell of a hexagonal lattice
    vec2 s = vec2(1.0, 1.7320508);
    vec2 a = mod(p, s) - s * 0.5;
    vec2 b = mod(p - s * 0.5, s) - s * 0.5;
    vec2 g = dot(a, a) < dot(b, b) ? a : b;
    vec2 h = abs(g);
    return 0.5 - max(dot(h, normalize(vec2(1.0, 1.7320508))), h.x);
  }
  void main() {
    float r = length(vP);
    float fr = max(fwidth(r), 1e-4);
    // Dark glass under the tower; the emitters are a fine honeycomb in a
    // band just inside the aperture ring, dim, brightening toward it
    float band = smoothstep(uAperture - 0.75, uAperture - 0.45, r) * step(r, uAperture - 0.06);
    float cell = hexCell(vP / 0.16);
    float fc = max(fwidth(cell), 1e-4);
    float lattice = (1.0 - smoothstep(0.04, 0.04 + fc * 1.5, cell)) * (1.0 - smoothstep(0.1, 0.35, fc));
    float toward = smoothstep(uAperture - 0.75, uAperture, r);
    // The aperture ring, and fine rings inside it and at the bezel's edge
    float ring = 1.0 - smoothstep(0.018, 0.018 + fr * 1.5, abs(r - uAperture));
    float ringGlow = exp(-pow((r - uAperture) / 0.14, 2.0));
    float inner = 1.0 - smoothstep(0.005, 0.005 + fr * 1.5, abs(r - (uAperture - 0.8)));
    float bezel = 1.0 - smoothstep(0.006, 0.006 + fr * 1.5, abs(r - (uRadius - 0.08)));
    // Whatever of it the panes lie in front of goes out; seen from high up,
    // what remains quietens further
    float hidden = towerMask(vWorld, 0.0);
    float steep = abs(normalize(vWorld - cameraPosition).y);
    float quiet = hidden * (1.0 - 0.5 * smoothstep(0.5, 0.9, steep));
    vec3 col = uGlass * (0.8 + 0.4 * smoothstep(0.0, uAperture, r));
    col += uDeep * band * (0.05 + lattice * 0.3) * toward * quiet;
    col += uLight * (ring * 0.18 + ringGlow * 0.05 + inner * 0.03 + bezel * 0.04) * quiet;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const TableTop = () => {
  const { geometry, material } = useMemo(
    () => ({
      geometry: new CircleGeometry(TABLE_RADIUS, 96).rotateX(-Math.PI / 2),
      material: new ShaderMaterial({
        uniforms: {
          uGlass: { value: new Color('#05080f') },
          uLight: { value: new Color(PALETTE.emitter) },
          uDeep: { value: new Color(PALETTE.projectorDeep) },
          uAperture: { value: APERTURE },
          uRadius: { value: TABLE_RADIUS },
        },
        vertexShader: floorVertex,
        fragmentShader: tableTopFragment,
      }),
    }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return (
    <mesh geometry={geometry} material={material} position={[0, TABLE_Y, 0]} raycast={noRaycast} />
  );
};

const TableBody = () => {
  const { side, band, bandMaterial, sideMaterial } = useMemo(() => {
    const h = TABLE_Y - FLOOR_Y;
    return {
      side: new CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS * 0.86, h, 96, 1, true).translate(
        0,
        FLOOR_Y + h / 2,
        0,
      ),
      band: new CylinderGeometry(TABLE_RADIUS + 0.004, TABLE_RADIUS + 0.004, 0.025, 96, 1, true),
      sideMaterial: new MeshLambertMaterial({ color: '#0b0f1a' }),
      bandMaterial: withTowerMask(
        new MeshBasicMaterial({
          color: new Color(PALETTE.emitter).multiplyScalar(0.3),
          toneMapped: false,
          fog: false,
        }),
        0,
      ),
    };
  }, []);
  useEffect(
    () => () => {
      side.dispose();
      band.dispose();
      sideMaterial.dispose();
      bandMaterial.dispose();
    },
    [side, band, sideMaterial, bandMaterial],
  );
  return (
    <>
      <mesh geometry={side} material={sideMaterial} raycast={noRaycast} />
      <mesh
        geometry={band}
        material={bandMaterial}
        position={[0, TABLE_Y - 0.06, 0]}
        raycast={noRaycast}
      />
    </>
  );
};

// The faint curtain of light rising from the aperture ring
const curtainVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vWorld;
  varying float vY;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vY = world.y;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = cameraPosition - world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const curtainFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uBase;
  uniform float uHeight;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vWorld;
  varying float vY;
  ${TOWER_MASK}
  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float edge = pow(1.0 - facing, 1.6);
    float k = (vY - uBase) / uHeight;
    float rise = exp(-k * 5.0) * (1.0 - smoothstep(0.6, 1.0, k));
    // Projected light, not haze: fine vertical striations round the ring
    float ang = atan(vWorld.z, vWorld.x);
    float rays = 0.5 + 0.5 * sin(ang * 120.0 + 2.0 * sin(ang * 37.0));
    rays = mix(0.25, 1.0, rays * rays);
    // Seen from above, the curtain's wall would stack into a bright ring
    float steep = abs(normalize(vView).y);
    float a = (0.003 + edge * 0.014) * rise * rays * (1.0 - smoothstep(0.5, 0.8, steep));
    a *= towerMask(vWorld, 0.0);
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

const Curtain = () => {
  const height = FRAME.levelY[4] + 1.2 - TABLE_Y;
  const { geometry, material } = useMemo(
    () => ({
      geometry: new CylinderGeometry(APERTURE + 0.05, APERTURE, height, 96, 1, true).translate(
        0,
        TABLE_Y + height / 2,
        0,
      ),
      material: new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: BackSide,
        uniforms: {
          uColor: { value: new Color(PALETTE.curtain) },
          uBase: { value: TABLE_Y },
          uHeight: { value: height },
        },
        vertexShader: curtainVertex,
        fragmentShader: curtainFragment,
      }),
    }),
    [height],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return <mesh geometry={geometry} material={material} renderOrder={-10} raycast={noRaycast} />;
};

// --- Plinths and holographic studies ------------------------------------------------------

/** Three great circles of a sphere, as line segments. */
const gyroscope = (radius: number, steps: number): BufferGeometry => {
  const points: number[] = [];
  for (let ring = 0; ring < 3; ring++) {
    for (let i = 0; i < steps; i++) {
      for (const k of [i, i + 1]) {
        const a = (k / steps) * Math.PI * 2;
        const [u, v] = [Math.cos(a) * radius, Math.sin(a) * radius];
        points.push(...(ring === 0 ? [u, v, 0] : ring === 1 ? [0, u, v] : [v, 0, u]));
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(points), 3));
  return g;
};

// Angles chosen against the opening view (the same camera for both seats):
// the studies in frame stand clear of the tower's outline, and any study
// behind the tower from another side is hidden by the tower mask.
const STUDIES: { angle: number; radius: number; height: number; form: () => BufferGeometry }[] = [
  {
    angle: 22,
    radius: 16.5,
    height: 1.3,
    form: () => new WireframeGeometry(new TorusKnotGeometry(0.42, 0.1, 40, 4)),
  },
  {
    angle: 75,
    radius: 18,
    height: 1.7,
    form: () => new EdgesGeometry(new IcosahedronGeometry(0.62, 1)),
  },
  {
    angle: 120,
    radius: 17,
    height: 1.1,
    // An architectural model: stacked, turned slabs
    form: () => {
      const slabs = [0, 1, 2, 3, 4, 5].map((i) =>
        new EdgesGeometry(new BoxGeometry(0.9 - i * 0.1, 0.16, 0.6 - i * 0.05))
          .rotateY(i * 0.22)
          .translate(0, i * 0.22, 0),
      );
      return mergeGeometries(slabs);
    },
  },
  {
    angle: 158,
    radius: 18.5,
    height: 1.5,
    form: () => new EdgesGeometry(new DodecahedronGeometry(0.55, 0)),
  },
  {
    angle: 240,
    radius: 16.5,
    height: 1.25,
    // A gyroscope: three rings, each turned a quarter from the last
    form: () => gyroscope(0.5, 48),
  },
  {
    angle: 290,
    radius: 18,
    height: 1.8,
    // A twisted tower study
    form: () => {
      const floors = Array.from({ length: 9 }, (_, i) =>
        new EdgesGeometry(new BoxGeometry(0.5, 0.001, 0.5))
          .rotateY(i * 0.14)
          .translate(0, i * 0.15, 0),
      );
      return mergeGeometries(floors);
    },
  },
  {
    angle: 335,
    radius: 17.5,
    height: 1.2,
    form: () => new EdgesGeometry(new OctahedronGeometry(0.55, 0)),
  },
];

const Studies = () => {
  const parts = useMemo(() => {
    const plinth = new BoxGeometry(1.5, 1, 1.5).translate(0, 0.5, 0);
    const cap = new BoxGeometry(1.26, 0.02, 1.26);
    const plinthMaterial = withTowerMask(new MeshLambertMaterial({ color: PALETTE.plinth }), 0);
    const capMaterial = new MeshBasicMaterial({
      color: new Color(PALETTE.holo).multiplyScalar(0.07),
      toneMapped: false,
    });
    withTowerMask(capMaterial, 0);
    const lineMaterial = new LineBasicMaterial({
      color: PALETTE.holo,
      transparent: true,
      opacity: 0.13,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    withTowerMask(lineMaterial, 0);
    const forms = STUDIES.map((s) => s.form());
    return { plinth, cap, plinthMaterial, capMaterial, lineMaterial, forms };
  }, []);
  useEffect(
    () => () => {
      parts.plinth.dispose();
      parts.cap.dispose();
      parts.plinthMaterial.dispose();
      parts.capMaterial.dispose();
      parts.lineMaterial.dispose();
      parts.forms.forEach((f) => f.dispose());
    },
    [parts],
  );
  return (
    <group name="lumen-studies">
      {STUDIES.map((s, i) => {
        const a = (s.angle * Math.PI) / 180;
        const x = Math.sin(a) * s.radius;
        const z = Math.cos(a) * s.radius;
        return (
          <group key={i} position={[x, FLOOR_Y, z]} rotation={[0, a * 0.7, 0]}>
            <mesh
              geometry={parts.plinth}
              material={parts.plinthMaterial}
              scale={[1, s.height, 1]}
              raycast={noRaycast}
            />
            <mesh
              geometry={parts.cap}
              material={parts.capMaterial}
              position={[0, s.height + 0.012, 0]}
              raycast={noRaycast}
            />
            <lineSegments
              geometry={parts.forms[i]}
              material={parts.lineMaterial}
              position={[0, s.height + 1.25, 0]}
              scale={1.4}
              rotation={[0.3 * (i % 2), i * 0.8, 0]}
              raycast={noRaycast}
            />
          </group>
        );
      })}
    </group>
  );
};

// --- Drafting displays ------------------------------------------------------------------

// Floating in the gloom, a few holographic drafting boards: elevation
// drawings of the very pieces on the board, their turned profiles mirrored
// about a dashed axis, over a faint grid, as a design studio would have them
// up. Faint, still, and set round the whole room.

const DRAWINGS: { name: string; profiles: Profile[] }[] = [
  { name: 'PAWN', profiles: [PROFILES.pawn.body, PROFILES.pawn.collar] },
  {
    name: 'BISHOP',
    profiles: [
      PROFILES.bishop.body,
      PROFILES.bishop.collar,
      PROFILES.bishop.bead,
      PROFILES.bishop.mitre,
      PROFILES.bishop.finial,
    ],
  },
  {
    name: 'QUEEN',
    profiles: [
      PROFILES.queen.body,
      PROFILES.queen.collar,
      PROFILES.queen.crown,
      PROFILES.queen.dome,
    ],
  },
  {
    name: 'KING',
    profiles: [PROFILES.king.body, PROFILES.king.collar, PROFILES.king.crown, PROFILES.king.cap],
  },
];

const drafting = (profiles: Profile[], name: string): CanvasTexture => {
  const W = 384;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  // A CPU canvas: painting through a software GPU (the review machine's)
  // would stall the first frame for a long time
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, W, H);
  // A frame and a faint grid
  ctx.strokeStyle = 'rgba(160, 215, 255, 0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(6, 6, W - 12, H - 12);
  ctx.strokeStyle = 'rgba(160, 215, 255, 0.09)';
  ctx.lineWidth = 1;
  for (let x = 6; x < W; x += 24) {
    ctx.beginPath();
    ctx.moveTo(x, 6);
    ctx.lineTo(x, H - 6);
    ctx.stroke();
  }
  for (let y = 6; y < H; y += 24) {
    ctx.beginPath();
    ctx.moveTo(6, y);
    ctx.lineTo(W - 6, y);
    ctx.stroke();
  }
  // The piece in elevation, about a dashed axis
  const scale = 440;
  const baseY = H - 50;
  const cx = W / 2;
  ctx.setLineDash([10, 6]);
  ctx.strokeStyle = 'rgba(160, 215, 255, 0.35)';
  ctx.beginPath();
  ctx.moveTo(cx, 30);
  ctx.lineTo(cx, H - 24);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(200, 235, 255, 0.95)';
  ctx.lineWidth = 2;
  for (const profile of profiles) {
    const pts = sampleProfile(profile, 0.004);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      pts.forEach(([r, y], i) => {
        const x = cx + side * r * scale;
        const yy = baseY - y * scale;
        if (i === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      });
      ctx.stroke();
    }
  }
  // A ground line, a height dimension and the title
  ctx.strokeStyle = 'rgba(160, 215, 255, 0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(30, baseY + 0.5);
  ctx.lineTo(W - 30, baseY + 0.5);
  ctx.moveTo(W - 44, baseY);
  ctx.lineTo(W - 44, 40);
  ctx.moveTo(W - 50, 40);
  ctx.lineTo(W - 38, 40);
  ctx.stroke();
  ctx.fillStyle = 'rgba(190, 228, 255, 0.7)';
  ctx.font = '600 18px "Space Grotesk", system-ui, sans-serif';
  ctx.fillText(name, 22, 34);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
};

const DISPLAYS = [
  { angle: 52, radius: 21, y: 0.2 },
  { angle: 142, radius: 22, y: 0.8 },
  { angle: 205, radius: 21.5, y: -0.2 },
  { angle: 262, radius: 22, y: 0.5 },
];

const DraftingDisplays = () => {
  const materials = useMemo(
    () =>
      DRAWINGS.map((d) =>
        withTowerMask(
          new MeshBasicMaterial({
            map: drafting(d.profiles, d.name),
            transparent: true,
            opacity: 0.32,
            blending: AdditiveBlending,
            depthWrite: false,
            side: DoubleSide,
            color: new Color(PALETTE.holo),
            fog: false,
          }),
          0,
        ),
      ),
    [],
  );
  const plane = useMemo(() => new PlaneGeometry(3, 4), []);
  useEffect(
    () => () => {
      materials.forEach((m) => {
        m.map?.dispose();
        m.dispose();
      });
      plane.dispose();
    },
    [materials, plane],
  );
  return (
    <group name="lumen-displays">
      {DISPLAYS.map((d, i) => {
        const a = (d.angle * Math.PI) / 180;
        return (
          <mesh
            key={i}
            geometry={plane}
            material={materials[i % materials.length]}
            position={[Math.sin(a) * d.radius, d.y, Math.cos(a) * d.radius]}
            // Facing the table
            rotation={[0, a + Math.PI, 0]}
            renderOrder={-900}
            raycast={noRaycast}
          />
        );
      })}
    </group>
  );
};

// --- Lights -------------------------------------------------------------------------------

const UP = new Vector3(0, 1, 0);
const forward = new Vector3();
const right = new Vector3();
const origin = new Vector3();

/**
 * A soft key above the camera's left shoulder and a cool fill low on its
 * right, riding with the camera, so the pieces are modelled the same way
 * from every side and both seats.
 */
const CameraLights = () => {
  const key = useRef<DirectionalLight>(null);
  const fill = useRef<DirectionalLight>(null);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target?: Vector3 } | null;
  useFrame(() => {
    const target = controls?.target ?? origin;
    forward.copy(target).sub(camera.position).normalize();
    right.crossVectors(forward, UP).normalize();
    for (const [light, back, side, up] of [
      [key.current, 8, -5, 9],
      [fill.current, 6, 7, 1],
    ] as const) {
      if (!light) continue;
      light.position
        .copy(target)
        .addScaledVector(forward, -back)
        .addScaledVector(right, side)
        .addScaledVector(UP, up);
      light.target.position.copy(target);
      light.target.updateMatrixWorld();
    }
    // The pieces' ceramic shader reads the same rig
    if (key.current) rig.key.value.copy(key.current.position).sub(target).normalize();
    if (fill.current) rig.fill.value.copy(fill.current.position).sub(target).normalize();
  });
  return (
    <>
      <directionalLight ref={key} intensity={2.3} color="#f4f6ff" />
      <directionalLight ref={fill} intensity={0.55} color="#9cc4ff" />
    </>
  );
};

export const Stage = () => (
  <>
    <GradientSky
      top={PALETTE.skyTop}
      horizon={PALETTE.skyHorizon}
      bottom={PALETTE.skyBottom}
      exponent={0.6}
    />
    <GlassWall />
    <Floor />
    <TableBody />
    <TableTop />
    <Curtain />
    <Studies />
    <DraftingDisplays />
    {/* Cool light from above, and the table's glow from below */}
    <hemisphereLight args={['#c9d6ff', '#2a3a52', 0.75]} />
    <CameraLights />
  </>
);
