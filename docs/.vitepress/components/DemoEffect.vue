<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { WebGLApp, BaseEffect, type BaseEffectConfig } from 'dom-sync-gl';

const stage = ref<HTMLDivElement | null>(null);
let app: InstanceType<typeof WebGLApp> | null = null;
let grain: GrainEffect | null = null;
const grainOn = ref(true);

const baseShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  void main() {
    vec2 uv = vUv;
    float wave = 0.5 + 0.5 * sin(uv.x * 8.0 + uTime * 0.8);
    vec3 col = mix(
      vec3(0.13, 0.18, 0.36),
      vec3(0.43, 0.95, 0.96),
      uv.y * wave
    );
    gl_FragColor = vec4(col, 1.0);
  }
`;

class GrainEffect extends BaseEffect {
  protected getConfig(): BaseEffectConfig {
    return {
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform float uAmount;
        void main() {
          vec4 src = texture2D(tDiffuse, vUv);
          float g = fract(sin(dot(vUv + uTime, vec2(12.9898, 78.233))) * 43758.5453);
          gl_FragColor = vec4(src.rgb + (g - 0.5) * uAmount, src.a);
        }
      `,
      uniforms: {
        uTime: { value: 0 },
        uAmount: { value: 0.18 },
      },
    };
  }
  update(time: number) {
    this.setUniform('uTime', time);
  }
}

onMounted(() => {
  if (!stage.value) return;
  app = new WebGLApp(stage.value, { showGUI: false });
  app.createPlane(null, { fragmentShader: baseShader });
  grain = new GrainEffect();
  app.addEffect(grain);
});

onBeforeUnmount(() => {
  app?.destroy();
  app = null;
  grain = null;
});

function toggleGrain() {
  if (!grain) return;
  grain.enabled = !grain.enabled;
  grainOn.value = grain.enabled;
}
</script>

<template>
  <div class="demo-frame">
    <div
      ref="stage"
      class="demo-frame__stage"
      style="height: 280px;"
    ></div>
    <div class="demo-frame__controls">
      <button @click="toggleGrain">grain: {{ grainOn ? 'ON' : 'OFF' }}</button>
      <span>背景 plane + Grain ポストエフェクト。<code>effect.enabled</code> でパスをスキップできる。</span>
    </div>
  </div>
</template>
