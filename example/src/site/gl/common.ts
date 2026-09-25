/**
 * GL 側モジュールの共通の型と小さなヘルパー。
 */
import type { DomPlane } from "dom-sync-gl";

/** 各章の GL パーツが返す、毎フレーム更新と破棄の口 */
export interface Part {
  update(dt: number): void;
  destroy?(): void;
}

/** 描画順の層。背景を必ず最背面、文字を最前面に置く */
export const LAYER = {
  background: -10,
  flare: 1,
  art: 2,
  text: 5,
} as const;

/**
 * 深度を使わず renderOrder だけで重ね順を決める。
 * 板は z をしならせる（positionNode）ので、深度テストを残すと隣の板や
 * 文字と食い込んで欠ける。
 */
export function layer(plane: DomPlane, order: number): void {
  plane.getMesh().renderOrder = order;
  plane.material.depthTest = false;
  plane.material.depthWrite = false;
}

/** 目標値へ近づく 0..1 のアニメーション値（リビール・ホバーに使う） */
export class Smoothed {
  value = 0;
  target = 0;
  constructor(private readonly rate: number) {}
  step(dt: number): number {
    this.value += (this.target - this.value) * (1 - Math.exp(-this.rate * dt));
    if (Math.abs(this.target - this.value) < 0.0005) this.value = this.target;
    return this.value;
  }
}
