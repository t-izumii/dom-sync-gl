import { TSL } from 'dom-sync-gl';
import { MeshPhysicalNodeMaterial, MeshBasicNodeMaterial, type UniformNode } from 'three/webgpu';

// Native GLSL on WebGL2, the same equations in WGSL on WebGPU. The clock is
// supplied by the portfolio RAF, so separate renderers never invent separate time.
const fieldGL = TSL.glslFn(`
vec4 izumiField(vec3 p, float t) {
  vec3 q = p * 3.5;
  float ay = q.y * 0.7 - t * 0.32;
  float ax = q.x * 1.3 + t * 0.45 + sin(ay);
  float az = q.z * 1.55 - t * 0.27 + sin(q.x * 0.75 + t * 0.31);
  float c = sin(ax), w = cos(az);
  vec3 dc = vec3(cos(ax) * 1.3, cos(ax) * cos(ay) * 0.7, 0.0);
  vec3 dw = vec3(-sin(az) * cos(q.x * 0.75 + t * 0.31) * 0.75, 0.0, -sin(az) * 1.55);
  float r = (q.y + c * 0.5 + w * 0.2) * 2.2 - t * 0.2;
  vec3 dr = cos(r) * 2.2 * (vec3(0.0, 1.0, 0.0) + dc * 0.5 + dw * 0.2);
  return vec4(c * 0.45 + w * 0.35 + sin(r) * 0.2, (dc * 0.45 + dw * 0.35 + dr * 0.2) * 3.5);
}`);
const fieldGPU = TSL.wgslFn(`
fn izumiField(p: vec3<f32>, t: f32) -> vec4<f32> {
  let q = p * 3.5;
  let ay = q.y * 0.7 - t * 0.32;
  let ax = q.x * 1.3 + t * 0.45 + sin(ay);
  let az = q.z * 1.55 - t * 0.27 + sin(q.x * 0.75 + t * 0.31);
  let c = sin(ax); let w = cos(az);
  let dc = vec3<f32>(cos(ax) * 1.3, cos(ax) * cos(ay) * 0.7, 0.0);
  let dw = vec3<f32>(-sin(az) * cos(q.x * 0.75 + t * 0.31) * 0.75, 0.0, -sin(az) * 1.55);
  let r = (q.y + c * 0.5 + w * 0.2) * 2.2 - t * 0.2;
  let dr = cos(r) * 2.2 * (vec3<f32>(0.0, 1.0, 0.0) + dc * 0.5 + dw * 0.2);
  return vec4<f32>(c * 0.45 + w * 0.35 + sin(r) * 0.2, (dc * 0.45 + dw * 0.35 + dr * 0.2) * 3.5);
}`);

export function sculptureMaterial(kind: string, webgpu: boolean, clock: UniformNode<number>, morph: UniformNode<number>) {
  const material = new MeshPhysicalNodeMaterial({
    color: kind === 'matter' ? '#ff986e' : kind === 'echo' ? '#cddff3' : '#ededdf',
    metalness: kind === 'matter' ? .75 : .98, roughness: .24,
    clearcoat: .8, clearcoatRoughness: .2, iridescence: kind === 'matter' ? .18 : .42,
    iridescenceIOR: 1.35, envMapIntensity: 1.6,
  });
  const field = TSL.vec4((webgpu ? fieldGPU : fieldGL)({p: TSL.positionLocal, t: clock})).toVar();
  const flow = TSL.varying(field.x);
  // Analytic derivatives produce a coherent normal field without fragment noise
  // loops, normal textures, extra passes, or five finite-difference evaluations.
  if (kind === 'fold') {
    const n = TSL.vec3(TSL.normalLocal), amplitude = morph.mul(.2).add(.045);
    material.positionNode = TSL.positionLocal.add(n.mul(field.x.mul(amplitude)));
    const tangentGradient = field.yzw.sub(n.mul(TSL.dot(field.yzw, n)));
    const shapedNormal = n.sub(tangentGradient.mul(amplitude).mul(.65)).normalize();
    material.normalNode = TSL.varying(TSL.transformNormalToView(shapedNormal)).normalize();
    material.clearcoatNormalNode = material.normalNode;
  }
  material.roughnessNode = flow.mul(.045).add(kind === 'echo' ? .2 : .25);
  material.iridescenceThicknessNode = flow.mul(170).add(380).add(morph.mul(220));
  return material;
}

const lightGL = TSL.glslFn(`
vec4 izumiLight(vec2 uv, float t, float band) {
  float phase = fract(uv.x * 1.6 - t * 0.055 - band * 0.09);
  float pulse = exp(-pow((phase - 0.5) * 12.0, 2.0));
  float edge = pow(max(0.0, 1.0 - abs(uv.y * 2.0 - 1.0)), 0.65);
  vec3 light = mix(vec3(0.27, 0.38, 0.19), vec3(0.8, 1.0, 0.42), pulse);
  return vec4(light, (0.1 + pulse * 0.48) * edge);
}`);
const lightGPU = TSL.wgslFn(`
fn izumiLight(uv: vec2<f32>, t: f32, band: f32) -> vec4<f32> {
  let phase = fract(uv.x * 1.6 - t * 0.055 - band * 0.09);
  let pulse = exp(-pow((phase - 0.5) * 12.0, 2.0));
  let edge = pow(max(0.0, 1.0 - abs(uv.y * 2.0 - 1.0)), 0.65);
  let light = mix(vec3<f32>(0.27, 0.38, 0.19), vec3<f32>(0.8, 1.0, 0.42), pulse);
  return vec4<f32>(light, (0.1 + pulse * 0.48) * edge);
}`);

export function lightMaterial(webgpu: boolean, clock: UniformNode<number>, band: number) {
  const material = new MeshBasicNodeMaterial({transparent: true, depthWrite: false});
  const light = TSL.vec4((webgpu ? lightGPU : lightGL)({uv: TSL.uv(), t: clock, band: TSL.float(band)}));
  material.colorNode = light.rgb;
  material.opacityNode = light.a.mul(band === 0 ? 1 : .45);
  material.positionNode = TSL.positionLocal.add(TSL.vec3(0,TSL.sin(TSL.positionLocal.x.mul(.005).add(clock.mul(.5)).add(band)).mul(band === 0 ? 7 : 4),0));
  return material;
}
