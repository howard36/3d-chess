import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, DoubleSide, PlaneGeometry, ShaderMaterial } from 'three';
import { LAYER } from '../kit/layers';
import { LastMoveLine } from '../kit/line';
import { noRaycast } from '../kit/noRaycast';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { levelAt, pitch } from './layout';
import { CAPTURE, CAPTURE_HOT, CHECK, INK, LASER, LASER_CORE, LASER_HOT, LEVEL } from './palette';

// Markers are projections on the tray, drawn as signed-distance shapes on one
// quad each, so they stay crisp at any angle:
//
// - a legal destination: a thin laser ring broken at its four diagonals, with
//   a hot core (projected light is the most vivid thing on the board) and a
//   soft halo, and at its heart a jewel in the destination level's colour,
//   so rings on different levels never read as one cluster;
// - a capture: a laser "kerf": the same broken ring doubled, in red, wide
//   enough to go round the victim's base, with the level's jewels set in its
//   four gaps;
// - the selection: four laser corner brackets framing the held piece's
//   square (a different shape from a destination, so a move straight up or
//   down still shows its own ring);
// - the last move: graphite ink, like a measured drawing: a dashed origin
//   circle where the piece left, a ring where it stands with the level's
//   jewels at its diagonals, and the kit's thin line between them with a
//   slow gleam running along it;
// - check: a still red ring round the king, its wash breathing slowly.

const KIND = {
  quiet: 0,
  capture: 1,
  selection: 2,
  from: 3,
  to: 4,
  check: 5,
} as const;
type Kind = keyof typeof KIND;

const vertexShader = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  uniform int uKind;
  uniform vec3 uColor;
  uniform vec3 uHot;
  uniform vec3 uCore;
  uniform vec3 uLevel;
  uniform float uHover;
  uniform float uTime;
  uniform float uPitch;
  varying vec2 vP;

  const float TAU = 6.2831853;
  float stroke(float d, float w) {
    float fw = max(fwidth(d), 1e-4);
    float hw = max(w, fw * 0.5);
    return (1.0 - smoothstep(hw - fw * 0.5, hw + fw * 0.5, d)) * min(1.0, w / (fw * 0.5));
  }
  // Distance along the ring from the nearest of n evenly spaced angles (offset by phase)
  float fromSpokes(float ang, float n, float phase, float r) {
    float step = TAU / n;
    return abs(mod(ang - phase + step * 0.5, step) - step * 0.5) * r;
  }
  // Paints a stroke over what is there
  void paint(inout vec3 col, inout float a, vec3 c, float s) {
    col = mix(col, c, s);
    a = max(a, s);
  }

  void main() {
    vec2 p = vP / uPitch;
    float r = length(p);
    float ang = atan(p.y, p.x);
    vec3 col = uColor;
    float a = 0.0;

    if (uKind == 0) {
      float R = 0.3 + 0.03 * uHover;
      float d = abs(r - R);
      float gaps = smoothstep(0.018, 0.034, fromSpokes(ang, 4.0, 0.7853982, R));
      float line = stroke(d, 0.018 + 0.006 * uHover) * gaps;
      float core = stroke(d, 0.006) * gaps;
      float halo = exp(-(d * d) / (0.035 * 0.035)) * (0.2 + 0.12 * uHover);
      float fill = (1.0 - smoothstep(R - 0.02, R, r)) * 0.18 * uHover;
      a = max(max(line, halo), fill);
      col = mix(uColor, uCore, core * 0.35);
      // The level's jewel at the heart, ringed in white so its hue holds
      paint(col, a, vec3(1.0), stroke(r, 0.085) * 0.9);
      paint(col, a, uLevel, stroke(r, 0.07));
    } else if (uKind == 1) {
      // The kerf: two broken red rings round the victim, the outer one hot
      float R = 0.37;
      float grow = 0.006 * uHover;
      float gaps = smoothstep(0.018, 0.034, fromSpokes(ang, 4.0, 0.7853982, R));
      float inner = stroke(abs(r - R), 0.013 + grow) * gaps;
      float outer = stroke(abs(r - R - 0.045), 0.013 + grow) * gaps;
      // Hot cores in both rings: the capture's red is the bright one, check's the deep one
      float core = max(stroke(abs(r - R), 0.004), stroke(abs(r - R - 0.045), 0.004)) * gaps;
      float dm = min(abs(r - R), abs(r - R - 0.045));
      float halo = exp(-(dm * dm) / (0.03 * 0.03)) * (0.18 + 0.14 * uHover);
      a = max(max(inner, outer), halo);
      col = mix(uColor, uHot, core * 0.9);
      // The level's jewels, set in the kerf's four gaps
      vec2 jewel = vec2(fromSpokes(ang, 4.0, 0.7853982, r), r - R - 0.0225);
      paint(col, a, uLevel, stroke(length(jewel), 0.034));
    } else if (uKind == 2) {
      // The selection: four corner brackets framing the square (never a ring,
      // so a move straight up or down still shows its own ring inside)
      vec2 q = abs(p);
      float H = 0.44;
      float arm = 0.14;
      float bx = stroke(abs(q.x - H), 0.01) * step(H - arm, q.y) * step(q.y, H + 0.01);
      float by = stroke(abs(q.y - H), 0.01) * step(H - arm, q.x) * step(q.x, H + 0.01);
      float line = max(bx, by);
      float cx = stroke(abs(q.x - H), 0.004) * step(H - arm, q.y) * step(q.y, H);
      float cy = stroke(abs(q.y - H), 0.004) * step(H - arm, q.x) * step(q.x, H);
      float glow = exp(-pow(min(abs(q.x - H), abs(q.y - H)) / 0.025, 2.0)) * 0.2 *
        step(H - arm, min(q.x, q.y));
      a = max(line, glow);
      col = mix(uColor, uCore, max(cx, cy) * 0.7);
    } else if (uKind == 3) {
      // The origin: a dashed circle, the level's colour at its centre
      float R = 0.2;
      float dash = step(0.5, fract(ang / TAU * 14.0));
      a = stroke(abs(r - R), 0.008) * dash * 0.9;
      paint(col, a, uLevel, stroke(r, 0.045));
    } else if (uKind == 4) {
      // The arrival: a ring with the level's jewels at its four diagonals
      float R = 0.4;
      a = stroke(abs(r - R), 0.009) * 0.92;
      vec2 jewel = vec2(fromSpokes(ang, 4.0, 0.7853982, r), r - R - 0.03);
      paint(col, a, vec3(1.0), stroke(length(jewel), 0.036) * 0.9);
      paint(col, a, uLevel, stroke(length(jewel), 0.026));
    } else {
      // Check: a still red ring; its wash breathes, once every four seconds
      float R = 0.41;
      float line = stroke(abs(r - R), 0.016);
      float core = stroke(abs(r - R), 0.005);
      float breath = 0.17 + 0.03 * sin(uTime * TAU / 4.0);
      float wash = (1.0 - smoothstep(R - 0.02, R, r)) * breath;
      a = max(line, wash);
      col = mix(uColor, uHot, core * 0.85);
    }
    if (a < 0.004) discard;
    gl_FragColor = vec4(col, min(a, 1.0));
    #include <colorspace_fragment>
  }`;

const plane = new PlaneGeometry(pitch, pitch);
// Every animated marker reads one clock
const clock = { value: 0 };

const useMarkerMaterial = (kind: Kind, color: string, hot: string, level: string) => {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        uniforms: {
          uKind: { value: KIND[kind] },
          uColor: { value: new Color(color) },
          uHot: { value: new Color(hot) },
          uCore: { value: new Color(LASER_CORE) },
          uLevel: { value: new Color(level) },
          uHover: { value: 0 },
          uTime: clock,
          uPitch: { value: pitch },
        },
        vertexShader,
        fragmentShader,
      }),
    [kind, color, hot, level],
  );
  useEffect(() => () => material.dispose(), [material]);
  return material;
};

const Mark = ({
  kind,
  floor,
  color,
  hot = color,
  hovered = false,
}: {
  kind: Kind;
  floor: Vec3;
  color: string;
  hot?: string;
  hovered?: boolean;
}) => {
  // The level of the tray the mark lies on, from its height
  const material = useMarkerMaterial(kind, color, hot, LEVEL[levelAt(floor[1])]);
  material.uniforms.uHover.value = hovered ? 1 : 0;
  return (
    <mesh
      geometry={plane}
      material={material}
      position={[floor[0], floor[1] + 0.012, floor[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={LAYER.marker}
      raycast={noRaycast}
    />
  );
};

const Quiet = ({ floor, hovered }: MarkerProps) => (
  <Mark kind="quiet" floor={floor} color={LASER} hot={LASER_HOT} hovered={hovered} />
);

const Capture = ({ floor, hovered }: MarkerProps) => (
  <Mark kind="capture" floor={floor} color={CAPTURE} hot={CAPTURE_HOT} hovered={hovered} />
);

const Selection = ({ floor }: MarkerProps) => (
  <Mark kind="selection" floor={floor} color={LASER} hot={LASER_HOT} />
);

const LastMove = ({ from, to, fresh = false, arc = 0 }: LastMoveMarkerProps) => (
  <>
    <Mark kind="from" floor={from.floor} color={INK} />
    <Mark kind="to" floor={to.floor} color={INK} />
    <LastMoveLine
      from={from.floor}
      to={to.floor}
      arc={arc}
      color={INK}
      pulseColor="#a9bccf"
      radius={0.011}
      pulse={0.75}
      pulseLength={0.22}
      spacing={1.5}
      flowSpeed={0.45}
      shade={0.25}
      drawInMs={fresh ? 360 : 0}
    />
  </>
);

/** The ring is still; only its faint wash breathes (a four-second breath) while the king is in check. */
const Check = ({ floor }: MarkerProps) => {
  const invalidate = useThree((s) => s.invalidate);
  useFrame((state) => {
    clock.value = state.clock.elapsedTime;
    invalidate();
  });
  return <Mark kind="check" floor={floor} color={CHECK} hot="#ffe3e6" />;
};

export const markers = { Quiet, Capture, Selection, LastMove, Check };
