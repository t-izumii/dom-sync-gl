import { createServer } from 'vite';
import { chromium } from 'playwright';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = fileURLToPath(new URL('../public/portfolio/', import.meta.url));
const cache = await mkdtemp(join(tmpdir(), 'portfolio-art-'));
const server = await createServer({ configFile: false, root, cacheDir: cache, server: { host: '127.0.0.1', port: 0 }, logLevel: 'warn' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } });
  await page.goto(server.resolvedUrls.local[0] + 'example/scripts/portfolio-art.html');
  await page.waitForFunction(() => window.artReady);
  for (const kind of ['fold', 'echo', 'matter']) {
    const data = await page.evaluate(kind => window.renderArt(kind), kind);
    await writeFile(join(output, kind + '.png'), Buffer.from(data.split(',')[1], 'base64'));
    console.log('Saved ' + kind + '.png');
  }
} finally {
  await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true });
}
