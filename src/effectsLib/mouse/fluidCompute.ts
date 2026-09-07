/**
 * WebGPU コンピュートシェーダーによる Navier-Stokes 流体シミュレーション。
 *
 * `splashCursor/fluidSim.ts` の fragment + ping-pong RenderTarget 版と同じ
 * 数式を、1 フレーム分すべて事前構築した静的な ComputeNode チェーンとして
 * 1 回の compute パスに流し込む。`renderer.info.compute.frameCalls === 1` が
 * 本設計が成立している指標。
 *
 * 静的チェーンが成立する根拠（ping-pong のパリティ）:
 * splat をフレーム 1 ディスパッチに畳み込むと velocity は 4 回・dye は 2 回の
 * 反転で開始バッファへ戻る。pressure だけは clear + Jacobi n 回で n+1 回だが、
 * 実効反復回数を `n | 1`（n 以上の最小の奇数）に丸めれば必ず戻る。結果として
 * 「フレーム境界では velocity / dye / pressure のいずれも A 側が最新」という
 * 不変条件が常に成り立ち、チェーンは 1 本で足りる。
 *
 * @see src/effectsLib/mouse/fluidKernels.ts 各カーネルの TSL 実装
 * @see src/effectsLib/splashCursor/fluidSim.ts 移植元
 */

import * as THREE from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';
import {
  SPLAT_VELOCITY_Y_SIGN,
  advectionKernel,
  clearKernel,
  curlKernel,
  divergenceKernel,
  gradientSubtractKernel,
  pressureClearKernel,
  pressureJacobiKernel,
  splatKernel,
  vorticityKernel,
  type FluidGrid,
  type FluidUniformArray,
} from './fluidKernels';

export interface FluidStepParams {
  curl: number;
  pressure: number;
  velocityDissipation: number;
  densityDissipation: number;
}

export interface FluidComputeOptions {
  simResolution: number;
  dyeResolution: number;
  pressureIterations: number;
  maxSplatsPerFrame: number;
}

export interface SplatPoint {
  /** UV。左上原点 */
  x: number;
  y: number;
  /** 速度（既に splatForce 倍済み） */
  dx: number;
  dy: number;
  /** インク色 */
  r: number;
  g: number;
  b: number;
  /** splat 半径（fluidSim.splat() と同じスケール: radius/100、aspect>1 なら *aspect） */
  radius: number;
}

/**
 * `mipmapsAutoUpdate` は @types/three 0.182 の StorageTexture 宣言に無いため補う。
 */
type MipmapAwareStorageTexture = THREE.StorageTexture & { mipmapsAutoUpdate: boolean };

/* ======================================================
 *
 *   FluidCompute
 *
 * ====================================================== */

export class FluidCompute {
  /**
   * Why 自前で保持するか: `BaseEffect._disposeFeedback()` は `glRenderer` を
   * null にしてから `dispose()` を呼ぶので、呼び出し側の参照には依存できない。
   */
  private readonly renderer: THREE.WebGPURenderer;

  private options: FluidComputeOptions;

  /* ==----------------------------------------------------
   * uniform（チェーンに焼き込まれ、値だけ毎フレーム差し替える）
   * ---------------------------------------------------- */

  private readonly uDt = uniform(0);
  private readonly uCurl = uniform(0);
  private readonly uPressure = uniform(0);
  private readonly uVelocityDissipation = uniform(0);
  private readonly uDensityDissipation = uniform(0);
  private readonly uAspect = uniform(1);
  private readonly uSplatCount = uniform(0, 'int');

  private splatPointArray: THREE.Vector4[] = [];
  private splatVelocityArray: THREE.Vector4[] = [];
  private splatColorArray: THREE.Vector4[] = [];
  private uSplatPoints: FluidUniformArray | null = null;
  private uSplatVelocities: FluidUniformArray | null = null;
  private uSplatColors: FluidUniformArray | null = null;
  private splatCount = 0;

  /* ==----------------------------------------------------
   * GPU リソース
   * ---------------------------------------------------- */

  private textures: THREE.StorageTexture[] = [];
  private dyeResult: THREE.StorageTexture | null = null;

  private chain: THREE.ComputeNode[] = [];
  private clearChain: THREE.ComputeNode[] = [];

  /**
   * `renderer.compute()` へ渡す配列。backend が WeakMap のキーに使うので
   * 毎フレーム作り直さず、中身だけ詰め替える。
   */
  private readonly dispatch: THREE.ComputeNode[] = [];

  /** 再構築が要るかの判定キー。パイプライン再コンパイルを避けるため */
  private signature = '';

  private needsClear = false;

  private _aspect = 1;

  constructor(renderer: THREE.WebGPURenderer, options: FluidComputeOptions) {
    this.renderer = renderer;
    this.options = { ...options };
  }

  /* ==----------------------------------------------------
   * 公開アクセサ
   * ---------------------------------------------------- */

  /** dye の最新テクスチャ。不変条件により常に dye A 側 */
  get dyeTexture(): THREE.Texture | null {
    return this.dyeResult;
  }

  get aspect(): number {
    return this._aspect;
  }

  /* ==----------------------------------------------------
   * 構築
   * ---------------------------------------------------- */

  /**
   * StorageTexture 確保 + チェーン構築。resize / パラメータ変更時に呼び直す。
   * 構成が前回と同一なら何もしない（ComputeNode の再構築はパイプライン
   * 再コンパイルを伴うため）。
   */
  build(): void {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this._aspect = size.x / size.y || 1;
    this.uAspect.value = this._aspect;

    const simGrid = this.getResolution(this.options.simResolution);
    const dyeGrid = this.getResolution(this.options.dyeResolution);
    const iterations = this.effectiveIterations();
    const maxSplats = Math.max(1, Math.round(this.options.maxSplatsPerFrame));

    const signature = [
      simGrid.width,
      simGrid.height,
      dyeGrid.width,
      dyeGrid.height,
      iterations,
      maxSplats,
    ].join(':');
    if (signature === this.signature) return;
    this.signature = signature;

    this.release();
    this.buildSplatUniforms(maxSplats);

    const velocityA = this.createTexture(simGrid);
    const velocityB = this.createTexture(simGrid);
    const dyeA = this.createTexture(dyeGrid);
    const dyeB = this.createTexture(dyeGrid);
    const pressureA = this.createTexture(simGrid);
    const pressureB = this.createTexture(simGrid);
    const divergence = this.createTexture(simGrid);
    const curl = this.createTexture(simGrid);

    this.dyeResult = dyeA;

    this.clearChain = this.textures.map((texture) => clearKernel(texture, this.gridOf(texture)));
    this.chain = this.buildChain({
      simGrid,
      dyeGrid,
      iterations,
      maxSplats,
      velocityA,
      velocityB,
      dyeA,
      dyeB,
      pressureA,
      pressureB,
      divergence,
      curl,
    });

    this.needsClear = true;
  }

  /** options を差し替えて build() し直す */
  setOptions(options: Partial<FluidComputeOptions>): void {
    this.options = { ...this.options, ...options };
    this.build();
  }

  /* ==----------------------------------------------------
   * 実行
   * ---------------------------------------------------- */

  /** フレーム内の splat キューに積む。maxSplatsPerFrame を超えたぶんは捨てる */
  addSplat(point: SplatPoint): void {
    if (this.splatCount >= this.splatPointArray.length) return;

    const index = this.splatCount;
    this.splatPointArray[index].set(point.x, point.y, point.radius, 0);
    this.splatVelocityArray[index].set(
      point.dx,
      point.dy * SPLAT_VELOCITY_Y_SIGN,
      0,
      0,
    );
    this.splatColorArray[index].set(point.r, point.g, point.b, 0);
    this.splatCount = index + 1;
  }

  /** 1 フレーム進める。内部で `renderer.compute()` を 1 回だけ呼ぶ */
  step(dt: number, params: FluidStepParams): void {
    if (this.chain.length === 0) return;

    this.uDt.value = dt;
    this.uCurl.value = params.curl;
    this.uPressure.value = params.pressure;
    this.uVelocityDissipation.value = params.velocityDissipation;
    this.uDensityDissipation.value = params.densityDissipation;
    this.uSplatCount.value = this.splatCount;

    this.dispatch.length = 0;
    if (this.needsClear) {
      for (const node of this.clearChain) this.dispatch.push(node);
      this.needsClear = false;
    }
    for (const node of this.chain) this.dispatch.push(node);

    /*
     * Why 第2引数を渡さないか: `Renderer.compute()` は dispatchSize を全ノードへ
     * 同じ値で配るため、sim と dye で解像度が違う本チェーンでは破綻する。
     * null のとき backend が各ノードの `count`（= ワークグループ数）を使う。
     *
     * TODO: 同一 compute パス内の連続ディスパッチ間バリアが実機で効かない場合は、
     * ここを依存境界ごとの複数回 compute() へ差し替える（chain の組み立ては
     * buildChain() に閉じているので、この呼び出しだけを変えればよい）。
     */
    this.renderer.compute(this.dispatch);

    this.splatCount = 0;
  }

  dispose(): void {
    this.release();
    this.signature = '';
  }

  /* ==----------------------------------------------------
   * 内部: チェーン組み立て
   * ---------------------------------------------------- */

  /**
   * 1 フレーム分のディスパッチ列。バッファの入れ替わり方はここに書いた順序が
   * すべてで、末尾で velocity / dye / pressure がいずれも A 側に戻る。
   */
  private buildChain(c: {
    simGrid: FluidGrid;
    dyeGrid: FluidGrid;
    iterations: number;
    maxSplats: number;
    velocityA: THREE.StorageTexture;
    velocityB: THREE.StorageTexture;
    dyeA: THREE.StorageTexture;
    dyeB: THREE.StorageTexture;
    pressureA: THREE.StorageTexture;
    pressureB: THREE.StorageTexture;
    divergence: THREE.StorageTexture;
    curl: THREE.StorageTexture;
  }): THREE.ComputeNode[] {
    const points = this.uSplatPoints;
    const velocities = this.uSplatVelocities;
    const colors = this.uSplatColors;
    if (!points || !velocities || !colors) return [];

    const motionTexel = { x: 1 / c.simGrid.width, y: 1 / c.simGrid.height };
    const nodes: THREE.ComputeNode[] = [];

    /* velA -> velB */
    nodes.push(
      splatKernel({
        name: 'fluidSplatVelocity',
        target: c.velocityB,
        source: c.velocityA,
        grid: c.simGrid,
        maxSplats: c.maxSplats,
        uSplatCount: this.uSplatCount,
        uAspect: this.uAspect,
        points,
        amounts: velocities,
      }),
    );

    /* dyeA -> dyeB */
    nodes.push(
      splatKernel({
        name: 'fluidSplatDye',
        target: c.dyeB,
        source: c.dyeA,
        grid: c.dyeGrid,
        maxSplats: c.maxSplats,
        uSplatCount: this.uSplatCount,
        uAspect: this.uAspect,
        points,
        amounts: colors,
      }),
    );

    /* velB -> curl */
    nodes.push(curlKernel({ target: c.curl, velocity: c.velocityB, grid: c.simGrid }));

    /* velB, curl -> velA */
    nodes.push(
      vorticityKernel({
        target: c.velocityA,
        velocity: c.velocityB,
        curl: c.curl,
        grid: c.simGrid,
        uCurl: this.uCurl,
        uDt: this.uDt,
      }),
    );

    /* velA -> divergence */
    nodes.push(
      divergenceKernel({ target: c.divergence, velocity: c.velocityA, grid: c.simGrid }),
    );

    /* prsA -> prsB */
    nodes.push(
      pressureClearKernel({
        target: c.pressureB,
        pressure: c.pressureA,
        grid: c.simGrid,
        uPressure: this.uPressure,
      }),
    );

    /*
     * 反復回数は奇数に丸めてあるので、最後の書き込み先は必ず prsA になる。
     */
    for (let i = 0; i < c.iterations; i++) {
      const readFromB = i % 2 === 0;
      nodes.push(
        pressureJacobiKernel({
          name: `fluidPressureJacobi${readFromB ? 'BA' : 'AB'}`,
          target: readFromB ? c.pressureA : c.pressureB,
          pressure: readFromB ? c.pressureB : c.pressureA,
          divergence: c.divergence,
          grid: c.simGrid,
        }),
      );
    }

    /* prsA, velA -> velB */
    nodes.push(
      gradientSubtractKernel({
        target: c.velocityB,
        pressure: c.pressureA,
        velocity: c.velocityA,
        grid: c.simGrid,
      }),
    );

    /* velB -> velA（自己移流） */
    nodes.push(
      advectionKernel({
        name: 'fluidAdvectVelocity',
        target: c.velocityA,
        source: c.velocityB,
        velocity: c.velocityB,
        grid: c.simGrid,
        motionTexel,
        uDt: this.uDt,
        uDissipation: this.uVelocityDissipation,
      }),
    );

    /*
     * dye は「速度移流後」の velA で流す（移植元 fluidSim.step() L389-390 と同じ）。
     */
    nodes.push(
      advectionKernel({
        name: 'fluidAdvectDye',
        target: c.dyeA,
        source: c.dyeB,
        velocity: c.velocityA,
        grid: c.dyeGrid,
        motionTexel,
        uDt: this.uDt,
        uDissipation: this.uDensityDissipation,
      }),
    );

    return nodes;
  }

  /* ==----------------------------------------------------
   * 内部: リソース管理
   * ---------------------------------------------------- */

  private getResolution(base: number): FluidGrid {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    let aspect = size.x / size.y || 1;
    if (aspect < 1) aspect = 1 / aspect;
    const min = Math.round(base);
    const max = Math.round(base * aspect);
    return size.x > size.y ? { width: max, height: min } : { width: min, height: max };
  }

  /** Jacobi 反復の実効回数。奇数に丸めることで pressure のパリティを固定する */
  private effectiveIterations(): number {
    const requested = Math.max(1, Math.round(this.options.pressureIterations));
    return requested | 1;
  }

  private createTexture(grid: FluidGrid): THREE.StorageTexture {
    const texture = new THREE.StorageTexture(
      grid.width,
      grid.height,
    ) as MipmapAwareStorageTexture;

    /* rgba16float。rg/r 16float は WebGPU コアでは storage 非対応 */
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.HalfFloatType;

    /*
     * Why 必須か: store バインドがあると Bindings が needsMipmap を立て、
     * sampled 側の更新時に generateMipmaps() が別のレンダーパスを開く。
     * compute パスを開いたまま呼ばれるので確実に壊れる。
     */
    texture.mipmapsAutoUpdate = false;

    this.textures.push(texture);
    return texture;
  }

  private gridOf(texture: THREE.StorageTexture): FluidGrid {
    const image = texture.image as { width: number; height: number };
    return { width: image.width, height: image.height };
  }

  private buildSplatUniforms(maxSplats: number): void {
    this.splatPointArray = Array.from({ length: maxSplats }, () => new THREE.Vector4());
    this.splatVelocityArray = Array.from({ length: maxSplats }, () => new THREE.Vector4());
    this.splatColorArray = Array.from({ length: maxSplats }, () => new THREE.Vector4());
    this.uSplatPoints = uniformArray(this.splatPointArray, 'vec4');
    this.uSplatVelocities = uniformArray(this.splatVelocityArray, 'vec4');
    this.uSplatColors = uniformArray(this.splatColorArray, 'vec4');
    this.splatCount = 0;
  }

  /**
   * Why ComputeNode まで dispose するか: dispose イベントで
   * `Renderer.compute()` が張ったリスナが pipelines / bindings / nodes を
   * 掃除する。静的バインド設計では放置するとそのままリークする。
   */
  private release(): void {
    for (const node of this.chain) node.dispose();
    for (const node of this.clearChain) node.dispose();
    for (const texture of this.textures) texture.dispose();

    this.chain = [];
    this.clearChain = [];
    this.textures = [];
    this.dispatch.length = 0;
    this.dyeResult = null;
    this.uSplatPoints = null;
    this.uSplatVelocities = null;
    this.uSplatColors = null;
    this.splatPointArray = [];
    this.splatVelocityArray = [];
    this.splatColorArray = [];
    this.splatCount = 0;
    this.needsClear = false;
  }
}
