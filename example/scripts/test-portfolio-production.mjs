import assert from 'node:assert/strict';
import {preview} from 'vite';
import {chromium,devices} from 'playwright';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Build first. Bind the specified existing LAN address for a real nonsecure
// origin check, rather than pretending that localhost has the same browser APIs.
const host=process.env.PORTFOLIO_TEST_HOST||'127.0.0.1';
const output=process.env.PORTFOLIO_EVIDENCE_DIR||join(tmpdir(),'dom-sync-gl-portfolio-production');
await mkdir(output,{recursive:true});
const server=await preview({configFile:fileURLToPath(new URL('../vite.config.ts',import.meta.url)),preview:{host,port:0,open:false},logLevel:'warn'});
const address=server.httpServer.address();
const url=`http://${host}:${address.port}/portfolio.html`;
const browser=await chromium.launch();
const errors=[],report={url};
try {
  const page=await browser.newPage({...devices['iPhone 13'],deviceScaleFactor:1});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(url+'?diagnostics&debug');
  await page.waitForFunction(()=>document.documentElement.dataset.portfolioPhase==='ready');
  Object.assign(report,await page.evaluate(()=>({secure:isSecureContext,gpu:!!navigator.gpu,backend:document.documentElement.dataset.portfolioRenderer,shader:document.documentElement.dataset.portfolioShader,stageFlags:document.documentElement.dataset.portfolioGpuConstants,canvases:document.querySelectorAll('canvas').length,liveForms:document.querySelectorAll('.is-gl').length})));
  assert.equal(report.canvases,3);assert.equal(report.liveForms,4);
  if(host!=='127.0.0.1'){assert.equal(report.secure,false);assert.equal(report.gpu,false);assert.equal(report.backend,'webgl');assert.equal(report.shader,'native-glsl');assert.equal(report.stageFlags,'local-stage-flags');}
  await page.screenshot({path:join(output,'production-diagnostics.png')});
  await page.locator('.render-diagnostics summary').click();
  await page.getByRole('link',{name:'Explorations 03',exact:true}).click();
  await page.waitForTimeout(900);await page.getByRole('button',{name:'Echoへ',exact:true}).click();await page.waitForTimeout(1000);
  assert.equal(await page.locator('.work-current').textContent(),'02');
  assert.equal(await page.locator('.work-stage').evaluate(el=>el.scrollLeft),0);
  await page.locator('.study-echo [data-project]').click();
  assert.equal(await page.locator('#project-title').textContent(),'Echo');
  await page.screenshot({path:join(output,'production-detail.png')});
  await page.close();assert.equal(errors.length,0,errors.join('\n'));
  report.errors=errors;report.navigation=true;report.passed=true;
  await writeFile(join(output,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally {await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
