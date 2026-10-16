import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

/**
 * The browser bench serves the build with `vite preview --config` this file,
 * not the app's own vite.config.ts: it is part of the harness (bench/run.mjs
 * copies client/bench over a base it compares with), so both sides of an A/B
 * are served by the same code, each with its own `public/_headers`.
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

/** Sends each matching rule's headers, in the file's order. */
export const hostHeaders = (file: string): Plugin => ({
  name: 'host-headers',
  configurePreviewServer(server) {
    const rules = parseHeaders(readFileSync(file, 'utf8'));
    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? '/').split('?')[0];
      for (const rule of rules)
        if (rule.path.test(path))
          for (const [name, value] of rule.headers) res.setHeader(name, value);
      next();
    });
  },
});

// Run from the side's client/ (the bench starts the server there)
export default defineConfig({
  plugins: [hostHeaders(resolve(process.cwd(), 'public/_headers'))],
});
