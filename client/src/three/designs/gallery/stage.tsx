import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  LatheGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  TorusKnotGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { BufferGeometry, DirectionalLight } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noRaycast } from '../kit/noRaycast';
import type { Vec3 } from '../types';
import { paintingAtlas } from './art';
import { rodOffset } from './plates';
import { BRASS, ROOM } from './palette';
import { ROOM_GLSL, ROOM_RADIUS, SCULPTURE_PHASE, SCULPTURE_RING, SCULPTURES } from './room';

// The world: the tower is the centrepiece of a dark sculpture rotunda after
// hours. It stands on a black plinth on a low round dais, ringed by brass
// stanchions and red velvet rope. Round it, in the gloom, eight sculptures
// stand on their plinths in pools of light; the curved wall is hung with
// paintings under picture lights, broken by two doorways onto dim rooms
// beyond (one with its exit sign's faint green glow), and high up a ring of
// windows lets in the moonlight. The polished concrete floor reflects the
// scallops of light on the walls. Everything is low in contrast and still,
// and the same all the way round, so no angle is the "front".

// --- Lights ------------------------------------------------------------------------

const DEG = Math.PI / 180;

/**
 * Lights that travel with the camera, so every piece is modelled the same
 * from any orbit and either seat: a warm gallery key over the viewer's left
 * shoulder and a cool moonlit rim from behind the tower.
 */
const CameraLights = () => {
  const key = useRef<DirectionalLight>(null);
  const rim = useRef<DirectionalLight>(null);
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    const az = Math.atan2(camera.position.x, camera.position.z);
    const place = (light: DirectionalLight | null, azimuth: number, elevation: number) => {
      light?.position.set(
        Math.sin(azimuth) * Math.cos(elevation) * 12,
        Math.sin(elevation) * 12,
        Math.cos(azimuth) * Math.cos(elevation) * 12,
      );
    };
    place(key.current, az - 50 * DEG, 46 * DEG);
    place(rim.current, az + 180 * DEG + 30 * DEG, 32 * DEG);
  });
  return (
    <>
      <directionalLight ref={key} intensity={2.9} color="#ffe9cc" />
      <directionalLight ref={rim} intensity={1.2} color="#c9d8f2" />
    </>
  );
};

// --- Walls and floor ---------------------------------------------------------------

const worldVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const wallFragment = /* glsl */ `
  ${ROOM_GLSL}
  uniform float uFloorY;
  varying vec3 vWorld;
  void main() {
    float theta = atan(vWorld.z, vWorld.x);
    if (theta < 0.0) theta += TAU;
    vec3 col = wallRadiance(theta, vWorld.y - uFloorY, 1.0);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const floorFragment = /* glsl */ `
  ${ROOM_GLSL}
  uniform float uFloorY;
  uniform vec3 uFloor;
  uniform float uGloss;
  uniform float uSculptR;
  varying vec3 vWorld;
  void main() {
    vec2 p = vWorld.xz;
    float r = length(p);
    float th = atan(p.y, p.x);
    if (th < 0.0) th += TAU;
    // Polished concrete: a slow mottle, a cloudier polish, and aggregate specks
    float mott = f2(p * 0.16);
    float cloud = f2(p * 0.7 + 13.0);
    float speck = n2(p * 21.0);
    vec3 col = uFloor * (0.72 + 0.4 * mott + 0.1 * cloud);
    col *= 1.0 + 0.3 * smoothstep(0.84, 0.97, speck) - 0.2 * smoothstep(0.16, 0.04, speck);
    // Saw-cut joints: rings round the dais, and radial cuts beyond the first
    float ring = 0.0;
    for (int i = 0; i < 4; i++) {
      float rr = 10.0 + float(i) * 6.5;
      float d = abs(r - rr);
      ring = max(ring, 1.0 - smoothstep(0.02, 0.02 + fwidth(r) * 1.5, d));
    }
    float seg = th / TAU * 16.0;
    float dist = abs(fract(seg) - 0.5) * TAU / 16.0 * r;
    float radial = (1.0 - smoothstep(0.02, 0.02 + fwidth(dist) * 1.5, dist)) * step(10.0, r);
    col *= 1.0 - 0.45 * max(ring, radial);
    // Pools of light: the exhibit's round the dais, and each sculpture's
    float pool = 0.1 * exp(-r * r / (2.0 * 9.0 * 9.0));
    for (int j = 0; j < ${SCULPTURES}; j++) {
      float a = ${SCULPTURE_PHASE.toFixed(5)} + float(j) * TAU / ${SCULPTURES}.0;
      vec2 c = vec2(cos(a), sin(a)) * uSculptR;
      vec2 d = p - c;
      pool += 0.2 * exp(-dot(d, d) / (2.0 * 1.7 * 1.7));
    }
    col += uWash * pool * (0.85 + 0.3 * cloud);
    // The walls, mirrored in the polish (their light only, softly)
    vec3 dir = normalize(vWorld - cameraPosition);
    vec3 rd = vec3(dir.x, -dir.y, dir.z);
    vec2 v = rd.xz;
    float a2 = max(dot(v, v), 1e-5);
    float b2 = 2.0 * dot(p, v);
    float c2 = dot(p, p) - uR * uR;
    float t = (-b2 + sqrt(max(b2 * b2 - 4.0 * a2 * c2, 0.0))) / (2.0 * a2);
    vec2 hit = p + v * t;
    float hh = t * rd.y;
    float ht = atan(hit.y, hit.x);
    if (ht < 0.0) ht += TAU;
    vec3 refl = wallRadiance(ht, hh, 0.0);
    float fres = 0.04 + 0.5 * pow(1.0 - abs(dir.y), 5.0);
    col += refl * fres * uGloss * (0.55 + 0.6 * cloud);
    // Darker toward the walls
    col *= mix(1.0, 0.75, smoothstep(22.0, uR, r));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// The tops of the dais and the plinth: honed dark stone with a pool of the
// exhibit's light, a soft bevel at the edge, and (the dais) a brass inlay ring
const topFragment = /* glsl */ `
  ${ROOM_GLSL}
  uniform vec3 uBase;
  uniform vec3 uLight;
  uniform float uPool;
  uniform float uPoolR;
  uniform float uHalf;
  uniform float uRound;
  uniform float uInlayR;
  uniform vec3 uInlay;
  varying vec3 vWorld;
  void main() {
    vec2 p = vWorld.xz;
    float r = length(p);
    float edge = uRound > 0.5 ? uHalf - r : uHalf - max(abs(p.x), abs(p.y));
    vec3 col = uBase * (0.8 + 0.3 * f2(p * 1.1) + 0.08 * (n2(p * 24.0) - 0.5));
    col += uLight * uPool * exp(-r * r / (2.0 * uPoolR * uPoolR));
    // A bevel catching the light along the edge
    col *= 1.0 + 0.7 * smoothstep(0.06, 0.0, edge);
    if (uInlayR > 0.0) {
      float d = abs(r - uInlayR);
      col = mix(col, uInlay, (1.0 - smoothstep(0.025, 0.025 + fwidth(r) * 1.5, d)) * 0.8);
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const roomUniforms = () => ({
  uR: { value: ROOM_RADIUS },
  uWall: { value: new Color(ROOM.wall) },
  uWash: { value: new Color(ROOM.wash).multiplyScalar(0.6) },
  uMoon: { value: new Color(ROOM.moon).multiplyScalar(0.22) },
  uExit: { value: new Color(ROOM.exit) },
  uArt: { value: paintingAtlas() },
});

// --- Props: plinths, sculptures, stanchions ----------------------------------------

interface Light {
  /** A spotlight above: its position and strength. */
  spot: Vector3;
  spotK: number;
  ambient: number;
  /** A glow from the lit exhibit at the centre of the room. */
  glowK?: number;
}

/**
 * Paints a geometry's vertices with its colour under fixed lights (baked,
 * so the room costs nothing to light), placed at `at`, ready to merge.
 */
const baked = (
  geometry: BufferGeometry,
  color: string,
  light: Light,
  at: Vec3 = [0, 0, 0],
): BufferGeometry => {
  const g = (geometry.index ? geometry.toNonIndexed() : geometry).translate(...at);
  g.deleteAttribute('uv');
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const base = new Color(color);
  const colors = new Float32Array(pos.count * 3);
  const p = new Vector3();
  const n = new Vector3();
  const l = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i).normalize();
    l.copy(light.spot).sub(p);
    const d = l.length();
    const spot = Math.max(n.dot(l.normalize()), 0) * light.spotK * Math.min(1, 16 / (d * d));
    l.set(-p.x, 2 - p.y, -p.z).normalize();
    const glow = Math.max(n.dot(l), 0) * (light.glowK ?? 0);
    const k = light.ambient * (0.75 + 0.25 * n.y) + spot + glow;
    colors[i * 3] = base.r * k;
    colors[i * 3 + 1] = base.g * k;
    colors[i * 3 + 2] = base.b * k;
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  return g;
};

const lathe = (points: [number, number][], segments = 20) =>
  new LatheGeometry(
    points.map(([r, y]) => new Vector2(r, y)),
    segments,
  );

/** One sculpture, base at the origin, by index. */
const sculpture = (i: number): [BufferGeometry, string][] => {
  switch ([0, 1, 2, 3, 4, 7][i % SCULPTURES]) {
    case 0:
      // A bird in flight, drawn up to a point
      return [
        [
          lathe([
            [0, 0],
            [0.08, 0.02],
            [0.05, 0.3],
            [0.1, 1.0],
            [0.15, 1.7],
            [0.11, 2.2],
            [0.03, 2.6],
            [0, 2.62],
          ]),
          '#8a6c3c',
        ],
      ];
    case 1:
      // A reclining form, pierced
      return [
        [
          new TorusGeometry(0.5, 0.24, 12, 28)
            .scale(1.5, 1, 0.9)
            .rotateY(0.4)
            .translate(0, 0.62, 0),
          '#9a9488',
        ],
      ];
    case 2:
      // A sphere resting on a cube
      return [
        [new BoxGeometry(0.62, 0.62, 0.62).translate(0, 0.31, 0), '#8f8b84'],
        [new SphereGeometry(0.4, 20, 14).translate(0, 1.02, 0), '#b4b0a8'],
      ];
    case 3:
      // A tall thin standing figure
      return [
        [
          lathe([
            [0, 0],
            [0.22, 0],
            [0.2, 0.1],
            [0.05, 0.14],
            [0.06, 1.0],
            [0.09, 1.5],
            [0.05, 2.0],
            [0.1, 2.12],
            [0.08, 2.32],
            [0, 2.36],
          ]),
          '#5d4b37',
        ],
      ];
    case 4:
      // A knot of dark steel
      return [[new TorusKnotGeometry(0.42, 0.11, 72, 8).translate(0, 0.72, 0), '#5d626a']];
    case 5: {
      // A cube balanced on its corner
      const cube = new BoxGeometry(0.8, 0.8, 0.8);
      cube.rotateZ(Math.PI / 4).rotateX(Math.atan(1 / Math.SQRT2));
      return [[cube.translate(0, 0.69, 0), '#b3aea5']];
    }
    case 6:
      // A classical bust
      return [
        [
          new SphereGeometry(0.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)
            .scale(1, 0.55, 0.62)
            .translate(0, 0.2, 0),
          '#b1ada5',
        ],
        [new CylinderGeometry(0.4, 0.45, 0.2, 20).translate(0, 0.1, 0), '#a5a198'],
        [new CylinderGeometry(0.11, 0.13, 0.3, 12).translate(0, 0.55, 0), '#b1ada5'],
        [new SphereGeometry(0.24, 18, 14).scale(0.9, 1.15, 1).translate(0, 0.9, 0), '#bbb7ae'],
      ];
    default: {
      // An endless column of stacked beads
      const beads: [BufferGeometry, string][] = [];
      for (let k = 0; k < 5; k++) {
        beads.push([
          new OctahedronGeometry(0.3, 0)
            .scale(1, 1.35, 1)
            .rotateY(Math.PI / 4)
            .translate(0, 0.4 + k * 0.8, 0),
          '#6f5a3e',
        ]);
      }
      return beads;
    }
  }
};

const PLINTH = { w: 1.15, h: 1.25 };

const buildProps = (floorY: number, plinthTop: number, daisR: number, plinthHalf: number) => {
  const parts: BufferGeometry[] = [];
  // Sculptures on plinths, each under its own spotlight
  for (let i = 0; i < SCULPTURES; i++) {
    const a = SCULPTURE_PHASE + (i * Math.PI * 2) / SCULPTURES;
    const x = Math.cos(a) * SCULPTURE_RING;
    const z = Math.sin(a) * SCULPTURE_RING;
    const light: Light = {
      spot: new Vector3(x, floorY + PLINTH.h + 6, z),
      spotK: 0.42,
      ambient: 0.09,
      glowK: 0.05,
    };
    parts.push(
      baked(
        new BoxGeometry(PLINTH.w, PLINTH.h, PLINTH.w).translate(0, PLINTH.h / 2, 0),
        '#6a6864',
        light,
        [x, floorY, z],
      ),
    );
    for (const [g, color] of sculpture(i)) {
      g.rotateY(-a + i);
      parts.push(baked(g, color, light, [x, floorY + PLINTH.h, z]));
    }
  }
  // The exhibit's own light, high above the tower
  const exhibit: Light = { spot: new Vector3(0, 14, 0), spotK: 3.2, ambient: 0.12 };
  // The dais and the plinth (their tops are drawn by the top shader)
  const daisH = 0.3;
  parts.push(
    baked(new CylinderGeometry(daisR, daisR, daisH, 96, 1, true), '#2a2b2e', exhibit, [
      0,
      floorY + daisH / 2,
      0,
    ]),
  );
  const plinthH = plinthTop - (floorY + daisH);
  parts.push(
    baked(new BoxGeometry(plinthHalf * 2, plinthH, plinthHalf * 2), '#1c1d20', exhibit, [
      0,
      floorY + daisH + plinthH / 2,
      0,
    ]),
  );
  // A brass plaque on each face of the plinth
  for (let f = 0; f < 4; f++) {
    const plaque = new BoxGeometry(1.1, 0.32, 0.03)
      .translate(0, 0, plinthHalf + 0.015)
      .rotateY((f * Math.PI) / 2);
    parts.push(baked(plaque, '#7d6538', exhibit, [0, plinthTop - plinthH * 0.42, 0]));
  }
  // Stanchions and velvet rope round the dais
  const posts = 16;
  const ringR = daisR + 1.5;
  const brass: Light = { spot: new Vector3(0, 14, 0), spotK: 3.6, ambient: 0.2 };
  const tops: Vector3[] = [];
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2;
    const at: Vec3 = [Math.cos(a) * ringR, floorY, Math.sin(a) * ringR];
    parts.push(
      baked(new CylinderGeometry(0.15, 0.17, 0.04, 18).translate(0, 0.02, 0), '#8c6d3a', brass, at),
    );
    parts.push(
      baked(
        new CylinderGeometry(0.028, 0.028, 0.92, 8).translate(0, 0.48, 0),
        '#8c6d3a',
        brass,
        at,
      ),
    );
    parts.push(baked(new SphereGeometry(0.062, 12, 8).translate(0, 0.96, 0), '#a8864a', brass, at));
    tops.push(new Vector3(at[0], floorY + 0.86, at[2]));
  }
  for (let i = 0; i < posts; i++) {
    const a = tops[i];
    const b = tops[(i + 1) % posts];
    const points = Array.from({ length: 9 }, (_, k) => {
      const t = k / 8;
      const p = a.clone().lerp(b, t);
      p.y -= 0.26 * 4 * t * (1 - t);
      return p;
    });
    const rope = new TubeGeometry(new CatmullRomCurve3(points), 14, 0.03, 6, false);
    parts.push(baked(rope, '#7a1826', brass));
  }
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
};

// --- The stage ----------------------------------------------------------------------

export interface GalleryRoom {
  /** World height of the gallery floor. */
  floorY: number;
  /** World height of the plinth's top, under level A. */
  plinthTop: number;
  plinthHalf: number;
  daisR: number;
}

/** The gallery, sized round a tower whose lowest platform is at `levelA`. */
export const makeStage = (levelY: number[], platformHalf: number) => {
  const levelA = levelY[0];
  const room: GalleryRoom = {
    floorY: levelA - 2.55,
    plinthTop: levelA - 0.6,
    plinthHalf: platformHalf + 0.45,
    daisR: 5.8,
  };
  const Room = () => {
    const built = useMemo(() => {
      const wallH = 22;
      const walls = new CylinderGeometry(ROOM_RADIUS, ROOM_RADIUS, wallH, 160, 1, true).translate(
        0,
        room.floorY + wallH / 2,
        0,
      );
      const floor = new CircleGeometry(ROOM_RADIUS, 96).rotateX(-Math.PI / 2);
      const wallMat = new ShaderMaterial({
        side: BackSide,
        uniforms: { ...roomUniforms(), uFloorY: { value: room.floorY } },
        vertexShader: worldVertex,
        fragmentShader: wallFragment,
      });
      const floorMat = new ShaderMaterial({
        uniforms: {
          ...roomUniforms(),
          uFloorY: { value: room.floorY },
          uFloor: { value: new Color(ROOM.floor) },
          uGloss: { value: 1.0 },
          uSculptR: { value: SCULPTURE_RING },
        },
        vertexShader: worldVertex,
        fragmentShader: floorFragment,
      });
      const top = (half: number, round: boolean, inlayR: number, pool: number) =>
        new ShaderMaterial({
          uniforms: {
            ...roomUniforms(),
            uBase: { value: new Color(ROOM.dais) },
            uLight: { value: new Color(ROOM.wash) },
            uPool: { value: pool },
            uPoolR: { value: half * 0.8 },
            uHalf: { value: half },
            uRound: { value: round ? 1 : 0 },
            uInlayR: { value: inlayR },
            uInlay: { value: new Color(BRASS).multiplyScalar(0.3) },
          },
          vertexShader: worldVertex,
          fragmentShader: topFragment,
        });
      const daisTop = new RingGeometry(room.plinthHalf, room.daisR, 96, 1).rotateX(-Math.PI / 2);
      const plinthTopG = new PlaneGeometry(room.plinthHalf * 2, room.plinthHalf * 2).rotateX(
        -Math.PI / 2,
      );
      const props = buildProps(room.floorY, room.plinthTop, room.daisR, room.plinthHalf);
      const propsMat = new MeshBasicMaterial({ vertexColors: true });
      return {
        walls,
        floor,
        wallMat,
        floorMat,
        daisTop,
        daisMat: top(room.daisR, true, room.daisR - 0.35, 0.12),
        plinthTopG,
        plinthMat: top(room.plinthHalf, false, 0, 0.2),
        props,
        propsMat,
      };
    }, []);
    useEffect(
      () => () => {
        Object.values(built).forEach((v) => (v as { dispose?: () => void }).dispose?.());
      },
      [built],
    );
    return (
      <group name="gallery-room">
        <mesh geometry={built.walls} material={built.wallMat} raycast={noRaycast} />
        <mesh
          geometry={built.floor}
          material={built.floorMat}
          position={[0, room.floorY, 0]}
          raycast={noRaycast}
        />
        <mesh
          geometry={built.daisTop}
          material={built.daisMat}
          position={[0, room.floorY + 0.3, 0]}
          raycast={noRaycast}
        />
        <mesh
          geometry={built.plinthTopG}
          material={built.plinthMat}
          position={[0, room.plinthTop + 0.002, 0]}
          raycast={noRaycast}
        />
        <mesh geometry={built.props} material={built.propsMat} raycast={noRaycast} />
      </group>
    );
  };

  // The display's four corner rods of dark bronze, from the plinth up past
  // the top shelf, holding each sheet of glass by its corner clamps
  const rodTop = levelY[levelY.length - 1] + 0.14;
  const rodAt = rodOffset(platformHalf);
  const rods = mergeGeometries(
    [-1, 1].flatMap((sx) =>
      [-1, 1].flatMap((sz) => [
        new CylinderGeometry(0.02, 0.02, rodTop - room.plinthTop, 8).translate(
          sx * rodAt,
          (rodTop + room.plinthTop) / 2,
          sz * rodAt,
        ),
        new SphereGeometry(0.038, 12, 8).translate(sx * rodAt, rodTop + 0.02, sz * rodAt),
        new CylinderGeometry(0.07, 0.08, 0.03, 16).translate(
          sx * rodAt,
          room.plinthTop + 0.015,
          sz * rodAt,
        ),
      ]),
    ),
  );
  const bronze = new MeshStandardMaterial({ color: '#6b5638', metalness: 0.75, roughness: 0.38 });

  const Stage = () => (
    <>
      <color attach="background" args={[ROOM.background]} />
      <Room />
      <mesh geometry={rods} material={bronze} raycast={noRaycast} />
      {/* Reflections: a dark room with a moonlit skylight overhead and the
          soft warm panels of the gallery's lights, so stone shows long soft
          highlights rather than points */}
      <Environment resolution={64} frames={1}>
        <color attach="background" args={['#0c0d10']} />
        <Lightformer
          form="rect"
          intensity={1.1}
          color="#b8c8e6"
          position={[0, 9, 0]}
          rotation-x={Math.PI / 2}
          scale={[7, 7, 1]}
        />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Lightformer
            key={i}
            form="rect"
            intensity={0.7}
            color="#ffdcb0"
            position={[Math.sin((i * Math.PI) / 3) * 8, 3, Math.cos((i * Math.PI) / 3) * 8]}
            scale={[2.5, 3.5, 1]}
          />
        ))}
      </Environment>
      <hemisphereLight args={['#a9b9d6', '#1d1a17', 0.38]} />
      {/* Moonlight from the skylight, straight down */}
      <directionalLight position={[0, 10, 0]} intensity={0.55} color="#aebfdd" />
      <CameraLights />
    </>
  );
  return { Stage, room };
};
