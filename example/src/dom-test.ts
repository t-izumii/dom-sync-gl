import { DomSyncGL, TSL } from "dom-sync-gl";
import type { PlaneNodeContext } from "dom-sync-gl";
import type { Node } from "three/webgpu";

const { float, vec2, vec3, vec4, sin, cos, length, atan, mix } = TSL;

// ============================================================================
// attach: 'dom' の動作確認。
//   - ライブラリは #bg の position / サイズを一切上書きしない（CSS 側で fixed 全画面）。
//   - canvas は #bg の box サイズ（= viewport）で生成される。
//   - createPlane(null) の全画面背景 plane に TSL の colorNode を載せて描く。
// ============================================================================
const plasmaColorNode = (ctx: PlaneNodeContext): Node => {
  const { uTime, uResolution, uv } = ctx;

  // アスペクト補正した座標
  const centered = uv.sub(0.5);
  const p = vec2(centered.x.mul(uResolution.x.div(uResolution.y)), centered.y);

  const t = uTime.mul(0.4);
  // うねる干渉縞（plasma）で「動いている＝毎フレーム描画されている」ことを可視化する
  let v: Node = sin(p.x.mul(6.0).add(t));
  v = v.add(sin(p.y.mul(6.0).add(t).mul(1.3)));
  v = v.add(sin(p.x.add(p.y).mul(5.0).add(t.mul(0.7))));
  const r = length(p).mul(4.0);
  v = v.add(sin(r.sub(t.mul(1.5))));
  v = v.mul(0.25);

  let col: Node = cos(vec3(0.0, 2.0, 4.0).add(v.mul(3.1415)).add(t.mul(0.2)))
    .mul(0.5)
    .add(0.5);
  // 中心をやや明るく
  col = col.mul(float(1.0).sub(length(p).mul(0.35)));
  return vec4(col, 1.0);
};

const app = new DomSyncGL("#bg", {
  scrollSync: { attach: "dom" },
});

// 全画面背景 plane（DOM 非ロック）に TSL の colorNode を載せる。canvasRect 全面に広がる。
app.createPlane(null, { colorNode: plasmaColorNode });

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
const ringsColorNode = (ctx: PlaneNodeContext): Node => {
  const { uTime, uResolution, uv } = ctx;

  const centered = uv.sub(0.5);
  const p = vec2(centered.x.mul(uResolution.x.div(uResolution.y)), centered.y);
  const t = uTime.mul(0.5);

  // 同心リング。背景(#bg)と見分けるため寒色寄りにする。
  const r = length(p);
  let rings: Node = sin(r.mul(26.0).sub(t.mul(2.0))).mul(0.5).add(0.5);
  const ang = atan(p.y, p.x);
  rings = rings.mul(sin(ang.mul(6.0).add(t)).mul(0.4).add(0.6));
  const col = mix(vec3(0.03, 0.1, 0.18), vec3(0.35, 0.85, 0.95), rings);
  return vec4(col, 1.0);
};

const inlineApp = new DomSyncGL("#inline", {
  scrollSync: { attach: "dom" },
});
inlineApp.createPlane(null, { colorNode: ringsColorNode });

const inlineSync = inlineApp.getScrollSync();
const inlineEl = document.querySelector<HTMLElement>("#inline")!;
console.log("[dom-test] #inline scrollSync.attach =", inlineSync?.attach);
console.log("[dom-test] #inline computed position =", getComputedStyle(inlineEl).position);
console.log("[dom-test] #inline logicalRect =", inlineSync?.logicalRect);
