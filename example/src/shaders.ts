// ----------------------------------------------------------------------------
// 共通ノイズ chunk。value noise + 6 オクターブ fbm。
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
// ドメインワープした fbm で流れる星雲。マウスで局所的に明るくなる。
// uTime / uResolution / uMouseUV は DomPlane が自動で更新する。uStrength は手動。
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

    float t = uTime * 0.04;

    // 2 段のドメインワープ
    vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t));
    vec2 r = vec2(
      fbm(p + 3.5 * q + vec2(1.7, 9.2) + 0.15 * t),
      fbm(p + 3.5 * q + vec2(8.3, 2.8) - 0.12 * t)
    );
    float f = fbm(p + 3.5 * r);

    // マウス周辺を持ち上げる
    float m = smoothstep(0.55, 0.0, distance(uv, uMouseUV));
    f += m * 0.25;

    vec3 c1 = vec3(0.012, 0.012, 0.018); // ほぼ黒
    vec3 c2 = vec3(0.16, 0.04, 0.26);    // 紫
    vec3 c3 = vec3(0.72, 0.27, 0.13);    // 琥珀（控えめ）

    vec3 col = mix(c1, c2, clamp(f * f * 1.8, 0.0, 1.0));
    // 琥珀は局所的にだけ出す（全面がピンクに寄らないよう pow で締める）
    col = mix(col, c3, clamp(pow(length(r), 1.6) * 0.42, 0.0, 1.0));

    // スクロール速度でわずかに脈動
    col += 0.04 * sin(uTime * 0.6 + uv.y * 9.0) * uStrength;

    // ビネット + 全体を沈める
    col *= 1.0 - 0.55 * length(uv - 0.5);
    col *= 0.82;

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ----------------------------------------------------------------------------
// Works のビジュアル。各 DOM 要素にロックされる procedural な板。
// uColorA/uColorB/uSeed で個体差を、uHover/uReveal/uStrength で状態を表す。
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

    // ホバー時に中心へ寄せて “ズーム” 感を出す
    vec2 cuv = (uv - 0.5) * (1.0 - 0.08 * uHover) + 0.5;

    vec2 p = cuv * 2.0 - 1.0;
    p.x *= uResolution.x / uResolution.y;

    float t = uTime * 0.12 + uSeed * 12.0;

    // ホバー位置から広がる波紋
    float d = distance(uv, uMouseUV);
    float ripple = sin(d * 16.0 - uTime * 3.0) * 0.5 + 0.5;

    vec2 warp = vec2(fbm(p * 1.4 + t), fbm(p * 1.4 - t + uSeed));
    float n = fbm(p * 2.0 + warp * 1.6 + uHover * ripple * 0.7);

    float bands = sin((n * 4.0 + cuv.y * 3.0 - uTime * 0.3) * 3.14159);
    float shade = smoothstep(-0.15, 0.85, n);

    vec3 col = mix(uColorA, uColorB, shade);
    col += bands * 0.06 * (0.5 + uHover);

    // スクロール速度で色味を流す
    col += uStrength * 0.18 * vec3(0.25, 0.12, 0.35);

    // ホバーで持ち上げる
    col = mix(col, col * 1.45 + 0.08, uHover * 0.55);

    // 下からのリビールワイプ
    float reveal = smoothstep(uv.y, uv.y + 0.18, uReveal * 1.2);

    // 粒状感
    float g = hash(uv * uResolution.xy + uTime);
    col += (g - 0.5) * 0.05;

    gl_FragColor = vec4(col, reveal);
  }
`;

// ----------------------------------------------------------------------------
// フルスクリーン post effect。色収差 + フィルムグレイン + ビネット + 走査線。
// 収差はスクロール速度 (uStrength) でブーストする。
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

    // 中心から離れるほど強い色収差。スクロール中はさらに強調。
    float aberr = (0.0012 + uStrength * 0.012) * dot(dir, dir) * 4.0;
    vec2 off = dir * aberr;

    float r = texture2D(tDiffuse, uv + off).r;
    float g = texture2D(tDiffuse, uv).g;
    float b = texture2D(tDiffuse, uv - off).b;
    vec3 col = vec3(r, g, b);

    // グレイン
    float grain = fract(sin(dot(uv * uResolution.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453);
    col += (grain - 0.5) * 0.045;

    // ビネット
    col *= 1.0 - 0.28 * dot(dir, dir);

    // 走査線
    col *= 1.0 - 0.025 * sin(uv.y * uResolution.y * 1.4);

    gl_FragColor = vec4(col, 1.0);
  }
`;
