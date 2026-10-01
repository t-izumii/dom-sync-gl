/**
 * 環境フラグと、サイト全体で共有する小さな数値ユーティリティ。
 * 端末やユーザー設定による分岐はここに集め、各モジュールは読むだけにする。
 */

// 動きの抑制は途中で切り替わりうるので MediaQueryList ごと公開し、
// 各モジュールは matches を都度読むか change を購読する。
export const reducedMotionQuery = matchMedia("(prefers-reduced-motion: reduce)");

// 自前カーソルやホバー演出は「ホバーできる精密なポインタ」がある時だけ使う。
export const FINE_POINTER = matchMedia("(hover: hover) and (pointer: fine)").matches;

// タッチ主体の端末。シェーダーのオクターブ数と DPR 上限を下げる。
export const COARSE = matchMedia("(pointer: coarse)").matches;

// 全画面シェーダー + 仕上げパスが乗るので、ノート PC の Retina でも 60fps を
// 保てるよう DPR は 2 まで上げない。
export const MAX_DPR = COARSE ? 1.5 : 1.75;

// fbm のオクターブ数。フラグメントの負荷はほぼこれに比例する。
export const OCTAVES = COARSE ? 3 : 4;

// ?debug を付けたときだけ stats.js / lil-gui を出す（本番の見た目を汚さない）。
export const DEBUG = new URLSearchParams(location.search).has("debug");

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * フレームレートに依存しない指数追従。rate は 1 秒あたりの追従の速さ。
 * 固定係数の lerp だと 120Hz と 60Hz で手触りが変わるため dt を使う。
 */
export const damp = (cur: number, to: number, rate: number, dt: number) =>
  lerp(cur, to, 1 - Math.exp(-rate * dt));

// サイト全体で揃えるイージング。CSS の --ease（cubic-bezier(0.19, 1, 0.22, 1)）と同じ系統。
export const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
