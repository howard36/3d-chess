import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  ShaderMaterial,
  Vector3,
} from 'three';
import { noRaycast } from '../noRaycast';
import { useDisposeOnUnmount } from './dispose';
import { rng } from './textures';
import { shadeUniforms, TOWER_SHADE } from './mask';
import { SKY_DETAIL } from './palette';
import { starBuffers } from './skyChart';
import { DEG, DOME } from './skyPlace';
import { skyPointMaterial } from './skyShaders';

// The Milky Way (envPreview `milkyWay: faint | clear`): a band of soft light
// on a great circle tilted to the horizon, so that in the low sky a camera
// can see it rises out of the horizon's haze as a leaning column on two
// opposite sides (between the king and the bishop, the brighter, wider
// side, split by a dark lane of dust; and through the unicorn, fainter),
// steep enough that each stands whole beside the tower when the camera
// looks up a little to one side of it, and is absent from the rest. The glow is worked out per vertex
// on a strip of mesh lying along the band, so a fragment only reads its
// light and the tower's shade, and only where the band is; a dust of faint
// stars gathers in it.

/** Where the band rises out of the horizon (degrees round from +z toward +x). */
export const BAND_NODE = 236;
/** Its tilt to the horizon (degrees). */
export const BAND_TILT = 68;
/** The radius it is drawn at: between the stars' dome and the sky's sphere. */
const BAND_RADIUS = 350;
/** Its half-width (degrees) and the strip's, which reaches well past the glow. */
const SIGMA = 6.5;
const HALF = 20;

/** The band's frame: a point on its middle line at `phi` (radians from the node), and its pole. */
export const bandFrame = () => {
  const n = BAND_NODE * DEG;
  const a = BAND_TILT * DEG;
  const node = new Vector3(Math.sin(n), 0, Math.cos(n));
  // Toward increasing azimuth, tipped up by the tilt
  const rise = new Vector3(Math.cos(n), 0, -Math.sin(n))
    .multiplyScalar(Math.cos(a))
    .add(new Vector3(0, Math.sin(a), 0));
  const pole = node.clone().cross(rise).normalize();
  const at = (phi: number, beta = 0) =>
    node
      .clone()
      .multiplyScalar(Math.cos(phi))
      .addScaledVector(rise, Math.sin(phi))
      .multiplyScalar(Math.cos(beta))
      .addScaledVector(pole, Math.sin(beta))
      .normalize();
  return { at };
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * The band's light at a point of it (0–1): `phi` along it from the node
 * (radians, 0–π the part above the horizon), `beta` across it (radians).
 */
export const bandLight = (phi: number, beta: number, elevation: number) => {
  const b = beta / DEG;
  const p = phi / DEG;
  // The side rising at the node is the bright one, the far side quieter
  const side = p < 90 ? 1 : 0.62;
  const width = SIGMA * (p < 90 ? 1 : 0.8);
  let glow = Math.exp(-((b / width) ** 2));
  // A narrower, brighter spine, lumpy along its length
  glow += 0.45 * Math.exp(-((b / (width * 0.38)) ** 2)) * (0.7 + 0.3 * Math.sin(p * 0.21 + 1));
  // The dark lane of dust, wandering a little off the middle
  const lane = 0.9 + 1.1 * Math.sin(p * 0.07 + 0.6);
  glow *= 1 - (p < 90 ? 0.62 : 0.4) * Math.exp(-(((b - lane) / 1.5) ** 2));
  // Clouds along it
  glow *= 0.75 + 0.18 * Math.sin(p * 0.29 + 0.4) + 0.12 * Math.sin(p * 0.53 + b * 0.25 + 2.1);
  // Swallowed by the haze near the horizon
  const haze = smooth(-0.5, 9, elevation);
  return Math.max(0, (glow / 1.45) * side * haze);
};

const bandGeometry = () => {
  const { at } = bandFrame();
  const along = Math.round(188 / 0.75);
  const across = Math.round((2 * HALF) / 1.5) + 1;
  const pos: number[] = [];
  const light: number[] = [];
  for (let i = 0; i <= along; i++) {
    const phi = (-4 + i * 0.75) * DEG;
    for (let j = 0; j < across; j++) {
      const beta = (-HALF + j * 1.5) * DEG;
      const d = at(phi, beta);
      const el = Math.asin(d.y) / DEG;
      pos.push(d.x * BAND_RADIUS, d.y * BAND_RADIUS, d.z * BAND_RADIUS);
      light.push(el < -1 || el > 40 ? 0 : bandLight(phi, beta, el));
    }
  }
  // Only the quads with some light: the rest of the circle draws nothing
  const index: number[] = [];
  for (let i = 0; i < along; i++) {
    for (let j = 0; j < across - 1; j++) {
      const a = i * across + j;
      const q = [a, a + 1, a + across, a + across + 1];
      if (Math.max(...q.map((k) => light[k])) < 0.004) continue;
      index.push(q[0], q[2], q[1], q[1], q[2], q[3]);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aLight', new BufferAttribute(new Float32Array(light), 1));
  g.setIndex(index);
  return g;
};

/** The dust of faint stars gathered in the band. */
const dustGeometry = (count: number) => {
  const random = rng(131);
  const { at } = bandFrame();
  const white = new Color(SKY_DETAIL.starWhite);
  const blue = new Color(SKY_DETAIL.starBlue);
  const pos: number[] = [];
  const size: number[] = [];
  const bright: number[] = [];
  const color: number[] = [];
  let tries = 0;
  while (pos.length < count * 3 && tries++ < count * 40) {
    const phi = (random() * 184 - 2) * DEG;
    // Gathered toward the middle: a sum of uniforms is near Gaussian
    const beta = (random() + random() + random() - 1.5) * SIGMA * 1.3 * DEG;
    const d = at(phi, beta);
    const el = Math.asin(d.y) / DEG;
    if (el < 1 || el > 37) continue;
    const l = bandLight(phi, beta, el);
    if (random() > l * 1.3) continue;
    pos.push(d.x * DOME, d.y * DOME, d.z * DOME);
    size.push(1 + random() * 0.25);
    bright.push((0.026 + random() ** 2 * 0.05) * (0.6 + 0.4 * l));
    const c = random() < 0.7 ? white : blue;
    color.push(c.r, c.g, c.b);
  }
  return starBuffers(pos, size, bright, color);
};

const glowVertex = /* glsl */ `
  attribute float aLight;
  varying float vLight;
  void main() {
    vLight = aLight;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const glowFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uGain;
  varying float vLight;
  ${TOWER_SHADE}
  void main() {
    float a = vLight * uGain;
    if (a < 2e-5) discard;
    a *= 1.0 - towerShade();
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

/** How bright each choice is: the glow's peak (linear) and the dust's count and strength. */
const LOOK = {
  faint: { gain: 0.02, dust: 1100, dustOpacity: 0.9 },
  clear: { gain: 0.034, dust: 1600, dustOpacity: 1.2 },
};

export const MilkyWay = ({ look }: { look: 'faint' | 'clear' }) => {
  const dpr = useThree((s) => s.viewport.dpr);
  const parts = useMemo(() => {
    const l = LOOK[look];
    return {
      band: bandGeometry(),
      glow: new ShaderMaterial({
        // Seen from inside the sky, either way round
        side: DoubleSide,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          ...shadeUniforms(),
          uColor: { value: new Color(SKY_DETAIL.milkyWay) },
          uGain: { value: l.gain },
        },
        vertexShader: glowVertex,
        fragmentShader: glowFragment,
      }),
      dust: dustGeometry(l.dust),
      dustMaterial: skyPointMaterial({ opacity: l.dustOpacity }),
    };
  }, [look]);
  useDisposeOnUnmount(parts);
  parts.dustMaterial.uniforms.uDpr.value = dpr;
  return (
    <group name="milky-way">
      <mesh
        geometry={parts.band}
        material={parts.glow}
        renderOrder={-899}
        raycast={noRaycast}
        frustumCulled={false}
      />
      <points
        geometry={parts.dust}
        material={parts.dustMaterial}
        renderOrder={-899}
        raycast={noRaycast}
        frustumCulled={false}
      />
    </group>
  );
};
