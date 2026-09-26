import { BackSide, BufferAttribute, Color, ShaderMaterial, Vector3 } from 'three';
import type { BufferGeometry } from 'three';

// Flat poster shading: every surface is one of three exact colours (lit,
// mid, shade), banded by a light fixed in view space so the light always
// comes from the poster's upper left however the board is turned. Ink
// outlines are an inverted hull pushed out along a crease-aware normal.

/** Light direction in view space: from the upper left, a little toward the viewer. */
const LIGHT = new Vector3(-0.55, 0.7, 0.45).normalize();

const vertexShader = /* glsl */ `
  varying vec3 vN;
  void main() {
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uLit;
  uniform vec3 uMid;
  uniform vec3 uShade;
  uniform vec3 uLight;
  varying vec3 vN;
  void main() {
    float d = dot(normalize(vN), uLight);
    float w = fwidth(d) * 0.75;
    float lit = smoothstep(0.32 - w, 0.32 + w, d);
    float mid = smoothstep(-0.28 - w, -0.28 + w, d);
    vec3 c = mix(uShade, mix(uMid, uLit, lit), mid);
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`;

/** A three-band flat material in exact colours. */
export const toonMaterial = (lit: string, mid: string, shade: string) =>
  new ShaderMaterial({
    uniforms: {
      uLit: { value: new Color(lit) },
      uMid: { value: new Color(mid) },
      uShade: { value: new Color(shade) },
      uLight: { value: LIGHT },
    },
    vertexShader,
    fragmentShader,
  });

/** The ink outline: the back faces of a slightly inflated copy, in one flat colour. */
export const inkMaterial = (color: string, width: number) =>
  new ShaderMaterial({
    side: BackSide,
    uniforms: { uInk: { value: new Color(color) }, uWidth: { value: width } },
    vertexShader: /* glsl */ `
      attribute vec3 aOutline;
      uniform float uWidth;
      void main() {
        vec3 p = position + aOutline * uWidth;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uInk;
      void main() {
        gl_FragColor = vec4(uInk, 1.0);
        #include <colorspace_fragment>
      }`,
  });

/**
 * Adds the `aOutline` attribute the ink material inflates along. Where faces
 * meet at a crease (a cube's edge, a cylinder's rim) the vertex is split, so
 * its face normals are summed: each face then moves out by the full width
 * and the hull stays closed. Smooth vertices (and cone tips, where many
 * normals meet) use the averaged normal.
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
