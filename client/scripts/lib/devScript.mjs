// What the dev scripts share: their command line, and the browser they draw
// the scene in (software WebGL, SwiftShader, as on CI's runners).
import { chromium } from '@playwright/test';

const argv = process.argv.slice(2);

/** `--name value` on the command line, else `fallback`. */
export const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};

/** Whether `--name` is on the command line. */
export const flag = (name) => argv.includes(`--${name}`);

/** Playwright's Chromium, or PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH's (remote containers: /opt/pw-browsers/chromium). */
export const EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

/** Chromium drawing WebGL in software. */
export const launchSoftwareGl = () =>
  chromium.launch({
    executablePath: EXECUTABLE,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
    ],
  });
