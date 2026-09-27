import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { BackSide, Color, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';
import type { DirectionalLight } from 'three';
import { noRaycast } from '../kit/noRaycast';
import { GradientSky } from '../kit/sky';
import { PALETTE, ROOM_FLOOR_Y } from './shared';

// The studio: a navy-to-black dome, and far below the tower a softly lit
// floor, an even grid of faint light seams (like the joints of floor panels)
// that fades with distance, under a pool of light. The grid is square and
// centred on the tower, so the room looks the same from both seats. The lights
// ride with the camera, so the pieces are lit the same way whichever way the
// player turns the tower (no hot specular from one side only).

const floorVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vP = w.xz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const floorFragment = /* glsl */ `
  uniform vec3 uLine;
  uniform vec3 uGlow;
  uniform float uCell;
  varying vec2 vP;
  void main() {
    float r = length(vP);
    // An even square grid of soft seams, every one alike: a thin core in a
    // wider halo. They thin out where they would shimmer at grazing angles.
    vec2 g = vP / uCell + 0.5;
    vec2 fw = max(fwidth(g), vec2(1e-4));
    vec2 d = abs(fract(g) - 0.5) * uCell;
    vec2 core = 1.0 - smoothstep(vec2(0.012), vec2(0.012) + fw * uCell * 1.5, d);
    vec2 seam = max(core, exp(-d / 0.08) * 0.25);
    seam *= 1.0 - smoothstep(vec2(0.08), vec2(0.3), fw * 2.0);
    // Nothing sharp directly under the tower, where it would show through the glass
    float clear = smoothstep(4.2, 7.0, r);
    float fade = 1.0 - smoothstep(8.0, 22.0, r);
    float lines = max(seam.x, seam.y) * 0.32 * clear * fade;
    float glow = exp(-r * r / (2.0 * 4.2 * 4.2));
    vec3 col = uGlow * glow + uLine * lines;
    float a = clamp(glow * 0.9 + lines * 0.22, 0.0, 1.0);
    if (a < 0.002) discard;
    gl_FragColor = vec4(col / max(a, 1e-3), a);
    #include <colorspace_fragment>
  }`;

const floorPlane = new PlaneGeometry(70, 70).rotateX(-Math.PI / 2);

/** The studio floor far below the tower. */
const StudioFloor = () => {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        uniforms: {
          uLine: { value: new Color(PALETTE.floorLine) },
          uGlow: { value: new Color(PALETTE.floorGlow) },
          uCell: { value: 3.2 },
        },
        vertexShader: floorVertex,
        fragmentShader: floorFragment,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh
      geometry={floorPlane}
      material={material}
      position={[0, ROOM_FLOOR_Y, 0]}
      renderOrder={-900}
      raycast={noRaycast}
    />
  );
};

const UP = new Vector3(0, 1, 0);
const forward = new Vector3();
const right = new Vector3();
const origin = new Vector3();

/**
 * A key light above the camera's left shoulder and a cool fill low on its
 * right, both following the camera round the tower.
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
  });
  return (
    <>
      <directionalLight ref={key} intensity={2.2} color="#fff6ea" />
      <directionalLight ref={fill} intensity={0.7} color="#9fd0ff" />
    </>
  );
};

/**
 * Rajdhani's lowercase "a" reads as "o" at HUD size. The move box's prompt is
 * the one HUD line that stays lowercase, so while this design is up it is
 * set in the mono face, like the coordinates.
 */
const HUD_CSS = `label[for="typed-move"] { font-family: "Share Tech Mono", ui-monospace, monospace; }`;
const useHudStyle = () => {
  useEffect(() => {
    const style = document.createElement('style');
    style.dataset.design = 'command';
    style.textContent = HUD_CSS;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
};

export const Stage = () => {
  useHudStyle();
  return (
    <>
      <GradientSky
        top={PALETTE.skyTop}
        horizon={PALETTE.skyHorizon}
        bottom={PALETTE.skyBottom}
        exponent={0.55}
      />
      <StudioFloor />
      {/* What the pieces' lacquer reflects: a dark room, a soft panel overhead
          and a ring of dim wall panels, the same all the way round */}
      <Environment resolution={64} frames={1}>
        <mesh scale={30}>
          <sphereGeometry args={[1, 16, 8]} />
          <meshBasicMaterial side={BackSide} color="#050b14" />
        </mesh>
        <Lightformer
          form="rect"
          intensity={1.6}
          color="#eaf4ff"
          position={[0, 9, 0]}
          rotation-x={Math.PI / 2}
          scale={[9, 9, 1]}
        />
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const a = (i / 6) * Math.PI * 2;
          return (
            <Lightformer
              key={i}
              form="rect"
              intensity={0.7}
              color="#5fcfff"
              position={[Math.sin(a) * 9, 1.2, Math.cos(a) * 9]}
              rotation-y={a + Math.PI}
              scale={[6, 0.8, 1]}
            />
          );
        })}
      </Environment>
      <hemisphereLight args={['#c4ddf2', '#0a1420', 0.7]} />
      <CameraLights />
    </>
  );
};
