/**
 * サイト全体で共有する uniform ノード。
 * uniform ノードは複数のマテリアルから同時に参照できるので、背景・作品・文字・
 * 仕上げパスが同じ「時間」「スクロール速度」「章の色」を読むようにここへ集約する。
 * 値の所有者は main.ts の毎フレーム処理だけで、他のモジュールは読むだけにする。
 */
import { THREE, TSL } from "dom-sync-gl";

const { uniform } = TSL;

export const shared = {
  /**
   * 演出用の時計（秒）。DomPlane の uTime は常に進むが、こちらは動きの抑制中に
   * 止められるよう main.ts が dt × 速度係数で進める。
   */
  uClock: uniform(0),
  /** 符号付きスクロール速度（-1..1、平滑化済み）。板の湾曲やせん断に使う */
  uVelocity: uniform(0),
  /** スクロール速度の大きさ（0..1）。色収差やストリークの伸びに使う */
  uSpeed: uniform(0),
  /** スクロール量（viewport 高さ単位）。背景の霧に視差を付ける */
  uScroll: uniform(0),
  /** viewport 基準の平滑化したポインタ位置（左下原点 0..1） */
  uPointer: uniform(new THREE.Vector2(0.62, 0.58)),
  /** 章ごとに移り変わる主光（ハレーションの芯の色） */
  uKeyA: uniform(new THREE.Color("#ff7a2e")),
  /** 章ごとに移り変わる副光（淡い金） */
  uKeyB: uniform(new THREE.Color("#ffd9a0")),
  /** 寒色の対旋律（シアン） */
  uCounter: uniform(new THREE.Color("#5fd3e0")),
  /** ヒーローでの光量（1 = ヒーロー、下の章ほど沈める） */
  uHero: uniform(1),
};

export type Shared = typeof shared;
