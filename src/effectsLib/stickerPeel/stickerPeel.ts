/**
 * sticker-peel（ステッカー剥がし）plane シェーダーの TSL 実装。
 *
 * 旧 v0.3 の stickerPeel.vert.glsl / stickerPeel.frag.glsl（?raw import）を
 * three/tsl のノードファクトリ（colorNode / positionNode）へ移行したもの。
 * 数式・視覚挙動は GLSL 版を忠実に再現している。
 *
 * - 頂点: 提供サンプルの円柱カールを DomPlane 用に調整。PlaneGeometry(1,1,seg,seg)
 *   の position ∈ [-0.5, 0.5] を uDirection で回転し、境界 xb より先を
 *   アルキメデス螺旋（1 周ごとに uThickness 分だけ外へ）で巻き上げる。
 *   mesh scale が (w,h,1) px なので z 変位は uResolution.x を掛けて px に揃える。
 * - 断片: 円形マスク（半径 0.5 の外は Discard）+ 白縁 + cover-fit 画像
 *   （省略時は単色）。表裏は frontFacing で確実に判定し、裏面には正面画像を
 *   一切混ぜない。ライティング・落ち影は無し。立体感は「巻きの奥の控えめな
 *   固定グラデーション（vShade）」だけで与える。
 *
 * 使い方（1 インスタンス = 1 plane。ノードグラフを共有するため使い回さない）:
 * ```ts
 * const peel = new StickerPeel({ texture: stickerTex });
 * const plane = app.createPlane('.sticker', peel.planeOptions());
 * peel.applyTo(plane); // 裏面描画のため DoubleSide にする
 * peel.progress = 0.4; // 0: 全部ロール / 1: 全部 flat
 * ```
 */
import * as THREE from "three/webgpu";
import type { Node, TextureNode, UniformNode } from "three/webgpu";
import {
  Discard,
  Fn,
  clamp,
  cos,
  float,
  frontFacing,
  length,
  max,
  mix,
  positionGeometry,
  radians,
  select,
  sin,
  smoothstep,
  texture,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { CreatePlaneOptions, DomPlane, PlaneNodeContext } from "../../index";

const TWO_PI = 6.28318530718;

// テクスチャ未設定でも texture() ノードは有効な Texture を要求するため、
// 1x1 透明テクスチャを初期値に使う（DomPlane の placeholder と同じ方式）。
const placeholderTexture = new THREE.DataTexture(
  new Uint8Array([0, 0, 0, 0]),
  1,
  1,
);
placeholderTexture.needsUpdate = true;

/**
 * 円領域への cover-fit サンプリング（正方形の円マスク領域に画像を隙間なく収める）。
 * GLSL 版 coverSample() と同一の数式。
 */
const coverSample = (
  tex: TextureNode,
  cuv: Node,
  res: UniformNode<THREE.Vector2>,
): Node => {
  const aspect = res.x.div(max(res.y, 1.0));
  const scale = select(
    aspect.greaterThanEqual(1.0),
    vec2(float(1.0).div(aspect), 1.0),
    vec2(1.0, aspect),
  );
  return tex.sample(cuv.mul(scale).add(0.5)).rgb;
};

export interface StickerPeelOptions {
  /** 剥がし進行度。0: 全部ロール / 1: 全部 flat。既定: 1 */
  progress?: number;
  /** 剥がし方向（度）。既定: 0 */
  direction?: number;
  /** 巻き半径（plane ローカル単位。小さいほどタイトな curl）。既定: 0.12 */
  curlRadius?: number;
  /** 紙の厚み（螺旋の 1 周ごとの外向きオフセット。z-fighting 防止）。既定: 0.01 */
  thickness?: number;
  /** 正面の単色（正面画像が未指定 / 未ロードのとき表示）。既定: '#ffffff' */
  color?: THREE.ColorRepresentation;
  /** 裏面のバッキング紙色（裏面画像が未指定のとき表示）。既定: '#f3f0e8' */
  backColor?: THREE.ColorRepresentation;
  /** 正面画像（ロード済みの THREE.Texture）。 */
  texture?: THREE.Texture | null;
  /** 裏面画像（ロード済みの THREE.Texture）。 */
  backTexture?: THREE.Texture | null;
  /**
   * PlaneGeometry の分割数。カールを滑らかに曲げるため高めに取る。既定: 96
   * （createPlane へは planeOptions() 経由で渡る）
   */
  segments?: number;
}

/**
 * sticker-peel の TSL ノードファクトリと uniform 一式を束ねるクラス。
 * colorNode / positionNode を `planeOptions()` で createPlane に渡し、
 * 以後は progress 等のアクセサで uniform の `.value` を差し替えて駆動する
 * （ノードグラフは構築時に一度だけ組まれ、以後は組み替えない）。
 */
export class StickerPeel {
  /** planeOptions() が返す PlaneGeometry の分割数。 */
  public segments: number;

  // --- uniform ノード（毎フレーム/任意タイミングで .value のみ差し替える） ---
  private readonly uProgress: UniformNode<number>;
  private readonly uDirection: UniformNode<number>;
  private readonly uCurlRadius: UniformNode<number>;
  private readonly uThickness: UniformNode<number>;
  private readonly uReady: UniformNode<number>;
  private readonly uUseTexture: UniformNode<number>;
  private readonly uUseBackTexture: UniformNode<number>;
  private readonly uColor: UniformNode<THREE.Color>;
  private readonly uBackColor: UniformNode<THREE.Color>;
  private readonly uImageRes: UniformNode<THREE.Vector2>;
  private readonly uBackImageRes: UniformNode<THREE.Vector2>;
  private readonly tSticker: TextureNode;
  private readonly tStickerBack: TextureNode;

  // 頂点カールの共有ノード（positionNode と colorNode の vShade で共有するため
  // 一度だけ組み立ててキャッシュする）。
  private curl: { outX: Node; outY: Node; z: Node; vShade: Node } | null = null;

  constructor(options: StickerPeelOptions = {}) {
    this.segments = options.segments ?? 96;
    this.uProgress = uniform(options.progress ?? 1);
    this.uDirection = uniform(options.direction ?? 0);
    this.uCurlRadius = uniform(options.curlRadius ?? 0.12);
    this.uThickness = uniform(options.thickness ?? 0.01);
    this.uReady = uniform(0);
    this.uUseTexture = uniform(0);
    this.uUseBackTexture = uniform(0);
    this.uColor = uniform(new THREE.Color(options.color ?? "#ffffff"));
    this.uBackColor = uniform(new THREE.Color(options.backColor ?? "#f3f0e8"));
    this.uImageRes = uniform(new THREE.Vector2(1, 1));
    this.uBackImageRes = uniform(new THREE.Vector2(1, 1));
    this.tSticker = texture(placeholderTexture);
    this.tStickerBack = texture(placeholderTexture);
    if (options.texture) this.setTexture(options.texture);
    if (options.backTexture) this.setBackTexture(options.backTexture);
  }

  /** 剥がし進行度。0: 全部ロール / 1: 全部 flat。 */
  get progress(): number {
    return this.uProgress.value;
  }
  set progress(v: number) {
    this.uProgress.value = v;
  }

  /** 剥がし方向（度）。 */
  get direction(): number {
    return this.uDirection.value;
  }
  set direction(v: number) {
    this.uDirection.value = v;
  }

  /** 巻き半径（小さいほどタイトな curl）。 */
  get curlRadius(): number {
    return this.uCurlRadius.value;
  }
  set curlRadius(v: number) {
    this.uCurlRadius.value = v;
  }

  /** 紙の厚み（螺旋 1 周ごとの外向きオフセット）。 */
  get thickness(): number {
    return this.uThickness.value;
  }
  set thickness(v: number) {
    this.uThickness.value = v;
  }

  /** 正面の単色を変更する。 */
  setColor(color: THREE.ColorRepresentation): void {
    this.uColor.value.set(color);
  }

  /** 裏面のバッキング紙色を変更する。 */
  setBackColor(color: THREE.ColorRepresentation): void {
    this.uBackColor.value.set(color);
  }

  /**
   * 正面画像を設定する（null で解除して単色 uColor に戻す）。
   * 画像サイズが確定している（ロード済み）テクスチャを渡すこと。サイズ未確定の
   * 場合は uReady が 0 のままとなり、ロード完了後にもう一度呼ぶまで単色で表示する
   * （GLSL 版の「未ロードなら単色」と同じ挙動）。テクスチャの所有権は呼び出し側
   * （dispose は呼び出し側の責務）。
   */
  setTexture(tex: THREE.Texture | null): void {
    if (!tex) {
      this.tSticker.value = placeholderTexture;
      this.uUseTexture.value = 0;
      this.uReady.value = 0;
      return;
    }
    this.tSticker.value = tex;
    this.uUseTexture.value = 1;
    const image = tex.image as { width?: number; height?: number } | undefined;
    if (image && image.width && image.height) {
      this.uImageRes.value.set(image.width, image.height);
      this.uReady.value = 1;
    } else {
      this.uReady.value = 0;
    }
  }

  /**
   * 裏面画像を設定する（null で解除してバッキング紙色 uBackColor に戻す）。
   * 裏から見ると左右が鏡像になるためシェーダー側で x を反転してサンプルする。
   */
  setBackTexture(tex: THREE.Texture | null): void {
    if (!tex) {
      this.tStickerBack.value = placeholderTexture;
      this.uUseBackTexture.value = 0;
      return;
    }
    this.tStickerBack.value = tex;
    this.uUseBackTexture.value = 1;
    const image = tex.image as { width?: number; height?: number } | undefined;
    if (image && image.width && image.height) {
      this.uBackImageRes.value.set(image.width, image.height);
    }
  }

  /** createPlane にそのまま渡せるオプション（colorNode / positionNode / segments）。 */
  planeOptions(): CreatePlaneOptions {
    return {
      segments: this.segments,
      colorNode: this.colorNode,
      positionNode: this.positionNode,
    };
  }

  /**
   * 生成済み plane に材質設定を適用する。裏面（frontFacing = false）を描くため
   * DoubleSide が必須（CreatePlaneOptions に side が無いため後付けで設定する）。
   */
  applyTo(plane: DomPlane): void {
    plane.material.side = THREE.DoubleSide;
    plane.material.needsUpdate = true;
  }

  /**
   * 頂点カール（GLSL 版 stickerPeel.vert.glsl の本体）。
   * positionNode と colorNode（vShade）で共有するため一度だけ組み立てる。
   */
  private buildCurl(): { outX: Node; outY: Node; z: Node; vShade: Node } {
    if (this.curl) return this.curl;

    const p = positionGeometry; // PlaneGeometry(1,1,seg,seg): position ∈ [-0.5, 0.5]
    const ang = radians(this.uDirection);
    const c = cos(ang);
    const s = sin(ang);

    // rot = mat2(c, -s, s, c)（剥がし方向 → +x）: q = rot * p.xy
    const qx = c.mul(p.x).add(s.mul(p.y));
    const qy = c.mul(p.y).sub(s.mul(p.x));

    const r = max(this.uCurlRadius, 0.005);
    // 境界。progress=0 → 円の左外（全部ロール）/ 1 → 右外（全部 flat）
    const xb = mix(float(-0.56), float(0.56), clamp(this.uProgress, 0.0, 1.0));
    const d = qx.sub(xb);

    const rolled = d.greaterThan(0.0);
    const theta = d.div(r); // 弧長 → 角度（rolled=false 側では使わない）
    // アルキメデス螺旋: θ が進むほど半径と底面高さが単調増加し、
    // どの 2 周も同一面に重ならない（θ と θ+2π が別レイヤーになる → z-fighting 解消）。
    const layer = this.uThickness.mul(theta.div(TWO_PI));
    const rEff = r.add(layer); // 1 周ごとに厚み分だけ外へ

    const curlA = select(rolled, theta, float(0.0));
    const qxCurl = select(rolled, xb.add(rEff.mul(sin(theta))), qx); // 螺旋上の x
    // 底面側も浮かせてレイヤーを分離。flat 部（d<=0）は持ち上げない
    // （頂点バンプは剥がれ際の画像を歪ませるため無し）。
    const z = select(
      rolled,
      rEff.mul(float(1.0).sub(cos(theta))).add(layer),
      float(0.0),
    );

    // rotInv = mat2(c, s, -s, c): out = rotInv * q
    const outX = c.mul(qxCurl).sub(s.mul(qy));
    const outY = s.mul(qxCurl).add(c.mul(qy));

    // 立体感は巻きの奥をわずかに暗くする固定グラデーションのみ（ライト非依存）。
    // flat 部（curlA=0）は 1.0 のまま = 元画像そのまま。強くすると円外 Discard の
    // 穴から覗く裏面が高コントラストのまだらに見えるため 0.85 まで（控えめ）。
    // varying() で頂点ステージ計算 + 補間にする（GLSL 版の varying float vShade 相当）。
    const vShade = varying(
      mix(float(1.0), float(0.85), smoothstep(float(1.6), float(3.2), curlA)),
    );

    this.curl = { outX, outY, z, vShade };
    return this.curl;
  }

  /**
   * positionNode ファクトリ（createPlane の options.positionNode に渡す）。
   * mesh scale が (w,h,1) px なので z 変位は uResolution.x を掛けて px に揃える。
   */
  readonly positionNode = (ctx: PlaneNodeContext): Node => {
    const { outX, outY, z } = this.buildCurl();
    return vec3(outX, outY, z.mul(ctx.uResolution.x));
  };

  /**
   * colorNode ファクトリ（createPlane の options.colorNode に渡す）。
   * GLSL 版 stickerPeel.frag.glsl の本体。
   */
  readonly colorNode = (ctx: PlaneNodeContext): Node => {
    const { vShade } = this.buildCurl();
    return Fn(() => {
      const cuv = ctx.uv.sub(0.5);
      const rr = length(cuv);
      // 円マスクは Discard 主体（半径 0.5 の外は捨てる）。
      // 螺旋で自己重なりが生じるため、アルファブレンドの縁に頼ると重なった半透明縁が
      // 濃いノイズになる。本体は不透明(α=1)で描き、深度で正しく重ね合わせる。
      Discard(rr.greaterThan(0.5));

      // 表面: 正面画像（未ロード/未指定なら単色）
      const frontCol = select(
        this.uUseTexture.greaterThan(0.5).and(this.uReady.greaterThan(0.5)),
        coverSample(this.tSticker, cuv, this.uImageRes),
        vec3(this.uColor),
      );
      // 裏面: 裏面画像 or バッキング紙色のみ。正面画像は混ぜない。
      // 裏から見ると左右が鏡像になるため x を反転してサンプルする
      // （実物のステッカー裏面と同じ向きで画像が読める）。
      const backCol = select(
        this.uUseBackTexture.greaterThan(0.5),
        coverSample(
          this.tStickerBack,
          vec2(cuv.x.negate(), cuv.y),
          this.uBackImageRes,
        ),
        vec3(this.uBackColor),
      );

      // 表裏は frontFacing で確実に判定する（gl_FrontFacing 相当）。
      let col: Node = select(frontFacing, frontCol, backCol);
      // 白縁（表裏共通）
      col = mix(col, vec3(0.96), smoothstep(float(0.47), float(0.475), rr));
      // 巻きの奥だけ控えめに暗く（固定グラデ）
      col = col.mul(vShade);
      // 本体は不透明（縁の自己重なりノイズ回避）
      return vec4(col, 1.0);
    })();
  };
}
