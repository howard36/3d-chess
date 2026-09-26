import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BackSide,
  Color,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  ShaderMaterial,
} from 'three';
import { noRaycast } from '../kit/noRaycast';
import { holo } from './pieces';

// The war room: a dark navy chamber ringed with dim wall screens; in the
// middle, a round projector table whose engraved rings turn against each
// other, throwing a faint cone of light up through the tower of boards.

const CYAN = '#3cf2ff';

const passVertex = /* glsl */ `
  varying vec2 vUv; varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

// --- Projector table ------------------------------------------------------------

/** The table's top: engraved rings and dashes turning against each other. */
const tableTopMaterial = () =>
  new ShaderMaterial({
    fog: false,
    uniforms: {
      uTime: holo.uTime,
      uLine: { value: new Color('#2a8cff').multiplyScalar(0.5) },
      uAmber: { value: new Color('#ff9a3c').multiplyScalar(0.7) },
      uBase: { value: new Color('#041019') },
      uRadius: { value: 1 },
      uBoard: { value: 0.3 },
    },
    vertexShader: passVertex,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uLine; uniform vec3 uAmber; uniform vec3 uBase;
      uniform float uRadius; uniform float uBoard;
      varying vec2 vUv;
      #define TAU 6.2831853
      float band(float r, float at, float w) {
        float fw = fwidth(r) * 1.2;
        return 1.0 - smoothstep(w, w + fw, abs(r - at));
      }
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float a = atan(p.y, p.x) / TAU + 0.5;
        vec3 col = uBase * (1.0 + 0.6 * (1.0 - r));
        float lit = 0.0;
        // Solid guide rings
        lit += band(r, 0.985, 0.006) * 1.2 + band(r, 0.93, 0.002) * 0.5;
        lit += band(r, 0.08, 0.003) * 0.5 + band(r, 0.11, 0.0015) * 0.3;
        // Dashed rings, alternately turning
        for (int i = 0; i < 4; i++) {
          float fi = float(i);
          float at = 0.63 + fi * 0.085;
          float dir = mod(fi, 2.0) < 0.5 ? 1.0 : -1.0;
          float n = 12.0 + fi * 10.0;
          float dash = step(0.35 + 0.1 * fi, fract(a * n + dir * uTime * (0.05 + 0.02 * fi)));
          lit += band(r, at, 0.008 - fi * 0.001) * dash * (0.75 + 0.1 * fi);
          lit += band(r, at + 0.03, 0.0015) * 0.35;
        }
        // Tick marks round the rim, sweeping slowly the other way
        float ticks = step(0.8, fract(a * 120.0 - uTime * 0.02));
        lit += ticks * (1.0 - smoothstep(0.0, 0.01, abs(r - 0.955) - 0.018)) * 0.8;
        // A radar arm sweeping round
        float arm = fract(a - uTime * 0.08);
        float sweep = smoothstep(0.88, 1.0, arm) * step(r, 0.93) * smoothstep(0.5, 0.62, r);
        col += uLine * sweep * 0.18;
        // The tower's footprint, and amber corner marks
        vec2 q = abs(p) / uBoard;
        float sq = max(q.x, q.y);
        float fws = fwidth(sq) * 1.2;
        lit += (1.0 - smoothstep(0.0, fws, abs(sq - 1.0))) * 0.3;
        float corner = step(0.82, min(q.x, q.y)) * (1.0 - smoothstep(0.0, fws * 2.0, abs(sq - 1.06)));
        col += uAmber * corner * 1.2;
        col += uLine * lit;
        // Fade to the metal at the very edge
        col *= step(r, 1.0);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });

/** Light rising from the lens: brightest low down and in the middle. */
const coneMaterial = () =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog: false,
    uniforms: { uTime: holo.uTime, uColor: { value: new Color('#6ff7ff') } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = -mv.xyz;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        float ndv = abs(dot(normalize(vN), normalize(vV)));
        float h = vUv.y;
        float rays = 0.65 + 0.35 * sin(vUv.x * 150.0 + sin(vUv.x * 40.0) * 2.0);
        float drift = 0.8 + 0.2 * sin(h * 18.0 - uTime * 1.5);
        float a = pow(1.0 - h, 1.2) * smoothstep(0.0, 0.15, h) * pow(ndv, 1.5) * rays * drift * 0.06;
        gl_FragColor = vec4(uColor, a);
      }`,
  });

export const ProjectorTable = ({
  y,
  radius,
  top,
  board,
  floor,
}: {
  /** Height of the table top. */
  y: number;
  radius: number;
  /** Height the light cone reaches. */
  top: number;
  /** Half the side of a board, to mark its footprint. */
  board: number;
  floor: number;
}) => {
  const topMat = useMemo(() => {
    const m = tableTopMaterial();
    m.uniforms.uBoard.value = board / radius;
    return m;
  }, [board, radius]);
  const cone = useMemo(coneMaterial, []);
  const metal = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#0b1724',
        metalness: 0.85,
        roughness: 0.35,
        envMapIntensity: 1.2,
      }),
    [],
  );
  const edge = useMemo(
    () =>
      new ShaderMaterial({
        toneMapped: false,
        uniforms: { uTime: holo.uTime, uColor: { value: new Color(CYAN).multiplyScalar(1.1) } },
        vertexShader: passVertex,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
          void main() {
            // Light running round the table's lip
            float run = 0.55 + 0.45 * pow(0.5 + 0.5 * sin(vUv.x * 6.2831853 * 3.0 - uTime * 1.4), 3.0);
            gl_FragColor = vec4(uColor * run, 1.0);
          }`,
      }),
    [],
  );
  useEffect(
    () => () => [topMat, cone, metal, edge].forEach((m) => m.dispose()),
    [topMat, cone, metal, edge],
  );
  const coneH = top - y;
  const lip = 0.32;
  return (
    <group>
      <mesh
        position={[0, y, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={topMat}
        raycast={noRaycast}
      >
        <circleGeometry args={[radius, 96]} />
      </mesh>
      {/* The lip, a glowing edge, and the pedestal down to the floor */}
      <mesh position={[0, y - lip / 2, 0]} material={metal} raycast={noRaycast}>
        <cylinderGeometry args={[radius, radius * 0.97, lip, 96, 1, true]} />
      </mesh>
      <mesh
        position={[0, y - 0.01, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        material={edge}
        raycast={noRaycast}
      >
        <torusGeometry args={[radius + 0.01, 0.028, 8, 128]} />
      </mesh>
      <mesh
        position={[0, y - lip - 0.02, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        material={edge}
        raycast={noRaycast}
      >
        <torusGeometry args={[radius * 0.97, 0.012, 6, 128]} />
      </mesh>
      <mesh position={[0, (y - lip + floor) / 2, 0]} material={metal} raycast={noRaycast}>
        <cylinderGeometry args={[radius * 0.55, radius * 0.7, y - lip - floor, 64, 1, true]} />
      </mesh>
      {/* The lens and its beam */}
      <mesh position={[0, y + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast}>
        <circleGeometry args={[radius * 0.045, 48]} />
        <meshBasicMaterial color={new Color('#bffcff').multiplyScalar(0.35)} toneMapped={false} />
      </mesh>
      <mesh position={[0, y + coneH / 2, 0]} material={cone} raycast={noRaycast}>
        <cylinderGeometry args={[radius * 0.72, radius * 0.1, coneH, 64, 1, true]} />
      </mesh>
    </group>
  );
};

// --- The room -----------------------------------------------------------------------

/** A ring of wall panels round the room, a few of them lit as screens. */
export const Walls = ({ radius = 34, height = 26, y = -8 }) => {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        fog: false,
        depthWrite: false,
        uniforms: {
          uTime: holo.uTime,
          uBase: { value: new Color('#020a14') },
          uLine: { value: new Color('#0f3a52') },
          uScreen: { value: new Color(CYAN).multiplyScalar(0.28) },
          uAmber: { value: new Color('#ff9a3c').multiplyScalar(0.25) },
        },
        vertexShader: passVertex,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform vec3 uBase; uniform vec3 uLine; uniform vec3 uScreen; uniform vec3 uAmber;
          varying vec2 vUv;
          float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
          void main() {
            vec2 cell = vec2(vUv.x * 44.0, vUv.y * 9.0);
            vec2 id = floor(cell);
            vec2 f = fract(cell);
            vec3 col = uBase * (0.6 + 0.8 * vUv.y);
            // Panel seams
            vec2 w = fwidth(cell);
            vec2 seam = 1.0 - smoothstep(vec2(0.0), w * 1.5, min(f, 1.0 - f));
            col += uLine * max(seam.x, seam.y) * 0.6;
            // Screens on the middle rows
            float h = hash(id);
            if (id.y >= 3.0 && id.y <= 4.0 && h > 0.6) {
              vec2 s = (f - 0.5) / vec2(0.42, 0.36);
              float inside = step(max(abs(s.x), abs(s.y)), 1.0);
              float frame = inside * (1.0 - step(max(abs(s.x), abs(s.y)), 0.94));
              float rows = step(0.5, fract(f.y * 14.0)) * step(hash(id + floor(f.y * 14.0)), 0.5 + 0.4 * sin(uTime * 0.6 + h * 20.0));
              float bars = step(f.y, 0.25 + 0.5 * hash(id + floor(f.x * 9.0) + floor(uTime * 0.5)));
              vec3 ink = h > 0.93 ? uAmber : uScreen;
              col += ink * inside * (0.12 + 0.35 * (h > 0.75 ? bars : rows) * step(abs(s.x), 0.85) * step(abs(s.y), 0.8));
              col += ink * frame * 0.9;
            }
            // Dark toward the floor and ceiling
            col *= smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y) * 0.7);
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh
      position={[0, y + height / 2, 0]}
      material={material}
      raycast={noRaycast}
      renderOrder={-900}
    >
      <cylinderGeometry args={[radius, radius, height, 96, 1, true]} />
    </mesh>
  );
};

/** The room's floor: a faint grid, lit round the table. */
export const RoomFloor = ({ y }: { y: number }) => {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        fog: false,
        uniforms: {
          uGlow: { value: new Color(CYAN).multiplyScalar(0.22) },
          uLine: { value: new Color('#0f3a52') },
          uBase: { value: new Color('#01060c') },
        },
        vertexShader: passVertex,
        fragmentShader: /* glsl */ `
          uniform vec3 uGlow; uniform vec3 uLine; uniform vec3 uBase; varying vec3 vWorld;
          void main() {
            vec2 g = vWorld.xz / 1.5;
            vec2 w = fwidth(g);
            vec2 f = abs(fract(g - 0.5) - 0.5);
            vec2 l = 1.0 - smoothstep(vec2(0.0), w * 1.3, f);
            float r = length(vWorld.xz);
            vec3 col = uBase + uLine * max(l.x, l.y) * (1.0 - smoothstep(6.0, 24.0, r));
            col += uGlow * exp(-r / 5.0);
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh
      position={[0, y, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      material={material}
      raycast={noRaycast}
    >
      <circleGeometry args={[26, 96]} />
    </mesh>
  );
};

// --- The scan plane ------------------------------------------------------------------

/** A sheet of light that sweeps up through the tower every few seconds. */
export const ScanPlane = ({ size }: { size: number }) => {
  const mesh = useRef<Mesh>(null);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        toneMapped: false,
        uniforms: { uColor: { value: new Color('#9dfcff') } },
        vertexShader: passVertex,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; varying vec2 vUv;
          void main() {
            vec2 d = abs(vUv - 0.5) * 2.0;
            float m = max(d.x, d.y);
            float fw = fwidth(m) * 1.5;
            float edge = 1.0 - smoothstep(0.0, fw, abs(m - 0.985));
            float fill = 0.018 + 0.018 * step(0.5, fract(vUv.y * 60.0));
            gl_FragColor = vec4(uColor * (1.0 + edge * 0.6), fill * (1.0 - m * 0.5) + edge * 0.45);
          }`,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const yy = holo.uScanY.value;
    m.visible = yy > -50;
    m.position.y = yy;
  });
  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} material={material} raycast={noRaycast}>
      <planeGeometry args={[size, size]} />
    </mesh>
  );
};
