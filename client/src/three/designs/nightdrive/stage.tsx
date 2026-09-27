import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  EquirectangularReflectionMapping,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';
import { SKY } from './palette';

// The world around the tower: a full 360° dusk. One shader paints the whole
// surround: a sky that darkens from a rose horizon glow to indigo overhead,
// a striped sun setting on one side, and an endless neon grid far below the
// tower, found by casting each pixel's view ray onto a ground plane. The
// ground is part of the sky dome, so there is no backdrop plane, no seam and
// no edge to find from any azimuth or elevation, and the horizon always sits
// exactly where it should.
//
// The grid scrolls slowly away from the sun, but never where it could be
// seen through the glass: every view ray that passes the tower's column
// finds bare ground, and the grid also fades out round the tower's foot. So
// the scroll only ever moves out to the sides, far from the board, and the
// tower always stands on calm, dark ground (nothing moves behind the plates).

/**
 * Where the sun sets: a little off the players' axis, behind the tower's
 * left shoulder. The opening view's frame ends about 3° above the horizon,
 * so there it is only a warm glow at the top left; tilt the view down
 * toward the horizon (or swing an eighth of a turn round) and the whole
 * striped disc stands beside the tower.
 */
export const SUN_DIR = new Vector3(-0.543, 0.078, -0.836).normalize();
/** Angular radius of the sun's disc (radians). */
const SUN_RADIUS = 0.14;
/**
 * Half-width of the calm corridor round the tower's column: the plates'
 * half-diagonal plus a margin, so no ray through the glass sees the grid.
 */
const CALM_RADIUS = 4.3;

/** World height of the grid plane: far below the bottom platform. */
const FLOOR_Y = -16;
/** Grid spacing on the ground: wide, so the pattern stays low-frequency. */
const CELL = 9;
/** Grid scroll speed (world units a second): a line crosses a cell in ~13 s. */
const SCROLL = 0.7;

const vertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const fragment = /* glsl */ `
  uniform float uTime;
  uniform float uGrid;
  uniform vec3 uSun;
  uniform float uSunSize;
  uniform float uFloor;
  uniform float uCell;
  uniform vec3 uZenith;
  uniform vec3 uHigh;
  uniform vec3 uLow;
  uniform vec3 uHorizon;
  uniform vec3 uSunGlow;
  uniform vec3 uGround;
  uniform vec3 uHaze;
  uniform vec3 uLine;
  uniform vec3 uSunTop;
  uniform vec3 uSunBottom;
  varying vec3 vWorld;

  void main() {
    vec3 d = normalize(vWorld - cameraPosition);
    float e = d.y;
    vec2 dh = normalize(d.xz + vec2(1e-5));
    vec2 sh = normalize(uSun.xz);
    // How far round the horizon this pixel is from the sun (1 facing it)
    float toward = dot(dh, sh) * 0.5 + 0.5;
    float sunSide = toward * toward * toward;
    // The horizon glows all the way round, warmer and stronger on the sun's side
    vec3 glow = mix(uHorizon, uSunGlow, sunSide * 0.85);
    float glowK = 0.42 + 0.33 * sunSide;

    vec3 col;
    if (e >= 0.0) {
      col = mix(uLow, uHigh, smoothstep(0.0, 0.3, e));
      col = mix(col, uZenith, smoothstep(0.28, 0.95, e));
      col = mix(col, glow, glowK * exp(-e * 11.0));

      // The sun: a disc facing the viewer, amber at the crown to magenta at
      // the foot, cut by slits that thicken toward the horizon (still)
      vec3 s = uSun;
      vec3 right = normalize(cross(s, vec3(0.0, 1.0, 0.0)));
      vec3 up = cross(right, s);
      float fwd = dot(d, s);
      if (fwd > 0.0) {
        vec2 p = vec2(dot(d, right), dot(d, up)) / fwd / uSunSize;
        float r = length(p);
        float aa = fwidth(r) * 1.5;
        vec3 sun = mix(uSunBottom, uSunTop, smoothstep(-0.7, 0.8, p.y));
        float gap = 0.0;
        if (p.y < 0.35) {
          float k = clamp((0.35 - p.y) / 1.2, 0.0, 1.0);
          float band = fract(p.y * 5.0);
          float w = 0.08 + k * 0.5;
          float fw = fwidth(p.y * 5.0) * 1.2;
          gap = 1.0 - smoothstep(w - fw, w, band) * (1.0 - smoothstep(1.0 - fw, 1.0, band));
        }
        // It sinks into the horizon haze: its foot fades out over the lowest
        // few degrees, so from the opening view (whose frame ends just above
        // the horizon) only a warm glow shows, never a cut-off disc
        float sink = smoothstep(0.004, 0.06, e);
        float disc = (1.0 - smoothstep(1.0 - aa, 1.0, r)) * (1.0 - gap) * sink;
        float halo = exp(-max(r - 1.0, 0.0) * 2.4) * (1.0 - step(r, 1.0) * (1.0 - gap));
        col += uSunGlow * halo * 0.3;
        // Held below white, so a pearl piece in front of it still reads
        col = mix(col, sun * 0.82, disc);
      }
    } else {
      // The ground: where this view ray meets the plane far below
      float h = max(cameraPosition.y - uFloor, 0.1);
      float t = h / -e;
      vec2 p = cameraPosition.xz + d.xz * t;
      float dist = t * length(d.xz);
      col = uGround;
      if (uGrid > 0.5) {
        // One set of lines runs toward the sun, the other across it, rolling
        // slowly away from the sun
        float along = dot(p, sh) + uTime * ${SCROLL.toFixed(2)};
        float across = dot(p, vec2(-sh.y, sh.x));
        vec2 g = vec2(across, along) / uCell;
        vec2 w = fwidth(g);
        vec2 f = abs(fract(g - 0.5) - 0.5);
        vec2 core = 1.0 - smoothstep(w * 0.4, w * 1.6 + 0.004, f);
        vec2 soft = exp(-f / (w * 2.5 + 0.012)) * 0.25;
        // Lines denser than a pixel fade out instead of shimmering
        vec2 fade = 1.0 - smoothstep(vec2(0.08), vec2(0.4), w);
        vec2 line = max(core, soft) * fade;
        // Bare ground round the tower's foot, and wherever the view ray
        // passes the tower's column (in plan): whatever is seen through the
        // glass is still
        float foot = smoothstep(9.0, 20.0, length(p));
        vec2 c = cameraPosition.xz;
        vec2 v = normalize(d.xz);
        float ahead = step(0.0, -dot(c, v));
        float miss = abs(c.x * v.y - c.y * v.x);
        float calm = ahead * (1.0 - smoothstep(${CALM_RADIUS.toFixed(1)}, ${(CALM_RADIUS + 2.4).toFixed(1)}, miss));
        // The near lines stay dimmer than the ones glowing toward the haze
        float reach = mix(0.45, 1.0, smoothstep(20.0, 70.0, dist));
        col += uLine * max(line.x, line.y) * foot * (1.0 - calm) * reach;
      }
      // Haze thickening toward the horizon, then the horizon's own glow
      col = mix(col, uHaze, smoothstep(18.0, 200.0, dist) * 0.92);
      col = mix(col, glow, glowK * exp(e * 38.0) * 0.9);
    }
    // A thin hot line right on the horizon
    col += glow * 0.2 * exp(-abs(e) * 220.0);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const skyMaterial = (grid: boolean) =>
  new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uGrid: { value: grid ? 1 : 0 },
      uSun: { value: SUN_DIR.clone() },
      uSunSize: { value: Math.tan(SUN_RADIUS) },
      uFloor: { value: FLOOR_Y },
      uCell: { value: CELL },
      uZenith: { value: new Color(SKY.zenith) },
      uHigh: { value: new Color(SKY.high) },
      uLow: { value: new Color(SKY.low) },
      uHorizon: { value: new Color(SKY.horizon) },
      uSunGlow: { value: new Color(SKY.sunGlow) },
      uGround: { value: new Color(SKY.ground) },
      uHaze: { value: new Color(SKY.haze) },
      uLine: { value: new Color(SKY.grid).multiplyScalar(0.34) },
      uSunTop: { value: new Color('#ffb25c') },
      uSunBottom: { value: new Color('#ff3f86') },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
  });

/** The sky, the sun and the endless grid, on one dome round the camera. */
const DuskDome = () => {
  const material = useMemo(() => skyMaterial(true), []);
  useEffect(() => () => material.dispose(), [material]);
  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });
  return (
    <mesh material={material} raycast={noRaycast} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[400, 48, 32]} />
    </mesh>
  );
};

/** A few faint, still stars high up: far above the horizon glow, never near the tower. */
const Stars = ({ count = 260, radius = 380 }: { count?: number; radius?: number }) => {
  const { geometry, material } = useMemo(() => {
    const random = rng(29);
    const pos = new Float32Array(count * 3);
    const bright = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // Elevations from ~22° up, thinning toward the horizon
      const e = 0.38 + random() ** 0.7 * 1.1;
      const a = random() * Math.PI * 2;
      pos.set(
        [
          radius * Math.cos(e) * Math.cos(a),
          radius * Math.sin(e),
          radius * Math.cos(e) * Math.sin(a),
        ],
        i * 3,
      );
      bright[i] = 0.25 + random() ** 3 * 0.75;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    geometry.setAttribute('aBright', new BufferAttribute(bright, 1));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: { uDpr: { value: 1 } },
      vertexShader: /* glsl */ `
        uniform float uDpr;
        attribute float aBright;
        varying float vAlpha;
        void main() {
          vec3 d = normalize(position);
          vAlpha = aBright * smoothstep(0.3, 0.55, d.y);
          gl_PointSize = (1.2 + aBright * 1.6) * uDpr;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float a = smoothstep(0.5, 0.15, length(gl_PointCoord - 0.5));
          gl_FragColor = vec4(vec3(1.0, 0.93, 1.0), a * vAlpha * 0.8);
        }`,
    });
    return { geometry, material };
  }, [count, radius]);
  const dpr = useThree((s) => s.viewport.dpr);
  material.uniforms.uDpr.value = dpr;
  return (
    <points
      geometry={geometry}
      material={material}
      raycast={noRaycast}
      frustumCulled={false}
      renderOrder={-999}
    />
  );
};

// --- Reflections ----------------------------------------------------------------------

/**
 * The environment the glossy pieces reflect: the same dusk, painted on an
 * equirectangular canvas (no grid, so reflections stay smooth), with three
 * soft panels placed like studio lights: a broad lilac key on the players'
 * side, and a hot-pink and a violet strip behind. Built once.
 */
const envTexture = (() => {
  let t: CanvasTexture | null = null;
  return () => {
    if (t) return t;
    const W = 512;
    const H = 256;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    // Rows by elevation: v = 0.5 is the horizon, the top row straight up
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, SKY.zenith);
    g.addColorStop(0.28, SKY.high);
    g.addColorStop(0.43, SKY.low);
    g.addColorStop(0.49, SKY.horizon);
    g.addColorStop(0.52, SKY.haze);
    g.addColorStop(0.62, '#1c0a33');
    g.addColorStop(1, SKY.ground);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Column for a world direction's azimuth (three's equirect mapping)
    const column = (x: number, z: number) => ((Math.atan2(z, x) / (2 * Math.PI) + 0.5) % 1) * W;
    const row = (elevation: number) => (0.5 - elevation / Math.PI) * H;
    const blob = (x: number, y: number, rx: number, ry: number, color: string, alpha: number) => {
      for (const dx of [-W, 0, W]) {
        ctx.save();
        ctx.translate(x + dx, y);
        ctx.scale(rx, ry);
        const r = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        r.addColorStop(0, color);
        r.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = alpha;
        ctx.fillStyle = r;
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    };
    ctx.globalCompositeOperation = 'lighter';
    // The sun's glow on the horizon
    blob(column(SUN_DIR.x, SUN_DIR.z), row(0.06), 70, 22, SKY.sunGlow, 0.9);
    // Key: a broad lilac softbox up on the players' side
    blob(column(0.35, 1), row(0.75), 90, 34, '#ffffff', 0.75);
    // Strips behind: magenta on the left, violet on the right
    blob(column(-0.8, -0.6), row(0.42), 10, 34, '#d946ef', 0.3);
    blob(column(0.9, -0.5), row(0.42), 10, 34, '#8a6cff', 0.4);
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    tex.mapping = EquirectangularReflectionMapping;
    t = tex;
    return tex;
  };
})();

const Reflections = () => {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const previous = scene.environment;
    scene.environment = envTexture();
    return () => {
      scene.environment = previous;
    };
  }, [scene]);
  return null;
};

// --- HUD ----------------------------------------------------------------------------

// The HUD variables dress the panels; the turn banner's display face and the
// neon text glow need a few rules of their own, as does the result card's
// title (an Orbitron line under a small 'Game over' kicker), scoped to this
// design.
const HUD_CSS = `
[data-testid="turn-indicator"] {
  font-family: 'Orbitron', 'Rajdhani', sans-serif !important;
  font-weight: 700 !important;
  text-shadow: 0 0 6px rgba(217, 70, 239, 0.6), 0 0 18px rgba(217, 70, 239, 0.32);
}
#end-game-title {
  font-family: 'Orbitron', 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 20px;
  line-height: 1.35;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #fbeaff;
  text-shadow: 0 0 8px rgba(217, 70, 239, 0.75), 0 0 22px rgba(217, 70, 239, 0.35);
}
#end-game-title::before {
  content: 'Game over';
  display: block;
  margin-bottom: 10px;
  font-family: 'Rajdhani', sans-serif;
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.42em;
  color: rgba(214, 200, 255, 0.7);
  text-shadow: none;
}
`;
const useHudStyle = () => {
  useEffect(() => {
    const style = document.createElement('style');
    style.dataset.design = 'nightdrive';
    style.textContent = HUD_CSS;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
};

// --- Stage ---------------------------------------------------------------------------

export const Stage = () => {
  useHudStyle();
  return (
    <>
      <DuskDome />
      <Stars />
      <Reflections />
      <hemisphereLight args={['#d9d2ff', '#2a0d3c', 0.6]} />
      {/* Key: cool white from the players' side, high and to the right */}
      <directionalLight position={[5, 9, 8]} intensity={1.9} color="#ffffff" />
      {/* The sunset behind the tower's left shoulder: a warm edge on every piece */}
      <directionalLight
        position={[SUN_DIR.x * 10, 3, SUN_DIR.z * 10]}
        intensity={0.7}
        color="#ffd2bf"
      />
      {/* A faint violet fill from the left, so shadowed sides never go dead */}
      <directionalLight position={[-7, 3, 5]} intensity={0.3} color="#b4b8ff" />
    </>
  );
};
