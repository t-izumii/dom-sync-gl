<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { DomSyncGL, TSL } from 'dom-sync-gl';

const { vec2, vec3, vec4, sin, mix, distance, select } = TSL;

// カード型のボックス自体を WebGL コンテナにする。中に「フルスクリーン plane」を 1 枚張るので
// DOM 要素ロックではなく、canvasRect / scroll に依存しない。ページをスクロールしても plane は
// 常に canvas（= カード）を埋めたままズレない。
const card = ref<HTMLDivElement | null>(null);
let app: InstanceType<typeof DomSyncGL> | null = null;

onMounted(() => {
  if (!card.value) return;
  app = new DomSyncGL(card.value);
  // element=null = フルスクリーン plane（canvas 全体を埋める）。
  // フルスクリーン plane には PointerController が canvas 内 UV（uMouseUV）と
  // ポインタ在圏フラグ（uIsHovered）を毎フレーム流し込むので、hover の自前配線は不要。
  app.createPlane(null, {
    colorNode: ({ uv, uTime, uMouseUV, uIsHovered }) => {
      const hovered = uIsHovered.greaterThan(0.5);
      const dist = distance(uv, select(hovered, uMouseUV, vec2(0.5)));
      const ring = sin(dist.mul(12).sub(uTime.mul(1.5))).mul(0.5).add(0.5);
      const col = mix(vec3(0.34, 0.43, 0.99), vec3(0.96, 0.34, 0.62), uv.y)
        .add(ring.mul(0.18));
      return vec4(mix(col, vec3(1), uIsHovered.mul(0.15)), 1);
    },
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
      <span>カード型の canvas にフルスクリーン plane を 1 枚張って TSL シェーダーを流している。hover で色が変わる。</span>
    </div>
  </div>
</template>
