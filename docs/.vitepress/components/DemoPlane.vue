<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { WebGLApp } from 'dom-sync-gl';

const stage = ref<HTMLDivElement | null>(null);
const card = ref<HTMLDivElement | null>(null);
let app: InstanceType<typeof WebGLApp> | null = null;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2 uMouseUV;
  uniform bool uIsHovered;

  void main() {
    vec2 uv = vUv;
    float dist = distance(uv, uIsHovered ? uMouseUV : vec2(0.5));
    float ring = 0.5 + 0.5 * sin(dist * 12.0 - uTime * 1.5);
    vec3 col = mix(
      vec3(0.34, 0.43, 0.99),
      vec3(0.96, 0.34, 0.62),
      uv.y
    );
    col += ring * 0.18;
    col = mix(col, vec3(1.0), uIsHovered ? 0.15 : 0.0);
    gl_FragColor = vec4(col, 1.0);
  }
`;

onMounted(() => {
  if (!stage.value || !card.value) return;
  app = new WebGLApp(stage.value);
  app.createPlane(card.value, { fragmentShader });
});

onBeforeUnmount(() => {
  app?.destroy();
  app = null;
});
</script>

<template>
  <div class="demo-frame">
    <div
      ref="stage"
      class="demo-frame__stage"
      style="height: 320px;"
    >
      <div
        ref="card"
        style="
          position: absolute;
          left: 50%;
          top: 50%;
          width: 60%;
          max-width: 360px;
          aspect-ratio: 16 / 9;
          transform: translate(-50%, -50%);
          border-radius: 12px;
          pointer-events: auto;
        "
      ></div>
    </div>
    <div class="demo-frame__controls">
      <span>カードの位置にロックした plane に shader を流し込んでいる。hover で色が変わる。</span>
    </div>
  </div>
</template>
