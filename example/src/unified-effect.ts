import {
  DomSyncGL,
  BaseEffect,
  type BaseEffectConfig,
  type EffectOutput,
} from "dom-sync-gl";

// ---------------------------------------------------------------------------
// shaders（自己完結のためここに直書き）
// ---------------------------------------------------------------------------

// plane のベースマテリアル。texture モードのとき uTrailTex に軌跡が供給される。
const planeFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTrailTex;  // texture モードで供給（post モードでは null=黒）
  uniform float uSeed;

  vec3 hue(float h){ return 0.5 + 0.5 * cos(6.2831 * (h + vec3(0.0, 0.33, 0.67))); }

  void main() {
    vec3 a = hue(uSeed * 0.13 + 0.05);
    vec3 base = mix(a * 0.22, a * 0.6, vUv.y);
    float trail = texture2D(uTrailTex, vUv).r;
    vec3 col = base + trail * vec3(1.0, 0.85, 0.5) * 0.9;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// 軌跡の蓄積（generate）。uPrev/uMouse/uHover/uAspect は FeedbackBuffer が自動供給。
const trailAccumFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPrev;
  uniform vec2  uMouse;
  uniform float uHover;
  uniform float uAspect;
  uniform float uDecay;
  uniform float uRadius;

  void main() {
    float prev = texture2D(uPrev, vUv).r * uDecay;
    vec2 d = (uMouse - vUv) * vec2(uAspect, 1.0);
    float splat = (1.0 - smoothstep(0.0, uRadius, length(d))) * uHover;
    float v = max(prev, splat);
    gl_FragColor = vec4(v, v, v, 1.0);
  }
`;

// post 合成。tDiffuse（描画結果）+ uGenerated（軌跡）。透過維持のため元アルファを使う。
const trailCompositeFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform sampler2D uGenerated;
  uniform float uIntensity;

  void main() {
    vec4 src = texture2D(tDiffuse, vUv);
    float trail = texture2D(uGenerated, vUv).r;
    vec3 col = src.rgb + trail * uIntensity * vec3(1.0, 0.85, 0.5);
    gl_FragColor = vec4(col, src.a);
  }
`;

// ---------------------------------------------------------------------------
// Trail エフェクト（1 クラス）。generate=軌跡生成 / fragmentShader=post 合成 を持つ。
// 出力モード（texture / post）は addEffect の { output } で切り替える。
// ---------------------------------------------------------------------------
class Trail extends BaseEffect {
  private readonly uDecay = { value: 0.95 };
  private readonly uRadius = { value: 0.35 };
  private readonly uIntensity = { value: 1.1 };

  protected getConfig(): BaseEffectConfig {
    return {
      // テクスチャ生成（ping-pong で軌跡を蓄積）
      generate: {
        fragmentShader: trailAccumFragment,
        size: 256,
        uniforms: { uDecay: this.uDecay, uRadius: this.uRadius },
      },
      // post 合成 shader（output:'post' のときだけ使われる。uGenerated に軌跡が渡る）
      fragmentShader: trailCompositeFragment,
      uniforms: { uIntensity: this.uIntensity },
    };
  }
}

// ---------------------------------------------------------------------------
// セットアップ
// ---------------------------------------------------------------------------
const app = new DomSyncGL("#gl", { scrollSync: true, showGUI: false });

const cards = Array.from(document.querySelectorAll<HTMLElement>(".card"));
let output: EffectOutput = { uniform: "uTrailTex" }; // 初期は texture モード
let planes: ReturnType<DomSyncGL["createPlane"]>[] = [];

function build() {
  cards.forEach((card) => {
    const seed = Number(card.dataset.seed ?? 0);
    const plane = app.createPlane(card, {
      fragmentShader: planeFragment,
      updateRectEveryFrame: true,
      uniforms: {
        uTrailTex: { value: null },
        uSeed: { value: seed },
      },
    });
    // ★ ここが肝: 同じ Trail クラスのまま output だけで texture ⇄ post を切替
    plane.addEffect(new Trail(), { output });
    planes.push(plane);
  });
}

function rebuild() {
  for (const p of planes) app.removePlane(p);
  planes = [];
  build();
}

build();

// トグル
const modeEl = document.getElementById("mode") as HTMLElement;
document.getElementById("toggle")?.addEventListener("click", () => {
  output = output === "post" ? { uniform: "uTrailTex" } : "post";
  modeEl.textContent = output === "post" ? "post" : "texture";
  rebuild();
});

// 開発用にグローバルへ
(window as unknown as { app: DomSyncGL }).app = app;
