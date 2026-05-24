// dev: 直接 src を見る。npm 公開後は `import { ... } from "dom-sync-gl"`。
import {
  WebGLApp,
  BaseEffect,
  RafScroll,
  type BaseEffectConfig,
  THREE,
} from "../../src/index";

// ──────────────────────────────────────────────────────────────
// MOBILE TIER — モバイル GPU の負荷を抑える分岐
// ──────────────────────────────────────────────────────────────
//
// CSS @media (max-width: 900px) と breakpoint を揃える。検出基準は viewport 幅。
// 「pointer: coarse」(タッチ主体) を OR で混ぜないのは、tablet 横置きや touch laptop で
// 高解像度なのに低解像度モードに落ちるのを避けるため。
const IS_MOBILE =
  typeof window !== "undefined" &&
  window.matchMedia("(max-width: 900px)").matches;

// fbm のオクターブ数: 5 (desktop) / 3 (mobile)。fragment 全体で 1 px あたり 2 回呼ぶ
// shader も多いので、ここを 5→3 にするだけで GPU 負荷がかなり減る。
const FBM_ITER = IS_MOBILE ? 3 : 5;

// Section 03 の cell 数: 7x7=49 (desktop) / 5x5=25 (mobile)。
// CSS 側で .grid-mouse が mobile 時 5 cols なので 5x5 が割れて綺麗に並ぶ。
const CELL_GRID = IS_MOBILE ? 5 : 7;
const CELL_COUNT = CELL_GRID * CELL_GRID;

// renderer.setPixelRatio の上限。3x 画面で 1.5 にすると (1.5/2)^2 ≈ 56% に描画ピクセル
// が減る。視覚劣化は ~retina 表示ではほぼ気付かないレベル。
const MAX_PIXEL_RATIO = IS_MOBILE ? 1.5 : 2;

// ──────────────────────────────────────────────────────────────
// SHADER LIBRARY
// ──────────────────────────────────────────────────────────────
//
// 全 fragment shader は `${LIB}` を 1 度だけ展開して使う。LIB は次の 3 ブロック:
//
//   1. PALETTE  — index.html の :root --bg / --ink / --accent と同じ印刷インク色
//   2. NOISE    — hash21 / vnoise / fbm / rot (毎 shader で再宣言しない)
//   3. REVEAL   — uProgress 駆動の ink-bleed マスクと applyReveal() ヘルパー
//
// reveal は旧版の vertex curl + 多段 clamp ではなく、fragment の alpha で描く。
// renderer が `alpha: true` なので、alpha=0 の領域は body の paper 色がそのまま透けて、
// 「インクが紙に滲んで現れる」見え方になる。vertex は default passthrough のまま。

const PALETTE = /* glsl */ `
  // 数値は index.html の --bg/--ink/--accent と一致。sRGB 直書き (現プロジェクト前提)。
  const vec3 PAPER  = vec3(0.925, 0.890, 0.812);
  const vec3 PAPRD  = vec3(0.867, 0.812, 0.694);
  const vec3 SAND   = vec3(0.792, 0.706, 0.518);
  const vec3 INK    = vec3(0.102, 0.086, 0.071);
  const vec3 INKSF  = vec3(0.302, 0.271, 0.212);
  const vec3 OXIDE  = vec3(0.757, 0.227, 0.106);
  const vec3 OXSFT  = vec3(0.855, 0.447, 0.318);
  const vec3 MOSS   = vec3(0.290, 0.349, 0.220);
  const vec3 FOIL   = vec3(0.870, 0.700, 0.420);
`;

const NOISE = /* glsl */ `
  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i),                  hash21(i + vec2(1.0, 0.0)), f.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < ${FBM_ITER}; i++) {
      v += a * vnoise(p);
      p = p * 2.03 + 7.0;
      a *= 0.5;
    }
    return v;
  }
  mat2 rot(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
  }
`;

// uProgress: 0=完全に隠れ / 1=完全表示。中間で uRevealOrigin から「染み」が広がる。
// applyReveal() は alpha を含む vec4 を返すので shader 末尾でそのまま gl_FragColor に。
const REVEAL = /* glsl */ `
  uniform float uProgress;
  uniform vec2  uRevealOrigin;

  float revealMask(vec2 uv) {
    vec2 d = abs(uv - uRevealOrigin);
    float t = (d.x + d.y) * 0.5;             // 0..1 の sweep スカラ
    // 大局の繊維 + 細かいパルプ斑で縁を割る
    float n = fbm(uv * 4.0) * 0.18 + fbm(uv * 18.0) * 0.05;
    float w = 0.16;
    return 1.0 - smoothstep(uProgress - w, uProgress + w, t - n);
  }

  vec4 applyReveal(vec3 col, vec2 uv) {
    float m = revealMask(uv);
    // 縁の inkring: m が 0.0→0.4 立ち上がりで oxide のにじみを残す
    float ring = smoothstep(0.0, 0.35, m) * smoothstep(1.0, 0.55, m);
    col = mix(col, OXIDE * 0.55 + col * 0.45, ring * 0.30);
    return vec4(col, m);
  }
`;

const LIB = PALETTE + NOISE + REVEAL;

// 共通プロローグ: 全 fragment shader の varying/uniform 宣言と LIB を 1 まとめに。
const PROLOGUE = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2  uMouseUV;
  uniform bool  uIsHovered;
  uniform vec2  uResolution;
  ${LIB}
`;

// ──────────────────────────────────────────────────────────────
// FRAGMENT SHADERS (cohesive, palette-locked)
// ──────────────────────────────────────────────────────────────

// hero: 紙にゆっくり広がる大きなインクのにじみ。マウスで微かに重心が動く。
// この plane は document 全幅・全高 (8000px 級) を覆う背景なので、空間 sweep の
// reveal は使わない。uProgress を「全体の存在感」スカラとして alpha+輝度に直接掛ける
// シンプルな fade-in にする (空間 reveal は DOM-locked plane 側だけで使う)。
const heroShader = /* glsl */ `
  ${PROLOGUE}
  uniform vec2 uMouse;     // global 0..1 (hero は DOM 要素を持たないので uMouseUV ではなく)
  void main() {
    vec2 uv = vUv;
    vec2 m  = (uMouse - 0.5) * 0.25;
    // p は uv.x はそのまま、uv.y は緩く伸ばす (document 全高で fbm の周期が間延びしすぎないように)
    vec2 p  = vec2(uv.x * 1.6, uv.y * 4.0) + uTime * 0.018;
    // 2 段 warp の柔らかい大局ノイズ
    vec2 w  = vec2(fbm(p + 11.0), fbm(p - 4.0));
    float f = fbm(p + w * 0.9 + m);
    // 紙 → 砂 → 鉄錆 の 3 段グラデ (INK までは行かせない / 暗くなりすぎ防止)
    vec3 col = mix(PAPER, SAND, smoothstep(0.34, 0.62, f));
    col = mix(col, OXIDE * 0.85 + SAND * 0.15, smoothstep(0.72, 0.88, f) * 0.55);
    // 紙の繊維 grain
    col += (hash21(uv * 1100.0) - 0.5) * 0.012;
    // x 方向にだけ周辺光量落ち (y は document 全高なので vignette すると下が真っ黒に)
    float ex = abs(uv.x - 0.5);
    col *= 1.0 - ex * 0.25;
    // PAPER とのブレンドで「インクが紙に乗る」量を uProgress でコントロール
    // (alpha は常に 1: hero は背景なので body bg を透かす必要がない)
    vec3 blended = mix(PAPER, col, uProgress * 0.85);
    gl_FragColor = vec4(blended, 1.0);
  }
`;

// mercury: hot-foil stamp。fbm の height から normal を起こして Lambert + spec。
// マウス位置を光源にすると、銀箔が傾いて反射するように見える。
const mercuryShader = /* glsl */ `
  ${PROLOGUE}
  void main() {
    vec2 uv = vUv;
    float t = uTime * 0.06;

    // height field と数値微分
    float eps = 0.004;
    float h  = fbm(uv * 3.2 + t);
    float hx = fbm((uv + vec2(eps, 0.0)) * 3.2 + t);
    float hy = fbm((uv + vec2(0.0, eps)) * 3.2 + t);
    vec3 N = normalize(vec3((h - hx) * 18.0, (h - hy) * 18.0, 1.0));

    // 光源: hover 時はマウス、それ以外はゆるく回るデフォルト位置
    vec2 lightUV = uIsHovered
      ? uMouseUV
      : vec2(0.5) + vec2(cos(uTime * 0.18), sin(uTime * 0.18)) * 0.3;
    vec3 L = normalize(vec3(lightUV - vec2(0.5), 0.55));
    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 H = normalize(L + V);

    float diff = max(dot(N, L), 0.0);
    float spec = pow(max(dot(N, H), 0.0), 28.0);

    // 箔のベース色: 谷=ink、山=foil
    vec3 base = mix(INK, FOIL, smoothstep(0.35, 0.7, h));
    vec3 col = base * (0.35 + 0.85 * diff) + vec3(spec) * 0.9;

    // ふくらみに oxide のニュアンス (iridescence)
    float iris = 0.5 + 0.5 * sin(h * 9.0 + uTime * 0.4);
    col = mix(col, mix(OXSFT, FOIL, iris), iris * 0.18);

    // hover で熱を加える
    if (uIsHovered) {
      float d = distance(uv, uMouseUV);
      col += OXIDE * smoothstep(0.45, 0.0, d) * 0.35;
    }

    gl_FragColor = applyReveal(col, uv);
  }
`;

// thermal → "contour": 地形図のような等高線。fbm の高さを N 段で帯化し、
// fwidth で太さを画面解像度に合わせて常に 1px に。エイリアスなし。
const thermalShader = /* glsl */ `
  ${PROLOGUE}
  void main() {
    vec2 uv = vUv;
    vec2 p  = uv * 3.4 + uTime * 0.04;
    float h = fbm(p);

    // 等高線: 0.0..1.0 を 12 段。バンド位置に対する距離を fwidth で AA。
    float bands = 12.0;
    float scaled = h * bands;
    float d = abs(fract(scaled) - 0.5);
    float lineW = fwidth(scaled) * 1.2;
    float line = 1.0 - smoothstep(0.0, lineW, d - 0.40);

    // 高度塗り: paper → sand → oxide
    vec3 fill = mix(PAPER, SAND, smoothstep(0.30, 0.62, h));
    fill = mix(fill, OXSFT, smoothstep(0.68, 0.86, h) * 0.55);
    vec3 col = mix(fill, INK, line * 0.78);

    // 標高 80% 以上は accent inked
    col = mix(col, OXIDE, smoothstep(0.85, 0.95, h) * 0.4);

    gl_FragColor = applyReveal(col, uv);
  }
`;

// aurora → "current": 流れる油彩のリボン。warp を 2 段かけて方向感を作り、
// 横筋 (絹目) で繊維感を添える。空ではなく "紙の上の絵の具" 感に振る。
const auroraShader = /* glsl */ `
  ${PROLOGUE}
  void main() {
    vec2 uv = vUv;
    float t = uTime * 0.08;

    // 縦に流れる p、x には sin curl で蛇行
    vec2 p = uv * vec2(1.4, 2.2);
    p.x += sin(p.y * 1.8 + t * 2.4) * 0.18;
    p.y -= t;

    // 2 段 warp
    vec2 w1 = vec2(fbm(p * 0.7), fbm(p * 0.7 + 9.0));
    vec2 w2 = vec2(
      fbm(p * 1.3 + w1 * 1.6 + t),
      fbm(p * 1.3 + w1 * 1.6 - t + 13.0)
    );
    float n = fbm(p + w2 * 1.8);

    // 横方向の絹目
    float silk = sin(uv.y * 90.0 + w2.x * 6.0) * 0.5 + 0.5;
    n = mix(n, n * (0.7 + 0.6 * silk), 0.25);

    // 上=ink/oxide、下=sand/paper の 4 段グラデ
    vec3 col = mix(PAPER, SAND,  smoothstep(0.22, 0.55, n));
    col = mix(col, OXIDE, smoothstep(0.55, 0.78, n) * 0.85);
    col = mix(col, INK,   smoothstep(0.82, 0.95, n) * 0.55);

    // 紙のスペック
    col += (hash21(uv * 950.0 + uTime) - 0.5) * 0.016;

    gl_FragColor = applyReveal(col, uv);
  }
`;

// dither: 4x4 Bayer 順序ディザで fbm を ink-on-paper 2 値化。印刷っぽい解像感。
// 影響: gl_FragCoord を使うので element resize で再サンプル位置が変わる。
const ditherShader = /* glsl */ `
  ${PROLOGUE}
  float bayer4(vec2 fc) {
    int x = int(mod(fc.x, 4.0));
    int y = int(mod(fc.y, 4.0));
    int idx = y * 4 + x;
    // 4x4 Bayer: 値は 0..15
    int v = 0;
    if      (idx == 0)  v = 0;   else if (idx == 1)  v = 8;
    else if (idx == 2)  v = 2;   else if (idx == 3)  v = 10;
    else if (idx == 4)  v = 12;  else if (idx == 5)  v = 4;
    else if (idx == 6)  v = 14;  else if (idx == 7)  v = 6;
    else if (idx == 8)  v = 3;   else if (idx == 9)  v = 11;
    else if (idx == 10) v = 1;   else if (idx == 11) v = 9;
    else if (idx == 12) v = 15;  else if (idx == 13) v = 7;
    else if (idx == 14) v = 13;  else                v = 5;
    return (float(v) + 0.5) / 16.0;
  }
  void main() {
    vec2 uv = vUv;
    // ソース濃度
    vec2 q = vec2(fbm(uv * 2.4 + uTime * 0.08), fbm(uv * 2.4 - uTime * 0.05 + 5.0));
    float h = fbm(uv * 3.6 + q * 1.3);
    h = mix(h, 1.0 - uv.y, 0.20);          // 上=明、下=暗 の緩い勾配
    h = pow(h, 1.25);

    // Bayer しきい値で 3 値化 (paper / sand / ink)
    float bay = bayer4(gl_FragCoord.xy);
    vec3 col;
    if (h < 0.32 + bay * 0.25)      col = PAPER;
    else if (h < 0.62 + bay * 0.25) col = SAND;
    else                            col = INK;

    // たまに oxide ペック (印刷ムラ)
    float speck = step(0.985, hash21(floor(gl_FragCoord.xy * 0.18)));
    col = mix(col, OXIDE, speck * 0.6);

    gl_FragColor = applyReveal(col, uv);
  }
`;

// oxide: 銅板のパティナ。oxide ↔ moss ↔ ink の 3 色のみで「酸化した金属」。
const oxideShader = /* glsl */ `
  ${PROLOGUE}
  void main() {
    vec2 uv = vUv;
    float t = uTime * 0.025;
    float base    = fbm(uv * 3.2 + t);
    float patches = fbm(uv * 6.0 - base * 1.4);

    vec3 col = mix(OXIDE, OXSFT, smoothstep(0.25, 0.55, base));
    col = mix(col, MOSS, smoothstep(0.45, 0.7, patches));
    col = mix(col, INK,  smoothstep(0.78, 0.92, patches) * 0.85);

    // ハイライトのこぼれ
    col += FOIL * smoothstep(0.85, 0.98, base) * 0.18;

    gl_FragColor = applyReveal(col, uv);
  }
`;

// chrome → "iris": 油膜の薄膜干渉。彩度を抑えて palette に寄せる。
const chromeShader = /* glsl */ `
  ${PROLOGUE}
  void main() {
    vec2 uv = vUv;
    vec2 c = uv - 0.5;
    float r = length(c) * 2.0;
    float a = atan(c.y, c.x);

    // 干渉位相: 距離 + 時間 + 角度
    float phase = r * 14.0 + uTime * 0.5 + sin(a * 3.0 + uTime * 0.2) * 1.2;
    // ニュートン環ふうの 3 波 (sand/oxide/ink にバンド)
    float w1 = 0.5 + 0.5 * sin(phase);
    float w2 = 0.5 + 0.5 * sin(phase + 2.094);  // 120deg
    float w3 = 0.5 + 0.5 * sin(phase + 4.188);  // 240deg

    vec3 col = SAND  * w1
             + OXSFT * w2
             + INKSF * w3;
    col = col / max(w1 + w2 + w3, 0.001);

    // 中心ハイライト
    col += FOIL * smoothstep(0.4, 0.0, r) * 0.25;

    gl_FragColor = applyReveal(col, uv);
  }
`;

// moire: 2 枚の回転格子の干渉。fwidth で常に細い線にして強烈なエイリアスを回避。
const moireShader = /* glsl */ `
  ${PROLOGUE}
  // AA-line: 周期 1.0 で中心からの距離を返し fwidth で AA
  float gridLine(vec2 p, float freq) {
    vec2 g = abs(fract(p * freq) - 0.5);
    float d = min(g.x, g.y);
    float w = fwidth(d) * 1.2;
    return 1.0 - smoothstep(0.0, w, d - 0.02);
  }
  void main() {
    vec2 uv = vUv;
    vec2 c = uv - 0.5;
    float t = uTime * 0.03;

    float g1 = gridLine(rot(t)        * c, 18.0);
    float g2 = gridLine(rot(t + 0.18) * c, 19.5);
    float m  = max(g1, g2);

    // overlap (両方の格子が重なった場所) を強調
    float overlap = g1 * g2;

    vec3 col = mix(PAPER, INK, m * 0.75);
    col = mix(col, OXIDE, overlap);
    gl_FragColor = applyReveal(col, uv);
  }
`;

// cell (section 03): index ごとに 6 種の sub-pattern を切替。色は palette 固定。
// hover で oxide bloom。global mouse は seed として全 cell の位相を波打たせる。
const cellShader = /* glsl */ `
  ${PROLOGUE}
  uniform float uIndex;
  uniform vec2  uGlobalMouse;   // 0..1 全体マウス位置
  uniform vec2  uGridXY;        // CELL_GRID × CELL_GRID の位置 (0..CELL_GRID-1)

  // 6 種パターン: 全部 [0,1] の濃度を返す。
  // 0=ink fbm patches / 1=h-hatch / 2=diagonal stripes
  // 3=concentric rings / 4=dot grid / 5=cross-hatch
  float pattern(int kind, vec2 uv, float seed) {
    if (kind == 0) {
      return fbm(uv * 2.5 + seed);
    } else if (kind == 1) {
      return 0.5 + 0.5 * sin(uv.y * 28.0 + seed * 6.28);
    } else if (kind == 2) {
      vec2 r = rot(0.785) * (uv - 0.5);
      return 0.5 + 0.5 * sin(r.x * 36.0 + seed * 6.28);
    } else if (kind == 3) {
      float d = length(uv - 0.5);
      return 0.5 + 0.5 * sin(d * 38.0 - seed * 4.0);
    } else if (kind == 4) {
      vec2 g = fract(uv * 6.0) - 0.5;
      float dot = 1.0 - smoothstep(0.16, 0.20, length(g));
      return dot;
    } else {
      vec2 a = abs(fract(uv * 8.0) - 0.5);
      return 1.0 - smoothstep(0.06, 0.10, min(a.x, a.y));
    }
  }

  void main() {
    vec2 uv = vUv;
    int kind = int(mod(uIndex, 6.0));
    float seed = uIndex * 0.137;

    // 全 cell に共通する波: 自分のグリッド位置と global mouse 距離で位相を変える。
    vec2 myPos = (uGridXY + 0.5) / ${CELL_GRID.toFixed(1)};
    float dToMouse = distance(myPos, uGlobalMouse);
    float wave = 0.5 + 0.5 * sin(uTime * 1.6 - dToMouse * 6.0 + seed * 6.28);

    float p = pattern(kind, uv, seed + wave * 0.4);

    // 背景は paper、線/点が ink、波で sand と混ぜる
    vec3 col = mix(PAPER, SAND, wave * 0.55);
    col = mix(col, INK, p * 0.78);

    // hover: マウス位置から oxide bloom
    if (uIsHovered) {
      float d = distance(uv, uMouseUV);
      col = mix(col, OXIDE, smoothstep(0.45, 0.0, d) * 0.85);
      // 縁ハイライト
      col += FOIL * smoothstep(0.6, 0.0, d) * 0.12;
    }

    gl_FragColor = applyReveal(col, uv);
  }
`;

// rift (section 04): curl-noise streamline。マウスで渦を足す。
// 流速の速い箇所に foil の筋を引いて「ink の動脈」っぽく。
const riftShader = /* glsl */ `
  ${PROLOGUE}
  void main() {
    vec2 uv = vUv;
    vec2 m  = uIsHovered ? uMouseUV : vec2(0.5);
    vec2 toM = uv - m;
    float dM = length(toM);
    float t  = uTime * 0.08;

    // 2D curl noise 近似: 中央差分で scalar fbm の勾配を取り 90 度回転
    float eps = 0.012;
    vec2 grad = vec2(
      fbm((uv + vec2(eps, 0.0)) * 3.0 + t) - fbm((uv - vec2(eps, 0.0)) * 3.0 + t),
      fbm((uv + vec2(0.0, eps)) * 3.0 + t) - fbm((uv - vec2(0.0, eps)) * 3.0 + t)
    ) / (2.0 * eps);
    vec2 curl = vec2(grad.y, -grad.x);

    // hover で渦 (反比例の tangent field、半径下限付き)
    if (uIsHovered) {
      vec2 tangent = vec2(-toM.y, toM.x);
      curl += tangent / max(dM * dM + 0.04, 0.04) * 0.18;
    }

    // 流された UV で本体ノイズ
    vec2 flowed = uv + curl * 0.04;
    vec2 q = vec2(fbm(flowed * 2.2 + t * 0.4), fbm(flowed * 2.2 - t * 0.5 + 9.0));
    float n = fbm(flowed * 3.0 + q * 1.5);

    vec3 col = mix(PAPER, SAND, smoothstep(0.30, 0.55, n));
    col = mix(col, OXIDE, smoothstep(0.55, 0.78, n) * 0.85);
    col = mix(col, INK,   smoothstep(0.82, 0.95, n) * 0.55);

    // 流速の速い箇所に foil ストリーク
    float speed = length(curl);
    float streak = pow(0.5 + 0.5 * sin(uv.y * 22.0 - uv.x * 18.0 + n * 8.0 - t * 4.0), 6.0);
    col = mix(col, FOIL, streak * smoothstep(0.8, 4.0, speed) * 0.45);

    // hover ホット & 渦の眼
    if (uIsHovered) {
      col += OXIDE * smoothstep(0.5, 0.0, dM) * 0.45;
      col += FOIL  * smoothstep(0.06, 0.0, dM) * 0.7;
    }

    // 四隅落とし
    vec2 e = abs(uv - 0.5) * 2.0;
    col *= mix(1.0, 0.55, smoothstep(0.85, 1.0, max(e.x, e.y)));

    gl_FragColor = applyReveal(col, uv);
  }
`;

// ──────────────────────────────────────────────────────────────
// SETUP
// ──────────────────────────────────────────────────────────────

// RafScroll: native scroll を JS rAF tick に集約。これが無いと scene 原点固定の
// fullscreen plane が paint と rAF の scroll Δ でカタつく。
const rafScroll = new RafScroll();
void rafScroll;

const webgl = new WebGLApp("#canvas", {
  scrollSync: true,
  showGUI: false,
  showStats: false,
  maxPixelRatio: MAX_PIXEL_RATIO,
});

// 全 plane で共通の reveal uniforms を作る関数
// uRevealOrigin を per-plane で振ることで「左下から」「右上から」など bleed 方向を変える
type RevealOrigin = "BL" | "BR" | "TL" | "TR" | "C";
const ORIGIN: Record<RevealOrigin, [number, number]> = {
  BL: [0, 0],
  BR: [1, 0],
  TL: [0, 1],
  TR: [1, 1],
  C:  [0.5, 0.5],
};

function revealUniforms(origin: RevealOrigin) {
  const [x, y] = ORIGIN[origin];
  return {
    uProgress:     { value: 0 },
    uRevealOrigin: { value: new THREE.Vector2(x, y) },
  };
}

// hero: 画面全体に常駐する背景プレーン (DOM 要素なし → uMouseUV ではなく自前 uMouse)
const heroMouse = new THREE.Vector2(0.5, 0.5);
const heroPlane = webgl.createPlane(null, {
  uniforms: {
    ...revealUniforms("BL"),
    uMouse: { value: heroMouse },
  },
  fragmentShader: heroShader,
});

// Section 03 の cell を生成 (desktop: 7x7=49 / mobile: 5x5=25)
const gridMouse = document.querySelector<HTMLElement>(".grid-mouse")!;
for (let i = 0; i < CELL_COUNT; i++) {
  const fig = document.createElement("figure");
  fig.className = "plane";
  fig.dataset.variant = "cell";
  fig.dataset.cellIndex = String(i);
  gridMouse.appendChild(fig);
}

// variant ↔ fragment shader ↔ reveal 方向 のマップ
const SHADER_MAP: Record<string, { shader: string; origin: RevealOrigin }> = {
  mercury: { shader: mercuryShader, origin: "BL" },
  thermal: { shader: thermalShader, origin: "BR" },
  aurora:  { shader: auroraShader,  origin: "BL" },
  dither:  { shader: ditherShader,  origin: "TR" },
  oxide:   { shader: oxideShader,   origin: "TL" },
  chrome:  { shader: chromeShader,  origin: "C"  },
  moire:   { shader: moireShader,   origin: "BR" },
  cell:    { shader: cellShader,    origin: "C"  },
  rift:    { shader: riftShader,    origin: "BL" },
};

// CSS reveal (translate) で host が動く plane だけ毎フレ bbox 取り直し。
// data-reveal が付くものは reveal 中に opacity tween で動くので updateRectEveryFrame ON。
const isHostAnimated = (el: HTMLElement): boolean =>
  el.hasAttribute("data-reveal") || el.closest("[data-reveal]") !== null;

type DomPlaneType = ReturnType<typeof webgl.createPlane>;
const elToPlane = new Map<HTMLElement, DomPlaneType>();

// 全プレーンを生成
document.querySelectorAll<HTMLElement>("[data-variant]").forEach((el) => {
  const variant = el.dataset.variant ?? "thermal";
  const entry = SHADER_MAP[variant] ?? SHADER_MAP.thermal;

  const idx = parseFloat(el.dataset.cellIndex ?? "0");

  // cell 専用 uniforms (uIndex / uGridXY / uGlobalMouse)
  const extra: Record<string, THREE.IUniform> =
    variant === "cell"
      ? {
          uIndex:       { value: idx },
          uGridXY:      { value: new THREE.Vector2(idx % CELL_GRID, Math.floor(idx / CELL_GRID)) },
          uGlobalMouse: { value: new THREE.Vector2(0.5, 0.5) },
        }
      : {};

  const plane = webgl.createPlane(el, {
    updateRectEveryFrame: isHostAnimated(el),
    uniforms: {
      ...revealUniforms(entry.origin),
      ...extra,
    },
    fragmentShader: entry.shader,
  });
  elToPlane.set(el, plane);
});

// 毎フレ: uTime / hero uMouse / cell uGlobalMouse を一括更新
const cellPlanes: DomPlaneType[] = [];
document.querySelectorAll<HTMLElement>('[data-variant="cell"]').forEach((el) => {
  const p = elToPlane.get(el);
  if (p) cellPlanes.push(p);
});

webgl.addUpdateCallback(() => {
  const m = webgl.getMouse();
  heroMouse.copy(m);
  for (const cp of cellPlanes) {
    (cp.material.uniforms.uGlobalMouse.value as THREE.Vector2).copy(m);
  }
});

// ──────────────────────────────────────────────────────────────
// POST EFFECT: PaperEffect — 暖色グレード + 微 chromatic aberration + vignette
// ──────────────────────────────────────────────────────────────

class PaperEffect extends BaseEffect {
  protected getConfig(): BaseEffectConfig {
    // mobile では chromatic aberration を OFF (3 texture lookup → 1 で fragment 重量を 1/3)
    const sample = IS_MOBILE
      ? /* glsl */ `
          vec4 src = texture2D(tDiffuse, uv);
          vec3 col = src.rgb;
          float a = src.a;
        `
      : /* glsl */ `
          vec2 off = (uv - 0.5) * 0.0028;
          float r = texture2D(tDiffuse, uv - off).r;
          float g = texture2D(tDiffuse, uv).g;
          float b = texture2D(tDiffuse, uv + off).b;
          float a = texture2D(tDiffuse, uv).a;
          vec3 col = vec3(r, g, b);
        `;
    return {
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D tDiffuse;
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          vec2 uv = vUv;

          ${sample}

          // 暖色グレード
          col.r += 0.015;
          col.b -= 0.010;

          // ヴィネット
          float d = distance(uv, vec2(0.5));
          col *= smoothstep(1.05, 0.28, d * 1.25);

          gl_FragColor = vec4(col, a);
        }
      `,
      uniforms: { uTime: { value: 0 } },
    };
  }
  update(time: number): void {
    this.setUniform("uTime", time);
  }
}
webgl.addEffect(new PaperEffect());

// ──────────────────────────────────────────────────────────────
// REVEAL TWEEN: uProgress 0 → 1 を ease-out cubic で駆動
// ──────────────────────────────────────────────────────────────

type RevealTween = { plane: DomPlaneType; start: number; duration: number };
const tweens: RevealTween[] = [];

function startReveal(plane: DomPlaneType, delayMs = 0, duration = 1500): void {
  // 同一 plane の走行中 tween を上書き
  for (let i = tweens.length - 1; i >= 0; i--) {
    if (tweens[i].plane === plane) tweens.splice(i, 1);
  }
  tweens.push({ plane, start: performance.now() + delayMs, duration });
}

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

webgl.addUpdateCallback(() => {
  const now = performance.now();
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    const linearT = (now - tw.start) / tw.duration;
    if (linearT < 0) continue;
    const u = tw.plane.material.uniforms.uProgress;
    if (linearT >= 1) {
      u.value = 1;
      tweens.splice(i, 1);
    } else {
      u.value = easeOutCubic(linearT);
    }
  }
});

// hero: 即時開始 (page opener)
startReveal(heroPlane, 80, 2000);

// ──────────────────────────────────────────────────────────────
// IntersectionObserver: DOM fade + GLSL ink-bleed reveal を同時発火
// ──────────────────────────────────────────────────────────────

const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target as HTMLElement;
      el.classList.add("in");

      // この data-reveal element 配下 (本人含む) の plane を全部 unfurl
      const planeEls: HTMLElement[] = [];
      if (el.hasAttribute("data-variant")) planeEls.push(el);
      planeEls.push(
        ...Array.from(el.querySelectorAll<HTMLElement>("[data-variant]")),
      );

      planeEls.forEach((pe) => {
        const plane = elToPlane.get(pe);
        if (!plane) return;
        const idx = parseFloat(pe.dataset.cellIndex ?? "0");
        // 49 cell は 2D 波状 stagger (中央から外側)
        const isCell = pe.dataset.variant === "cell";
        let stagger: number;
        let duration: number;
        if (isCell) {
          const gx = idx % CELL_GRID;
          const gy = Math.floor(idx / CELL_GRID);
          const center = (CELL_GRID - 1) / 2;
          const dx = gx - center;
          const dy = gy - center;
          const r = Math.sqrt(dx * dx + dy * dy);
          stagger = r * 70;             // 中央 0ms → 角 ~300ms (mobile は 5x5 で短め)
          duration = 1100;
        } else {
          stagger = idx * 60;
          duration = 1400;
        }
        startReveal(plane, stagger, duration);
      });

      io.unobserve(el);
    }
  },
  { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
);
document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));

// ──────────────────────────────────────────────────────────────
// HUD: mouse / scroll readout & footer clock
// ──────────────────────────────────────────────────────────────

const mxEl = document.getElementById("mx")!;
const myEl = document.getElementById("my")!;
const syEl = document.getElementById("sy")!;
webgl.addUpdateCallback(() => {
  const m = webgl.getMouse();
  mxEl.textContent = m.x.toFixed(3);
  myEl.textContent = m.y.toFixed(3);
  syEl.textContent = String(Math.round(window.scrollY));
});

const timeEl = document.getElementById("time");
if (timeEl) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const tick = () => {
    const d = new Date();
    timeEl.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  tick();
  setInterval(tick, 1000);
}

// hero テキストは IO を待たず即 fade-in
requestAnimationFrame(() => {
  document
    .querySelectorAll(".hero [data-reveal]")
    .forEach((el) => el.classList.add("in"));
});
