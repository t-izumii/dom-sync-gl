/** Optional, local-only status UI. No telemetry, storage, requests, or preference changes. */
export function mountDiagnostics() {
  if (!new URLSearchParams(location.search).has('diagnostics')) return;
  const root = document.documentElement;
  const styles = document.createElement('style');
  styles.textContent = `.render-diagnostics{position:fixed;right:12px;bottom:12px;width:min(360px,calc(100vw - 24px));max-height:65dvh;overflow:auto;z-index:50;border:1px solid #545c48;background:#151813f5;color:#ededdf;box-shadow:0 8px 40px #0008;font:12px/1.6 Arial,'Hiragino Kaku Gothic ProN',sans-serif}.render-diagnostics summary{padding:12px 16px;cursor:pointer;font-size:13px;color:#d9ff70}.render-diagnostics-body{padding:0 16px 16px}.render-diagnostics p{margin:0 0 10px;overflow-wrap:anywhere}.render-diagnostics strong{font-size:17px}.render-diagnostics dl{margin:12px 0}.render-diagnostics dl>div{display:grid;grid-template-columns:70px 1fr;border-top:1px solid #373d31;padding:7px 0}.render-diagnostics dt{color:#a5b39b}.render-diagnostics dd{margin:0;overflow-wrap:anywhere}.render-diagnostics button{min-height:44px;border:1px solid #d9ff70;background:none;color:#d9ff70;padding:8px 14px;border-radius:3px}.render-diagnostics button:focus-visible{outline:2px solid #ededdf;outline-offset:3px}.render-diagnostics button[hidden]{display:none}`;
  document.head.append(styles);
  const panel = document.createElement('details'); panel.className = 'render-diagnostics'; panel.open = true;
  panel.innerHTML = `<summary>描画診断</summary><div class="render-diagnostics-body"><p><strong data-status></strong></p><p data-reason></p><dl><div><dt>動き</dt><dd data-motion></dd></div><div><dt>接続</dt><dd data-origin></dd></div><div><dt>描画</dt><dd data-frames></dd></div><div><dt>Canvas</dt><dd data-canvases></dd></div></dl><dl data-models></dl><button type="button" data-retry>3Dを再試行</button></div>`;
  document.body.append(panel);
  const scenes = Array.from(document.querySelectorAll<HTMLElement>('.scene[data-kind]'));
  const modelLabels = scenes.map(scene => {
    const row = document.createElement('div'), title = document.createElement('dt'), label = document.createElement('dd');
    title.textContent = scene.id === 'hero-form' ? 'Hero' : scene.dataset.kind!;
    row.append(title,label); panel.querySelector('[data-models]')!.append(row);
    return label;
  });
  const retry = panel.querySelector<HTMLButtonElement>('[data-retry]')!;
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const update = () => {
    const renderer = root.dataset.portfolioRenderer;
    const loading = !scenes.some(scene => scene.classList.contains('is-gl'));
    const state = loading && (renderer === 'webgpu' || renderer === 'webgl') ? `${renderer === 'webgpu' ? 'WebGPU' : 'WebGL2'} / 3D読み込み中` : renderer === 'webgpu' ? 'WebGPU / 3D表示' : renderer === 'webgl' ? 'WebGL2 / 3D表示' : renderer === 'dom' ? '画像 fallback' : '3Dを準備中';
    panel.querySelector('[data-status]')!.textContent = state;
    const reason = root.dataset.portfolioFallbackReason;
    panel.querySelector('[data-reason]')!.textContent = reason || (renderer === 'webgl' && !isSecureContext ? 'HTTPのLAN接続ではWebGPUを使えないため、WebGL2で3Dを描画しています。画像fallbackとは別の状態です。' : renderer === 'webgl' ? 'この環境ではWebGL2で3Dを描画しています。' : renderer === 'webgpu' ? 'GPUで立体を描画しています。' : 'モデルと描画機能を読み込んでいます。');
    panel.querySelector('[data-motion]')!.textContent = renderer === 'dom' ? '画像表示（自動アニメーションなし）' : media.matches ? '動きを抑える設定：3Dを静止表示' : document.hidden ? 'タブ非表示のため休止' : root.dataset.portfolioVisible === '0' ? '作品が画面外／詳細表示のため休止' : '自動回転＋タッチ変形';
    panel.querySelector('[data-origin]')!.textContent = `${isSecureContext ? 'Secure' : 'HTTP / 非secure'} · WebGPU API ${(navigator as Navigator & { gpu?: unknown }).gpu ? 'あり' : 'なし'}`;
    panel.querySelector('[data-frames]')!.textContent = `${root.dataset.portfolioFrames || '0'} GPUフレーム · ${root.dataset.synchronizedForms || '0'}/${scenes.length}モデル`;
    panel.querySelector('[data-canvases]')!.textContent = renderer === 'dom' ? 'GPUを解放' : root.dataset.portfolioCanvasMode === 'translate+sticky+fixed' ? '通常DOM / sticky DOM / 独立fixed（各別層）' : '準備中';
    scenes.forEach((scene,index) => {
      modelLabels[index].textContent = scene.classList.contains('is-gl') ? '3D' : scene.dataset.renderReason || (scene.dataset.renderState === 'failed' ? '画像表示' : '読み込み中（画像を仮表示）');
    });
    retry.hidden = new URLSearchParams(location.search).has('no-gl') || (renderer !== 'dom' && !scenes.some(scene => scene.dataset.renderState === 'failed'));
  };
  retry.addEventListener('click', () => window.dispatchEvent(new Event('portfolio-retry-gpu')));
  const observer = new MutationObserver(update);
  observer.observe(root,{attributes:true,attributeFilter:['data-portfolio-renderer','data-portfolio-fallback-reason','data-portfolio-frames','data-portfolio-visible','data-synchronized-forms','data-portfolio-canvas-mode']});
  scenes.forEach(scene => observer.observe(scene,{attributes:true,attributeFilter:['class','data-render-state','data-render-reason']}));
  media.addEventListener('change',update); document.addEventListener('visibilitychange',update);
  window.addEventListener('pagehide',event => { if (!event.persisted) { observer.disconnect(); media.removeEventListener('change',update); document.removeEventListener('visibilitychange',update); } });
  update();
}
