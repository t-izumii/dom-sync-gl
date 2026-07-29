/**
 * feedback 版の高さ場を plane 側で消費する屈折/鏡面ノード（旧 rippleApply.glsl の TSL 版）。
 * post 版は ripplePostEffect.ts に同等処理を内蔵するため不要。
 * createPlane の colorNode から呼び、addFeedback（rippleTexture）の出力 texture()
 * ノードを rippleTex に渡す。
 */
import {
  clamp,
  dot,
  floor,
  fract,
  max,
  mix,
  normalize,
  pow,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { Node, TextureNode, Vector3 } from 'three/webgpu';
import { unpackH } from './packing';

export interface RippleApplyOptions {
  /** 屈折（UV 歪み）の強さ。既定 0.3 */
  distortion?: number;
  /** 法線の傾きスケール。既定 6.0 */
  normalScale?: number;
  /** 鏡面の鋭さ。既定 60.0 */
  specularPower?: number;
  /** 鏡面の強さ。既定 1.0 */
  specularIntensity?: number;
  /** ライト方向。既定 (-3, 10, 3) */
  lightDir?: Vector3;
  /** 高さ場テクスチャの一辺セル数。rippleTexture の size と揃える。既定 256 */
  texSize?: number;
}

/**
 * 高さ場の勾配で tex を屈折させ、鏡面ハイライトを乗せた vec4 ノードを返す。
 * 高さ場はテクセル中心で 12bit デコード → 手動バイリニア補間で読む
 * （feedback 側 packState と対。GPU のバイリニアはパック値を混ぜて壊すため）。
 *
 * @example
 * ```ts
 * colorNode: (ctx) =>
 *   rippleApplyNode({ rippleTex: uRippleTex, tex: ctx.uTexture, uv: ctx.uv }),
 * ```
 */
export function rippleApplyNode(
  args: {
    /** addFeedback の出力先 texture() ノード（outputUniform と同じもの） */
    rippleTex: TextureNode;
    /** 歪ませる元テクスチャ（通常 ctx.uTexture） */
    tex: TextureNode;
    /** サンプリング UV（通常 ctx.uv） */
    uv: Node;
  } & RippleApplyOptions,
): Node {
  const size = args.texSize ?? 256;
  const distortion = args.distortion ?? 0.3;
  const normalScale = args.normalScale ?? 6.0;
  const specularPower = args.specularPower ?? 60.0;
  const specularIntensity = args.specularIntensity ?? 1.0;
  const light = args.lightDir
    ? vec3(args.lightDir.x, args.lightDir.y, args.lightDir.z)
    : vec3(-3.0, 10.0, 3.0);

  // テクセル中心の高さ（12bit デコード）
  const texelH = (ij: Node): Node => {
    const t = ij.add(0.5).div(size);
    return unpackH(args.rippleTex.sample(t).rg);
  };

  // 手動バイリニア補間
  const heightAt = (sampleUv: Node): Node => {
    const p = sampleUv.mul(size).sub(0.5);
    const i = floor(p);
    const f = fract(p);
    const h00 = texelH(i);
    const h10 = texelH(i.add(vec2(1.0, 0.0)));
    const h01 = texelH(i.add(vec2(0.0, 1.0)));
    const h11 = texelH(i.add(vec2(1.0, 1.0)));
    return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
  };

  const texel = 1.0 / size;
  const hL = heightAt(args.uv.sub(vec2(texel, 0.0)));
  const hR = heightAt(args.uv.add(vec2(texel, 0.0)));
  const hD = heightAt(args.uv.sub(vec2(0.0, texel)));
  const hU = heightAt(args.uv.add(vec2(0.0, texel)));
  const grad = vec2(hR.sub(hL), hU.sub(hD));

  const color = args.tex.sample(clamp(args.uv.add(grad.mul(distortion)), 0.0, 1.0));

  const normal = normalize(
    vec3(grad.x.mul(-normalScale), 1.0, grad.y.mul(-normalScale)),
  );
  const specular = pow(max(dot(normal, normalize(light)), 0.0), specularPower).mul(
    specularIntensity,
  );

  return vec4(color.rgb.add(specular), color.a);
}
