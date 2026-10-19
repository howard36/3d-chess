import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

/**
 * The browser bench serves the build with `vite preview --config` this file,
 * not the app's own vite.config.ts: it is part of the harness (bench/run.mjs
 * copies client/bench over a base it compares with), so both sides of an A/B
 * are served by the same code, each with its own `_headers` as built.
 */

/** One rule of the host's `_headers` file: the paths it matches and the headers it adds. */
export interface HeaderRule {
  path: RegExp;
  headers: [string, string][];
}

/**
 * Cloudflare Pages' `_headers` format: a path (`*` matches anything) on a
 * line of its own, then its headers indented under it, `#` for a comment.
 * Anything else Pages reads (`:placeholder` paths, `! Name` removals, a
 * header before any path) throws, naming the line, rather than leaving a rule
 * out of the bench without a word.
 */
export function parseHeaders(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim() || line.trim().startsWith('#')) return;
    const fail = (why: string) => {
      throw new Error(`_headers line ${i + 1} (${line.trim()}): ${why}`);
    };
    if (/^\S/.test(line)) {
      if (!/^[/A-Za-z0-9._*~-]+$/.test(line.trim())) fail('a path this reader does not handle');
      const parts = line
        .trim()
        .split('*')
        .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
      rules.push({ path: new RegExp(`^${parts.join('.*')}$`), headers: [] });
      return;
    }
    const header = /^\s+([A-Za-z0-9-]+):\s*(.*\S)\s*$/.exec(line);
    if (!header) fail('not a "Name: value" header');
    if (!rules.length) fail('a header before any path');
    rules.at(-1)!.headers.push([header![1], header![2]]);
  });
  return rules;
}

/**
 * Sends each matching rule's headers, in the file's order (a relative `file`
 * is in the build). A build with no `_headers` (the first recorded run's, the
 * long view's base) is served with none, as its host served it.
 */
export const hostHeaders = (file: string): Plugin => ({
  name: 'host-headers',
  configurePreviewServer(server) {
    const outDir = resolve(server.config.root, server.config.build.outDir);
    const path = resolve(outDir, file);
    const rules = existsSync(path) ? parseHeaders(readFileSync(path, 'utf8')) : [];
    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? '/').split('?')[0];
      for (const rule of rules)
        if (rule.path.test(path))
          for (const [name, value] of rule.headers) res.setHeader(name, value);
      next();
    });
  },
});

/** One rule of the host's `_redirects` file that serves another file at an address. */
export interface Rewrite {
  path: RegExp;
  to: string;
}

/**
 * Cloudflare Pages' `_redirects` format, as far as the app uses it: `from to
 * 200`, a rewrite (`*` matches anything). A redirect or a placeholder throws,
 * naming the line, rather than being served as something else.
 */
export function parseRedirects(text: string): Rewrite[] {
  const rules: Rewrite[] = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim() || line.trim().startsWith('#')) return;
    const [from, to, status, ...rest] = line.trim().split(/\s+/);
    if (status !== '200' || rest.length || !/^[/A-Za-z0-9._*~-]+$/.test(from) || !to)
      throw new Error(
        `_redirects line ${i + 1} (${line.trim()}): not a rewrite this reader handles`,
      );
    const parts = from.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
    rules.push({ path: new RegExp(`^${parts.join('.*')}$`), to });
  });
  return rules;
}

/**
 * Serves a rewritten address's file as Pages does (`/game/*` is the
 * invitation's page, invite.html), where the build being served has it.
 */
export const hostRedirects = (file: string): Plugin => ({
  name: 'host-redirects',
  configurePreviewServer(server) {
    const rules = existsSync(file) ? parseRedirects(readFileSync(file, 'utf8')) : [];
    const outDir = resolve(server.config.root, server.config.build.outDir);
    server.middlewares.use((req, _res, next) => {
      const [path, query] = (req.url ?? '/').split(/\?(.*)/s);
      const rule = rules.find((r) => r.path.test(path));
      // Pages serves /invite from invite.html
      const to = rule && (existsSync(resolve(outDir, `.${rule.to}`)) ? rule.to : `${rule.to}.html`);
      if (to && existsSync(resolve(outDir, `.${to}`))) req.url = query ? `${to}?${query}` : to;
      next();
    });
  },
});

// Run from the side's client/ (the bench starts the server there). The
// headers are the build's copy of public/_headers, with whatever rules the
// build added to it (vite.config.ts, keepHashedFiles)
export default defineConfig({
  plugins: [hostHeaders('_headers'), hostRedirects(resolve(process.cwd(), 'public/_redirects'))],
});
