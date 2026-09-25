/**
 * 全画面の背景「光の場」。createPlane(null, …) の colorNode。
 * ドメインワープした fbm の霧を、ポインタへ少し引き寄せられる光源が照らす。
 * 光源からは横に長いアナモルフィックのストリークが伸び、芯の外側には
 * フィルムのハレーション（赤い滲み）が出る。画面の反対側にはシアンの対旋律。
 *
 * 章の色（uKeyA / uKeyB / uCounter）と光量（uHero）は main.ts がスクロール位置から
 * 補間して流し込む。ノイズ評価は fbm 3 回 × オクターブ数に抑えている。
 */
import { TSL } from "dom-sync-gl";
import type { PlaneNodeContext } from "dom-sync-gl";
import type { Node } from "three/webgpu";
import { makeFbm } from "./noise";
import { shared } from "../uniforms";

const { vec2, vec3, vec4, float, mix, exp, abs, dot, smoothstep, sin, cos, max, min } = TSL;

export const createBackgroundNode =
  (octaves: number) =>
  (ctx: PlaneNodeContext): Node => {
    const { uv, uResolution } = ctx;
    const { uClock, uSpeed, uPointer, uKeyA, uKeyB, uCounter, uHero, uScroll } = shared;
    const fbm = makeFbm(octaves);

    const aspect = uResolution.x.div(max(uResolution.y, 1.0));
    // 短辺を 1 とする座標。縦長（スマホ）でも光源の大きさが画面幅に対して保たれる
    const unit = max(min(aspect, 1.0), 0.001);
    const p = vec2(uv.x.mul(aspect), uv.y).div(unit);
    const t = uClock.mul(0.035);

    // 主光源。ヒーローでは右上、ポインタへ 2 割だけ寄る（追いかけすぎると安っぽい）
    const mouse = vec2(uPointer.x.mul(aspect), uPointer.y).div(unit);
    const home = vec2(aspect.mul(0.7), float(0.62).add(sin(t.mul(2.0)).mul(0.02))).div(unit);
    const src = mix(home, mouse, 0.2);

    // 霧。スクロールで縦にゆっくり流して視差を付ける
    const pw = p.mul(1.4).add(vec2(0.0, uScroll.mul(0.18)));
    const q = vec2(
      fbm(pw.add(vec2(t, t.mul(0.6)))),
      fbm(pw.add(vec2(5.2, 1.3)).sub(vec2(t.mul(0.8), t))),
    );
    const f = fbm(pw.add(q.mul(1.9)).add(vec2(t.mul(0.5), 0.0)));
    const fog = smoothstep(0.28, 0.95, f);

    // 光源まわり: 芯・ハレーション（芯の外側の輪）・広い滲み
    const d = p.sub(src);
    const r2 = dot(d, d);
    const core = exp(r2.mul(-26.0));
    const bloom = exp(r2.mul(-2.4));
    const halationRing = exp(r2.mul(-7.0)).sub(core).max(0.0);

    // アナモルフィックのストリーク。スクロールが速いほど横に伸びる
    const stretch = mix(float(1.6), float(0.45), uSpeed);
    const streak = exp(abs(d.y).mul(-90.0)).mul(exp(abs(d.x).mul(stretch.negate())));
    const streakSoft = exp(abs(d.y).mul(-18.0)).mul(exp(abs(d.x).mul(-2.2)));

    // 左下のシアンの対旋律（弱く、霧の濃淡でだけ見える）
    const src2 = vec2(aspect.mul(0.16).add(cos(t.mul(1.3)).mul(0.03)), 0.2).div(unit);
    const d2 = p.sub(src2);
    const cyan = exp(dot(d2, d2).mul(-4.0))
      .mul(0.3)
      .add(exp(abs(d2.y).mul(-140.0)).mul(exp(abs(d2.x).mul(-3.0))).mul(0.18));

    // 地の霧と滲み（ambient）。出力は linear なので、小さな値でも sRGB では明るく出る。
    // 地が黒く締まるよう ambient 全体を絞り、芯とストリークだけを強く残す
    let ambient: Node = uKeyA.mul(fog.mul(fog)).mul(bloom.mul(1.1).add(0.03));
    ambient = ambient.add(vec3(1.0, 0.22, 0.06).mul(halationRing).mul(0.55));
    ambient = ambient.add(mix(uKeyA, uKeyB, 0.5).mul(bloom).mul(0.12));
    ambient = ambient.add(uKeyA.mul(streakSoft).mul(0.14));
    ambient = ambient.add(uCounter.mul(cyan).mul(q.x.add(0.2)));
    let col: Node = ambient.mul(0.3);
    col = col.add(uKeyB.mul(core).mul(1.6));
    col = col.add(mix(uKeyB, vec3(1.0), 0.45).mul(streak).mul(0.8));

    // 下の章では光量を落として本文のコントラストを確保する
    col = col.mul(mix(float(0.12), float(1.0), uHero));

    // 露光のようなトーンマップ（白飛びさせずに芯だけ明るく）
    col = float(1.0).sub(exp(col.mul(-1.25)));

    // 真っ黒にしない地の色（#07070a を linear に直した値。出力時に sRGB へ変換される）
    col = col.add(vec3(0.0021, 0.0021, 0.0031));

    return vec4(col, 1.0);
  };
