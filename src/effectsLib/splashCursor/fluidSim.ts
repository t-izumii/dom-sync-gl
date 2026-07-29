import * as THREE from 'three/webgpu';
import {
  abs,
  clamp,
  dot,
  exp,
  length,
  select,
  texture,
  uniform,
  uv,
  vec2,
  vec4,
} from 'three/tsl';

/** step() に毎フレーム渡すシミュレーションパラメータ。 */
export interface FluidStepParams {
  /** 渦度復元の強さ（本家 CURL）。 */
  curl: number;
  /** 圧力場の毎フレーム減衰率（本家 PRESSURE）。 */
  pressure: number;
  /** 圧力 Jacobi 反復回数（本家 PRESSURE_ITERATIONS）。 */
  pressureIterations: number;
  /** 速度場の消散（本家 VELOCITY_DISSIPATION）。 */
  velocityDissipation: number;
  /** 染料の消散（本家 DENSITY_DISSIPATION）。 */
  densityDissipation: number;
}

/** ping-pong 用 RT ペア。 */
interface DoubleFBO {
  read: THREE.RenderTarget;
  write: THREE.RenderTarget;
  swap(): void;
  dispose(): void;
}

/**
 * Navier-Stokes 流体シミュレーションの RT 群とパス実行を束ねる内部ヘルパー
 * （SplashCursorEffect 専用。lib には入れない）。
 *
 * 生 WebGL の Pavel Dobryakov 系実装（Program + blit()）を three/webgpu + TSL に
 * 翻訳したもので、「QuadMesh 1 枚 + パスごとに MeshBasicNodeMaterial 差し替え +
 * setRenderTarget」で各パスを実行する（FeedbackBuffer / EffectComposer と同じ流儀）。
 * 各パスの数式は colorNode（TSL ノードグラフ）として構築時に一度だけ組み立て、
 * 毎フレームの更新は uniform / texture ノードの `.value` 差し替えのみで行う。
 * renderer の RenderTarget 状態は public メソッド（splat / step）の内部で保存・復元する。
 *
 * 旧 GLSL 版の baseVertex（上下左右 1 テクセルずらした UV を varying で渡す最適化）は、
 * TSL では fragment 側で uv() ± uTexelSize を計算する形に置き換えた（数式は等価）。
 */
export class FluidSim {
  private renderer: THREE.WebGPURenderer;

  // fullscreen 描画は QuadMesh に任せる（clip 空間 z の WebGL/WebGPU 差の吸収。
  // Why の詳細は EffectComposer の quad 宣言部を参照）。material はパスごとに差し替える。
  private readonly quad = new THREE.QuadMesh();

  // 全パス共通の sim テクセルサイズ（旧実装は material ごとに同値の uniform を
  // 持っていたが、TSL ではノードを共有できるため 1 本にまとめる）
  private readonly uTexelSize = uniform(new THREE.Vector2(1, 1));

  // --- splat パスのノード ---
  private readonly splatTarget = texture();
  private readonly uAspectRatio = uniform(1);
  private readonly uColor = uniform(new THREE.Vector3());
  private readonly uPoint = uniform(new THREE.Vector2());
  private readonly uRadius = uniform(0.0025);

  // --- advection パスのノード ---
  // velocity 自身の移流と dye の移流で material を分ける。
  // Why: three の TextureNode は uniform のハッシュに **テクスチャの uuid** を使う
  // （TextureNode.getUniformHash() = this.value.uuid）ため、シェーダーのビルド時点で
  // 同じテクスチャを指している 2 枚の texture() ノードは 1 本のバインドに畳まれ、
  // 以後どちらの .value を差し替えても片方しか効かなくなる。1 つの material を
  // velocity 移流（uVelocity === uSource）と dye 移流（uVelocity ≠ uSource）で
  // 兼用すると、初回ビルドが velocity 移流側になるため必ず畳まれ、dye 移流のとき
  // 速度ではなく dye をサンプルしてしまう（= dye が全く流れない）。
  // velocity 側は本来 1 枚で足りるのでノードも 1 本にし、dye 側は最初から
  // 別テクスチャになる 2 本を持たせて畳み込みを避ける。
  private readonly advVelSelf = texture();
  private readonly advDyeVelocity = texture();
  private readonly advDyeSource = texture();
  private readonly uAdvDt = uniform(0);
  private readonly uDissipation = uniform(0);

  // --- curl パスのノード ---
  private readonly curlVelocity = texture();

  // --- vorticity パスのノード ---
  private readonly vortVelocity = texture();
  private readonly vortCurl = texture();
  private readonly uCurl = uniform(0);
  private readonly uVortDt = uniform(0);

  // --- divergence パスのノード ---
  private readonly divVelocity = texture();

  // --- clear パスのノード ---
  private readonly clearTexture = texture();
  private readonly uClearValue = uniform(0.1);

  // --- pressure パスのノード ---
  private readonly prsPressure = texture();
  private readonly prsDivergence = texture();

  // --- gradientSubtract パスのノード ---
  private readonly gradPressure = texture();
  private readonly gradVelocity = texture();

  // パスごとの material
  private readonly splatMaterial: THREE.MeshBasicNodeMaterial;
  private readonly advectionVelocityMaterial: THREE.MeshBasicNodeMaterial;
  private readonly advectionDyeMaterial: THREE.MeshBasicNodeMaterial;
  private readonly curlMaterial: THREE.MeshBasicNodeMaterial;
  private readonly vorticityMaterial: THREE.MeshBasicNodeMaterial;
  private readonly divergenceMaterial: THREE.MeshBasicNodeMaterial;
  private readonly clearMaterial: THREE.MeshBasicNodeMaterial;
  private readonly pressureMaterial: THREE.MeshBasicNodeMaterial;
  private readonly gradientSubtractMaterial: THREE.MeshBasicNodeMaterial;
  private readonly materials: THREE.MeshBasicNodeMaterial[];

  // RT 群（全て RGBA / HalfFloat / ClampToEdge / depth・stencil なし。
  // フィルタは本家に合わせ velocity・dye が Linear、他は Nearest）
  private velocity: DoubleFBO | null = null;
  private dye: DoubleFBO | null = null;
  private pressure: DoubleFBO | null = null;
  private divergence: THREE.RenderTarget | null = null;
  private curl: THREE.RenderTarget | null = null;

  // renderer.init() 完了前に GPU コマンドを発行できないため、RT の 0 クリアは
  // buildFramebuffers() ではなく初回の splat()/step()（render ループ内 =
  // init 完了後）まで遅延する（FeedbackBuffer と同じパターン）。
  private cleared = false;

  private _aspect = 1;

  constructor(renderer: THREE.WebGPURenderer) {
    this.renderer = renderer;

    // Why fragmentNode（colorNode ではなく）:
    // NodeMaterial の colorNode 経路は出力に `.max(0)`（three 側のコメント曰く
    // "force unsigned floats - useful for RenderTargets"）を強制で挟む。流体の
    // 速度・渦度・発散・圧力はいずれも符号付きで、負の半分が 0 に潰れると逆流も
    // 渦も圧力射影も成立せず「ぼんやり広がる雲」にしかならない。fragmentNode 経路
    // にはこのクランプが無いためこちらを使う。
    // fragmentNode は出力色空間変換も飛ばすが、sim の各パスは NoColorSpace の
    // 中間 RT にしか描かないため変換は不要（むしろ掛かってはいけない）。
    const make = (fragmentNode: THREE.Node): THREE.MeshBasicNodeMaterial => {
      const material = new THREE.MeshBasicNodeMaterial();
      material.fragmentNode = fragmentNode;
      material.depthTest = false;
      material.depthWrite = false;
      // 各パスは書き込み先 RT を丸ごと置き換える（旧 ShaderMaterial も実質 blend なし）。
      material.blending = THREE.NoBlending;
      return material;
    };

    const texel = this.uTexelSize;

    // 近傍サンプル用の UV（旧 baseVertex の vL/vR/vT/vB 相当）。
    // ノードグラフはパスごとに独立させるため、ファクトリで毎回組み立てる。
    const neighborUVs = () => {
      const vUv = uv();
      return {
        vUv,
        vL: vUv.sub(vec2(texel.x, 0.0)),
        vR: vUv.add(vec2(texel.x, 0.0)),
        vT: vUv.add(vec2(0.0, texel.y)),
        vB: vUv.sub(vec2(0.0, texel.y)),
      };
    };

    // splat: マウス位置に Gaussian で速度（velocity RT）や色（dye RT）を加算注入する。
    // velocity へは uColor = (dx, dy, 0)、dye へはインク色を渡して同じパスを使い回す。
    {
      const p0 = uv().sub(this.uPoint);
      const p = vec2(p0.x.mul(this.uAspectRatio), p0.y);
      const splat = exp(dot(p, p).negate().div(this.uRadius)).mul(this.uColor);
      this.splatMaterial = make(vec4(this.splatTarget.xyz.add(splat), 1.0));
    }

    // advection: 速度場に沿って場を運ぶ（semi-Lagrangian）。velocity 自身と dye で
    // material を分ける（理由は advVelSelf 宣言部の Why を参照）。
    // uTexelSize は常に velocity（sim 解像度）のテクセル。dye 解像度は
    // sim と異なるが、coord の逆流計算は速度場の座標系（UV × sim テクセル）で行い、
    // tSource のサンプルは Linear フィルタに任せるため dyeTexelSize は不要
    // （本家の MANUAL_FILTERING = HalfFloat Linear 非対応端末向け bilerp は、
    // WebGPU / WebGL2 とも float texture の Linear フィルタが使えるため移植しない）。
    {
      const decay = this.uDissipation.mul(this.uAdvDt).add(1.0);

      // velocity 自身の移流（本家 uVelocity と uSource が同じテクスチャ）
      const selfCoord = uv().sub(this.advVelSelf.xy.mul(texel).mul(this.uAdvDt));
      this.advectionVelocityMaterial = make(this.advVelSelf.sample(selfCoord).div(decay));

      // dye の移流
      const dyeCoord = uv().sub(this.advDyeVelocity.xy.mul(texel).mul(this.uAdvDt));
      this.advectionDyeMaterial = make(this.advDyeSource.sample(dyeCoord).div(decay));
    }

    // curl: 速度場の回転（渦度）を計算して curl RT の r に書く。
    {
      const { vL, vR, vT, vB } = neighborUVs();
      const L = this.curlVelocity.sample(vL).y;
      const R = this.curlVelocity.sample(vR).y;
      const T = this.curlVelocity.sample(vT).x;
      const B = this.curlVelocity.sample(vB).x;
      const vorticity = R.sub(L).sub(T).add(B);
      this.curlMaterial = make(vec4(vorticity.mul(0.5), 0.0, 0.0, 1.0));
    }

    // vorticity confinement: 数値拡散で失われる細かい渦を、curl の勾配方向の力で
    // 復元する。uCurl（本家 CURL, 既定 3）が大きいほど軌跡の縁が強くカールする。
    {
      const { vUv, vL, vR, vT, vB } = neighborUVs();
      const L = this.vortCurl.sample(vL).x;
      const R = this.vortCurl.sample(vR).x;
      const T = this.vortCurl.sample(vT).x;
      const B = this.vortCurl.sample(vB).x;
      const C = this.vortCurl.sample(vUv).x;

      const dir = vec2(abs(T).sub(abs(B)), abs(R).sub(abs(L))).mul(0.5);
      const normalized = dir.div(length(dir).add(0.0001));
      const force = normalized.mul(this.uCurl).mul(C).mul(vec2(1.0, -1.0));

      const velocity = this.vortVelocity.sample(vUv).xy.add(force.mul(this.uVortDt));
      const clamped = clamp(velocity, vec2(-1000.0), vec2(1000.0));
      this.vorticityMaterial = make(vec4(clamped, 0.0, 1.0));
    }

    // divergence: 速度場の発散を計算。境界では法線方向速度を反転（no-slip 境界条件）。
    {
      const { vUv, vL, vR, vT, vB } = neighborUVs();
      const C = this.divVelocity.sample(vUv).xy;
      const L = select(vL.x.lessThan(0.0), C.x.negate(), this.divVelocity.sample(vL).x);
      const R = select(vR.x.greaterThan(1.0), C.x.negate(), this.divVelocity.sample(vR).x);
      const T = select(vT.y.greaterThan(1.0), C.y.negate(), this.divVelocity.sample(vT).y);
      const B = select(vB.y.lessThan(0.0), C.y.negate(), this.divVelocity.sample(vB).y);
      const div = R.sub(L).add(T).sub(B).mul(0.5);
      this.divergenceMaterial = make(vec4(div, 0.0, 0.0, 1.0));
    }

    // clear: 前フレームの圧力場を uValue（本家 PRESSURE, 既定 0.1）倍に減衰させ、
    // Jacobi 反復の初期値にする。
    this.clearMaterial = make(this.clearTexture.mul(this.uClearValue));

    // pressure: 圧力ポアソン方程式の Jacobi 反復 1 ステップ。
    // TS 側で PRESSURE_ITERATIONS 回 ping-pong しながら繰り返す。
    {
      const { vUv, vL, vR, vT, vB } = neighborUVs();
      const L = this.prsPressure.sample(vL).x;
      const R = this.prsPressure.sample(vR).x;
      const T = this.prsPressure.sample(vT).x;
      const B = this.prsPressure.sample(vB).x;
      const divergence = this.prsDivergence.sample(vUv).x;
      const pressure = L.add(R).add(B).add(T).sub(divergence).mul(0.25);
      this.pressureMaterial = make(vec4(pressure, 0.0, 0.0, 1.0));
    }

    // gradientSubtract: 速度場から圧力勾配を引き、非圧縮（発散ゼロ）に射影する。
    {
      const { vUv, vL, vR, vT, vB } = neighborUVs();
      const L = this.gradPressure.sample(vL).x;
      const R = this.gradPressure.sample(vR).x;
      const T = this.gradPressure.sample(vT).x;
      const B = this.gradPressure.sample(vB).x;
      const velocity = this.gradVelocity.sample(vUv).xy.sub(vec2(R.sub(L), T.sub(B)));
      this.gradientSubtractMaterial = make(vec4(velocity, 0.0, 1.0));
    }

    this.materials = [
      this.splatMaterial,
      this.advectionVelocityMaterial,
      this.advectionDyeMaterial,
      this.curlMaterial,
      this.vorticityMaterial,
      this.divergenceMaterial,
      this.clearMaterial,
      this.pressureMaterial,
      this.gradientSubtractMaterial,
    ];
  }

  /** 最終合成パスへ渡す染料テクスチャ（read 側）。 */
  get dyeTexture(): THREE.Texture | null {
    return this.dye?.read.texture ?? null;
  }

  /** drawing buffer のアスペクト比（splat の delta 補正に使う）。 */
  get aspect(): number {
    return this._aspect;
  }

  /**
   * 本家 getResolution() の移植。短辺を base に合わせ、長辺をアスペクト比で伸ばす。
   */
  private getResolution(base: number): { width: number; height: number } {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    let aspect = size.x / size.y || 1;
    if (aspect < 1) aspect = 1 / aspect;
    const min = Math.round(base);
    const max = Math.round(base * aspect);
    return size.x > size.y ? { width: max, height: min } : { width: min, height: max };
  }

  /**
   * 中間 RT を 1 枚作る。
   * @param filter 本家 createFBO の param。移流でサンプルされる velocity / dye は
   *   LINEAR、テクセル単位でしか読まない divergence / curl / pressure は NEAREST。
   */
  private makeTarget(
    w: number,
    h: number,
    filter: THREE.MagnificationTextureFilter = THREE.LinearFilter,
  ): THREE.RenderTarget {
    return new THREE.RenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: filter,
      magFilter: filter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  private makeDoubleFBO(
    w: number,
    h: number,
    filter: THREE.MagnificationTextureFilter = THREE.LinearFilter,
  ): DoubleFBO {
    const fbo: DoubleFBO = {
      read: this.makeTarget(w, h, filter),
      write: this.makeTarget(w, h, filter),
      swap() {
        const tmp = this.read;
        this.read = this.write;
        this.write = tmp;
      },
      dispose() {
        this.read.dispose();
        this.write.dispose();
      },
    };
    return fbo;
  }

  /**
   * RT 群を（再）構築する。既存の流体状態は破棄される
   * （本家はリサイズ時に copy パスで内容を引き継ぐが、デモ用途では再構築で十分）。
   * GPU コマンドは発行しない（初期 0 クリアは初回 splat()/step() まで遅延）。
   */
  buildFramebuffers(simResolution: number, dyeResolution: number): void {
    const simRes = this.getResolution(simResolution);
    const dyeRes = this.getResolution(dyeResolution);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this._aspect = size.x / size.y || 1;
    this.uTexelSize.value.set(1 / simRes.width, 1 / simRes.height);

    this.disposeFramebuffers();
    this.velocity = this.makeDoubleFBO(simRes.width, simRes.height);
    this.dye = this.makeDoubleFBO(dyeRes.width, dyeRes.height);
    this.pressure = this.makeDoubleFBO(simRes.width, simRes.height, THREE.NearestFilter);
    this.divergence = this.makeTarget(simRes.width, simRes.height, THREE.NearestFilter);
    this.curl = this.makeTarget(simRes.width, simRes.height, THREE.NearestFilter);
    this.cleared = false;
  }

  /** first frame のゴミ防止に全 RT を 0 クリアする（renderer の状態は復元）。 */
  private ensureCleared(): void {
    if (this.cleared) return;
    const velocity = this.velocity;
    const dye = this.dye;
    const pressure = this.pressure;
    const divergence = this.divergence;
    const curl = this.curl;
    if (!velocity || !dye || !pressure || !divergence || !curl) return;

    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    // WebGPURenderer の getClearColor は Color4 を要求するが、three/webgpu は
    // Color4 をランタイム export していないため Color を流用する（copy で rgb が
    // 写り、alpha は getClearAlpha() で別途保存・復元する）。
    const prevColor = r.getClearColor(
      new THREE.Color() as unknown as Parameters<
        THREE.WebGPURenderer['getClearColor']
      >[0],
    );
    const prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    const targets = [
      velocity.read, velocity.write,
      dye.read, dye.write,
      pressure.read, pressure.write,
      divergence, curl,
    ];
    for (const t of targets) {
      r.setRenderTarget(t);
      r.clear();
    }
    r.setClearColor(prevColor, prevAlpha);
    r.setRenderTarget(prevRT);
    this.cleared = true;
  }

  /** material を差し替えて target にフルスクリーン quad を 1 枚描く（本家 blit() 相当）。 */
  private blit(material: THREE.MeshBasicNodeMaterial, target: THREE.RenderTarget): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);
  }

  /**
   * velocity と dye に Gaussian splat を注入する（本家 splat() の翻訳）。
   * @param x/y   注入位置（0..1 UV・y 上向き）
   * @param dx/dy 速度（aspect 補正・SPLAT_FORCE 乗算済みの値を渡す）
   * @param color 染料色（linear 0..1、rainbow は 0.15 倍済み）
   * @param radius 本家 SPLAT_RADIUS（内部で /100 + aspect 補正）
   */
  splat(x: number, y: number, dx: number, dy: number, color: THREE.Color, radius: number): void {
    const velocity = this.velocity;
    const dye = this.dye;
    if (!velocity || !dye) return;

    let r = radius / 100;
    if (this._aspect > 1) r *= this._aspect;

    const prevRT = this.renderer.getRenderTarget();
    this.ensureCleared();

    this.splatTarget.value = velocity.read.texture;
    this.uAspectRatio.value = this._aspect;
    this.uPoint.value.set(x, y);
    this.uColor.value.set(dx, dy, 0);
    this.uRadius.value = r;
    this.blit(this.splatMaterial, velocity.write);
    velocity.swap();

    this.splatTarget.value = dye.read.texture;
    this.uColor.value.set(color.r, color.g, color.b);
    this.blit(this.splatMaterial, dye.write);
    dye.swap();

    this.renderer.setRenderTarget(prevRT);
  }

  /**
   * シミュレーションを 1 ステップ進める（本家 step() の翻訳）。
   * curl → vorticity → divergence → clear（圧力減衰）→ pressure×N →
   * gradientSubtract → advection（velocity）→ advection（dye）。
   */
  step(dt: number, params: FluidStepParams): void {
    const velocity = this.velocity;
    const dye = this.dye;
    const pressure = this.pressure;
    const divergence = this.divergence;
    const curl = this.curl;
    if (!velocity || !dye || !pressure || !divergence || !curl) return;

    const prevRT = this.renderer.getRenderTarget();
    this.ensureCleared();

    // 1. curl（渦度の計算）
    this.curlVelocity.value = velocity.read.texture;
    this.blit(this.curlMaterial, curl);

    // 2. vorticity confinement（渦の復元力を速度場へ）
    this.vortVelocity.value = velocity.read.texture;
    this.vortCurl.value = curl.texture;
    this.uCurl.value = params.curl;
    this.uVortDt.value = dt;
    this.blit(this.vorticityMaterial, velocity.write);
    velocity.swap();

    // 3. divergence（発散の計算）
    this.divVelocity.value = velocity.read.texture;
    this.blit(this.divergenceMaterial, divergence);

    // 4. clear（前フレーム圧力の減衰 = Jacobi 反復の初期値）
    this.clearTexture.value = pressure.read.texture;
    this.uClearValue.value = params.pressure;
    this.blit(this.clearMaterial, pressure.write);
    pressure.swap();

    // 5. pressure（圧力ポアソン方程式の Jacobi 反復）
    this.prsDivergence.value = divergence.texture;
    for (let i = 0; i < params.pressureIterations; i++) {
      this.prsPressure.value = pressure.read.texture;
      this.blit(this.pressureMaterial, pressure.write);
      pressure.swap();
    }

    // 6. gradientSubtract（圧力勾配を引いて非圧縮に射影）
    this.gradPressure.value = pressure.read.texture;
    this.gradVelocity.value = velocity.read.texture;
    this.blit(this.gradientSubtractMaterial, velocity.write);
    velocity.swap();

    // 7. advection（velocity 自身の移流）
    this.advVelSelf.value = velocity.read.texture;
    this.uAdvDt.value = dt;
    this.uDissipation.value = params.velocityDissipation;
    this.blit(this.advectionVelocityMaterial, velocity.write);
    velocity.swap();

    // 8. advection（dye の移流。uTexelSize は sim テクセルのまま = 本家と同じ）
    this.advDyeVelocity.value = velocity.read.texture;
    this.advDyeSource.value = dye.read.texture;
    this.uDissipation.value = params.densityDissipation;
    this.blit(this.advectionDyeMaterial, dye.write);
    dye.swap();

    this.renderer.setRenderTarget(prevRT);
  }

  private disposeFramebuffers(): void {
    this.velocity?.dispose();
    this.dye?.dispose();
    this.pressure?.dispose();
    this.divergence?.dispose();
    this.curl?.dispose();
    this.velocity = null;
    this.dye = null;
    this.pressure = null;
    this.divergence = null;
    this.curl = null;
  }

  dispose(): void {
    this.disposeFramebuffers();
    // QuadMesh の geometry は全インスタンス共有のため dispose してはいけない。
    for (const mat of this.materials) mat.dispose();
  }
}
