import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { PreviewServer } from 'vite';
import { expect, test, vi } from 'vitest';
import config, { hostHeaders, hostRedirects, parseHeaders, parseRedirects } from './preview.config';

test('the bench serves the host’s headers (public/_headers), read as Pages reads them', () => {
  const rules = parseHeaders(readFileSync(resolve(process.cwd(), 'public/_headers'), 'utf8'));
  const names = (path: string) =>
    rules.filter((r) => r.path.test(path)).flatMap((r) => r.headers.map(([name]) => name));
  for (const path of ['/', '/game/abc', '/assets/index-B2x9_kQe.js'])
    expect(names(path)).toEqual(
      expect.arrayContaining([
        'X-Frame-Options',
        'Content-Security-Policy',
        'X-Content-Type-Options',
      ]),
    );
  // A path's dots are dots, its star anything
  const [rule] = parseHeaders('/a.b/*\n  X-Test: 1\n');
  expect([rule.path.test('/a.b/c/d'), rule.path.test('/axb/c')]).toEqual([true, false]);
  expect(rule.headers).toEqual([['X-Test', '1']]);
});

test('a _headers line the reader does not handle fails, naming the line', () => {
  expect(() => parseHeaders('/game/:id\n  X-Test: 1\n')).toThrow(/line 1/);
  expect(() => parseHeaders('/*\n  ! X-Frame-Options\n')).toThrow(/line 2/);
  expect(() => parseHeaders('/*\n  no colon here\n')).toThrow(/line 2/);
  expect(() => parseHeaders('  X-Test: 1\n')).toThrow(/before any path/);
});

test('the preview server sends every matching rule’s headers, query aside', () => {
  let middleware: (req: { url?: string }, res: unknown, next: () => void) => void = () => {};
  const server = {
    middlewares: { use: (fn: typeof middleware) => (middleware = fn) },
  } as unknown as PreviewServer;
  const plugin = hostHeaders(resolve(process.cwd(), 'public/_headers'));
  (plugin.configurePreviewServer as (s: PreviewServer) => void)(server);
  const sent: Record<string, string> = {};
  const next = vi.fn();
  middleware(
    { url: '/assets/a.js?v=1' },
    { setHeader: (n: string, v: string) => (sent[n] = v) },
    next,
  );
  expect(sent['X-Frame-Options']).toBe('DENY');
  expect(next).toHaveBeenCalledOnce();
  // The bench starts `vite preview --config` this file: it must carry the plugin
  const plugins = (config as { plugins: { name: string }[] }).plugins.map((p) => p.name);
  expect(plugins).toEqual(['host-headers', 'host-redirects']);
});

test('the bench serves a game’s address the invitation’s page, as the host does (public/_redirects)', () => {
  const rules = parseRedirects(readFileSync(resolve(process.cwd(), 'public/_redirects'), 'utf8'));
  expect(rules.find((r) => r.path.test('/game/ABC123'))?.to).toBe('/invite');
  expect(rules.some((r) => r.path.test('/new') || r.path.test('/'))).toBe(false);
  expect(() => parseRedirects('/old /new 301\n')).toThrow(/line 1/);
  expect(() => parseRedirects('/game/:id /invite 200\n')).toThrow(/line 1/);
  // In the preview server: /game/... becomes invite.html, where the build has one
  const dir = mkdtempSync(join(tmpdir(), 'preview-'));
  writeFileSync(join(dir, 'invite.html'), '');
  writeFileSync(join(dir, '_redirects'), '/game/* /invite 200\n');
  let middleware: (req: { url?: string }, res: unknown, next: () => void) => void = () => {};
  const server = {
    config: { root: dir, build: { outDir: '.' } },
    middlewares: { use: (fn: typeof middleware) => (middleware = fn) },
  } as unknown as PreviewServer;
  (hostRedirects(join(dir, '_redirects')).configurePreviewServer as (s: PreviewServer) => void)(
    server,
  );
  const served = (url: string) => {
    const req = { url };
    middleware(req, {}, () => {});
    return req.url;
  };
  expect(served('/game/ABC123?x=1')).toBe('/invite.html?x=1');
  expect(served('/new')).toBe('/new');
  rmSync(dir, { recursive: true });
});
