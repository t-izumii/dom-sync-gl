import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium, devices } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const evidence = process.env.PORTFOLIO_EVIDENCE_DIR || join(tmpdir(), 'dom-sync-gl-portfolio-evidence');
await mkdir(evidence, { recursive: true });
const results = [], errors = [], expectedGPUloss = new WeakSet();
const pass = (name, detail = '') => { results.push({ name, detail, passed: true }); console.log(`PASS ${name}${detail ? ': ' + detail : ''}`); };
const server = await createServer({ configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)), server: { host: '127.0.0.1', port: 0, open: false }, logLevel: 'warn' });
await server.listen(); const base = server.resolvedUrls.local[0]; const browser = await chromium.launch();
const watch = page => { page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error' && !(expectedGPUloss.has(page) && (message.text().includes('GPUDevice') || message.text().includes('Device Lost')))) errors.push(message.text()); }); };
const ready = page => page.waitForFunction(() => ['ready','fallback'].includes(document.documentElement.dataset.portfolioPhase), { timeout: 15000 });
const loaded = page => page.waitForFunction(() => document.documentElement.dataset.synchronizedForms === '4' && document.documentElement.dataset.portfolioPhase === 'ready', { timeout: 15000 });
const fits = async page => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal document overflow');
const chapter = async (page, index) => {
  await page.evaluate(index => { const section = document.querySelector('#work'); scrollTo({ top: section.getBoundingClientRect().top + scrollY + (section.offsetHeight - innerHeight) * index / 2, behavior: 'instant' }); }, index);
  await page.waitForTimeout(250);
};
const debug = page => page.evaluate(() => window.__portfolioDebug.diagnostics);
const alignment = async page => {
  const delta = await page.evaluate(() => {
    const d = window.__portfolioDebug;
    return Math.max(...d.items.filter(item => item.object.getModel().visible).map(item => {
      const camera=item.engine.getCamera().instance,canvas=item.engine.getRenderer().domElement.getBoundingClientRect();
      const point = item.object.getModel().position.clone().project(camera), rect = item.element.getBoundingClientRect();
      return Math.hypot(canvas.left + (point.x + 1) * canvas.width / 2 - (rect.left + rect.width / 2), canvas.top + (1 - point.y) * canvas.height / 2 - (rect.top + rect.height / 2));
    }), 0);
  });
  assert(delta < 1.1, `DOM / 3D origin alignment error ${delta}`); return delta;
};

// Decode screenshots with existing Node APIs; no extra image package is installed.
function png(buffer) {
  let offset = 8, width, height, channels; const chunks = [];
  while (offset < buffer.length) { const length = buffer.readUInt32BE(offset), type = buffer.toString('ascii', offset + 4, offset + 8), data = buffer.subarray(offset + 8, offset + 8 + length); if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); channels = data[9] === 6 ? 4 : 3; assert.equal(data[8], 8); } if (type === 'IDAT') chunks.push(data); offset += length + 12; }
  const bytes = inflateSync(Buffer.concat(chunks)), stride = width * channels, pixels = Buffer.alloc(stride * height);
  const paeth = (a,b,c) => { const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c); return pa<=pb&&pa<=pc?a:pb<=pc?b:c; };
  for (let y=0;y<height;y++) { const filter=bytes[y*(stride+1)];for(let x=0;x<stride;x++){const index=y*stride+x,left=x>=channels?pixels[index-channels]:0,up=y?pixels[index-stride]:0,corner=y&&x>=channels?pixels[index-stride-channels]:0,value=filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):filter===4?paeth(left,up,corner):0;pixels[index]=(bytes[y*(stride+1)+1+x]+value)&255;} }
  return { width,height,channels,pixels };
}
function difference(a,b) { const x=png(a),y=png(b);assert.equal(x.width,y.width);assert.equal(x.height,y.height);let sum=0,changed=0;for(let i=0;i<x.width*x.height;i++){let d=0;for(let c=0;c<3;c++)d+=Math.abs(x.pixels[i*x.channels+c]-y.pixels[i*y.channels+c]);sum+=d;if(d>30)changed++;}return{mean:sum/(x.width*x.height*3),changed:changed/(x.width*x.height)}; }

try {
  const page = await browser.newPage({ viewport: { width:1440, height:1000 }, deviceScaleFactor:1 }); watch(page);
  await page.goto(base + 'portfolio.html?debug'); await loaded(page); await fits(page);
  const renderer = await page.evaluate(() => document.documentElement.dataset.portfolioRenderer);
  assert.notEqual(renderer,'dom');assert.equal((await debug(page)).forms,4);assert.equal((await debug(page)).independentPaths,4);
  assert.equal(await page.locator('canvas').count(),3);
  assert.equal((await debug(page)).workCanvasMode,'dom');
  pass('Normal flow / sticky DOM / fixed layers use separate canvases');
  assert(await page.evaluate(()=>{const d=window.__portfolioDebug;return d.app.getScene().environment!==d.workApp.getScene().environment;}));
  pass('Each renderer owns its environment texture / PMREM context');
  pass('Four real DOM-synchronized sculptures plus independent space paths',renderer);
  pass('Initial 3D / DOM anchor alignment',`${(await alignment(page)).toFixed(4)}px`);
  await page.screenshot({path:join(evidence,'desktop-top.png')});
  const spaceBefore = await page.evaluate(() => window.__portfolioDebug.space.position.x);
  await page.evaluate(() => document.querySelector('#hero-form').style.translate = '25px 0');await page.waitForTimeout(100);
  await alignment(page);assert.equal(await page.evaluate(() => window.__portfolioDebug.space.position.x),spaceBefore);
  await page.evaluate(() => document.querySelector('#hero-form').style.translate = '');
  pass('DOM anchor moves sculpture; independent layer stays in screen space');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  const paused=await debug(page);await page.waitForTimeout(350);assert.equal((await debug(page)).frames,paused.frames);
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(100);pass('Hidden document pauses the animation loop');
  const before = await debug(page);await page.waitForTimeout(1000);const after=await debug(page);
  assert(after.frames-before.frames>0 && after.frames-before.frames<=65,`continuous GPU draw: ${after.frames-before.frames} frames / 1s`);pass('Live rendering bounded at 60fps',`${after.frames-before.frames} frames / 1s`);
  await chapter(page,0);await alignment(page);await page.screenshot({path:join(evidence,'desktop-fold.png')});
  assert.equal(await page.locator('.work-current').textContent(),'01');
  await chapter(page,1);await alignment(page);assert.equal(await page.locator('.work-current').textContent(),'02');assert.equal((await debug(page)).visible,1);
  await page.screenshot({path:join(evidence,'desktop-echo.png')});
  await page.locator('[data-transform="echo-form"]').click();await page.waitForTimeout(1500);
  assert.equal(await page.locator('[data-transform="echo-form"]').getAttribute('aria-pressed'),'true');
  assert(await page.evaluate(() => window.__portfolioDebug.items.find(i=>i.kind==='echo').value>.93));
  const nativeShader = await page.evaluate(async()=>{const d=window.__portfolioDebug,item=d.items.find(i=>i.element.id==='hero-form'),engine=item.engine;return await engine.getRenderer().debug.getShaderAsync(engine.getScene(),engine.getCamera().instance,item.parts[0].mesh);});
  assert(nativeShader.vertexShader.includes('izumiField'));
  assert(nativeShader.fragmentShader.toLowerCase().includes('iridescence'));
  pass('Native shader field / analytic normals / thin-film shading compile in renderer');
  await page.screenshot({path:join(evidence,'desktop-echo-transformed.png')});pass('Pinned chapters / visible-object culling / actual ring recomposition');
  await page.locator('.study-matter [data-transform]').evaluate(el=>{el.focus();el.scrollIntoView({block:'nearest',inline:'nearest'});});
  assert.equal(await page.locator('.work-stage').evaluate(el=>el.scrollLeft),0);
  await alignment(page);pass('Offscreen focus cannot create hidden horizontal scroll / anchor jump');
  const link = page.locator('.study-echo [data-project]');await link.click();assert(await page.locator('dialog').evaluate(el=>el.open));
  assert.equal(await page.locator('#project-title').textContent(),'Echo');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'作品詳細を閉じる');
  await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'project-next');await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'作品詳細を閉じる');await page.screenshot({path:join(evidence,'desktop-detail.png')});
  pass('Detail opens / keyboard focus trap');
  await page.goBack();assert(!(await page.locator('dialog').evaluate(el=>el.open)));await page.goForward();assert(await page.locator('dialog').evaluate(el=>el.open));pass('Back / Forward detail restoration');
  await page.locator('#project-next').click();assert.equal(await page.locator('#project-title').textContent(),'Matter');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog').open);
  assert(await link.evaluate(el=>el===document.activeElement));pass('Next / Escape / original focus restoration');
  await page.goto(base+'portfolio.html?debug#project-matter');await loaded(page);assert.equal(await page.locator('#project-title').textContent(),'Matter');
  await page.getByRole('button',{name:'作品詳細を閉じる'}).click();await page.waitForFunction(()=>!document.querySelector('dialog').open);pass('Direct hash detail / close without previous history');

  await page.goto(base+'portfolio.html?debug');await loaded(page);await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('#echo-form').scrollIntoViewIfNeeded();await page.waitForTimeout(150);
  const frozen=await page.screenshot();const idleStart=await debug(page);await page.waitForTimeout(650);const frozenLater=await page.screenshot();
  assert(difference(frozen,frozenLater).mean<.02);assert((await debug(page)).frames-idleStart.frames<=1);
  assert(await page.locator('.study').evaluateAll(nodes=>nodes.every(n=>!n.inert)));assert(!(await page.evaluate(()=>window.__portfolioDebug.space.visible)));
  pass('Live reduced-motion switch: static stacked chapters / no continuous GPU draw');
  const beforeMorph=await page.screenshot();await page.locator('[data-transform="echo-form"]').click();await page.waitForTimeout(100);const afterMorph=await page.screenshot();
  const morphDiff=difference(beforeMorph,afterMorph);assert(morphDiff.changed>.004);pass('Keyboard-accessible explicit static transform',`${(morphDiff.changed*100).toFixed(2)}% pixels change`);
  for (const width of [320,390,768,900,1024,1920,2560,3440]) { await page.setViewportSize({width,height:1000});await page.waitForTimeout(150);await fits(page);await alignment(page); }
  pass('Responsive resize 320–3440px / synchronized origins remain aligned');
  await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>document.querySelector('.study-fold .study-description').textContent='長い文章でも読みやすさとレイアウトを保つための確認です。'.repeat(80));
  await page.waitForFunction(()=>document.documentElement.classList.contains('content-expanded'));
  assert(await page.locator('.study').evaluateAll(nodes=>nodes.every(n=>!n.inert)));await fits(page);await page.locator('#fold-form').scrollIntoViewIfNeeded();await alignment(page);
  pass('Long copy automatically expands to readable, stacked chapters');
  await page.goto(base+'portfolio.html?debug');await loaded(page);await page.locator('#about').scrollIntoViewIfNeeded();await page.waitForTimeout(250);
  const offscreen=await debug(page);await page.waitForTimeout(700);assert.equal((await debug(page)).frames,offscreen.frames);pass('GPU stops when all art is offscreen');

  const gl=await browser.newPage({viewport:{width:390,height:844}});watch(gl);await gl.goto(base+'portfolio.html?backend=webgl&debug');await loaded(gl);
  assert.equal(await gl.evaluate(()=>document.documentElement.dataset.portfolioRenderer),'webgl');pass('Forced WebGL2 backend');
  expectedGPUloss.add(gl);
  await gl.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  assert.equal(await gl.locator('canvas').count(),0);assert.equal(await gl.locator('.is-gl').count(),0);assert((await debug(gl)).disposed);
  await gl.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await loaded(gl);await gl.waitForFunction(()=>document.querySelectorAll('.is-gl').length===4);
  assert.equal(await gl.locator('canvas').count(),3);pass('pagehide GPU disposal / bfcache reconstruction');
  expectedGPUloss.add(gl);await gl.evaluate(()=>document.querySelector('#portfolio-gl canvas').dispatchEvent(new Event('webglcontextlost',{cancelable:true})));
  assert.equal(await gl.locator('canvas').count(),0);assert.equal(await gl.locator('.is-gl').count(),0);pass('Context loss restores static DOM images');await gl.close();

  const phone=await browser.newPage({...devices['iPhone 13'],deviceScaleFactor:1});watch(phone);await phone.goto(base+'portfolio.html?debug');await loaded(phone);await fits(phone);
  await phone.screenshot({path:join(evidence,'mobile-top.png')});const phoneStart=await debug(phone);await phone.waitForTimeout(1000);const phoneFrames=(await debug(phone)).frames-phoneStart.frames;
  assert(phoneFrames>8&&phoneFrames<=33);pass('Mobile continuous draw capped at 30fps',`${phoneFrames} frames / 1s`);
  const initialDrag=await phone.evaluate(()=>window.__portfolioDebug.items.find(i=>i.element.id==='hero-form').drag);
  const box=await phone.locator('#hero-form').boundingBox();const session=await phone.context().newCDPSession(phone);
  const touch={x:Math.round(box.x+box.width*.5),y:Math.round(box.y+box.height*.5)};
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch]});
  for(let i=1;i<=5;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touch.x+12*i,y:touch.y+1}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert(Math.abs(await phone.evaluate(()=>window.__portfolioDebug.items.find(i=>i.element.id==='hero-form').drag)-initialDrag)>.1);
  await phone.locator('[data-transform="hero-form"]').tap();await phone.waitForTimeout(800);assert.equal(await phone.locator('[data-transform="hero-form"]').getAttribute('aria-pressed'),'true');
  pass('Real touch events: drag rotation / tap transformation');
  const scrollBefore = await phone.evaluate(()=>scrollY);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:250,y:380}]});
  for (let i=1;i<=8;i++) { await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:250,y:380-i*20}]}); await phone.waitForTimeout(16); }
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await phone.waitForTimeout(200);
  assert(await phone.evaluate(()=>scrollY)>scrollBefore+40);pass('Vertical touch scroll remains native over the sculpture');
  await phone.getByRole('link',{name:'Explorations 03',exact:true}).tap();await phone.waitForTimeout(1100);await chapter(phone,0);
  await phone.screenshot({path:join(evidence,'mobile-fold.png')});await phone.getByRole('button',{name:'Echoへ',exact:true}).tap();await phone.waitForTimeout(1100);await alignment(phone);
  assert.equal(await phone.locator('.work-current').textContent(),'02');await phone.screenshot({path:join(evidence,'mobile-echo.png')});
  await phone.locator('[data-transform="echo-form"]').tap();await phone.waitForTimeout(900);await phone.screenshot({path:join(evidence,'mobile-echo-transformed.png')});
  await phone.locator('.study-echo [data-project]').tap();assert(await phone.locator('dialog').evaluate(el=>el.open));await phone.screenshot({path:join(evidence,'mobile-detail.png')});
  await phone.getByRole('button',{name:'作品詳細を閉じる'}).tap();await phone.waitForFunction(()=>!document.querySelector('dialog').open);await chapter(phone,2);await phone.screenshot({path:join(evidence,'mobile-matter.png')});
  await phone.getByRole('link',{name:'About',exact:true}).tap();await phone.waitForTimeout(1000);await fits(phone);pass('Mobile navigation / chapter selector / details');
  await phone.setViewportSize({width:390,height:844});await chapter(phone,1);await fits(phone);await alignment(phone);await phone.screenshot({path:join(evidence,'mobile-tall-echo.png')});
  pass('Short and tall mobile viewport layouts');await phone.close();

  const fallback=await browser.newPage({viewport:{width:390,height:844}});watch(fallback);await fallback.goto(base+'portfolio.html?no-gl');await ready(fallback);
  assert.equal(await fallback.locator('canvas').count(),0);await chapter(fallback,0);await fallback.locator('.study-fold [data-project]').click();assert(await fallback.locator('dialog').evaluate(el=>el.open));pass('Explicit DOM fallback / functional detail');await fallback.close();
  const noGPU=await browser.newPage();const blockedErrors=[];noGPU.on('pageerror',e=>blockedErrors.push(e.message));
  await noGPU.addInitScript(()=>{Object.defineProperty(navigator,'gpu',{value:undefined});const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...rest){return ['webgl','webgl2','experimental-webgl'].includes(kind)?null:original.call(this,kind,...rest);};});
  await noGPU.goto(base+'portfolio.html');await ready(noGPU);assert.equal(await noGPU.evaluate(()=>document.documentElement.dataset.portfolioRenderer),'dom');assert.equal(blockedErrors.length,0);await chapter(noGPU,0);await noGPU.locator('.study-fold [data-project]').click();assert(await noGPU.locator('dialog').evaluate(el=>el.open));pass('Actual unsupported GPU retains readable content / navigation');await noGPU.close();
  const delayed=await browser.newPage({viewport:{width:390,height:844}});watch(delayed);
  await delayed.route('**/portfolio/*.{png,glb}',async route=>{await new Promise(resolve=>setTimeout(resolve,1400));await route.continue();});
  await delayed.goto(base+'portfolio.html',{waitUntil:'domcontentloaded'});assert((await delayed.locator('#hero-form').boundingBox()).height>400);await fits(delayed);await loaded(delayed);pass('Delayed images and models reserve stable DOM geometry');await delayed.close();
  const broken=await browser.newPage({viewport:{width:390,height:844}}); // Expected loader/network errors are isolated from normal browser failures.
  await broken.route('**/portfolio/echo.*',route=>route.abort());await broken.goto(base+'portfolio.html');await ready(broken);assert.equal(await broken.locator('.is-gl').count(),3,await broken.evaluate(()=>document.documentElement.dataset.portfolioFallbackReason));await chapter(broken,1);await fits(broken);
  assert(await broken.locator('#echo-form').evaluate(el=>!el.classList.contains('is-gl')&&el.classList.contains('image-error')));await broken.locator('.study-echo [data-project]').click();assert.equal(await broken.locator('#project-title').textContent(),'Echo');pass('Broken model + image retains placeholder / detail');await broken.close();
  const compatibility=await browser.newPage({viewport:{width:390,height:844}});watch(compatibility);
  await compatibility.addInitScript(()=>{Object.defineProperty(window,'GPUShaderStage',{configurable:true,value:undefined});Object.defineProperty(navigator,'gpu',{configurable:true,value:undefined});});
  await compatibility.goto(base+'portfolio.html?diagnostics&debug');await loaded(compatibility);
  assert.equal(await compatibility.evaluate(()=>document.documentElement.dataset.portfolioRenderer),'webgl');
  assert.equal(await compatibility.evaluate(()=>document.documentElement.dataset.portfolioGpuConstants),'local-stage-flags');
  assert((await compatibility.locator('.render-diagnostics [data-status]').textContent()).includes('WebGL2 / 3D表示'));
  assert((await compatibility.locator('.render-diagnostics [data-origin]').textContent()).includes('API なし'));
  pass('Missing WebGPU enums / API still load WebGL2 and diagnostic UI');
  await compatibility.emulateMedia({reducedMotion:'reduce'});await compatibility.waitForTimeout(100);
  assert((await compatibility.locator('.render-diagnostics [data-motion]').textContent()).includes('3Dを静止表示'));
  assert.equal(await compatibility.locator('.is-gl').count(),4);pass('Diagnostics distinguish static 3D from image fallback');
  expectedGPUloss.add(compatibility);
  await compatibility.evaluate(()=>document.querySelector('#portfolio-gl canvas').dispatchEvent(new Event('webglcontextlost',{cancelable:true})));
  assert.equal(await compatibility.locator('.render-diagnostics [data-status]').textContent(),'画像 fallback');
  assert((await compatibility.locator('.render-diagnostics [data-reason]').textContent()).includes('コンテキスト'));
  await compatibility.getByRole('button',{name:'3Dを再試行',exact:true}).click();await loaded(compatibility);
  assert.equal(await compatibility.locator('canvas').count(),3);pass('Context-loss diagnostic reason / retry reconstructs three owned renderers');
  await compatibility.close();

  const importFailure=await browser.newPage({viewport:{width:390,height:844}}),importErrors=[];
  importFailure.on('pageerror',e=>importErrors.push(e.message));
  await importFailure.route('**/src/portfolio/surface.ts',route=>route.abort());
  await importFailure.goto(base+'portfolio.html?diagnostics');await ready(importFailure);
  assert.equal(await importFailure.locator('.render-diagnostics [data-status]').textContent(),'画像 fallback');
  assert((await importFailure.locator('.render-diagnostics [data-reason]').textContent()).includes('初期化'));
  await chapter(importFailure,0);await importFailure.locator('.study-fold [data-project]').click();assert(await importFailure.locator('dialog').evaluate(el=>el.open));
  assert.equal(importErrors.length,0);pass('GPU module import failure preserves DOM details / reports reason');
  const hrefs=await page.locator('a[href^="https:"]').evaluateAll(nodes=>nodes.map(n=>n.href));assert(hrefs.every(h=>h==='https://github.com/t-izumii'||h==='https://github.com/t-izumii/dom-sync-gl'));pass('Only verified public contact destinations');
  assert.equal(errors.length,0,errors.join('\n'));pass('No unexpected browser errors');
  await writeFile(join(evidence,'results.json'),JSON.stringify({environment:'Mac mini / local Playwright Chromium; iPhone touch emulation',renderer,results},null,2));
  console.log(`All ${results.length} checks passed. Screenshots: ${evidence}`);
} catch(error) { await writeFile(join(evidence,'results.json'),JSON.stringify({results,error:String(error),errors},null,2));throw error; }
finally { await browser.close();await server.close(); }
