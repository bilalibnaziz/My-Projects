#!/usr/bin/env node
/**
 * End-to-end suite: starts Vite and a headless Chrome, then runs each *.e2e.mjs file, which
 * drives the real app with real mouse / pen / wheel / keyboard input and checks the pixels.
 *
 * Usage: npm run test:e2e [-- <name filter>]     (needs Google Chrome / Chromium; set CHROME_PATH otherwise)
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
// CDP_PORT=… lets two sessions run suites side by side (each gets its own Chrome)
const CDP_PORT = Number(process.env.CDP_PORT) || 9348;
const filter = process.argv[2] ?? '';

const chromePath = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => p && existsSync(p));
if (!chromePath) {
  console.error('Chrome/Chromium not found. Set CHROME_PATH to a Chromium-based browser.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'skillmotion-e2e-'));
const server = await createServer({ root, logLevel: 'error', server: { port: 0, strictPort: false } });
await server.listen();
const appUrl = server.resolvedUrls.local[0];
const chrome = spawn(chromePath, [
  '--headless=new', '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', '--force-device-scale-factor=1',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

let failed = 0;
try {
  for (let i = 0; i < 100; i++) {
    if (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then(() => true, () => false)) break;
    await sleep(100);
  }
  const suites = readdirSync(here).filter((f) => f.endsWith('.e2e.mjs') && f.includes(filter)).sort();
  for (const suite of suites) {
    console.log(`\n=== ${suite}`);
    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, [join(here, suite)], {
        stdio: 'inherit',
        env: { ...process.env, CDP_PORT: String(CDP_PORT), APP_URL: appUrl },
      });
      child.on('exit', resolve);
    });
    if (code !== 0) failed++;
  }
  console.log(failed ? `\n${failed} suite(s) failed` : `\nAll ${suites.length} suites passed`);
} finally {
  chrome.kill();
  await server.close();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
