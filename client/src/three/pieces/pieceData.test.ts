import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { OCCLUSION_MEDIUM } from '../scene/occlusion.medium';
import { KNIGHT_MEDIUM } from './knight.medium';

describe('the set’s precomputed parts', () => {
  it('throw until loaded, so nothing draws a piece without them', async () => {
    vi.resetModules();
    const { loadPieceData, pieceData } = await import('./pieceData');
    expect(() => pieceData()).toThrow(/loadPieceData/);
    const loading = loadPieceData();
    expect(loadPieceData()).toBe(loading);
    await loading;
    expect(pieceData()).toEqual({ knight: KNIGHT_MEDIUM, occlusion: OCCLUSION_MEDIUM });
  });

  it('load again after a failed load, so a board’s Retry can bring them', async () => {
    vi.resetModules();
    let fetches = 0;
    vi.doMock('./pieceData.files', async (importOriginal) => {
      if (fetches++ === 0) throw new Error('Failed to fetch dynamically imported module');
      return importOriginal();
    });
    try {
      const { loadPieceData, pieceData } = await import('./pieceData');
      const failed = loadPieceData();
      await expect(failed).rejects.toThrow();
      expect(() => pieceData()).toThrow(/loadPieceData/);
      const again = loadPieceData();
      expect(again).not.toBe(failed);
      await again;
      expect(pieceData()).toEqual({ knight: KNIGHT_MEDIUM, occlusion: OCCLUSION_MEDIUM });
      expect(fetches).toBe(2);
    } finally {
      vi.doUnmock('./pieceData.files');
    }
  });
});

// Every test file runs with the data loaded (setupTests.ts), so a page that
// draws pieces without loading it first passes them all and throws only in
// the browser: read the rule from the sources instead
const SRC = resolve(process.cwd(), 'src');
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(join(dir, e.name))
      : /\.tsx?$/.test(e.name) && !/\.(test|spec)\./.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );

describe('whatever draws pieces', () => {
  it('loads the data beside its canvas, but for the lobby, which draws only kings', () => {
    const loaders = sources(SRC).flatMap((file) =>
      [
        ...readFileSync(file, 'utf8').matchAll(
          /(Promise\.all\(\[)?import\('\.\/(\w*Canvas|LandingPreview)'\)(, loadPieceData\(\)\])?/g,
        ),
      ].map(([, all, chunk, data]) => ({
        file: relative(SRC, file),
        chunk,
        data: !!(all && data),
      })),
    );
    expect(loaders.map((l) => l.chunk).sort()).toEqual(
      expect.arrayContaining(['GameCanvas', 'LandingPreview', 'LearnCanvas', 'LobbyCanvas']),
    );
    for (const loader of loaders)
      expect(loader).toEqual({ ...loader, data: loader.chunk !== 'LobbyCanvas' });
  });

  it('loads the data before a dev page that draws them renders', () => {
    const pages = sources(join(SRC, 'dev'))
      .map((file) => ({ file: relative(SRC, file), text: readFileSync(file, 'utf8') }))
      .filter(
        ({ text }) =>
          /createRoot/.test(text) && /\b(PieceGallery|LandingPreview|Board)\b/.test(text),
      );
    expect(pages.length).toBeGreaterThanOrEqual(2);
    for (const { file, text } of pages)
      expect({ file, loads: /loadPieceData\(\)\.then\(/.test(text) }).toEqual({
        file,
        loads: true,
      });
  });
});
