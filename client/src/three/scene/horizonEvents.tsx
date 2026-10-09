import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Matrix4,
  ShaderMaterial,
  Vector3,
} from 'three';
import { noRaycast } from '../noRaycast';
import { useDisposeOnUnmount } from './dispose';
import { shadeUniforms, TOWER_SHADE } from './mask';
import { GROUND_Y, HORIZON } from './palette';
import { rng } from './textures';

// A rare event at the horizon, for a player who lingers on a low view: once
// in a few minutes, a lighthouse far off on the hills sweeps its beam once
// through the haze, a soft ray of light swinging round over a few seconds,
// brightening as it passes the viewer, then gone. No flash: at its
// brightest it is a breath over the haze. Like the shooting star
// (shootingStar.tsx), it runs on r3f's clock and never wakes the canvas: it
// begins only on a frame already being drawn while the camera moves (the
// player turning the view), low enough that the horizon is in frame, and
// keeps the frames coming only while it lasts. Its parts are drawn from the
// first frame with no light and no area, so its programs link up front,
// never in a move's frame.

/** How long one sweep lasts (seconds), and how far round the beam turns in it. */
const SWEEP_SECONDS = 6.5;
const SWEEP_TURN = 150 * (Math.PI / 180);
/** The beam's reach (world units) and its spread (half-width at its far end). */
const BEAM_LENGTH = 190;
const BEAM_SPREAD = 13;
/** Its brightest, and the lamp's own glow as the beam passes the viewer. */
const BEAM_LIGHT = 0.03;
const LAMP_LIGHT = 0.3;
/** Where the lighthouses stand: on the near hills' crest line, this high. */
const LIGHTHOUSE_RADIUS = 296;
const LAMP_HEIGHT = 9;
/** Segments along the beam. */
const ALONG = 24;

const DEG = Math.PI / 180;

const beamVertex = /* glsl */ `
  uniform vec3 uSource;
  uniform vec2 uDir;
  uniform float uLight;
  attribute float aAlong;
  attribute float aSide;
  varying float vAlong;
  varying float vSide;
  void main() {
    vec3 dir = vec3(uDir.x, -0.004, uDir.y);
    vec3 p = uSource + dir * aAlong * ${BEAM_LENGTH.toFixed(1)};
    // Widened across the view, as a cone of light seen from aside
    vec3 v = normalize(cameraPosition - p);
    vec3 s = cross(dir, v);
    float sl = length(s);
    s = sl > 1e-4 ? s / sl : vec3(0.0, 1.0, 0.0);
    p += s * aSide * (0.4 + aAlong * ${BEAM_SPREAD.toFixed(1)});
    vAlong = aAlong;
    vSide = aSide;
    // No light, no area: drawn from the first frame, touching no pixel
    if (uLight <= 0.0) p = uSource;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;

const beamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uLight;
  uniform float uDim;
  varying float vAlong;
  varying float vSide;
  ${TOWER_SHADE}
  void main() {
    float across = exp(-vSide * vSide * 4.0);
    float along = smoothstep(0.0, 0.04, vAlong) * pow(1.0 - vAlong, 1.6);
    float a = across * along * uLight * uDim * (1.0 - towerShade());
    if (a < 0.0006) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

const lampVertex = /* glsl */ `
  uniform vec3 uSource;
  uniform float uGlow;
  uniform float uDpr;
  void main() {
    gl_Position = projectionMatrix * viewMatrix * vec4(uSource, 1.0);
    gl_PointSize = uGlow > 0.0 ? 14.0 * uDpr : 0.0;
  }`;

const lampFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uGlow;
  uniform float uDim;
  ${TOWER_SHADE}
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = dot(p, p);
    float a = (exp(-d * 18.0) * 0.8 + exp(-d * 4.0) * 0.2) * uGlow * uDim * (1.0 - towerShade());
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

const beamGeometry = () => {
  const along: number[] = [];
  const side: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= ALONG; i++) {
    const t = i / ALONG;
    along.push(t, t);
    side.push(-1, 1);
    if (i < ALONG) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(along.length * 3), 3));
  g.setAttribute('aAlong', new BufferAttribute(new Float32Array(along), 1));
  g.setAttribute('aSide', new BufferAttribute(new Float32Array(side), 1));
  g.setIndex(index);
  return g;
};

const pointGeometry = () => {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
  return g;
};

/**
 * The lighthouse's sweep: now and then, while the player turns a low view,
 * one beam swings through the haze beside the tower.
 */
export const Lighthouse = ({ dim }: { dim: { value: number } }) => {
  const invalidate = useThree((s) => s.invalidate);
  const dpr = useThree((s) => s.viewport.dpr);
  const parts = useMemo(() => {
    const source = { value: new Vector3() };
    const color = { value: new Color(HORIZON.beam) };
    return {
      beam: beamGeometry(),
      lamp: pointGeometry(),
      beamMaterial: new ShaderMaterial({
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          ...shadeUniforms(),
          uSource: source,
          uDir: { value: [1, 0] },
          uLight: { value: 0 },
          uColor: color,
          uDim: dim,
        },
        vertexShader: beamVertex,
        fragmentShader: beamFragment,
      }),
      lampMaterial: new ShaderMaterial({
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          ...shadeUniforms(),
          uSource: source,
          uGlow: { value: 0 },
          uDpr: { value: 1 },
          uColor: color,
          uDim: dim,
        },
        vertexShader: lampVertex,
        fragmentShader: lampFragment,
      }),
    };
  }, [dim]);
  useDisposeOnUnmount(parts);
  parts.lampMaterial.uniforms.uDpr.value = dpr;

  const state = useRef({
    random: rng(5309),
    next: -1,
    start: -1,
    lowSince: -1,
    from: 0,
    turn: 1,
    last: new Matrix4(),
  });
  useFrame(({ clock, camera }) => {
    const s = state.current;
    const t = clock.elapsedTime;
    const u = parts.beamMaterial.uniforms;
    if (s.next < 0) s.next = t + 90 + s.random() * 90;
    const moved = !s.last.equals(camera.matrixWorld);
    s.last.copy(camera.matrixWorld);
    // Low enough that the horizon is in frame, for a moment
    const dir = camera.getWorldDirection(new Vector3());
    const low = dir.y > -Math.sin(14 * DEG);
    if (!low) s.lowSince = -1;
    else if (s.lowSince < 0) s.lowSince = t;
    if (s.start < 0 && t >= s.next && low && moved && t - s.lowSince > 2) {
      // Beside the tower, on the hills, sweeping across toward the viewer
      const look = Math.atan2(dir.x, dir.z);
      const side = s.random() < 0.5 ? -1 : 1;
      const az = look + side * (14 + s.random() * 8) * DEG;
      u.uSource.value.set(
        Math.sin(az) * LIGHTHOUSE_RADIUS,
        GROUND_Y + LAMP_HEIGHT,
        Math.cos(az) * LIGHTHOUSE_RADIUS,
      );
      // Toward the viewer is az + π; the sweep passes it mid-way
      s.turn = s.random() < 0.5 ? -1 : 1;
      s.from = az + Math.PI - (s.turn * SWEEP_TURN) / 2;
      s.start = t;
      s.next = t + 150 + s.random() * 150;
    }
    if (s.start >= 0) {
      const p = (t - s.start) / SWEEP_SECONDS;
      if (p >= 1) {
        s.start = -1;
        u.uLight.value = 0;
        parts.lampMaterial.uniforms.uGlow.value = 0;
      } else {
        const a = s.from + s.turn * SWEEP_TURN * p;
        u.uDir.value = [Math.sin(a), Math.cos(a)];
        // In and out softly over the sweep
        const fade = Math.sin(Math.PI * p) ** 2;
        u.uLight.value = BEAM_LIGHT * fade;
        // The lamp glows as the beam turns toward the viewer
        const src = u.uSource.value as Vector3;
        const toward = Math.atan2(camera.position.x - src.x, camera.position.z - src.z);
        const facing = Math.max(Math.cos(a - toward), 0);
        parts.lampMaterial.uniforms.uGlow.value = LAMP_LIGHT * fade * facing ** 12 + 1e-4;
        invalidate();
      }
    }
  });
  return (
    <group name="horizon-events">
      <mesh
        geometry={parts.beam}
        material={parts.beamMaterial}
        renderOrder={-889}
        frustumCulled={false}
        raycast={noRaycast}
      />
      <points
        geometry={parts.lamp}
        material={parts.lampMaterial}
        renderOrder={-888}
        frustumCulled={false}
        raycast={noRaycast}
      />
    </group>
  );
};
