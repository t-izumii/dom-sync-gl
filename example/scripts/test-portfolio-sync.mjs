import assert from 'node:assert/strict';
import {chromium,devices} from 'playwright';
import {createServer} from 'vite';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFile,mkdir} from 'node:fs/promises';
import {inflateSync} from 'node:zlib';
const output=process.env.PORTFOLIO_EVIDENCE_DIR||join(tmpdir(),'dom-sync-gl-portfolio-sync');await mkdir(output,{recursive:true});
const server=process.env.PORTFOLIO_URL?null:await createServer({configFile:fileURLToPath(new URL('../vite.config.ts',import.meta.url)),server:{host:'127.0.0.1',port:0,open:false},logLevel:'warn'});
if(server)await server.listen();
const base=process.env.PORTFOLIO_URL||server.resolvedUrls.local[0]+'portfolio.html';
function png(buffer) {
  let offset = 8, width, height, channels; const chunks = [];
  while (offset < buffer.length) { const length = buffer.readUInt32BE(offset), type = buffer.toString('ascii', offset + 4, offset + 8), data = buffer.subarray(offset + 8, offset + 8 + length); if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); channels = data[9] === 6 ? 4 : 3; assert.equal(data[8], 8); } if (type === 'IDAT') chunks.push(data); offset += length + 12; }
  const bytes = inflateSync(Buffer.concat(chunks)), stride = width * channels, pixels = Buffer.alloc(stride * height);
  const paeth = (a,b,c) => { const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c); return pa<=pb&&pa<=pc?a:pb<=pc?b:c; };
  for (let y=0;y<height;y++) { const filter=bytes[y*(stride+1)];for(let x=0;x<stride;x++){const index=y*stride+x,left=x>=channels?pixels[index-channels]:0,up=y?pixels[index-stride]:0,corner=y&&x>=channels?pixels[index-stride-channels]:0,value=filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):filter===4?paeth(left,up,corner):0;pixels[index]=(bytes[y*(stride+1)+1+x]+value)&255;} }
  return { width,height,channels,pixels };
}

const browser=await chromium.launch(),results=[];
try {
for(const [mode,options] of [['desktop',{viewport:{width:1440,height:1000},deviceScaleFactor:1}],['mobile',{...devices['iPhone 13'],deviceScaleFactor:1}]]){
 const page=await browser.newPage(options);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+(base.includes('?')?'&':'?')+'debug&sync-probe');await page.waitForFunction(()=>document.documentElement.dataset.portfolioPhase==='ready');
 const state=await page.evaluate(()=>({canvases:document.querySelectorAll('canvas').length,domMode:window.__portfolioDebug.diagnostics.canvasMode,workMode:window.__portfolioDebug.diagnostics.workCanvasMode,fixedMode:window.__portfolioDebug.diagnostics.fixedCanvasMode}));
 assert.equal(state.canvases,3);assert.equal(state.domMode,'translate');assert.equal(state.fixedMode,'dom');
 async function capture(label){
  const visible=await page.evaluate(()=>Array.from(document.querySelectorAll('.sync-probe-marker')).map(el=>{const r=el.getBoundingClientRect();return{id:el.parentElement.id,x:r.left+r.width/2,y:r.top+r.height/2}}).filter(p=>p.x>25&&p.x<innerWidth-25&&p.y>25&&p.y<innerHeight-25));
  const buffer=await page.screenshot({path:`${output}/${mode}-${label}.png`}),img=png(buffer);
  for(const anchor of visible){const sums={cyan:{x:0,y:0,n:0},magenta:{x:0,y:0,n:0}};
   for(let y=Math.max(0,Math.floor(anchor.y-65));y<Math.min(img.height,anchor.y+65);y++)for(let x=Math.max(0,Math.floor(anchor.x-65));x<Math.min(img.width,anchor.x+65);x++){
    const i=(y*img.width+x)*img.channels,r=img.pixels[i],g=img.pixels[i+1],b=img.pixels[i+2];const key=r<80&&g>170&&b>210?'cyan':r>210&&g<60&&b>85&&b<190?'magenta':null;
    if(key){const s=sums[key];s.x+=x+.5;s.y+=y+.5;s.n++}
   }
   if(sums.cyan.n<10||sums.magenta.n<10)continue;
   const cyan={x:sums.cyan.x/sums.cyan.n,y:sums.cyan.y/sums.cyan.n},magenta={x:sums.magenta.x/sums.magenta.n,y:sums.magenta.y/sums.magenta.n};
   const error=Math.hypot(cyan.x-magenta.x,cyan.y-magenta.y);results.push({mode,label,anchor:anchor.id,error,cyan,magenta});assert(error<2,`${mode}/${label} displayed marker delta ${error}`);
  }
 }
 await capture('hero');
 if(mode==='mobile'){
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:250,y:410}]});
  for(let i=1;i<=4;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:250,y:410-i*35}]});await capture('touch-'+i);}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await capture('momentum');
 }else {await page.mouse.wheel(0,200);await capture('wheel');await page.waitForTimeout(1200);}
 await page.evaluate(()=>{const e=document.querySelector('#work');scrollTo({top:e.getBoundingClientRect().top+scrollY+150,behavior:'instant'});});await page.waitForTimeout(300);await capture('work-fold');
 for(let i=1;i<=5;i++){await page.evaluate(()=>scrollBy({top:100,behavior:'instant'}));await capture('horizontal-'+i);}
 const samples=await page.evaluate(async()=>{const list=[];scrollBy({top:400,behavior:'smooth'});return await new Promise(resolve=>{let n=0;function inspect(t){const d=window.__portfolioDebug,f=d.diagnostics.frame;if(f)for(const a of f.anchors){const c=document.querySelector('#'+a.canvas+' canvas').getBoundingClientRect();const r=document.getElementById(a.id).getBoundingClientRect();if(r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth)list.push({error:Math.hypot(c.left+a.localX-r.left-r.width/2,c.top+a.localY-r.top-r.height/2),age:t-f.time,duration:f.duration,trackError:Math.abs(parseFloat(document.querySelector('.studio-track').style.left)-f.trackX),interval:list.length?t-list[list.length-1].sampleTime:0,sampleTime:t,commonTime:f.sculptureTime===f.spaceTime});}if(n++<75)requestAnimationFrame(inspect);else resolve(list);}requestAnimationFrame(inspect);});});
 assert.equal(errors.length,0);assert(samples.every(s=>s.trackError<.02));
 results.push({mode,...state,errors,missedHorizontalFrames:samples.filter(s=>s.trackError>=.02).length,rafSamples:samples.length,maxDisplayedProjectionError:Math.max(...samples.map(s=>s.error)),maxFrameAge:Math.max(...samples.map(s=>s.age)),allLayerTimesEqual:samples.every(s=>s.commonTime),maxCpuFrameMs:Math.max(...samples.map(s=>s.duration)),maxRafIntervalMs:Math.max(...samples.map(s=>s.interval)),samples});await page.close();
}
assert(results.filter(s=>s.error!==undefined).length>=12,'too few displayed-pixel samples');
await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(({samples,...r})=>r),null,2));
} finally {await browser.close();await server?.close();}
