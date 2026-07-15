import { DomSyncGL } from "dom-sync-gl";

// ============================================================================
// attach: 'dom' の動作確認。
//   - ライブラリは #bg の position / サイズを一切上書きしない（CSS 側で fixed 全画面）。
//   - canvas は #bg の box サイズ（= viewport）で生成される。
//   - createPlane(null) の全画面背景 plane に GLSL を載せて描く。
// ============================================================================
const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2  uResolution;
  varying vec2  vUv;

  void main() {
    vec2 uv = vUv;
    // アスペクト補正した座標
    vec2 p = (uv - 0.5);
    p.x *= uResolution.x / uResolution.y;

    float t = uTime * 0.4;
    // うねる干渉縞（plasma）で「動いている＝毎フレーム描画されている」ことを可視化する
    float v = 0.0;
    v += sin((p.x * 6.0) + t);
    v += sin((p.y * 6.0 + t) * 1.3);
    v += sin((p.x + p.y) * 5.0 + t * 0.7);
    float r = length(p) * 4.0;
    v += sin(r - t * 1.5);
    v *= 0.25;

    vec3 col = 0.5 + 0.5 * cos(vec3(0.0, 2.0, 4.0) + v * 3.1415 + t * 0.2);
    // 中心をやや明るく
    col *= 1.0 - 0.35 * length(p);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const app = new DomSyncGL("#bg", {
  scrollSync: { attach: "dom" },
});

// 全画面背景 plane（DOM 非ロック）に GLSL を載せる。canvasRect 全面に広がる。
app.createPlane(null, { fragmentShader });

// 動作ログ: 実際に適用された配置と canvas 論理サイズを確認する。
const sync = app.getScrollSync();
const bg = document.querySelector<HTMLElement>("#bg")!;
console.log("[dom-test] #bg scrollSync.attach =", sync?.attach);
console.log("[dom-test] #bg computed position =", getComputedStyle(bg).position);
console.log("[dom-test] #bg logicalRect =", sync?.logicalRect);

// ============================================================================
// ページ途中に「通常の DOM と同じ配置」で置いたケース。
//   - #inline は通常フローの block（fixed でない）。
//   - attach:'dom' なので position は上書きされず、#inline の box サイズ（680×420）で
//     canvas が生成される。canvas はページと一緒に普通にスクロールする。
// ============================================================================
const inlineFragment = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2  uResolution;
  varying vec2  vUv;

  void main() {
    vec2 p = (vUv - 0.5);
    p.x *= uResolution.x / uResolution.y;
    float t = uTime * 0.5;
    // 同心リング。背景(#bg)と見分けるため寒色寄りにする。
    float r = length(p);
    float rings = sin(r * 26.0 - t * 2.0) * 0.5 + 0.5;
    float ang = atan(p.y, p.x);
    rings *= 0.6 + 0.4 * sin(ang * 6.0 + t);
    vec3 col = mix(vec3(0.03, 0.10, 0.18), vec3(0.35, 0.85, 0.95), rings);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const inlineApp = new DomSyncGL("#inline", {
  scrollSync: { attach: "dom" },
});
inlineApp.createPlane(null, { fragmentShader: inlineFragment });

const inlineSync = inlineApp.getScrollSync();
const inlineEl = document.querySelector<HTMLElement>("#inline")!;
console.log("[dom-test] #inline scrollSync.attach =", inlineSync?.attach);
console.log("[dom-test] #inline computed position =", getComputedStyle(inlineEl).position);
console.log("[dom-test] #inline logicalRect =", inlineSync?.logicalRect);
