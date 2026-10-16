import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { placeLandingPictureEarly, preloadLandingPictureOnStartPage } from './vite.config';

test('the built page preloads its picture after the viewport tag, where a phone knows its width', async () => {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const transform = preloadLandingPictureOnStartPage().transformIndexHtml as (
    html: string,
  ) => Promise<string>;
  const built = await transform(html);
  // Before the tag a phone's innerWidth is the default 980 px: the script
  // would pick the tablet's picture, and the phone's would come late
  const viewport = built.indexOf('<meta name="viewport"');
  expect(viewport).toBeGreaterThan(-1);
  expect(built.indexOf('innerWidth')).toBeGreaterThan(viewport);
});

test('the built page places the start page’s picture right after #root, self-contained', async () => {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const transform = placeLandingPictureEarly().transformIndexHtml as (
    html: string,
  ) => Promise<string>;
  const built = await transform(html);
  const script = built.match(/<div id="root"><\/div>\s*<script>([\s\S]*?)<\/script>/)?.[1];
  expect(script).toBeTruthy();
  expect(script).not.toMatch(/\bimport\b/);
  expect(script).toContain('landing-early');
});
