import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import {
  BackSide,
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  LinearFilter,
  RepeatWrapping,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { DirectionalLight } from 'three';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';
import { CLOUD, SKY } from './palette';

// A sunny afternoon above a sea of cumulus. The opening view (the same for
// both seats: Black's board is walked round, the camera is not) looks
// toward the sun, which stands off its upper right: the clouds behind the
// tower are backlit, lilac bodies with cream linings, and turn front-lit and
// creamy as the camera swings away from the sun. The horizon glows peach and
// the sky deepens to a clear blue overhead.
//
// The clouds are painted once, as an illustration, into a panorama indexed
// by direction (azimuth and elevation), so they never smear the way a
// texture projected onto a far plane does at grazing angles. Nothing here
// moves: anything drifting behind the tower would show through every plate.

const DEG = Math.PI / 180;

// World azimuth (atan2(x, z)) and elevation of the sun. The opening camera
// (the same for both seats) looks toward azimuth -164° and 18° down, so the
// top of its view is the horizon: the sun stands just above the clouds, 24°
// to the right of the tower, at the top of the view's right side, clear of
// the pieces, and the clouds right behind the tower stay mid-toned.
const SUN_AZIMUTH = 172 * DEG;
const SUN_ELEVATION = 1.5 * DEG;
const SUN = new Vector3(
  Math.sin(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
  Math.sin(SUN_ELEVATION),
  Math.cos(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
);

// The panorama covers every azimuth and elevations from TOP down to BOTTOM.
const TOP = 16;
const BOTTOM = -82;
const W = 4096;
const H = 1024;
const MARGIN = 64;
const BLUR = 3;
/** The sunlit lining of a puff is at most this thick (pixels): a rim, never a field. */
const LINING_PX = 9;

const hex = (c: string) => new Color(c);
const mixCss = (a: Color, b: Color, t: number) => `#${a.clone().lerp(b, t).getHexString()}`;

/**
 * Paints the cloud sea: rows of cumulus from the horizon down, each row's
 * clouds sized by perspective (a flat sea far below, so a cloud at
 * elevation e is tan|e| times as big as one on the horizon), far rows first
 * so nearer clouds overlap them. Each cloud is a cluster of puffs shaded by
 * where it stands against the sun: backlit toward it (lilac with a cream
 * lining), front-lit away from it (cream over a warm lilac belly). Far rows
 * melt into the horizon haze.
 */
const paintClouds = () => {
  // Painted with a margin on both sides (the wrapped copies of the edge
  // clouds), so the soft-focus blur runs continuously across the seam
  const c = document.createElement('canvas');
  c.width = W + MARGIN * 2;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.translate(MARGIN, 0);
  const random = rng(29);
  const pxPerRad = W / (Math.PI * 2);
  const yOf = (e: number) => ((TOP - e) / (TOP - BOTTOM)) * H;
  const light = hex(CLOUD.light);
  const warm = hex(CLOUD.warm);
  const mid = hex(CLOUD.mid);
  const shadow = hex(CLOUD.shadow);
  const deep = hex(CLOUD.deep);
  const haze = hex(SKY.haze);
  const gold = hex('#ffe2b0');

  /** One puff: an ellipse with a vertical gradient from its lit top to its belly. */
  const puff = (
    x: number,
    y: number,
    rx: number,
    ry: number,
    top: string,
    body: string,
    belly: string,
    lining: number,
  ) => {
    for (const dx of [0, -W, W]) {
      const cx = x + dx;
      if (cx + rx < -MARGIN || cx - rx > W + MARGIN) continue;
      const g = ctx.createLinearGradient(0, y - ry, 0, y + ry);
      // A thin sunlit lining, then the body, shading down to the belly: in a
      // dense sea mostly the upper parts of puffs show, so the cream stays a rim
      g.addColorStop(0, top);
      g.addColorStop(Math.min(lining, LINING_PX / (2 * ry)), body);
      g.addColorStop(0.6, belly);
      g.addColorStop(1, belly);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  /** A cloud: a soft shadow on what lies below it, then its puffs, tallest in the middle. */
  const cloud = (azimuth: number, e: number, widthRad: number, heightRad: number, far: number) => {
    const x = ((azimuth + Math.PI) / (Math.PI * 2)) * W;
    const y = yOf(e);
    const stretch = 1 / Math.max(Math.cos(e * DEG), 0.25);
    const w = widthRad * pxPerRad * stretch;
    const h = heightRad * pxPerRad;
    // Every cloud is sunlit from above: a cream top, a warm body and a lilac
    // belly. Toward the sun the lining turns golden and the body a little
    // cooler; the far rows melt into the haze.
    const facing = Math.cos(azimuth - SUN_AZIMUTH);
    const toward = Math.min(Math.max(facing, 0), 1) ** 2;
    const shade = (col: Color) => mixCss(col, haze, far);
    const top = shade(light.clone().lerp(gold, toward * 0.6));
    const body = shade(warm.clone().lerp(mid, 0.6 + toward * 0.25));
    const belly = shade(shadow.clone().lerp(deep, 0.35 + toward * 0.3));
    const lining = 0.1 + toward * 0.03;
    // Ambient occlusion under the cloud, on the clouds behind it
    ctx.fillStyle = mixCss(deep, haze, far);
    ctx.globalAlpha = 0.3 * (1 - far);
    for (const dx of [0, -W, W]) {
      ctx.beginPath();
      ctx.ellipse(x + dx, y + h * 0.35, w * 0.55, h * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const n = 3 + Math.floor(random() * 3);
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0.5 : i / (n - 1);
      const bump = Math.sin(u * Math.PI);
      const rx = w * (0.16 + 0.12 * bump + random() * 0.05);
      const ry = h * (0.3 + 0.35 * bump + random() * 0.1);
      const px = x + (u - 0.5) * w * 0.72 + (random() - 0.5) * w * 0.08;
      const py = y - ry * 0.55 + h * 0.2 + (random() - 0.5) * h * 0.1;
      puff(px, py, rx, ry, top, body, belly, lining);
    }
  };

  // A few towering cumulus heads standing out of the sea on the horizon
  for (let i = 0; i < 7; i++) {
    const az = -Math.PI + ((i + random() * 0.6) / 7) * Math.PI * 2;
    const size = 0.09 + random() * 0.08;
    cloud(az, 1.2 + random() * 1.4, size * 1.5, size * 1.1, 0.5);
  }
  // The sea, from the horizon toward the viewer. Clouds in a row vary in
  // size (a few big heaps among smaller ones), so the sea never reads as a
  // quilt of equal scallops.
  const K = 0.46;
  let e = -1.5;
  while (e > BOTTOM + 4) {
    const t = Math.tan(-e * DEG);
    const a = Math.min(K * t, 1.1);
    const h = a * (0.26 + 0.5 * Math.sin(-e * DEG));
    const far = Math.min(Math.max((e + 16) / 14, 0), 1) ** 1.3 * 0.75;
    let az = -Math.PI + random() * a;
    const step = a / Math.max(Math.cos(e * DEG), 0.25);
    while (az < Math.PI) {
      const k = random() < 0.2 ? 1.5 + random() * 0.5 : 0.65 + random() * 0.5;
      cloud(az, e + (random() - 0.5) * h * 0.4 * (180 / Math.PI), a * k, h * k, far);
      az += step * k * (0.55 + random() * 0.45);
    }
    e -= Math.max(0.35, (h / DEG) * 0.42);
  }
  // Soft focus: the tower is the subject; the sea behind it stays calm
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const octx = out.getContext('2d')!;
  octx.filter = `blur(${BLUR}px)`;
  octx.drawImage(c, -MARGIN, 0);
  // Kept as raw sRGB values and decoded in the sky shader, which knows it
  const t = new CanvasTexture(out);
  t.wrapS = RepeatWrapping;
  t.wrapT = ClampToEdgeWrapping;
  // Row 0 of the canvas is the top of the panorama (v = 0 in the sky shader)
  t.flipY = false;
  // Magnified in every view: no mipmaps, so no seam where azimuth wraps
  t.generateMipmaps = false;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  return t;
};

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const skyFragment = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uUpper;
  uniform vec3 uHorizon;
  uniform vec3 uHaze;
  uniform vec3 uBelow;
  uniform vec3 uSun;
  uniform vec3 uSunDir;
  uniform sampler2D uClouds;
  uniform float uTop;
  uniform float uBottom;
  varying vec3 vDir;
  const float PI = 3.14159265;
  void main() {
    vec3 d = normalize(vDir);
    float el = asin(clamp(d.y, -1.0, 1.0));
    vec3 col;
    if (el > 0.0) {
      col = mix(uHorizon, uUpper, smoothstep(0.0, 0.3, el));
      col = mix(col, uZenith, smoothstep(0.2, 1.2, el));
    } else {
      // The shade under the cloud sea, hazing toward the horizon
      col = mix(uHaze, uBelow, smoothstep(0.0, 0.35, -el));
    }
    // The painted clouds
    vec2 uv = vec2(atan(d.x, d.z) / (2.0 * PI) + 0.5, (uTop - el) / (uTop - uBottom));
    if (uv.y > 0.0 && uv.y < 1.0) {
      vec4 cloud = texture2D(uClouds, uv);
      vec3 lin = mix(
        cloud.rgb / 12.92,
        pow((cloud.rgb + 0.055) / 1.055, vec3(2.4)),
        step(0.04045, cloud.rgb)
      );
      col = mix(col, lin, cloud.a);
    }
    // A warm haze where sky meets cloud
    col = mix(col, uHaze, exp(-abs(el) * 26.0) * 0.5);
    // The sun, over everything: a small disc in a wide, soft glow that warms
    // the clouds and the horizon on its side
    float s = max(dot(d, uSunDir), 0.0);
    col = mix(col, uSun, pow(s, 900.0) + pow(s, 60.0) * 0.35 + pow(s, 8.0) * 0.3);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const Sky = () => {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uZenith: { value: new Color(SKY.zenith) },
          uUpper: { value: new Color(SKY.upper) },
          uHorizon: { value: new Color(SKY.horizon) },
          uHaze: { value: new Color(SKY.haze) },
          uBelow: { value: new Color(SKY.below) },
          uSun: { value: new Color(SKY.sun) },
          uSunDir: { value: SUN },
          uClouds: { value: paintClouds() },
          uTop: { value: TOP * DEG },
          uBottom: { value: BOTTOM * DEG },
        },
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
      }),
    [],
  );
  return (
    <mesh material={material} raycast={noRaycast} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[90, 48, 24]} />
    </mesh>
  );
};

// --- Light ---------------------------------------------------------------------------

const KEY = new Vector3(5, 7, 3);
const RIM = new Vector3(6, 5, -26);
const at = new Vector3();

/**
 * Lights that ride with the camera: a warm key from above the player's
 * right shoulder and a sunny rim from behind the tower on the same side as
 * the sun in the opening view, so every toy is lit the same way from any
 * angle and either seat (no dark backlit side, no specular glare swinging
 * into view as the camera orbits).
 */
const CameraLights = () => {
  const key = useRef<DirectionalLight>(null);
  const rim = useRef<DirectionalLight>(null);
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    key.current?.position.copy(camera.localToWorld(at.copy(KEY)));
    rim.current?.position.copy(camera.localToWorld(at.copy(RIM)));
  });
  return (
    <>
      <directionalLight ref={key} intensity={2.0} color="#fff1dc" />
      <directionalLight ref={rim} intensity={1.5} color="#ffe6cf" />
    </>
  );
};

export const Stage = () => (
  <>
    <Sky />
    <Environment resolution={64} frames={1}>
      <mesh scale={40}>
        <sphereGeometry args={[1, 16, 8]} />
        <meshBasicMaterial side={BackSide} color="#a9c6f2" />
      </mesh>
      <Lightformer
        form="rect"
        intensity={2.4}
        color="#fff4e4"
        position={[2, 8, 3]}
        rotation-x={Math.PI / 2}
        scale={[10, 6, 1]}
      />
      <Lightformer
        form="rect"
        intensity={1.2}
        color="#ffffff"
        position={[0, 2, 9]}
        scale={[10, 3, 1]}
      />
      <Lightformer
        form="rect"
        intensity={0.7}
        color="#f3d6ff"
        position={[0, -5, 0]}
        rotation-x={-Math.PI / 2}
        scale={[14, 14, 1]}
      />
    </Environment>
    <hemisphereLight args={['#e3f0ff', '#e9c9d9', 0.95]} />
    <CameraLights />
  </>
);
