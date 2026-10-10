import { DomSyncGL, TSL, type Dom3DObject } from 'dom-sync-gl';
import { CubeTexture, SRGBColorSpace, Mesh, InstancedMesh, Group, PlaneGeometry, MeshBasicNodeMaterial, MeshBasicMaterial, TubeGeometry, CatmullRomCurve3, Vector3, type UniformNode, type Material } from 'three/webgpu';

import { sculptureMaterial, lightMaterial } from './shaders';
import type { ChapterFrame } from './studio';

const { uniform } = TSL;
type Form = { engine: DomSyncGL; element: HTMLElement; object: Dom3DObject; inner: Group; kind: string; morph: UniformNode<number>; expanded: boolean; value: number; drag: number; pointer: number | null; origin: number; parts: { mesh: Mesh; z: number; y: number }[]; instanced: InstancedMesh | null; baseScale: number; probe: Mesh | null };

/** Normal-flow, sticky DOM, and independent fixed graphics keep separate canvases. */
export class SculptureStage {
  readonly app: DomSyncGL;
  readonly workApp: DomSyncGL;
  readonly fixedApp: DomSyncGL;
  private items: Form[] = [];
  private lifetime = new AbortController();
  private disposed = false;
  private dirty = true;
  private lastRender = 0;
  private frames = 0;
  private lastScroll = -1;
  private lastStatus = 0;
  private layoutDirty = true;
  private lastDrawVisible = false;
  private previousLayers = {hero:false,work:false};
  private previousRects = new Map<Form,{x:number;y:number;width:number;height:number}>();
  private frameDurations: number[] = [];
  private frameSnapshot: { time: number; sculptureTime: number; spaceTime: number; scroll: number; trackX: number; duration: number; canvasTop: number; canvasLeft: number; anchors: { id: string; canvas: string; x: number; y: number; localX: number; localY: number }[] } | null = null;
  private coarse = matchMedia('(pointer: coarse)').matches;
  private clock = uniform(0);
  private environment: CubeTexture | null = null;
  private workEnvironment: CubeTexture | null = null;
  private space = new Group();
  private ribbons: Mesh<TubeGeometry, MeshBasicNodeMaterial>[] = [];

  constructor(private reduced: () => boolean, private wake: () => void) {
    const forceWebGL = new URLSearchParams(location.search).get('backend') === 'webgl' || !isSecureContext || !(navigator as Navigator & { gpu?: unknown }).gpu;
    this.app = new DomSyncGL('#portfolio-gl', { autoRaf: false, scrollSync: { attach: 'translate', overscan: 'auto' }, maxPixelRatio: this.coarse ? 1.25 : 1.5, enablePointerTracking: false, forceWebGL });
    this.workApp = new DomSyncGL('#portfolio-work-gl', { autoRaf: false, scrollSync: { attach: 'dom' }, maxPixelRatio: this.coarse ? 1 : 1.5, enablePointerTracking: false, forceWebGL });
    this.fixedApp = new DomSyncGL('#portfolio-space', { autoRaf: false, scrollSync: { attach: 'dom' }, maxPixelRatio: this.coarse ? 1 : 1.25, enablePointerTracking: false, forceWebGL });
    if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __portfolioDebug: this });
    for (const engine of [this.app,this.workApp,this.fixedApp]) engine.getRenderer().domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); this.destroy('GPUのコンテキストを失いました。3Dを再試行できます。'); }, { signal: this.lifetime.signal });
  }

  async init() {
    let timeout = 0;
    try {
      await Promise.race([Promise.all([this.app.ready,this.workApp.ready,this.fixedApp.ready]), new Promise<never>((_, reject) => { timeout = window.setTimeout(() => reject(new Error('Renderer timeout')), 6500); })]);
      if (this.disposed) return;
      document.documentElement.dataset.portfolioRenderer = this.app.isWebGPUBackend() ? 'webgpu' : 'webgl';
      document.documentElement.dataset.portfolioPhase = 'loading-models';
      document.documentElement.dataset.portfolioCanvasMode = 'translate+sticky+fixed';
      document.documentElement.dataset.portfolioShader = this.app.isWebGPUBackend() ? 'native-wgsl' : 'native-glsl';
      document.documentElement.dataset.portfolioFixedRenderer = this.fixedApp.isWebGPUBackend() ? 'webgpu' : 'webgl';
      document.documentElement.dataset.portfolioFrames = '0';
      this.environment = this.createEnvironment();
      this.app.getScene().environment = this.environment;
      // Three EnvironmentNode caches a PMREM node by texture identity. Each
      // renderer needs its own texture object and GPU render-target ownership.
      this.workEnvironment = this.environment.clone(); this.workEnvironment.needsUpdate = true;
      this.workApp.getScene().environment = this.workEnvironment;
      for (const engine of [this.app,this.workApp]) {
        const lights = engine.getLight();
        lights.ambientLight.intensity = .8; lights.directionalLight.intensity = 2.6;
        lights.directionalLight.position.set(-450,600,700);
      }
      this.fixedApp.addObject(this.space);
      this.createSpace();
      await Promise.all(Array.from(document.querySelectorAll<HTMLElement>('.scene[data-kind]')).map(async element => {
        const kind = element.dataset.kind!;
        element.dataset.renderState = 'loading'; delete element.dataset.renderReason;
        const engine = element.id === 'hero-form' ? this.app : this.workApp;
        const object = engine.create3DObject(element, { modelPath: `/portfolio/${kind}.glb`, fitMode: 'contain', scale: element.id === 'hero-form' ? (this.coarse ? .7 : .78) : (this.coarse ? .82 : .85), updateRectEveryFrame: true });
        const started = performance.now();
        while (!object.getModel() && !this.disposed && performance.now() - started < 15000) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (this.disposed) return;
        const wrapper = object.getModel();
        if (!wrapper) {
          element.dataset.renderState = 'failed';
          element.dataset.renderReason = 'モデルを15秒以内に読み込めませんでした（読込失敗または遅延）。';
          object.destroy(); return;
        }
        const inner = wrapper.children[0] as Group;
        const morph = uniform(0);
        const material = sculptureMaterial(kind,engine.isWebGPUBackend(),this.clock,morph);
        const oldMaterials = new Set<Material>();
        const parts: Form['parts'] = [];
        inner.traverse(child => {
          if (!(child instanceof Mesh)) return;
          (Array.isArray(child.material) ? child.material : [child.material]).forEach(old => oldMaterials.add(old));
          child.material = material;
          parts.push({ mesh: child, z: child.position.z, y: child.position.y });
        });
        oldMaterials.forEach(old => old.dispose());
        // Repeated rings/slats share geometry and material: one draw call per sculpture.
        let instanced: InstancedMesh | null = null;
        if (kind !== 'fold' && parts.length) {
          instanced = new InstancedMesh(parts[0].mesh.geometry, material, parts.length);
          instanced.frustumCulled = false;
          parts.forEach((part, index) => { part.mesh.updateMatrix(); instanced!.setMatrixAt(index, part.mesh.matrix); part.mesh.removeFromParent(); });
          inner.add(instanced);
        }
        let probe: Mesh | null = null;
        if (new URLSearchParams(location.search).has('sync-probe')) {
          probe = new Mesh(new PlaneGeometry(1,1),new MeshBasicMaterial({color:'#ff0088',depthTest:false,depthWrite:false}));
          probe.renderOrder=999; wrapper.add(probe);
          const marker=document.createElement('span');marker.className='sync-probe-marker';marker.setAttribute('aria-hidden','true');element.append(marker);
        }
        const item: Form = { engine, element, object, inner, kind, morph, expanded: false, value: 0, drag: 0, pointer: null, origin: 0, parts, instanced, baseScale: inner.scale.x, probe };
        this.items.push(item);
        element.dataset.renderState = 'ready';
        document.documentElement.dataset.synchronizedForms = String(this.items.length);
        this.dirty = true; this.layoutDirty = true;
        element.addEventListener('pointerdown', event => { item.pointer = event.pointerId; item.origin = event.clientX; element.setPointerCapture(event.pointerId); }, { signal: this.lifetime.signal });
        element.addEventListener('pointermove', event => {
          if (item.pointer !== event.pointerId) return;
          item.drag += (event.clientX - item.origin) * .012; item.origin = event.clientX;
          this.invalidate();
        }, { signal: this.lifetime.signal, passive: true });
        const release = () => { item.pointer = null; };
        element.addEventListener('pointerup', release, { signal: this.lifetime.signal });
        element.addEventListener('pointercancel', release, { signal: this.lifetime.signal });
        document.querySelector<HTMLButtonElement>(`[data-transform="${element.id}"]`)?.addEventListener('click', event => {
          if (!element.classList.contains('is-gl')) return;
          item.expanded = !item.expanded;
          (event.currentTarget as HTMLButtonElement).setAttribute('aria-pressed', String(item.expanded));
          element.dataset.transformed = String(item.expanded);
          this.invalidate();
        }, { signal: this.lifetime.signal });
      }));
      if (this.disposed) return;
      if (this.items.length === 0) { this.destroy('立体モデルを読み込めなかったため、画像を表示しています。'); return; }
      this.items.forEach(item => { item.expanded = document.querySelector(`[data-transform="${item.element.id}"]`)?.getAttribute('aria-pressed') === 'true'; });
      this.app.resize(); this.workApp.resize(); this.fixedApp.resize();
      this.update(performance.now(), .016);
      if (this.disposed) return;
      this.items.forEach(item => item.element.classList.add('is-gl'));
      document.documentElement.dataset.portfolioRenderer = this.app.isWebGPUBackend() ? 'webgpu' : 'webgl';
      document.documentElement.dataset.synchronizedForms = String(this.items.length);
      document.documentElement.dataset.spaceLayer = 'independent';
      document.documentElement.dataset.portfolioPhase = 'ready';
    } catch (error) { this.destroy(`3Dの初期化に失敗しました: ${error instanceof Error ? error.message : String(error)}`); throw error; }
    finally { clearTimeout(timeout); }
  }

  private createEnvironment() {
    const faces = Array.from({ length: 6 }, (_, index) => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#151716'; context.fillRect(0, 0, 256, 256);
      const gradient = context.createLinearGradient(0, 0, 256, 256);
      gradient.addColorStop(0, index === 2 ? '#d9ff70' : '#fafbed'); gradient.addColorStop(1, '#6a756a');
      context.fillStyle = gradient;
      context.fillRect(index % 2 ? 20 : 150, 0, index % 2 ? 70 : 42, 256);
      context.fillStyle = '#ededdf'; context.fillRect(0, 30, 256, 16);
      return canvas;
    });
    const texture = new CubeTexture(faces); texture.colorSpace = SRGBColorSpace; texture.needsUpdate = true;
    return texture;
  }

  /** These geometry paths never read or bind a DOM rectangle. They sit behind the sculptures. */
  private createSpace() {
    this.ribbons.forEach(mesh => { mesh.geometry.dispose(); mesh.material.dispose(); this.space.remove(mesh); });
    const width = document.documentElement.clientWidth, height = innerHeight;
    this.ribbons = Array.from({ length: 4 }, (_, i) => {
      const curve = new CatmullRomCurve3([
        new Vector3(-width * .85, -height * .42 + i * 19, -260),
        new Vector3(-width * .38, -height * .24 + i * 14, -210),
        new Vector3(width * .08, height * .14 + i * 13, -290),
        new Vector3(width * .48, height * .27 + i * 13, -380),
        new Vector3(width * .85, -height * .08 + i * 21, -180),
      ]);
      const mesh = new Mesh(new TubeGeometry(curve, 70, i === 0 ? 2.8 : .6, 5, false), lightMaterial(this.fixedApp.isWebGPUBackend(),this.clock,i));
      this.space.add(mesh); return mesh;
    });
  }

  update(time: number, dt: number, chapter?: ChapterFrame) {
    const frameStarted = performance.now();
    if (this.disposed || this.items.length === 0) return;
    const still = this.reduced();
    this.clock.value = still ? 0 : time * .0007;
    const effectiveScroll = -document.documentElement.getBoundingClientRect().top;
    const scrolled = effectiveScroll !== this.lastScroll; this.lastScroll = effectiveScroll;
    // Horizontal chapter transforms can enter the viewport before IntersectionObserver
    // publishes its next event. Set visibility before the library's read/apply phases.
    const rects = new Map<Form, DOMRect>();
    let layoutMoved = chapter?.changed ?? false;
    const modal = !!document.querySelector('dialog[open]');
    for (const item of this.items) {
      const rect = item.element.getBoundingClientRect(); rects.set(item, rect);
      const previous = this.previousRects.get(item);
      layoutMoved ||= !previous || Math.abs(previous.x-rect.x)>.01 || Math.abs(previous.y-rect.y)>.01 || Math.abs(previous.width-rect.width)>.01 || Math.abs(previous.height-rect.height)>.01;
      this.previousRects.set(item,{x:rect.x,y:rect.y,width:rect.width,height:rect.height});
      const chapter = item.element.closest('.study')?.getBoundingClientRect();
      const onscreen = (!chapter || (chapter.right > 1 && chapter.left < innerWidth - 1)) && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth && !modal;
      item.object.isVisible = onscreen; item.object.getModel()!.visible = onscreen;
    }
    this.app.update(time); this.workApp.update(time);
    const scrollSnapshot = this.app.getScroll().y;
    this.fixedApp.update(time);
    let visible = false, settling = false;
    for (const item of this.items) {
      const rect = rects.get(item)!;
      if (!item.object.isVisible) continue;
      visible = true;
      const target = item.expanded ? 1 : 0;
      item.value = still ? target : item.value + (target - item.value) * (1 - Math.exp(-dt * 5));
      settling ||= Math.abs(target - item.value) > .002;
      item.morph.value = item.value;
      if (item.probe) item.probe.scale.set(8 / item.object.getModel()!.scale.x,8 / item.object.getModel()!.scale.y,1);
      item.inner.scale.setScalar(item.baseScale * (item.kind === 'echo' ? 1 - item.value * .45 : 1));
      const t = still ? 0 : time * .00012;
      const scroll = still ? 0 : (rect.top / innerHeight) * .85;
      item.inner.rotation.set(item.kind === 'echo' ? .35 + item.value * .4 : .18 + item.value * .3, (item.kind === 'matter' ? -.75 + Math.sin(t) * .18 : t + .2) + item.drag + scroll + item.value * 1.1, item.kind === 'echo' ? -.3 : -.18);
      item.parts.forEach((part, index) => {
        if (item.kind === 'echo') {
          part.mesh.position.z = part.z * (1 + item.value * 3.4);
          part.mesh.rotation.y = still ? item.value * Math.sin(index * .22) * .7 : Math.sin(time * .0006 + index * .16) * (.05 + item.value * .65);
        } else if (item.kind === 'matter') {
          part.mesh.position.y = part.y + Math.sin(index * .23 + (still ? 0 : time * .0012)) * (.08 + item.value * .42);
          part.mesh.rotation.x = Math.sin(index * .22 + (still ? 0 : time * .0009)) * (.1 + item.value * .85);
        }
        if (item.instanced) { part.mesh.updateMatrix(); item.instanced.setMatrixAt(index, part.mesh.matrix); }
      });
      if (item.instanced) item.instanced.instanceMatrix.needsUpdate = true;
    }
    this.space.visible = visible && !still;
    if (document.documentElement.dataset.portfolioVisible !== (visible ? '1' : '0')) document.documentElement.dataset.portfolioVisible = visible ? '1' : '0';
    this.space.rotation.z = Math.sin(time * .0001) * .12 + scrollSnapshot * .00013;
    this.space.position.y = Math.sin(time * .00035) * 25;
    this.dirty ||= scrolled || layoutMoved;
    // Never update a translated canvas during scroll without redrawing its DOM anchors.
    // Both layers submit the same frame; 30fps applies only to stationary auto-animation.
    const render = (visible || this.lastDrawVisible || this.layoutDirty) && (this.dirty || settling || (visible && !still)) && (scrolled || layoutMoved || this.layoutDirty || still || time - this.lastRender >= (this.coarse ? 1000 / 30 : 1000 / 60) - 1);
    if (render) {
      try {
        const layers={hero:this.items.some(item=>item.engine===this.app&&item.object.isVisible),work:this.items.some(item=>item.engine===this.workApp&&item.object.isVisible)};
        if (layers.hero || this.previousLayers.hero || this.layoutDirty) this.app.render();
        if (layers.work || this.previousLayers.work || this.layoutDirty) this.workApp.render();
        this.fixedApp.render();
        this.previousLayers=layers;
        if (new URLSearchParams(location.search).has('debug')) {
          const physical = this.app.getRenderer().domElement.getBoundingClientRect();
          this.frameSnapshot = { time, sculptureTime: time, spaceTime: time, scroll: scrollSnapshot, trackX: chapter?.trackX ?? 0, duration:performance.now()-frameStarted, canvasTop: physical.top, canvasLeft: physical.left, anchors: this.items.filter(item => item.object.getModel()!.visible).map(item => {
            const viewport=item.engine.getViewPort(),camera=item.engine.getCamera().instance,physical=item.engine.getRenderer().domElement.getBoundingClientRect();
            const point = item.object.getModel()!.position.clone().project(camera);
            const localX=(point.x+1)*viewport.width/2, localY=(1-point.y)*viewport.height/2;
            return { id: item.element.id, canvas:item.engine===this.app?'portfolio-gl':'portfolio-work-gl', x: physical.left+localX, y: physical.top+localY, localX, localY };
          }) };
        }
        this.items.forEach(item => { if (!item.element.classList.contains('is-gl')) item.element.classList.add('is-gl'); });
      } catch (error) { this.destroy(`GPU描画に失敗しました: ${error instanceof Error ? error.message : String(error)}`); return; }
      this.frameDurations.push(performance.now()-frameStarted); if (this.frameDurations.length>120) this.frameDurations.shift();
      this.frames++; this.lastRender = time; this.dirty = false; this.layoutDirty = false; this.lastDrawVisible = visible;
      if (still || this.frames === 1 || time - this.lastStatus > 500) { this.lastStatus = time; document.documentElement.dataset.portfolioFrames = String(this.frames); }
    }
  }
  get diagnostics() { return { frames: this.frames, disposed: this.disposed, forms: this.items.length, visible: this.items.filter(item => item.object.getModel()?.visible).length, independentPaths: this.ribbons.length, coarse: this.coarse, rendererInfo: this.app.getRenderer().info, workRendererInfo: this.workApp.getRenderer().info, fixedRendererInfo: this.fixedApp.getRenderer().info, frameDurations:this.frameDurations, canvasMode: this.app.getScrollSync()?.attach, workCanvasMode:this.workApp.getScrollSync()?.attach,fixedCanvasMode: this.fixedApp.getScrollSync()?.attach, frame: this.frameSnapshot }; }
  invalidate() { this.dirty = true; this.wake(); }
  resize() { if (!this.disposed) { this.app.resize(); this.workApp.resize(); this.fixedApp.resize(); this.createSpace(); this.layoutDirty = true; this.invalidate(); } }
  syncMotion() { this.layoutDirty = true; this.invalidate(); }
  destroy(reason = 'ページ移動に伴いGPUを解放しました。') {
    if (this.disposed) return;
    this.disposed = true; this.lifetime.abort();
    this.items.forEach(item => { item.element.classList.remove('is-gl'); item.element.dataset.renderState = 'fallback'; item.element.dataset.renderReason = reason; item.element.querySelector('.sync-probe-marker')?.remove(); item.instanced?.dispose(); });
    this.ribbons.forEach(mesh => { mesh.geometry.dispose(); mesh.material.dispose(); });
    this.fixedApp.removeObject(this.space);
    this.app.getScene().environment = null; this.workApp.getScene().environment = null;
    this.app.destroy(); this.workApp.destroy(); this.fixedApp.destroy(); this.environment?.dispose(); this.workEnvironment?.dispose();
    this.items = []; this.ribbons = [];
    document.documentElement.dataset.portfolioRenderer = 'dom';
    document.documentElement.dataset.portfolioPhase = 'fallback';
    document.documentElement.dataset.portfolioFallbackReason = reason;
    document.documentElement.dataset.portfolioVisible = '0';
    delete document.documentElement.dataset.synchronizedForms;
    delete document.documentElement.dataset.spaceLayer;
  }
}
