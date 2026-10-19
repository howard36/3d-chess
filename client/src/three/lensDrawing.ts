import { Color, Vector2, Vector4 } from 'three';
import type { Camera, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { toLens } from './tapIntent';
import type { Lens } from './tapIntent';
import type { LensState } from './useTouchIntent';

// The magnifier (tapIntent.ts): part of the board drawn again, enlarged, in a
// square beside the finger. It is the same scene through the same camera,
// with a view offset that crops the projection to the part shown (composed
// with the fit's lens shift, viewOffset.ts), drawn into the square right
// after each frame of the view: the camera never moves, and every shader
// program it uses is one the view already linked (a render target would
// link them all again, for its colour space). The garden is left out
// (BackdropCache hides it for the pass, keeping its copy), so the square's
// ground is plain dark and the board stands out. A small DOM layer over the
// canvas draws the square's frame, the sight and the target under it.

/** The frame's width (CSS px): the board is drawn inside it. */
export const LENS_BORDER_PX = 3;
const LENS_GROUND = new Color('#05060b');

const size = new Vector2();
const viewport = new Vector4();
const scissor = new Vector4();
const clearColor = new Color();

/**
 * Draws `lens` (its crop of the view, inside its frame's border) on the
 * canvas with `render` (the renderer's own render), after the frame of the
 * view has been drawn; everything it changes is put back.
 */
export function drawLens(
  gl: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  lens: Lens,
  render: WebGLRenderer['render'],
): void {
  const cam = camera as PerspectiveCamera;
  if (typeof cam.setViewOffset !== 'function') return;
  gl.getSize(size);
  const b = LENS_BORDER_PX;
  const inner = {
    x: lens.frame.x + b,
    y: lens.frame.y + b,
    width: lens.frame.width - 2 * b,
    height: lens.frame.height - 2 * b,
  };
  // The crop of the view the inside of the frame shows, in the camera's
  // view offset (the fit's lens shift, if any, is a full-size offset)
  const was = cam.view?.enabled ? { ...cam.view } : null;
  const base = was ?? {
    fullWidth: size.x,
    fullHeight: size.y,
    offsetX: 0,
    offsetY: 0,
    width: size.x,
    height: size.y,
  };
  const [sx, sy] = [base.width / size.x, base.height / size.y];
  const crop = {
    x: lens.crop.x + b / lens.zoom,
    y: lens.crop.y + b / lens.zoom,
    width: inner.width / lens.zoom,
    height: inner.height / lens.zoom,
  };
  gl.getViewport(viewport);
  gl.getScissor(scissor);
  const scissorTest = gl.getScissorTest();
  gl.getClearColor(clearColor);
  const clearAlpha = gl.getClearAlpha();
  const autoClear = gl.autoClear;
  try {
    cam.setViewOffset(
      base.fullWidth,
      base.fullHeight,
      base.offsetX + crop.x * sx,
      base.offsetY + crop.y * sy,
      crop.width * sx,
      crop.height * sy,
    );
    // (three's viewport counts from the bottom)
    const y = size.y - inner.y - inner.height;
    gl.setViewport(inner.x, y, inner.width, inner.height);
    gl.setScissor(inner.x, y, inner.width, inner.height);
    gl.setScissorTest(true);
    gl.setClearColor(LENS_GROUND, 1);
    gl.autoClear = true;
    scene.userData.lensPass = true;
    render.call(gl, scene, camera);
  } finally {
    scene.userData.lensPass = false;
    gl.autoClear = autoClear;
    gl.setClearColor(clearColor, clearAlpha);
    gl.setScissorTest(scissorTest);
    gl.setScissor(scissor);
    gl.setViewport(viewport);
    if (was) {
      cam.setViewOffset(
        was.fullWidth,
        was.fullHeight,
        was.offsetX,
        was.offsetY,
        was.width,
        was.height,
      );
    } else cam.clearViewOffset();
  }
}

const SVG = 'http://www.w3.org/2000/svg';

/** An SVG element with these attributes, added to `parent`. */
const add = (parent: Element, name: string, attributes: Record<string, string | number>) => {
  const node = document.createElementNS(SVG, name);
  for (const key in attributes) node.setAttribute(key, String(attributes[key]));
  parent.appendChild(node);
  return node;
};

const LIGHT = '#e6eeff';
const AIMED = '#7cf2c1';
const SHADE = 'rgba(0,0,0,0.6)';

/**
 * Draws the overlay of `state` in `svg` (sized to the canvas, `width` x
 * `height`): the square's frame, the target under the sight ringed where the
 * square shows it, and the sight on the finger's point.
 */
export function drawOverlay(svg: SVGSVGElement, state: LensState, width: number, height: number) {
  svg.replaceChildren();
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  const { lens } = state;
  const { x, y, width: w, height: h } = lens.frame;
  const b = LENS_BORDER_PX;
  const clip = add(add(svg, 'defs', {}), 'clipPath', { id: 'lens-clip' });
  add(clip, 'rect', { x: x + b, y: y + b, width: w - 2 * b, height: h - 2 * b });
  const inside = add(svg, 'g', { 'clip-path': 'url(#lens-clip)' });
  const aimed = state.targets.find((t) => t.id === state.aimed);
  if (aimed) {
    const points = aimed.hull
      .map((p) => toLens(p, lens))
      .map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`)
      .join(' ');
    const line = { points, 'stroke-linejoin': 'round' };
    add(inside, 'polygon', { ...line, fill: 'none', stroke: SHADE, 'stroke-width': 5 });
    add(inside, 'polygon', {
      ...line,
      'data-cell': aimed.id,
      fill: 'rgba(230,238,255,0.08)',
      stroke: AIMED,
      'stroke-width': 2,
    });
  }
  // Where the finger aims: the middle of the square
  const at = { cx: x + w / 2, cy: y + h / 2 };
  add(inside, 'circle', { ...at, r: 9, fill: 'none', stroke: SHADE, 'stroke-width': 4 });
  add(inside, 'circle', { ...at, r: 9, fill: 'none', stroke: LIGHT, 'stroke-width': 1.5 });
  add(inside, 'circle', { ...at, r: 1.75, fill: LIGHT });
  const frame = { fill: 'none' };
  add(svg, 'rect', {
    ...frame,
    x: x - b / 2,
    y: y - b / 2,
    width: w + b,
    height: h + b,
    rx: b * 2,
    stroke: 'rgba(0,0,0,0.55)',
    'stroke-width': b * 2,
  });
  add(svg, 'rect', {
    ...frame,
    x: x + b / 2,
    y: y + b / 2,
    width: w - b,
    height: h - b,
    rx: b * 1.5,
    stroke: LIGHT,
    'stroke-width': b,
  });
}
