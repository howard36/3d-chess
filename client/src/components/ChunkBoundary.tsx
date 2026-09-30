import React from 'react';
import { ChunkLoadError } from '../lib/cachedImport';

interface ChunkBoundaryProps {
  children: React.ReactNode;
  /** Called once its chunk has failed to load. */
  onFail?: () => void;
}

interface ChunkBoundaryState {
  error: Error | null;
}

/**
 * Round a part of the page that comes in a chunk of its own (lazyChunk): if
 * the chunk fails to load, the part is left out and the rest of the page
 * stays. Any other error goes on up to the app's ErrorBoundary. Remount it
 * (a new key) with the chunk's fresh component to try again.
 */
export class ChunkBoundary extends React.Component<ChunkBoundaryProps, ChunkBoundaryState> {
  state: ChunkBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ChunkBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    if (error instanceof ChunkLoadError) this.props.onFail?.();
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (!(error instanceof ChunkLoadError)) throw error;
    return null;
  }
}
