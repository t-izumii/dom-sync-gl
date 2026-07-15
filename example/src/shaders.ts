// ----------------------------------------------------------------------------
// 共通ノイズ chunk。value noise + 6 オクターブ fbm。水墨のにじみに使う。
// ----------------------------------------------------------------------------
const noise = /* glsl */ `
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 6; i++) {
      v += a * vnoise(p);
      p *= 2.0;
      a *= 0.5;
    }
    return v;
  }
`;

// ----------------------------------------------------------------------------
// ヒーロー背景。selector=null のフルスクリーン plane に貼る。
// 和紙の地の上を、ドメインワープした fbm の雲がゆっくり流れる。マウス周辺に
// やわらかな墨だまりがにじむ（uMouseUV はフルスクリーン plane でも hover 経路で更新される）。
// uTime / uResolution / uMouseUV は DomPlane が自動で更新する。uStrength は手動。
// 全体を淡く保ち、上に乗る墨色のテキストが必ず読めるようにしている。
// ----------------------------------------------------------------------------
export const heroFragment = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2  uResolution;
  uniform vec2  uMouseUV;
  uniform float uStrength;
  varying vec2  vUv;

  ${noise}

  void main() {
    vec2 uv = vUv;
    vec2 p = uv;
    p.x *= uResolution.x / uResolution.y;

    float t = uTime * 0.025;

    // 2 段のドメインワープで雲のにじみを作る
    vec2 q = vec2(fbm(p * 1.3 + t), fbm(p * 1.3 + vec2(3.1, 1.7) - t));
    vec2 r = vec2(
      fbm(p * 1.3 + 2.2 * q + vec2(1.2, 7.4) + 0.10 * t),
      fbm(p * 1.3 + 2.2 * q + vec2(6.1, 2.3) - 0.08 * t)
    );
    float f = fbm(p * 1.3 + 2.2 * r);

    // マウス周辺にやわらかい墨だまり
    float m = smoothstep(0.5, 0.0, distance(uv, uMouseUV));

    vec3 paper = vec3(0.937, 0.925, 0.894); // 和紙の地
    vec3 ink   = vec3(0.60, 0.58, 0.54);    // やわらかい墨グレー
    vec3 shu   = vec3(0.69, 0.29, 0.19);    // 朱（気配だけ）

    // 雲の濃度は淡く保つ（最濃でも paper↔ink の中間どまり）
    float cloud = smoothstep(0.35, 0.95, f);
    vec3 col = mix(paper, ink, cloud * 0.5);

    // マウスでにじみを足す
    col = mix(col, ink, m * 0.18);

    // ごく僅かに朱の気配（局所・雲の濃いところだけ）
    col = mix(col, shu, clamp(pow(length(r), 2.2) * 0.10, 0.0, 1.0) * (0.3 + 0.7 * cloud));

    // スクロール速度で微かに揺らぐ
    col += 0.015 * sin(uTime * 0.5 + uv.y * 7.0) * uStrength;

    // 紙の縁を僅かに沈めるやわらかいビネット（暗くしすぎない）
    col *= 1.0 - 0.10 * length(uv - 0.5);

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ----------------------------------------------------------------------------
// Works のビジュアル。各 DOM 要素にロックされる procedural な板。水墨のトーン。
// uColorA(濃い墨) → uColorB(淡いトーン) を fbm の濃度で混ぜる単色ベースの諧調。
//   uHover   : ホバー量 (0..1, JS 側で lerp)
//   uReveal  : 画面内に入ったときの下からのワイプ (0..~1.2)
//   uStrength: スクロール速度 (0..1)
// ----------------------------------------------------------------------------
export const workFragment = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2  uResolution;
  uniform vec2  uMouseUV;
  uniform float uHover;
  uniform float uReveal;
  uniform float uStrength;
  uniform vec3  uColorA;
  uniform vec3  uColorB;
  uniform float uSeed;
  varying vec2  vUv;

  ${noise}

  void main() {
    vec2 uv = vUv;

    // ホバー時にわずかに寄せて静かな “呼吸” を出す
    vec2 cuv = (uv - 0.5) * (1.0 - 0.05 * uHover) + 0.5;
    vec2 p = cuv * 1.6;
    p.x *= uResolution.x / uResolution.y;

    float t = uTime * 0.06 + uSeed * 10.0;

    // ホバー位置からのやわらかい波紋
    float d = distance(uv, uMouseUV);
    float ripple = sin(d * 14.0 - uTime * 2.2) * 0.5 + 0.5;

    vec2 warp = vec2(fbm(p + t), fbm(p + uSeed - t));
    float n = fbm(p * 1.4 + warp * 1.3 + uHover * ripple * 0.4);

    // 単色ベースの諧調（濃い墨 → 淡いトーン）
    float shade = smoothstep(0.05, 0.95, n);
    vec3 col = mix(uColorA, uColorB, shade);

    // 墨のにじみ筋をほんの少し
    float veins = smoothstep(0.45, 0.5, fbm(p * 2.2 + warp));
    col = mix(col, uColorA, veins * 0.12);

    // ホバーでわずかに持ち上げる
    col = mix(col, col * 1.08 + 0.02, uHover * 0.4);

    // スクロール速度でうっすら流す
    col += uStrength * 0.05;

    // 細かい紙の粒子感
    float g = hash(uv * uResolution.xy + uTime);
    col += (g - 0.5) * 0.025;

    // 下からのリビールワイプ
    float reveal = smoothstep(uv.y, uv.y + 0.16, uReveal * 1.2);

    gl_FragColor = vec4(col, reveal);
  }
`;

// ----------------------------------------------------------------------------
// DomTextPlane 用の plane effect。plane.addEffect() 経由で PlaneComposer に繋がるので、
// tDiffuse には「その板だけを描いたテクスチャ」（＝ラスタライズ済みテキスト）が入る。
// uHover は main 側で lerp した値を setHover() で流し込む。
// 文字の alpha は 3 サンプルの最大値で保ち、色だけを左右にずらして滲みを出す。
// ----------------------------------------------------------------------------
export const textHoverFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform float uHover;
  varying vec2 vUv;

  void main() {
    float off = 0.008 * uHover;
    vec4 r = texture2D(tDiffuse, vUv + vec2(off, 0.0));
    vec4 g = texture2D(tDiffuse, vUv);
    vec4 b = texture2D(tDiffuse, vUv - vec2(off, 0.0));
    float a = max(max(r.a, g.a), b.a);
    gl_FragColor = vec4(r.r, g.g, b.b, a);
  }
`;

// ----------------------------------------------------------------------------
// フルスクリーン post effect。光の地に合わせて極めて控えめに仕上げる。
// スクロール中だけ僅かな色収差、淡いフィルムグレイン、やわらかいビネット。
// （ダーク版の強い収差 / 走査線 / 濃いビネットは紙の地に合わないため外した）
// tDiffuse は EffectPass が自動注入。
// ----------------------------------------------------------------------------
export const filmFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform float uTime;
  uniform vec2  uResolution;
  uniform float uStrength;
  varying vec2  vUv;

  void main() {
    vec2 uv = vUv;
    vec2 dir = uv - 0.5;

    // スクロール中だけ、中心から離れるほど僅かに色収差
    float aberr = (0.0002 + uStrength * 0.004) * dot(dir, dir) * 4.0;
    vec2 off = dir * aberr;
    float r = texture2D(tDiffuse, uv + off).r;
    float g = texture2D(tDiffuse, uv).g;
    float b = texture2D(tDiffuse, uv - off).b;
    vec3 col = vec3(r, g, b);

    // 淡いフィルムグレイン（紙の粒子感）
    float grain = fract(sin(dot(uv * uResolution.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453);
    col += (grain - 0.5) * 0.02;

    // 紙の縁をほんの少し沈めるやわらかいビネット
    col *= 1.0 - 0.10 * dot(dir, dir);

    gl_FragColor = vec4(col, 1.0);
  }
`;
