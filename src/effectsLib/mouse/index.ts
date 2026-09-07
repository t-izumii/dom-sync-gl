/**
 * マウス流体エフェクト。WebGPU コンピュートシェーダーで解くため
 * WebGL 2 フォールバック時は no-op になる（詳細は mouseEffect.ts）。
 *
 * `FluidCompute` は MouseEffect 専用の内部実装なので公開しない
 * （splashCursor が FluidSim を公開しないのと同じ理由）。
 */
export {
  MouseEffect,
  type MouseEffectOptions,
} from './mouseEffect';
