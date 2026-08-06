import { DomSyncGL, TSL } from "dom-sync-gl";
import type { DomTextPlane, PlaneNodeContext, TextStyleOverrides } from "dom-sync-gl";
import type { Node } from "three/webgpu";

const { float, vec3, vec4, min, max, step, mix } = TSL;

// ============================================================================
// DomTextPlane の padding 引き継ぎと verticalAlign の目視確認。
//
// padding は「文字が描かれない領域」なので、板の範囲が見えないと引き継げているか
// 判断できない。そこで板の縁（＝要素の border-box）を shader で 1.5px の枠として
// 描き、CSS 側は background-clip: content-box でコンテンツ領域（padding の内側）
// だけを塗る。枠と塗りの差がそのまま padding として見えるので、文字が塗りの中に
// 収まっていれば引き継ぎが効いている。
//
// スライダーは CSS カスタムプロパティ --pad-* を書き換えるだけで、板側へは
// refreshStyle() で反映する。style オプションで上書きした値（カード 02）は
// refreshStyle() を通しても override が勝つので、スライダーに反応しない。
// ============================================================================

/**
 * 板の縁を枠線として描き、その上にテキストを合成する colorNode。
 * 背景は透明のままにして、DOM 側の content-box 塗りを透かして見せる。
 *
 * @param tint 文字色の上書き。省略時はテクスチャの色（＝CSS の color）をそのまま使う
 */
const cardColorNode =
  (tint?: [number, number, number]) =>
  (ctx: PlaneNodeContext): Node => {
    const { uTexture, uResolution, uv } = ctx;

    // uv を px に戻して縁からの距離を取る。DPR ではなく CSS px 基準なので、
    // 板のサイズが変わっても枠の太さは一定に見える。
    const dx = min(uv.x, float(1).sub(uv.x)).mul(uResolution.x);
    const dy = min(uv.y, float(1).sub(uv.y)).mul(uResolution.y);
    const border = step(min(dx, dy), float(1.5));

    const edgeColor = vec3(0.45, 0.95, 1.0);
    const textColor = tint ? vec3(tint[0], tint[1], tint[2]) : uTexture.rgb;

    // 文字の内側は文字色、それ以外は枠色。アルファは大きい方を採る。
    const rgb = mix(edgeColor, textColor, uTexture.a);
    const alpha = max(uTexture.a, border.mul(0.5));
    return vec4(rgb, alpha);
  };

const app = new DomSyncGL("#gl", {
  // padding を変えると下のカードのレイアウトがずれるので、rect は毎フレーム取り直す。
  scrollSync: { trackStrength: false },
});

interface CardSpec {
  id: string;
  style?: TextStyleOverrides;
  hideElementText?: boolean;
  tint?: [number, number, number];
}

const CARDS: CardSpec[] = [
  // 01: 何も指定しない。CSS の padding がそのまま効く。
  { id: "t-inherit" },
  // 02: padding を 0 に潰す。CSS 側の padding は残るので、板の全面に文字が広がる。
  { id: "t-nopad", style: { padding: 0 } },
  // 03: CSS の align-content: center から verticalAlign が解決される。
  { id: "t-center" },
  // 04: CSS より style の指定が優先されることの確認。
  { id: "t-bottom", style: { verticalAlign: "bottom" } },
  // 05: コンテンツ領域より行数が多い状態。クランプされず上下へ溢れる。
  { id: "t-overflow", style: { verticalAlign: "center" } },
  // 06: DOM の文字を消さずに重ねる。ズレていれば赤と白が分離して見える。
  { id: "t-overlay", hideElementText: false, tint: [1.0, 0.28, 0.32] },
];

const planes = new Map<string, DomTextPlane>();

for (const card of CARDS) {
  const el = document.querySelector<HTMLElement>(`#${card.id}`);
  if (!el) continue;
  planes.set(
    card.id,
    app.createTextPlane(el, {
      updateRectEveryFrame: true,
      colorNode: cardColorNode(card.tint),
      style: card.style,
      hideElementText: card.hideElementText,
    }),
  );
}

// ============================================================================
// スライダー — CSS の値を変えて refreshStyle() で板へ反映する。
// ============================================================================

/**
 * padding 変更は要素サイズを変えるため、ResizeObserver 経由で再ラスタライズは
 * 走る。ただし既定では computed style を読み直さない（getComputedStyle が
 * reflow を招くので resize のたびには走らせない設計）ため、新しい padding を
 * 反映するには refreshStyle() を明示的に呼ぶ必要がある。
 */
const refreshAll = (): void => {
  for (const plane of planes.values()) plane.refreshStyle();
};

const bindPadSlider = (id: string, cssVar: string): void => {
  const input = document.querySelector<HTMLInputElement>(`#${id}`);
  const out = document.querySelector<HTMLOutputElement>(`#${id}-out`);
  if (!input || !out) return;

  input.addEventListener("input", () => {
    const px = `${input.value}px`;
    document.documentElement.style.setProperty(cssVar, px);
    out.textContent = px;
    // CSS 変数の反映はスタイル再計算後なので、次フレームで読み直す。
    requestAnimationFrame(refreshAll);
  });
};

bindPadSlider("pad-block", "--pad-block");
bindPadSlider("pad-inline", "--pad-inline");

// フォント読み込み後にメトリクスが変わるので、確定してからもう一度描き直す。
document.fonts?.ready.then(refreshAll);

if (import.meta.env?.DEV) {
  (window as unknown as { planes: typeof planes }).planes = planes;
}
