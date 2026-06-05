// screenshot.mjs — capture a localhost URL with the installed Google Chrome (via puppeteer-core).
//
// Usage:
//   node screenshot.mjs http://localhost:3000            -> temporary screenshots/screenshot-N.png
//   node screenshot.mjs http://localhost:3000 hero       -> temporary screenshots/screenshot-N-hero.png
//
// Notes:
//   - N auto-increments; existing files are never overwritten.
//   - Captures a full-page screenshot at 1440px wide, 2x (retina) by default.
//   - Override the browser with CHROME_PATH=/path/to/Chrome if needed.

import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'temporary screenshots');

// --- args ---
const url = process.argv[2] || 'http://localhost:3000';
const label = (process.argv[3] || '').trim().replace(/[^a-zA-Z0-9_-]/g, '-');

// --- locate Chrome ---
function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error('Could not find Google Chrome. Set CHROME_PATH=/path/to/Chrome');
}

// --- next filename (auto-increment, never overwrite) ---
function nextPath() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  let max = 0;
  for (const f of readdirSync(OUT_DIR)) {
    const m = f.match(/^screenshot-(\d+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const n = max + 1;
  const name = label ? `screenshot-${n}-${label}.png` : `screenshot-${n}.png`;
  return join(OUT_DIR, name);
}

const outPath = nextPath();

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  // Dedicated profile + pipe transport so a separate headless instance starts
  // reliably even when the user's Chrome is already running.
  userDataDir: mkdtempSync(join(tmpdir(), 'vw-shot-')),
  pipe: true,
  args: [
    '--no-sandbox', '--hide-scrollbars', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check', '--force-color-profile=srgb',
  ],
  timeout: 30000,
});

// Scroll the whole page so IntersectionObserver / lazy-loaded content reveals,
// then return to the top for a clean full-page capture.
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let y = 0;
      const step = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        y += step;
        if (y >= document.body.scrollHeight) { clearInterval(timer); resolve(); }
      }, 40);
    });
    window.scrollTo(0, 0);
  });
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  // Render reveal/scroll animations in their final (settled) state for a stable capture.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  // let web fonts settle
  try { await page.evaluateHandle('document.fonts.ready'); } catch {}
  await autoScroll(page);
  await new Promise((r) => setTimeout(r, 350));
  await page.screenshot({ path: outPath, fullPage: true });
  console.log(`✓ saved ${outPath.replace(__dirname + '/', '')}`);
} finally {
  await browser.close();
}
