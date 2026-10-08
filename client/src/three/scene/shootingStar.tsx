import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Line,
  ShaderMaterial,
  Vector3,
} from 'three';
import { noRaycast } from '../noRaycast';
import { skyDirection } from './heavens';
import { rng } from './textures';
import { shadeUniforms, TOWER_SHADE } from './mask';
import { PALETTE } from './palette';

// A touch that rewards a look up: now and then (a minute or so apart) a
// slow, faint shooting star high overhead, well off to one side of the
// tower, falling away from it. Whatever lies behind the tower is held down
// to nothing (mask.ts). The world itself carries no text.

/** Points along the streak's path. */
const TRAIL = 48;
const METEOR_DOME = 290;
/** How long one takes to cross its path (seconds). */
const METEOR_SECONDS = 1.9;
/** The share of the path its tail covers. */
const METEOR_TAIL = 0.35;

const meteorVertex = /* glsl */ `
  uniform vec3 uFrom;
  uniform vec3 uTo;
  attribute float aAlong;
  varying float vAlong;
  varying vec3 vWorld;
  void main() {
    // Along the great circle from uFrom to uTo, on the dome
    float o = acos(clamp(dot(uFrom, uTo), -1.0, 1.0));
    vec3 d = (sin((1.0 - aAlong) * o) * uFrom + sin(aAlong * o) * uTo) / max(sin(o), 1e-4);
    vec4 w = vec4(normalize(d) * ${METEOR_DOME.toFixed(1)}, 1.0);
    vAlong = aAlong;
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const meteorFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uHead;
  uniform float uLight;
  varying float vAlong;
  varying vec3 vWorld;
  ${TOWER_SHADE}
  void main() {
    // Brightest at the head, thinning out along the tail behind it
    float behind = uHead - vAlong;
    float tail = behind < 0.0 ? 0.0 : pow(1.0 - clamp(behind / ${METEOR_TAIL.toFixed(2)}, 0.0, 1.0), 2.2);
    float light = tail * uLight * (1.0 - towerShade());
    if (light < 0.002) discard;
    gl_FragColor = vec4(uColor * light, 1.0);
    #include <colorspace_fragment>
  }`;

const DEG = Math.PI / 180;

/**
 * Now and then, while the camera looks up past the tower, one faint streak
 * falls slowly across the sky beside it. Everything runs on r3f's clock and
 * nothing wakes the canvas: once one is due (a minute or so after the last)
 * it starts on the next frame drawn while the camera has been looking up
 * for a moment (a player exploring the sky is turning the view), and then
 * keeps the frames coming only while it lasts.
 */
export const ShootingStar = ({ often = false }: { often?: boolean }) => {
  const invalidate = useThree((s) => s.invalidate);
  const { geometry, material, line } = useMemo(() => {
    const along = Float32Array.from({ length: TRAIL }, (_, i) => i / (TRAIL - 1));
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(TRAIL * 3), 3));
    g.setAttribute('aAlong', new BufferAttribute(along, 1));
    // Added onto the sky with the stars (heavens.tsx), in the opaque list
    const m = new ShaderMaterial({
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        ...shadeUniforms(),
        uFrom: { value: new Vector3(0, 1, 0) },
        uTo: { value: new Vector3(0, 1, 0) },
        uColor: { value: new Color(PALETTE.neon) },
        uHead: { value: 0 },
        uLight: { value: 0 },
      },
      vertexShader: meteorVertex,
      fragmentShader: meteorFragment,
    });
    const l = new Line(g, m);
    l.visible = false;
    l.renderOrder = -896;
    l.frustumCulled = false;
    l.raycast = noRaycast;
    return { geometry: g, material: m, line: l };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  const state = useRef({ random: rng(907), next: -1, start: -1, upSince: -1 });
  // ENV PREVIEW (temporary): `often` (shootingStar:often) waits seconds, not a minute
  const wait = often ? 0.1 : 1;
  useEffect(() => {
    state.current.next = -1;
  }, [wait]);
  useFrame(({ clock, camera }) => {
    const s = state.current;
    const t = clock.elapsedTime;
    if (s.next < 0) s.next = t + (30 + s.random() * 30) * wait;
    // Looking up far enough that the frame holds the sky at 20–25° beside
    // the tower
    const dir = camera.getWorldDirection(new Vector3());
    const up = dir.y > Math.sin(8 * DEG);
    if (!up) s.upSince = -1;
    else if (s.upSince < 0) s.upSince = t;
    if (s.start < 0 && t >= s.next && up && t - s.upSince > 1.5) {
      const look = Math.atan2(dir.x, dir.z);
      const side = s.random() < 0.5 ? -1 : 1;
      const az = look + side * (20 + s.random() * 7) * DEG;
      const el = (20 + s.random() * 5) * DEG;
      material.uniforms.uFrom.value.copy(skyDirection(az, el));
      material.uniforms.uTo.value.copy(
        skyDirection(az + side * (8 + s.random() * 4) * DEG, el - (8 + s.random() * 3) * DEG),
      );
      s.start = t;
      s.next = t + (45 + s.random() * 45) * wait;
    }
    if (s.start >= 0) {
      const p = (t - s.start) / METEOR_SECONDS;
      if (p >= 1 + METEOR_TAIL) {
        s.start = -1;
        line.visible = false;
      } else {
        material.uniforms.uHead.value = p;
        // In gently, out as the head burns away
        material.uniforms.uLight.value =
          0.45 * Math.min(p / 0.15, 1) * Math.min(Math.max((1.1 - p) / 0.35, 0), 1);
        line.visible = true;
        invalidate();
      }
    }
  });
  return <primitive object={line} />;
};
