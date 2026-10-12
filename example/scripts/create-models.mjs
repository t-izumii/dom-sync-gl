import { createServer } from 'vite';
import { chromium } from 'playwright';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = fileURLToPath(new URL('../public/portfolio/', import.meta.url));
const cache = await mkdtemp(join(tmpdir(), 'portfolio-models-'));
const server = await createServer({ configFile: false, root, cacheDir: cache, server: { host: '127.0.0.1', port: 0 }, logLevel: 'warn' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(server.resolvedUrls.local[0] + 'example/scripts/models.html');
  await page.waitForFunction(() => window.modelReady);
  for (const kind of ['fold', 'echo', 'matter']) {
    const data = await page.evaluate(kind => window.makeModel(kind), kind);
    await writeFile(join(output, kind + '.glb'), Buffer.from(data, 'base64'));
    console.log(kind + ' GLB saved');
  }
} finally { await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true }); }
