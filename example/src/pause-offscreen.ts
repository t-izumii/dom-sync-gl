import { DomSyncGL, TSL } from "dom-sync-gl";
import type { PlaneNodeContext } from "dom-sync-gl";
import type { Node } from "three/webgpu";

const { float, vec2, vec3, vec4, sin, cos, length, atan, mix, step, abs } = TSL;

// ============================================================================
// pauseWhenOffscreen の動作確認。
//
// 同じ shader を載せた通常フロー（非 fixed）の canvas を 2 枚並べ、片方だけ
// pauseWhenOffscreen: true にする。画面外へスクロールして戻ってくると、
//   - ON 側は frame カウンタと uTime が止まったまま（＝描画ループごと停止した）
//   - OFF 側は回り続けてカウンタも uTime も進む
// という差が出る。復帰後に ON 側の uTime が「飛ばずに続きから」動くことが、
// clock 再シードが効いている証拠。
//
// 注意: HUD から時刻を読むときは clock.getElapsedTime() ではなく clock.elapsedTime
// を読む。getElapsedTime() は内部で getDelta() を呼んで時間を進めてしまうため、
// 停止中に呼ぶと「止まっているはずの時計」が動いてしまう。
// ============================================================================

/** 回転する掃引線 + 同心リング。止まっているか目視で分かる絵にする。 */
const sweepColorNode =
  (hue: "warm" | "cool") =>
  (ctx: PlaneNodeContext): Node => {
    const { uTime, uResolution, uv } = ctx;

    const centered = uv.sub(0.5);
    const p = vec2(
      centered.x.mul(uResolution.x.div(uResolution.y)),
      centered.y,
    );
    const t = uTime.mul(0.6);

    const r = length(p);
    const ang = atan(p.y, p.x);

    // 掃引線: 角度が時間で回る。1 本の明るい線が回転するので停止が一目で分かる。
    const sweep = step(float(0.94), cos(ang.sub(t.mul(1.6))));
    // 同心リング: 外側へ広がる。
    const rings = sin(r.mul(22.0).sub(t.mul(3.0))).mul(0.5).add(0.5);

    const base =
      hue === "warm"
        ? mix(vec3(0.12, 0.03, 0.02), vec3(0.95, 0.45, 0.15), rings)
        : mix(vec3(0.02, 0.07, 0.14), vec3(0.3, 0.75, 0.95), rings);

    // 中心の十字マーカー（静止基準）
    const cross = step(abs(p.x), float(0.004)).add(step(abs(p.y), float(0.004)));

    const col = base.add(sweep.mul(0.9)).add(cross.mul(0.35));
    return vec4(col, 1.0);
  };

interface Panel {
  app: DomSyncGL;
  frames: number;
  /** 直前に観測した停止状態。トグルの検出用。 */
  wasPaused: boolean;
  pauseCount: number;
  el: {
    frames: HTMLElement;
    time: HTMLElement;
    state: HTMLElement;
    pauses: HTMLElement;
  };
}

const makePanel = (
  id: string,
  colorNode: (ctx: PlaneNodeContext) => Node,
  pauseWhenOffscreen: boolean,
): Panel => {
  const app = new DomSyncGL(`#${id}`, {
    scrollSync: { attach: "dom", trackStrength: true },
    pauseWhenOffscreen,
  });
  app.createPlane(null, { colorNode });

  const panel: Panel = {
    app,
    frames: 0,
    wasPaused: false,
    pauseCount: 0,
    el: {
      frames: document.querySelector<HTMLElement>(`#${id}-frames`)!,
      time: document.querySelector<HTMLElement>(`#${id}-time`)!,
      state: document.querySelector<HTMLElement>(`#${id}-state`)!,
      pauses: document.querySelector<HTMLElement>(`#${id}-pauses`)!,
    },
  };

  // update() の中で呼ばれるので、停止中はカウントが伸びない = そのまま検証になる。
  app.addUpdateCallback(() => {
    panel.frames++;
  });

  return panel;
};

const panels = [
  makePanel("on", sweepColorNode("warm"), true),
  makePanel("off", sweepColorNode("cool"), false),
];

// ============================================================================
// HUD。app のループとは独立した rAF で回す（停止中も HUD だけは更新したいため）。
// ============================================================================
const fmt = (n: number) => n.toFixed(2);

const hud = () => {
  for (const panel of panels) {
    const paused = panel.app.isPaused();
    if (paused !== panel.wasPaused) {
      panel.wasPaused = paused;
      if (paused) panel.pauseCount++;
      console.log(
        `[pause-offscreen] ${paused ? "PAUSE" : "RESUME"} — frames=${panel.frames} uTime=${fmt(panel.app.clock.elapsedTime)}`,
      );
    }

    panel.el.frames.textContent = String(panel.frames);
    // getElapsedTime() は時間を進めてしまうので生フィールドを読む
    panel.el.time.textContent = fmt(panel.app.clock.elapsedTime);
    panel.el.state.textContent = paused ? "PAUSED" : "running";
    panel.el.state.dataset.paused = String(paused);
    panel.el.pauses.textContent = String(panel.pauseCount);
  }

  requestAnimationFrame(hud);
};
requestAnimationFrame(hud);

// 起動時の設定を確認できるようにログしておく。
for (const [i, panel] of panels.entries()) {
  console.log(
    `[pause-offscreen] panel${i} attach=${panel.app.getScrollSync()?.attach} isPaused=${panel.app.isPaused()}`,
  );
}
