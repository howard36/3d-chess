import { BackSide, BufferAttribute, Color, ShaderMaterial, Vector3 } from 'three';
import type { BufferGeometry } from 'three';

// Poster shading for the pieces: every surface is one of three flat tones
// (lit, mid, shade), banded by a light fixed in view space, so the light
// always falls from the upper left however the tower is turned. Nothing is
// specular, so no angle has a hotspot. The contour is an inverted hull in
// ink whose width is held constant on screen (about two pixels), like a
// line drawn with one pen at every zoom.

/** Light direction in view space: from above, a little left and toward the viewer. */
const LIGHT = new Vector3(-0.42, 0.84, 0.34).normalize();

/**
 * World width of one screen pixel at unit depth. `InkScale` (in the stage)
 * keeps it current as the canvas resizes; every contour reads it.
 */
export const pixelScale = { value: 0.0012 };

const fillVertex = /* glsl */ `
  varying vec3 vN;
  varying float vY;
  void main() {
    vN = normalize(normalMatrix * normal);
    // Height above the piece's base (geometry is built base at y = 0)
    vY = position.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fillFragment = /* glsl */ `
  uniform vec3 uLit;
  uniform vec3 uMid;
  uniform vec3 uShade;
  uniform vec3 uLight;
  uniform float uFoot;
  varying vec3 vN;
  varying float vY;
  void main() {
    float d = dot(normalize(vN), uLight);
    float w = fwidth(d) * 0.75 + 0.015;
    float lit = smoothstep(0.52 - w, 0.52 + w, d);
    float mid = smoothstep(-0.12 - w, -0.12 + w, d);
    vec3 c = mix(uShade, mix(uMid, uLit, lit), mid);
    // A soft dusk at the foot, where the piece meets its platform
    c *= mix(0.84, 1.0, smoothstep(0.0, uFoot, vY));
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`;

/** A three-tone flat material in exact colours. */
export const toonMaterial = (lit: string, mid: string, shade: string, foot = 0.07) =>
  new ShaderMaterial({
    uniforms: {
      uLit: { value: new Color(lit) },
      uMid: { value: new Color(mid) },
      uShade: { value: new Color(shade) },
      uLight: { value: LIGHT },
      uFoot: { value: foot },
    },
    vertexShader: fillVertex,
    fragmentShader: fillFragment,
  });

const inkVertex = /* glsl */ `
  attribute vec3 aOutline;
  uniform float uPixels;
  uniform float uPixel;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Pushed out along the crease-aware normal, by a width that grows with
    // depth: the same number of pixels near and far
    vec3 n = mat3(modelViewMatrix) * aOutline;
    mv.xyz += n * uPixels * uPixel * max(-mv.z, 0.5);
    gl_Position = projectionMatrix * mv;
  }`;

const inkFragment = /* glsl */ `
  uniform vec3 uInk;
  void main() {
    gl_FragColor = vec4(uInk, 1.0);
    #include <colorspace_fragment>
  }`;

/** The contour: the back faces of an inflated copy, `pixels` wide on screen. */
export const inkMaterial = (color: string, pixels: number) =>
  new ShaderMaterial({
    side: BackSide,
    uniforms: {
      uInk: { value: new Color(color) },
      uPixels: { value: pixels },
      uPixel: pixelScale,
    },
    vertexShader: inkVertex,
    fragmentShader: inkFragment,
  });

/**
 * Adds the `aOutline` attribute the ink material inflates along. Where faces
 * meet at a crease (a cube's edge, a drum's rim) the vertex has several
 * normals, which are summed so each face moves out by the full width and the
 * hull stays closed; smooth vertices, and apexes where many faces meet, use
 * the averaged normal.
 */
export const withOutline = <G extends BufferGeometry>(geometry: G): G => {
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  const key = (i: number) =>
    `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
  const normals = new Map<string, Vector3[]>();
  for (let i = 0; i < pos.count; i++) {
    const n = new Vector3(nor.getX(i), nor.getY(i), nor.getZ(i));
    const list = normals.get(key(i)) ?? [];
    if (!list.some((m) => m.dot(n) > 0.999)) list.push(n);
    normals.set(key(i), list);
  }
  const resolved = new Map<string, Vector3>();
  for (const [k, list] of normals) {
    const sum = list.reduce((a, n) => a.add(n), new Vector3());
    resolved.set(k, list.length <= 3 ? sum : sum.normalize());
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const n = resolved.get(key(i))!;
    out.set([n.x, n.y, n.z], i * 3);
  }
  geometry.setAttribute('aOutline', new BufferAttribute(out, 3));
  return geometry;
};
