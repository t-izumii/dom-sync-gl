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
  distortion?: number;
  normalScale?: number;
  specularPower?: number;
  specularIntensity?: number;
  lightDir?: Vector3;
  texSize?: number;
}

export function rippleApplyNode(
  args: {
    rippleTex: TextureNode;
    tex: TextureNode;
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

  const texelH = (ij: Node): Node => {
    const t = ij.add(0.5).div(size);
    return unpackH(args.rippleTex.sample(t).rg);
  };

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
