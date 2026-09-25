// example/gpu-regression.html をヘッドレス Chromium で開き、WebGPU / WebGL 2 の
// 実描画テストを自動実行する。結果はページの #results に 1 行ずつ出るので、
// DONE が出るまで待ってから FAIL / ERROR の有無で終了コードを決める。
//
// 環境変数:
//   GPU_REGRESSION_REQUIRE_WEBGPU=1  WebGPU が使えず WebGL 2 にフォールバックしたら失敗にする
//   GPU_REGRESSION_TIMEOUT=120000   DONE を待つ上限（ms）
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const requireWebGPU = process.env.GPU_REGRESSION_REQUIRE_WEBGPU === '1';
const timeout = Number(process.env.GPU_REGRESSION_TIMEOUT ?? 120_000);

// Linux の CI には GPU が無いので、WebGPU / WebGL とも SwiftShader（CPU 実装）で動かす。
const chromiumArgs = [
  '--enable-unsafe-webgpu',
  '--ignore-gpu-blocklist',
  ...(process.platform === 'linux'
    ? ['--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan']
    : []),
];

const server = await createServer({
  configFile: fileURLToPath(new URL('../example/vite.config.ts', import.meta.url)),
  server: { port: 0, open: false, host: '127.0.0.1' },
  logLevel: 'warn',
});
await server.listen();
const url = new URL('/gpu-regression.html', server.resolvedUrls.local[0]).href;

const browser = await chromium.launch({ args: chromiumArgs });
let exitCode = 1;
try {
  const page = await browser.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error(`[browser] ${msg.text()}`);
  });
  page.on('pageerror', (err) => console.error(`[pageerror] ${err.message}`));
  await page.goto(url);
  await page.waitForFunction(
    () => document.querySelector('#results')?.textContent?.includes('DONE'),
    undefined,
    { timeout },
  );
  const lines = await page.$$eval('#results > div', (nodes) => nodes.map((n) => n.textContent ?? ''));
  for (const line of lines) console.log(line);

  const failures = lines.filter((l) => /^(FAIL|ERROR|UNHANDLED)/.test(l));
  const fellBack = lines.some((l) => l.startsWith('WebGPU unavailable'));
  const passed = lines.filter((l) => l.startsWith('PASS')).length;

  if (failures.length > 0) {
    console.error(`\n${failures.length} failure(s).`);
  } else if (requireWebGPU && fellBack) {
    console.error('\nWebGPU was required but the WebGL 2 fallback was used.');
  } else if (passed === 0) {
    console.error('\nNo checks passed.');
  } else {
    console.log(`\nAll ${passed} checks passed${fellBack ? ' (WebGPU unavailable: WebGL 2 only)' : ''}.`);
    exitCode = 0;
  }
} catch (err) {
  console.error(err);
} finally {
  await browser.close();
  await server.close();
}
process.exit(exitCode);
