<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { DomSyncGL, BaseEffect, type BaseEffectConfig, TSL } from 'dom-sync-gl';

const { uniform, vec2, vec3, vec4, sin, mix, fract, dot } = TSL;

const stage = ref<HTMLDivElement | null>(null);
let app: InstanceType<typeof DomSyncGL> | null = null;
let grain: GrainEffect | null = null;
const grainOn = ref(true);

class GrainEffect extends BaseEffect {
  private uTime = uniform(0);
  private uAmount = uniform(0.18);

  protected getConfig(): BaseEffectConfig {
    return {
      outputNode: ({ inputTexture, uv }) => {
        const g = fract(
          sin(dot(uv.add(this.uTime), vec2(12.9898, 78.233))).mul(43758.5453),
        );
        return vec4(
          inputTexture.rgb.add(g.sub(0.5).mul(this.uAmount)),
          inputTexture.a,
        );
      },
      uniforms: { uTime: this.uTime, uAmount: this.uAmount },
    };
  }
  update(time: number) {
    this.setUniform('uTime', time);
  }
}

onMounted(() => {
  if (!stage.value) return;
  app = new DomSyncGL(stage.value);
  app.createPlane(null, {
    colorNode: ({ uv, uTime }) => {
      const wave = sin(uv.x.mul(8).add(uTime.mul(0.8))).mul(0.5).add(0.5);
      const col = mix(
        vec3(0.13, 0.18, 0.36),
        vec3(0.43, 0.95, 0.96),
        uv.y.mul(wave),
      );
      return vec4(col, 1);
    },
  });
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
