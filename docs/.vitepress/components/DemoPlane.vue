<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { WebGLApp } from 'dom-sync-gl';

// カード型のボックス自体を WebGL コンテナにする。中に「フルスクリーン plane」を 1 枚張るので
// DOM 要素ロックではなく、canvasRect / scroll に依存しない。ページをスクロールしても plane は
// 常に canvas（= カード）を埋めたままズレない。
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
  if (!card.value) return;
  app = new WebGLApp(card.value, { showGUI: false });
  // element=null = フルスクリーン plane（canvas 全体を埋める）。
  const plane = app.createPlane(null, { fragmentShader });

  // フルスクリーン plane は raycast 対象外なので、hover 用 uniform は自前で流す。
  // uMouseUV は getMouse()（canvas 内 UV, 0〜1）、uIsHovered は pointer enter/leave で。
  let hovered = false;
  card.value.addEventListener('pointerenter', () => (hovered = true));
  card.value.addEventListener('pointerleave', () => (hovered = false));
  app.addUpdateCallback(() => {
    const m = app!.getMouse();
    (plane.material.uniforms.uMouseUV.value as { set(x: number, y: number): void }).set(m.x, m.y);
    plane.material.uniforms.uIsHovered.value = hovered;
  });
});

onBeforeUnmount(() => {
  app?.destroy();
  app = null;
});
</script>

<template>
  <div class="demo-frame">
    <div
      class="demo-frame__stage demo-frame__stage--center"
      style="height: 320px;"
    >
      <div
        ref="card"
        style="
          width: 60%;
          max-width: 360px;
          aspect-ratio: 16 / 9;
          border-radius: 12px;
          overflow: hidden;
        "
      ></div>
    </div>
    <div class="demo-frame__controls">
      <span>カード型の canvas にフルスクリーン plane を 1 枚張って shader を流している。hover で色が変わる。</span>
    </div>
  </div>
</template>
