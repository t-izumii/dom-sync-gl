/**
 * DomTextPlane 用の colorNode。ラスタライズ済みの文字（uTexture）を GL 側で歪ませる。
 *
 * - halationTextNode: 巨大な見出し用。ポインタのレンズで屈折し、RGB が分かれ、
 *   文字の外側にハレーション（橙の滲み）が出る。リビールは左から順に下からせり上がる。
 * - sweepTextNode: 数字用。光の帯が文字の上を通り過ぎる。
 *
 * uTexture のサンプルは乗算済みアルファに直してから合成する。RGB を別々の位置で
 * 読むと、文字の外側（透明部）の RGB が混ざって縁が黒ずむため。
 */
import { TSL } from "dom-sync-gl";
import type { PlaneNodeContext } from "dom-sync-gl";
import type { Node, UniformNode } from "three/webgpu";
import { shared } from "../uniforms";

const { float, vec2, vec3, vec4, exp, dot, max, mix, clamp, smoothstep, abs, fract, pow } = TSL;

export interface TextUniforms {
  uReveal: UniformNode<number>;
  uHover: UniformNode<number>;
}

export interface HalationTextOptions {
  /** 滲みの半径（文字の高さに対する比） */
  glowRadius?: number;
  /** 滲みの強さ。0 なら滲みのサンプル自体を省く（タッチ端末向けの軽量版） */
  glow?: number;
  /** レンズの屈折量 */
  refraction?: number;
}

// 滲みを取るサンプル位置（8 点）。半径を 1 点おきに内・外で交互にして、
// 同じ半径の 1 重リングで出る「文字の複製が並んで見える」段差を目立たなくする。
// 巨大な見出しの板で 1 画素あたりの読み出しが増えすぎないよう、8 点に抑えている
// （RGB の 3 点と合わせて 11 回）。
const RING = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  const r = i % 2 === 0 ? 1 : 0.55;
  return [Math.cos(a) * r, Math.sin(a) * r] as const;
});

export const createHalationTextNode =
  (opts: HalationTextOptions = {}) =>
  (ctx: PlaneNodeContext): Node => {
    const { uv, uTexture, uResolution, uMouseUV } = ctx;
    const { uReveal, uHover } = ctx.uniforms as unknown as TextUniforms;
    const glowRadius = opts.glowRadius ?? 0.05;
    const glowAmt = opts.glow ?? 0.9;
    const refraction = opts.refraction ?? 0.07;

    const aspect = uResolution.x.div(max(uResolution.y, 1.0));

    // リビール: 左の文字から順に（uv.x で遅延）下からせり上がる
    const local = clamp(uReveal.mul(1.7).sub(uv.x.mul(0.7)), 0.0, 1.0);
    const k = float(1.0).sub(pow(float(1.0).sub(local), 3.0));
    const rise = float(1.0).sub(k).mul(0.9);
    const base = vec2(uv.x, uv.y.add(rise));

    // ポインタのレンズ（文字を押し広げる屈折）
    const d = base.sub(uMouseUV);
    const dA = vec2(d.x.mul(aspect), d.y);
    const lens = exp(dot(dA, dA).mul(-6.0)).mul(uHover);
    const refr = d.mul(lens.mul(refraction).negate());

    // 横スクロール方向の速度で横に流れる
    const vel = vec2(shared.uVelocity.mul(0.012), 0.0);

    // RGB 分離（静止時もごく僅かに残して “光学系” らしさを出す）
    const split = lens.mul(0.0045).add(abs(shared.uVelocity).mul(0.008)).add(0.001);
    const dir = vec2(1.0, 0.0);
    const uvR = base.add(refr).add(vel).add(dir.mul(split));
    const uvG = base.add(refr).add(vel);
    const uvB = base.add(refr).add(vel).sub(dir.mul(split));
    const sR = uTexture.sample(uvR);
    const sG = uTexture.sample(uvG);
    const sB = uTexture.sample(uvB);
    const a = max(max(sR.a, sG.a), sB.a);
    const premul = vec3(sR.r.mul(sR.a), sG.g.mul(sG.a), sB.b.mul(sB.a));

    // ハレーション: 周囲 8 点の alpha の平均を、文字の外側にだけ橙で足す
    let glow: Node = float(0.0);
    if (glowAmt > 0) {
      let halo: Node = float(0.0);
      for (const [cx, cy] of RING) {
        const off = vec2(cx, cy).mul(vec2(float(glowRadius).div(aspect), glowRadius));
        halo = halo.add(uTexture.sample(uvG.add(off)).a);
      }
      halo = halo.div(RING.length);
      glow = halo.mul(float(1.0).sub(a)).mul(glowAmt).mul(uHover.mul(0.6).add(0.7));
    }
    const haloCol = mix(vec3(1.0, 0.28, 0.08), shared.uKeyA, 0.5);

    const rgb = premul.add(haloCol.mul(glow));
    const alpha = clamp(a.add(glow), 0.0, 1.0);
    // 乗算済み → 直線アルファへ戻す（マテリアルは通常の alpha ブレンド）
    const fade = smoothstep(0.0, 0.25, local);
    return vec4(rgb.div(max(alpha, 0.0001)), alpha.mul(fade));
  };

/**
 * 数字用。左から拭き取るリビールと、ゆっくり通り過ぎる光の帯。
 * 帯の位置は uSeed で数字ごとにずらす。
 */
export const createSweepTextNode = () => (ctx: PlaneNodeContext): Node => {
  const { uv, uTexture } = ctx;
  const { uReveal, uSeed } = ctx.uniforms as unknown as TextUniforms & {
    uSeed: UniformNode<number>;
  };
  const s = uTexture.sample(uv);
  const pos = fract(shared.uClock.mul(0.09).add(uSeed)).mul(1.8).sub(0.4);
  // pow() は負の底で未定義なので 2 乗は自乗で書く
  const bandD = uv.x.sub(pos).add(uv.y.mul(0.25));
  const band = exp(bandD.mul(bandD).mul(-60.0));
  const col = s.rgb.mul(band.mul(0.6).add(0.78)).add(shared.uKeyA.mul(band).mul(0.45));
  const mask = smoothstep(uv.x.sub(0.05), uv.x, uReveal.mul(1.1));
  return vec4(col, s.a.mul(mask));
};
