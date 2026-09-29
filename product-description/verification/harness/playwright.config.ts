import { defineConfig } from '@playwright/test';
import path from 'node:path';

// The first verification pass. See README.md in this directory. The server on
// port 8000 must be started separately for server-restart.spec.ts (it kills
// and restarts it); the other specs let Playwright start it.
const root = path.join(__dirname, '../../..');
export default defineConfig({
  testDir: '.',
  timeout: 300_000,
  workers: 1,
  reporter: 'list',
  webServer: [
    {
      command: 'uv run --extra test uvicorn modal_app:create_web_app --factory --host 127.0.0.1 --port 8000',
      cwd: path.join(root, 'server'),
      url: 'http://127.0.0.1:8000/health',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'npm run dev',
      cwd: path.join(root, 'client'),
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 120_000,
      env: { VITE_WS_URL: 'ws://127.0.0.1:8000/ws' },
    },
  ],
  use: {
    baseURL: 'http://localhost:5173',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
    },
  },
});
