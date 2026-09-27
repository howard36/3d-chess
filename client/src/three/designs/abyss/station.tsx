import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  CylinderGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ShaderMaterial,
  TorusGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';

// The observation room round the board, and the life drifting outside it.
//
// - The room's glass wall: twelve bevelled titanium mullions standing in a
//   ring well outside the tower, on a slim floor lip with a thin seam of
//   light, lost in the water with distance so they frame the view without
//   taking it.
// - A handful of bioluminescent motes drifting far out in the water, slowly
//   pulsing.
//
// Both fade into the water wherever they would show behind or in front of
// the tower on screen (its whole angular size from the camera), so no dark
// bar reads as a spine through the decks and nothing moves behind them.

/** Radius of a sphere holding the tower, its pieces and labels: nothing moving or dark may show inside it. */
export const TOWER_RADIUS = 5.6;
const WALL_RADIUS = 21;
const FLOOR_Y = -10;
const TOP_Y = 14;

/** A part of the frame, tagged as structure (0) or light seam (1). */
const tagged = (g: BufferGeometry, seam: number) => {
  const flat = g.toNonIndexed();
  g.dispose();
  const n = flat.getAttribute('position').count;
  flat.setAttribute('aSeam', new BufferAttribute(new Float32Array(n).fill(seam), 1));
  flat.deleteAttribute('uv');
  return flat;
};

const frameGeometry = () => {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
    // Octagonal: the facets catch a little light, like a bevelled bar
    const bar = new CylinderGeometry(0.2, 0.2, TOP_Y - FLOOR_Y, 8, 1, true)
      .rotateY(Math.PI / 8)
      .translate(Math.sin(a) * WALL_RADIUS, (TOP_Y + FLOOR_Y) / 2, Math.cos(a) * WALL_RADIUS);
    parts.push(tagged(bar, 0));
  }
  // A slim floor lip, and a thin seam of light along its inner edge
  parts.push(
    tagged(
      new TorusGeometry(WALL_RADIUS, 0.16, 6, 128).rotateX(Math.PI / 2).translate(0, FLOOR_Y, 0),
      0,
    ),
  );
  parts.push(
    tagged(
      new TorusGeometry(WALL_RADIUS - 0.26, 0.035, 4, 192)
        .rotateX(Math.PI / 2)
        .translate(0, FLOOR_Y + 0.08, 0),
      1,
    ),
  );
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
};

const frameVertex = /* glsl */ `
  attribute float aSeam;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vSeam;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vSeam = aSeam;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const frameFragment = /* glsl */ `
  uniform vec3 uDark;
  uniform vec3 uEdge;
  uniform vec3 uInner;
  uniform vec3 uSeam;
  uniform float uFog;
  uniform float uTower;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vSeam;
  void main() {
    vec3 toEye = cameraPosition - vWorld;
    float dist = length(toEye);
    vec3 n = normalize(vNormal);
    float f = pow(1.0 - abs(dot(n, toEye / dist)), 2.0);
    // A faint edge light, and the facets turned toward the board catching its glow
    float inward = max(dot(n, -normalize(vec3(vWorld.x, 0.0, vWorld.z))), 0.0);
    vec3 c = uDark + uEdge * f + uInner * pow(inward, 3.0);
    c = mix(c, uSeam, vSeam);
    // Lost in the water with distance
    float haze = 1.0 - exp(-dist * uFog);
    // Never behind the tower, where it would read as part of it: gone
    // wherever it would show through the platforms
    vec3 toFrame = normalize(vWorld - cameraPosition);
    vec3 toTower = normalize(-cameraPosition);
    float angle = acos(clamp(dot(toFrame, toTower), -1.0, 1.0));
    float tower = asin(clamp(uTower / length(cameraPosition), 0.0, 1.0));
    float shown = smoothstep(tower * 1.05, tower * 1.4, angle);
    // Blended over the water behind it (not painted in a water colour of its
    // own), so where it fades there is nothing left to see
    float alpha = (1.0 - haze) * shown;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(c, alpha);
    #include <colorspace_fragment>
  }`;

/** The room's glass wall: bevelled mullions on a slim floor lip with a seam of light. Static. */
export const RoomFrame = () => {
  const { geometry, material } = useMemo(
    () => ({
      geometry: frameGeometry(),
      material: new ShaderMaterial({
        uniforms: {
          uDark: { value: new Color('#03090c') },
          uEdge: { value: new Color('#6f858c').multiplyScalar(0.2) },
          uInner: { value: new Color('#6f858c').multiplyScalar(0.16) },
          uSeam: { value: new Color('#a9b4b6').multiplyScalar(0.55) },
          uFog: { value: 0.024 },
          uTower: { value: TOWER_RADIUS },
        },
        vertexShader: frameVertex,
        fragmentShader: frameFragment,
        transparent: true,
        depthWrite: false,
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
  // Drawn first among the see-through layers: behind every platform and mark
  return <mesh geometry={geometry} material={material} renderOrder={-500} raycast={noRaycast} />;
};

// --- Motes -----------------------------------------------------------------------

const MOTES = 26;

const motesVertex = /* glsl */ `
  attribute vec4 aMote;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uScale;
  uniform float uTower;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float speed = aMote.x;
    float phase = aMote.y;
    // A slow wander on a small loop
    vec3 p = position + vec3(
      sin(uTime * speed + phase) * 0.9,
      sin(uTime * speed * 0.7 + phase * 1.7) * 0.5,
      cos(uTime * speed * 0.8 + phase) * 0.9
    );
    vec4 world = modelMatrix * vec4(p, 1.0);
    vec4 mv = viewMatrix * world;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max(aMote.z * uScale / -mv.z, 1.0);
    // Never behind or in front of the tower: fade out near its direction
    vec3 toMote = normalize(world.xyz - cameraPosition);
    vec3 toTower = normalize(-cameraPosition);
    float angle = acos(clamp(dot(toMote, toTower), -1.0, 1.0));
    float tower = asin(clamp(uTower / length(cameraPosition), 0.0, 1.0));
    float mask = smoothstep(tower * 1.05, tower * 1.35, angle);
    float pulse = 0.5 + 0.5 * sin(uTime * (0.35 + speed) + phase * 3.1);
    vAlpha = mask * (0.25 + 0.75 * pulse * pulse) * aMote.w;
    vColor = aColor;
  }`;

const motesFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (exp(-d * d * 5.0) - 0.007) * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor * a, a);
    #include <colorspace_fragment>
  }`;

// Deep teal and blue: clear of the marks' plankton white, violet and reds
const MOTE_COLORS = ['#4fb3c4', '#5d9fe0', '#3fb9a8'];

/** A few bioluminescent motes far out in the water, drifting and pulsing slowly. */
export const DistantMotes = () => {
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const camera = useThree((s) => s.camera);
  const { geometry, material } = useMemo(() => {
    const random = rng(71);
    const pos = new Float32Array(MOTES * 3);
    const mote = new Float32Array(MOTES * 4);
    const col = new Float32Array(MOTES * 3);
    const c = new Color();
    for (let i = 0; i < MOTES; i++) {
      const a = random() * Math.PI * 2;
      const r = 25 + random() * 14;
      pos.set([Math.sin(a) * r, -9 + random() * 15, Math.cos(a) * r], i * 3);
      mote.set(
        [0.05 + random() * 0.12, random() * 6.28, 0.18 + random() * 0.22, 0.4 + random() * 0.6],
        i * 4,
      );
      c.set(MOTE_COLORS[Math.floor(random() * MOTE_COLORS.length)]);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aMote', new BufferAttribute(mote, 4));
    g.setAttribute('aColor', new BufferAttribute(col, 3));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 1 },
        uTower: { value: TOWER_RADIUS },
      },
      vertexShader: motesVertex,
      fragmentShader: motesFragment,
    });
    return { geometry: g, material };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  // Their own clock, advanced only while frames render: after an idle spell
  // the motes carry on from where they were rather than jumping
  useFrame((_, delta) => {
    material.uniforms.uTime.value += Math.min(delta, 0.25);
    const fov = 'fov' in camera ? (camera.fov as number) : 36;
    material.uniforms.uScale.value = (size.height * dpr * 0.5) / Math.tan((fov * Math.PI) / 360);
  });
  return (
    <points
      geometry={geometry}
      material={material}
      renderOrder={-900}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};
