import { describe, expect, it } from 'vitest';
import { PieceType } from '../../engine/pieces';
import { bodyMaterial, setGlazeVariant } from './pieces';

// The glaze's passing effects (the entrance's forming, a capture's burn) are
// compiled into a piece's shader only where they can happen: a shader runs
// both sides of a branch in software (SwiftShader) and on some GPUs, and
// these were ~15% of a frame for pieces that could never show them.

describe('the glaze', () => {
  it('compiles a piece at rest with neither passing effect', () => {
    const m = bodyMaterial('white', PieceType.Queen, 0, 'steady');
    expect(m.defines).toEqual({});
    // Each effect is behind its own switch in the shader
    const shader = m.fragmentShader;
    expect(shader).toMatch(/#ifdef GLAZE_CUT\s+if \(uCut > -0\.005\) \{[^#]*\}\s+#endif/);
    expect(shader).toMatch(/#ifdef GLAZE_FORM\s+if \(uForm < 1\.0\) \{[^#]*\}\s+#endif/);
  });

  it('compiles the forming in for the entrance (and the lobby), the burn for a capture', () => {
    expect(bodyMaterial('black', PieceType.Knight, 2).defines).toEqual({ GLAZE_FORM: '' });
    expect(bodyMaterial('black', PieceType.Knight, 2, 'cut').defines).toEqual({ GLAZE_CUT: '' });
  });

  it('changes variant in place, keeping its uniforms', () => {
    const m = bodyMaterial('white', PieceType.Rook, 1, 'form');
    const uniforms = m.uniforms;
    const version = m.version;
    setGlazeVariant(m, 'steady');
    expect(m.defines).toEqual({});
    expect(m.uniforms).toBe(uniforms);
    // three.js builds the new program on its next draw
    expect(m.version).toBeGreaterThan(version);
  });
});
