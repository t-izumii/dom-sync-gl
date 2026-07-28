<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { DomSyncGL, TSL } from 'dom-sync-gl';

const { vec3, vec4, sin } = TSL;

const scroller = ref<HTMLDivElement | null>(null);
const inner = ref<HTMLDivElement | null>(null);
const stage = ref<HTMLDivElement | null>(null);
let app: InstanceType<typeof DomSyncGL> | null = null;

// scroller の中で scroll が起こる擬似ページ。3 枚のカードに plane をロック。
const cards = [0, 1, 2];
const colors: [number, number, number][] = [
  [0.34, 0.43, 0.99],
  [0.96, 0.34, 0.62],
  [0.27, 0.83, 0.58],
];

onMounted(() => {
  if (!stage.value || !scroller.value) return;

  // scrollSync は window scroll 前提なので、ここではローカル擬似 scroll に
  // 合わせて plane.position を更新するシンプルなトランスフォームで代用する。
  // （docs 上で「DOM が動いても plane が追随する」体感だけ伝える）
  app = new DomSyncGL(stage.value);

  cards.forEach((i) => {
    const el = scroller.value!.querySelector<HTMLElement>(`[data-card="${i}"]`);
    if (!el) return;
    app!.createPlane(el, {
      updateRectEveryFrame: true,
      colorNode: ({ uv, uTime }) => {
        const g = sin(uTime.add(uv.x.mul(6))).mul(0.5).add(0.5);
        return vec4(vec3(...colors[i]).mul(g.mul(0.4).add(0.6)), 1);
      },
    });
  });
});

onBeforeUnmount(() => {
  app?.destroy();
  app = null;
});

function scrollUp() {
  scroller.value?.scrollBy({ top: -200, behavior: 'smooth' });
}
function scrollDown() {
  scroller.value?.scrollBy({ top: 200, behavior: 'smooth' });
}
</script>

<template>
  <div class="demo-frame">
    <div
      ref="stage"
      class="demo-frame__stage"
      style="height: 360px;"
    >
      <div
        ref="scroller"
        style="
          position: absolute;
          inset: 0;
          overflow-y: auto;
          padding: 16px;
          scrollbar-gutter: stable;
        "
      >
        <div ref="inner" style="display: grid; gap: 24px; padding: 40px 0;">
          <div
            v-for="i in cards"
            :key="i"
            :data-card="i"
            style="
              height: 140px;
              border-radius: 12px;
              background: rgba(255,255,255,0.04);
            "
          ></div>
        </div>
      </div>
    </div>
    <div class="demo-frame__controls">
      <button @click="scrollUp">▲ scroll</button>
      <button @click="scrollDown">▼ scroll</button>
      <span>updateRectEveryFrame: true なので、カードの位置に毎フレ追従する。</span>
    </div>
  </div>
</template>
