import { useEffect, useLayoutEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import type { WebGLRenderer } from 'three';
import { CLICK_SLOP_PX } from './tap';
import { drawLens, drawOverlay } from './lensDrawing';
import type { ScreenPoint } from './tapIntent';
import type { LensState } from './useTouchIntent';

// The magnifier (tapIntent.ts, drawn by lensDrawing.ts): while there is one,
// the lens pass follows each frame of the view, and a DOM layer over the
// canvas draws its frame and, while it asks, takes every tap.

/**
 * The magnifier for `state` (useTouchIntent's), drawn while there is one.
 * While it asks, every tap on the canvas comes to `onTap` (canvas CSS px)
 * and nothing under it hears the touch.
 */
export interface MagnifierProps {
  state: LensState | null;
  /** A tap on the canvas while the magnifier asks (canvas CSS px). */
  onTap: (at: ScreenPoint) => void;
}

export function Magnifier({ state, onTap }: MagnifierProps) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const connected = useThree((s) => s.events.connected) as HTMLElement | null | undefined;
  const shown = useRef<LensState | null>(state);
  const latestTap = useRef(onTap);
  useLayoutEffect(() => {
    shown.current = state;
    latestTap.current = onTap;
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

  // The overlay: the frame and rings, and while asking, every tap
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
      touchAction: 'none',
      pointerEvents: 'none',
      display: 'none',
    });
    let press: { id: number; x: number; y: number } | null = null;
    const pointAt = (e: MouseEvent): ScreenPoint => {
      const rect = gl.domElement.getBoundingClientRect();
      return [e.clientX - rect.left, e.clientY - rect.top];
    };
    const stop = (e: Event) => e.stopPropagation();
    const down = (e: PointerEvent) => {
      e.stopPropagation();
      if (press === null) press = { id: e.pointerId, x: e.clientX, y: e.clientY };
    };
    const up = (e: PointerEvent) => {
      e.stopPropagation();
      if (!press || press.id !== e.pointerId) return;
      const still = Math.hypot(e.clientX - press.x, e.clientY - press.y) <= CLICK_SLOP_PX;
      press = null;
      if (still && e.type === 'pointerup') latestTap.current(pointAt(e));
    };
    const click = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointermove', stop);
    el.addEventListener('click', click);
    el.addEventListener('wheel', stop);
    el.addEventListener('contextmenu', click);
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
      el.style.pointerEvents = 'none';
      svg.replaceChildren();
      delete el.dataset.mode;
      delete el.dataset.candidates;
      delete el.dataset.aimed;
      return;
    }
    const rect = gl.domElement.getBoundingClientRect();
    el.style.display = 'block';
    el.style.pointerEvents = state.mode === 'ask' ? 'auto' : 'none';
    el.dataset.mode = state.mode;
    el.dataset.candidates = state.mode === 'ask' ? state.candidates.map((c) => c.id).join(' ') : '';
    el.dataset.aimed = state.aimed ?? '';
    drawOverlay(svg, state, rect.width, rect.height);
  }, [state, gl]);

  return null;
}
