// liquid-swap の描画パス（React Bits Pro "Liquid Swap" の移植・1 パス・FBO なし）。
// 旧 liquidSwap.frag.glsl (v0.3 GLSL) を v0.4 の TSL ノードファクトリへ移植したもの。
//
// uProgress(0→1) だけで駆動する決定論的な遷移:
//   - uCenter からの円形リビール（半径 = uProgress × 最遠隅距離）
//   - 円内は uTexNext を「液体ガラス」風に屈折サンプル
//     歪みは 3 層合成（①中心方向 bend ②周波数 22/35/50 の 3 波干渉リップル
//     ③高周波 value noise + ゆっくり回る流れ）
//   - RGB 非対称オフセット（+1.2 / +0.2 / -0.8 比率）の色収差
//   - 縁に rim グロー + 白ボーダー（uProgress 0.8〜1.0 で先に消灯）
//   - uProgress > 0.95 でクリーン画像へ cross-fade してスナップ防止
// time uniform は使わない（位相 = uProgress * 5.0）。同じ progress なら常に同じ絵。
//
// ノードグラフは colorNode ファクトリ呼び出し時（= plane 構築時）に一度だけ組まれ、
// 以後の更新はインスタンスが保持する uniform / texture ノードの `.value` 差し替えのみ。
import * as THREE from "three/webgpu";
import {
  Fn,
  clamp,
  cos,
  distance,
  dot,
  float,
  floor,
  fract,
  length,
  max,
  mix,
  normalize,
  pow,
  select,
  sin,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import type { PlaneNodeContext } from "../../index";

// テクスチャ未設定でも texture() ノードは有効な Texture を要求するため、
// 全インスタンスで共有する 1x1 透明テクスチャを初期値に使う（DomPlane と同じ手法）。
const placeholderTexture = new THREE.DataTexture(
  new Uint8Array([0, 0, 0, 0]),
  1,
  1,
);
placeholderTexture.needsUpdate = true;

// object-fit: cover 相当の UV 補正（プレーンの px サイズと画像原寸から算出）
const coverUv = Fn(([uvIn, imageRes, resolution]: [Node, Node, Node]) => {
  const ratio = resolution.div(imageRes);
  const scale = max(ratio.x, ratio.y);
  const scaledSize = imageRes.mul(scale);
  const offset = resolution.sub(scaledSize).mul(0.5);
  return uvIn.mul(resolution).sub(offset).div(scaledSize);
});

const hash21 = Fn(([p]: [Node]) => {
  return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
});

// smoothstep 補間の 2D value noise（液体表面の高周波ざわつき用）
const valueNoise = Fn(([p]: [Node]) => {
  const cell = floor(p);
  const f0 = fract(p);
  const f = f0.mul(f0).mul(float(3.0).sub(f0.mul(2.0)));
  const a = hash21(cell);
  const b = hash21(cell.add(vec2(1.0, 0.0)));
  const c = hash21(cell.add(vec2(0.0, 1.0)));
  const d = hash21(cell.add(vec2(1.0, 1.0)));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
});

/** テクスチャの原寸 px を取り出す（HTMLImageElement / ImageBitmap 両対応）。 */
function imageSizeOf(tex: THREE.Texture): { width: number; height: number } {
  const img = tex.image as
    | {
        width?: number;
        height?: number;
        naturalWidth?: number;
        naturalHeight?: number;
      }
    | undefined;
  return {
    width: img?.naturalWidth || img?.width || 1,
    height: img?.naturalHeight || img?.height || 1,
  };
}

export interface LiquidSwapOptions {
  /** 屈折（中心方向 bend）の強さ倍率。既定 1。 */
  refraction?: number;
  /** 色収差の強さ倍率。既定 1。 */
  aberration?: number;
  /** 中心クリア領域の広さ倍率（大きいほど歪みが縁に寄る）。既定 1。 */
  clarity?: number;
  /** 縁の rim グロー + 白ボーダーの強さ倍率。既定 1。 */
  edgeGlow?: number;
  /** ゆっくり回る流れの強さ倍率。既定 1。 */
  flow?: number;
  /** リビール円の原点（plane UV・左下原点）。既定 { x: 0.5, y: 0.5 }。 */
  center?: { x: number; y: number };
}

/**
 * Liquid Swap（液体ガラス風の画像スワップ遷移）。
 *
 * DOM 同期 plane の colorNode として使う。1 インスタンス = 1 plane。
 *
 * ```ts
 * const swap = new LiquidSwap();
 * app.createPlane('.hero', { colorNode: swap.colorNode });
 * swap.setTextures(prevTex, nextTex);
 * swap.progress = t; // 0 → 1 で prev から next へ遷移
 * swap.commit();     // 遷移完了後: next を prev に昇格して progress を 0 に戻す
 * ```
 *
 * テクスチャの所有権は呼び出し元にある（このクラスは dispose しない）。
 */
export class LiquidSwap {
  private readonly uTexPrev = texture(placeholderTexture);
  private readonly uTexNext = texture(placeholderTexture);
  private readonly uProgress = uniform(0);
  private readonly uReady = uniform(0);
  private readonly uCenter = uniform(new THREE.Vector2(0.5, 0.5));
  private readonly uImageResPrev = uniform(new THREE.Vector2(1, 1));
  private readonly uImageResNext = uniform(new THREE.Vector2(1, 1));
  private readonly uRefraction = uniform(1);
  private readonly uAberration = uniform(1);
  private readonly uClarity = uniform(1);
  private readonly uEdgeGlow = uniform(1);
  private readonly uFlow = uniform(1);

  private hasPrev = false;
  private hasNext = false;

  constructor(options: LiquidSwapOptions = {}) {
    this.uRefraction.value = options.refraction ?? 1;
    this.uAberration.value = options.aberration ?? 1;
    this.uClarity.value = options.clarity ?? 1;
    this.uEdgeGlow.value = options.edgeGlow ?? 1;
    this.uFlow.value = options.flow ?? 1;
    if (options.center) {
      this.uCenter.value.set(options.center.x, options.center.y);
    }
  }

  /**
   * createPlane の options.colorNode に渡すノードファクトリ。
   * plane 構築時に一度だけ呼ばれ、以後はこのインスタンスの setter が
   * uniform の `.value` を差し替えることで毎フレーム更新される。
   */
  readonly colorNode = (ctx: PlaneNodeContext): Node => {
    // uResolution（plane の px サイズ）は lib が自動セットする ctx のノードを使う。
    const uv = vec2(ctx.uv);
    const resolution = vec2(ctx.uResolution);

    const t = clamp(this.uProgress, 0.0, 1.0);
    const uvPrev = coverUv(uv, vec2(this.uImageResPrev), resolution);
    const prevColor = this.uTexPrev.sample(uvPrev);
    const uvNext = coverUv(uv, vec2(this.uImageResNext), resolution);

    // ---- 円形リビールの幾何（プレーンローカル px 座標系） ----
    const pixel = uv.mul(resolution);
    const center = vec2(this.uCenter).mul(resolution);
    // 4 隅までの最遠距離 = 各軸で遠い側の成分を採った対角距離。
    // t = 1 でどの原点からでも必ずプレーン全体が円に覆われる。
    const maxDist = length(max(center, resolution.sub(center)));
    const radius = t.mul(maxDist);
    const dist = distance(pixel, center);
    // 3px のソフトエッジ円マスク（円内 = 1）
    const mask = smoothstep(radius.add(3.0), radius.sub(3.0), dist);
    // 円内の正規化距離（0 = 中心、1 = 円周）と放射方向
    const norm = dist.div(max(radius, 0.001));
    // GLSL の `dist > 0.0001 ? (pixel - center) / dist : vec2(0.0)`。
    // select は両辺を評価しうるため、非採用側の 0 除算を避けて分母をクランプする
    // （採用側では dist > 0.0001 なので結果は同一）。
    const dir = select(
      dist.greaterThan(0.0001),
      pixel.sub(center).div(max(dist, 0.0001)),
      vec2(0.0),
    );

    // 中心クリア領域 → 縁ほど強い歪みのカーブ
    const clearZone = this.uClarity.mul(0.3);
    const distFactor = smoothstep(clearZone, 1.0, norm);
    // 時間軸は progress そのもの（決定論的。スライダー往復でも同じ絵）
    const phase = t.mul(5.0);

    // 縁の発光は t = 0.8 から先にフェードアウト（終盤のスナップ防止 1 段目）
    const fadeOut = float(1.0).sub(smoothstep(0.8, 1.0, t));
    const rimStrength = this.uEdgeGlow.mul(0.08).mul(fadeOut);
    const borderStrength = this.uEdgeGlow.mul(0.06).mul(fadeOut);

    // ---- 歪み層 1: 中心方向への bend（レンズ屈折の主成分） ----
    const bendDir = normalize(
      dir.add(vec2(sin(phase), cos(phase.mul(0.7))).mul(0.3)),
    );
    const bent = uvNext.sub(
      bendDir.mul(this.uRefraction.mul(0.08)).mul(pow(distFactor, 1.5)),
    );

    // ---- 歪み層 2: 周波数 22 / 35 / 50 の 3 波干渉リップル ----
    const ripple = sin(norm.mul(22.0).sub(phase.mul(3.5)))
      .add(sin(norm.mul(35.0).add(phase.mul(2.8))).mul(0.7))
      .add(sin(norm.mul(50.0).sub(phase.mul(4.2))).mul(0.5))
      .div(3.0);
    const rippled = bent.sub(dir.mul(ripple.mul(0.025).mul(distFactor)));

    // ---- 歪み層 3: 高周波 value noise + ゆっくり回る流れ ----
    const surface = vec2(
      valueNoise(uv.mul(100.0).add(phase.mul(0.3))),
      valueNoise(uv.mul(100.0).add(phase.mul(0.2).add(50.0))),
    ).sub(0.5);
    const sampleUv = rippled
      .sub(surface.mul(distFactor.mul(0.004)))
      .add(
        vec2(
          sin(phase.add(norm.mul(10.0))),
          cos(phase.mul(0.8).add(norm.mul(8.0))),
        )
          .mul(this.uFlow.mul(0.015))
          .mul(distFactor)
          .mul(mask),
      );

    // ---- 色収差: 放射方向へ非対称な RGB オフセット（縁ほど強い） ----
    const aberration = this.uAberration.mul(0.02).mul(pow(distFactor, 1.2));
    const r = this.uTexNext.sample(sampleUv.add(dir.mul(aberration).mul(1.2))).r;
    const g = this.uTexNext.sample(sampleUv.add(dir.mul(aberration).mul(0.2))).g;
    const b = this.uTexNext.sample(sampleUv.sub(dir.mul(aberration).mul(0.8))).b;

    // ---- 縁: rim グロー加算 + 白ボーダー ----
    const insideEdge = float(1.0).sub(smoothstep(1.0, 1.01, norm));
    const rim = smoothstep(0.95, 1.0, norm).mul(insideEdge);
    const border = smoothstep(0.975, 1.0, norm).mul(insideEdge);
    const distortedRgb = mix(
      vec3(r, g, b).add(rim.mul(rimStrength)),
      vec3(1.0),
      border.mul(borderStrength),
    );

    // 円外・GLSL の else 分岐（歪みなしの next）
    const cleanNext = this.uTexNext.sample(uvNext);
    const revealedRaw = select(
      mask.greaterThan(0.0),
      vec4(distortedRgb, 1.0),
      cleanNext,
    );

    // 終盤のスナップ防止 2 段目: 歪みなしのクリーン画像へ cross-fade
    // （GLSL の `if (t > 0.95)` は t <= 0.95 で係数 0 になるため clamp で等価）
    const revealed = mix(
      revealedRaw,
      cleanNext,
      clamp(t.sub(0.95).div(0.05), 0.0, 1.0),
    );

    // 円の外は現在画像（prev）のまま
    const composed = mix(prevColor, revealed, mask);
    // アイドル時（progress = 0）は現在画像（prev）のみ
    const active = select(t.lessThanEqual(0.0), prevColor, composed);
    // テクスチャロード完了前は透明（プレーンは transparent:true なので背景が見える）
    return select(this.uReady.lessThan(0.5), vec4(0.0), active);
  };

  /** 現在画像（prev）と遷移先画像（next）をまとめて設定する。 */
  setTextures(prev: THREE.Texture, next: THREE.Texture): void {
    this.setPrevTexture(prev);
    this.setNextTexture(next);
  }

  /** 現在画像（円の外に表示される側）を設定する。 */
  setPrevTexture(tex: THREE.Texture): void {
    this.uTexPrev.value = tex;
    const { width, height } = imageSizeOf(tex);
    this.uImageResPrev.value.set(width, height);
    this.hasPrev = true;
    this.updateReady();
  }

  /** 遷移先画像（円形リビールで現れる側）を設定する。 */
  setNextTexture(tex: THREE.Texture): void {
    this.uTexNext.value = tex;
    const { width, height } = imageSizeOf(tex);
    this.uImageResNext.value.set(width, height);
    this.hasNext = true;
    this.updateReady();
  }

  /**
   * 遷移完了後の後始末: next を prev へ昇格し progress を 0 に戻す。
   * 続けて setNextTexture() で次の画像を渡せば連続スワップできる。
   */
  commit(): void {
    this.uTexPrev.value = this.uTexNext.value;
    this.uImageResPrev.value.copy(this.uImageResNext.value);
    this.hasPrev = this.hasNext;
    this.uProgress.value = 0;
  }

  /** 遷移の進行度（0 = prev のみ、1 = next のみ）。シェーダー側で 0〜1 に clamp される。 */
  get progress(): number {
    return this.uProgress.value;
  }
  set progress(v: number) {
    this.uProgress.value = v;
  }

  /** リビール円の原点を plane UV（左下原点）で設定する。 */
  setCenter(x: number, y: number): void {
    this.uCenter.value.set(x, y);
  }

  get refraction(): number {
    return this.uRefraction.value;
  }
  set refraction(v: number) {
    this.uRefraction.value = v;
  }

  get aberration(): number {
    return this.uAberration.value;
  }
  set aberration(v: number) {
    this.uAberration.value = v;
  }

  get clarity(): number {
    return this.uClarity.value;
  }
  set clarity(v: number) {
    this.uClarity.value = v;
  }

  get edgeGlow(): number {
    return this.uEdgeGlow.value;
  }
  set edgeGlow(v: number) {
    this.uEdgeGlow.value = v;
  }

  get flow(): number {
    return this.uFlow.value;
  }
  set flow(v: number) {
    this.uFlow.value = v;
  }

  /** prev / next 両方のテクスチャが設定済みか（false の間は透明描画）。 */
  get ready(): boolean {
    return this.hasPrev && this.hasNext;
  }

  private updateReady(): void {
    this.uReady.value = this.ready ? 1 : 0;
  }
}

const sharedLoader = new THREE.TextureLoader();
sharedLoader.setCrossOrigin("anonymous");

/**
 * LiquidSwap 用のテクスチャロードヘルパー。
 * DomPlane の data-texture ロードと同じ既定（crossOrigin: anonymous /
 * SRGBColorSpace）でロードする。dispose は呼び出し元の責務。
 */
export function loadLiquidSwapTexture(
  url: string,
  colorSpace: THREE.ColorSpace = THREE.SRGBColorSpace,
): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    sharedLoader.load(
      url,
      (tex) => {
        tex.colorSpace = colorSpace;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}
