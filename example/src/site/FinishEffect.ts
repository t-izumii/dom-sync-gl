/**
 * 最終の仕上げ post effect（app.addEffect で全画面チェーンの最後に繋ぐ）。
 *
 * - 色収差: 画面の周辺ほど強く、スクロール速度で増える
 * - 走査線・グレイン・ビネット: 映写された光の質感
 * - イントロ: ロード中は黒地に中心の光漏れ（uLoad で育つ）。uIntro 0→1 で
 *   ノイズの境界から溶けて本編が現れ、途中でハレーションのバーストが一度だけ灯る
 *
 * イントロは終わった後も毎フレーム計算するのは無駄なので、uIntro < 1 の間だけ
 * If で分岐して評価する（uniform による分岐なので全ピクセルで同じ側を通る）。
 */
import { BaseEffect, type BaseEffectConfig, TSL } from "dom-sync-gl";
import type { Node } from "three/webgpu";
import { shared } from "./uniforms";
import { makeFbm, grain } from "./tsl/noise";

const {
  Fn,
  If,
  uniform,
  float,
  vec2,
  vec3,
  vec4,
  dot,
  length,
  exp,
  abs,
  mix,
  sin,
  smoothstep,
  screenSize,
  max,
  pow,
} = TSL;

export class FinishEffect extends BaseEffect {
  /** ロード進捗 0..1（光漏れの育ち） */
  private readonly uLoad = uniform(0);
  /** イントロ遷移 0..1（1 で完全に本編） */
  private readonly uIntro = uniform(0);

  protected getConfig(): BaseEffectConfig {
    const fbm = makeFbm(3);
    return {
      outputNode: ({ inputTexture, uv }) =>
        Fn(() => {
          const { uSpeed, uClock, uKeyA, uKeyB } = shared;
          const dir = uv.sub(0.5);
          const r2 = dot(dir, dir);

          // 周辺ほど強い色収差（静止時もごく僅か）
          const aberr = uSpeed.mul(0.012).add(0.0012).mul(r2).mul(4.0);
          const off = dir.mul(aberr);
          const r = inputTexture.sample(uv.add(off)).r;
          const g = inputTexture.sample(uv).g;
          const b = inputTexture.sample(uv.sub(off)).b;
          const col = vec3(r, g, b).toVar();

          // 走査線（物理 px 基準でごく薄く）
          const scan = sin(uv.y.mul(screenSize.y).mul(1.6)).mul(0.5).add(0.5);
          col.mulAssign(float(1.0).sub(scan.mul(0.035)));

          // ビネット
          col.mulAssign(float(1.0).sub(r2.mul(0.85)));

          // イントロ（終わったら評価しない）
          If(this.uIntro.lessThan(0.999), () => {
            const aspect = screenSize.x.div(max(screenSize.y, 1.0));
            const c = vec2(dir.x.mul(aspect), dir.y.add(0.02));
            const d = length(c);

            // ロード中の光漏れ: 中心の芯と横一文字のストリーク
            const load = this.uLoad;
            const leakCore = exp(d.mul(d).mul(mix(float(260.0), float(18.0), load)).negate());
            const leakStreak = exp(abs(c.y).mul(mix(float(400.0), float(120.0), load)).negate())
              .mul(exp(abs(c.x).mul(mix(float(9.0), float(1.4), load)).negate()));
            const leak = uKeyA
              .mul(leakCore.mul(0.8).add(leakStreak.mul(0.6)))
              .add(uKeyB.mul(leakCore.mul(leakCore)).mul(0.9))
              .mul(load.mul(0.85).add(0.15));

            // ノイズ境界を中心から外へ押し広げて本編を見せる
            const intro = this.uIntro;
            const n = fbm(uv.mul(vec2(aspect.mul(3.0), 3.0)).add(uClock.mul(0.2)));
            const front = intro.mul(1.9).sub(0.25);
            const field = d.mul(1.1).add(n.mul(0.35));
            const mask = smoothstep(field.sub(0.06), field, front);
            const edge = exp(abs(field.sub(front)).mul(-26.0)).mul(float(1.0).sub(intro));

            // 途中で一度だけ灯るハレーションのバースト
            const burst = sin(intro.mul(Math.PI)).mul(smoothstep(0.0, 0.2, intro));
            const flash = uKeyB.mul(exp(d.mul(d).mul(-3.0))).mul(burst).mul(0.9);

            const loaderLayer = leak.add(vec3(0.0021, 0.0021, 0.0031));
            const mixed = mix(loaderLayer, col, mask)
              .add(mix(uKeyA, vec3(1.0, 0.9, 0.75), 0.35).mul(edge).mul(1.3))
              .add(flash);
            col.assign(mixed);
          });

          // グレイン（最後に乗せてバーストの上にも粒子感を残す）。
          // ここの色は linear なので、暗部で粒が目立ちすぎないよう
          // おおよその知覚空間（γ 2.2）に移してから足して戻す
          const gr = grain(uv.mul(screenSize), uClock);
          const perceptual = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));
          const grained = max(perceptual.add(gr.sub(0.5).mul(0.05)), vec3(0.0));
          return vec4(pow(grained, vec3(2.2)), 1.0);
        })() as Node,
      uniforms: {
        uLoad: this.uLoad,
        uIntro: this.uIntro,
      },
    };
  }

  setLoad(v: number): void {
    this.setUniform("uLoad", v);
  }

  setIntro(v: number): void {
    this.setUniform("uIntro", v);
  }
}
