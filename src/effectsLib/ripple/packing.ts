/**
 * feedback 版リップルの高さ場 12bit パッキング（TSL 共通ヘルパー）。
 * FeedbackBuffer の RenderTarget は 8bit RGBA のため、h^n / h^{n-1} を
 * 12bit ずつ RGB に詰める（R=h^n 上位 8bit, B=h^{n-1} 上位 8bit,
 * G=両者の下位 4bit）。sim 側（rippleTexture）と consume 側
 * （rippleApplyNode）でデコードを共有する。
 */
import { Fn, clamp, floor, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';

const Q12 = 4095.0;

/** h^n / h^{n-1}（各 [-1,1]）を RGB へ 12bit パックする。 */
export const packState = Fn(([h, hPrev]: [Node, Node]) => {
  const H = clamp(h.mul(0.5).add(0.5), 0.0, 1.0);
  const P = clamp(hPrev.mul(0.5).add(0.5), 0.0, 1.0);
  const Hq = floor(H.mul(Q12).add(0.5));
  const Pq = floor(P.mul(Q12).add(0.5));
  const Hhi = floor(Hq.div(16.0));
  const Phi = floor(Pq.div(16.0));
  const Hlo = Hq.sub(Hhi.mul(16.0));
  const Plo = Pq.sub(Phi.mul(16.0));
  return vec3(Hhi.div(255.0), Hlo.mul(16.0).add(Plo).div(255.0), Phi.div(255.0));
});

/** RG（R=上位 8bit, G 上位 4bit=下位）から h^n を [-1,1] へデコードする。 */
export const unpackH = Fn(([rg]: [Node]) => {
  const Rq = floor(rg.x.mul(255.0).add(0.5));
  const Gq = floor(rg.y.mul(255.0).add(0.5));
  const Hlo = floor(Gq.div(16.0));
  return Rq.mul(16.0).add(Hlo).div(Q12).mul(2.0).sub(1.0);
});

/** BG（B=上位 8bit, G 下位 4bit=下位）から h^{n-1} を [-1,1] へデコードする。 */
export const unpackHPrev = Fn(([bg]: [Node]) => {
  const Bq = floor(bg.x.mul(255.0).add(0.5));
  const Gq = floor(bg.y.mul(255.0).add(0.5));
  const Plo = Gq.sub(floor(Gq.div(16.0)).mul(16.0));
  return Bq.mul(16.0).add(Plo).div(Q12).mul(2.0).sub(1.0);
});
