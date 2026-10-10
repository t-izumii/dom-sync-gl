import { mountDiagnostics } from './diagnostics';

// Three r182 reads self.GPUShaderStage at module evaluation, even for its WebGL
// backend. HTTP LAN origins (and browsers without WebGPU) omit that enum. These
// are the standard shader-stage bit flags, not a WebGPU API or capability shim.
// Keep navigator.gpu untouched and explicitly choose WebGL when it is absent.
const scope = globalThis as typeof globalThis & { GPUShaderStage?: { VERTEX: number; FRAGMENT: number; COMPUTE: number } };
if (!scope.GPUShaderStage) {
  Object.defineProperty(scope, 'GPUShaderStage', { value: Object.freeze({ VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }), configurable: true });
  document.documentElement.dataset.portfolioGpuConstants = 'local-stage-flags';
}
mountDiagnostics();

// Dynamic import preserves the order in both Vite dev and production chunks.
// The DOM application starts independently of Three and catches GPU imports.
void import('./main').catch(error => {
  const root = document.documentElement;
  root.dataset.portfolioRenderer = 'dom';
  root.dataset.portfolioPhase = 'fallback';
  root.dataset.portfolioFallbackReason = `ページ機能の読み込みに失敗しました: ${error instanceof Error ? error.message : String(error)}`;
  console.warn('[Portfolio] Application import failed:', error);
});
