import { useEffect, useLayoutEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import type { WebGLRenderer } from 'three';
import { drawLens, drawOverlay } from './lensDrawing';
import type { LensState } from './useTouchIntent';

// The magnifier (tapIntent.ts, drawn by lensDrawing.ts) while a finger aims
// by hand: the lens pass follows each frame of the view, and a DOM layer
// over the canvas, which takes no touch, draws its frame and its sight.

/** The magnifier for `state` (useTouchIntent's), drawn while there is one. */
export interface MagnifierProps {
  state: LensState | null;
}

export function Magnifier({ state }: MagnifierProps) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const connected = useThree((s) => s.events.connected) as HTMLElement | null | undefined;
  const shown = useRef<LensState | null>(state);
  useLayoutEffect(() => {
    shown.current = state;
  });

  // The second pass, after each frame of the view while there is a lens
  useEffect(() => {
    const render = gl.render;
    let inside = false;
    gl.render = function (this: WebGLRenderer, s, c) {
      render.call(this, s, c);
      const lens = shown.current?.lens;
      if (!lens || inside || s !== scene || c !== camera || this.getRenderTarget() !== null) return;
      inside = true;
      try {
        drawLens(this, scene, camera, lens, render);
      } finally {
        inside = false;
      }
    };
    return () => {
      gl.render = render;
    };
  }, [gl, scene, camera]);
  // A new lens, or none after one: draw the view again
  const drawn = useRef<LensState | null>(null);
  useEffect(() => {
    if (state === drawn.current) return;
    drawn.current = state;
    invalidate();
  }, [state, invalidate]);

  // The overlay: the frame, the sight and the target under it
  const layer = useRef<{ el: HTMLDivElement; svg: SVGSVGElement } | null>(null);
  useEffect(() => {
    const host = connected ?? gl.domElement.parentElement;
    if (!host || typeof host.appendChild !== 'function' || typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.dataset.testid = 'magnifier';
    el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, {
      position: 'absolute',
      inset: '0',
      zIndex: '1',
      pointerEvents: 'none',
      display: 'none',
    });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    Object.assign(svg.style, { position: 'absolute', inset: '0', overflow: 'visible' });
    el.appendChild(svg);
    host.appendChild(el);
    layer.current = { el, svg };
    return () => {
      el.remove();
      layer.current = null;
    };
  }, [gl, connected]);

  useLayoutEffect(() => {
    if (!layer.current) return;
    const { el, svg } = layer.current;
    if (!state) {
      el.style.display = 'none';
      svg.replaceChildren();
      delete el.dataset.aimed;
      return;
    }
    const rect = gl.domElement.getBoundingClientRect();
    el.style.display = 'block';
    el.dataset.aimed = state.aimed ?? '';
    drawOverlay(svg, state, rect.width, rect.height);
  }, [state, gl]);

  return null;
}
