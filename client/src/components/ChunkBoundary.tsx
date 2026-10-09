import React from 'react';
import { ChunkLoadError } from '../lib/cachedImport';

/** Why the part was left out: its chunk failed to load, or (round a canvas) there is no WebGL. */
export type ChunkFailure = 'chunk' | 'webgl';

interface ChunkBoundaryProps {
  children: React.ReactNode;
  /** Called once the part has failed (its chunk, or its canvas). */
  onFail?: (why: ChunkFailure) => void;
  /** Round a 3D canvas: a browser that gives it no WebGL context leaves it out too. */
  canvas?: boolean;
}

interface ChunkBoundaryState {
  error: Error | null;
}

/** three.js's error when the browser gives it no WebGL context (off, blocklisted, no GPU). */
const noWebGL = (error: Error) => /WebGL context/.test(error.message);

/**
 * Round a part of the page that comes in a chunk of its own (lazyChunk): if
 * the chunk fails to load, the part is left out and the rest of the page
 * stays; round a canvas, the same when the browser has no WebGL. Any other
 * error goes on up to the app's ErrorBoundary. Remount it (a new key) with
 * the chunk's fresh component to try again.
 */
export class ChunkBoundary extends React.Component<ChunkBoundaryProps, ChunkBoundaryState> {
  state: ChunkBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ChunkBoundaryState {
    return { error };
  }

  private why(error: Error): ChunkFailure | null {
    if (error instanceof ChunkLoadError) return 'chunk';
    if (this.props.canvas && noWebGL(error)) return 'webgl';
    return null;
  }

  componentDidCatch(error: Error): void {
    const why = this.why(error);
    if (why === 'webgl') console.error('No WebGL: the 3D scene is left out.', error);
    if (why) this.props.onFail?.(why);
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (!this.why(error)) throw error;
    return null;
  }
}
