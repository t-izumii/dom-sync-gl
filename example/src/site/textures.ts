/**
 * Process 章の 3 段階（Sketch / Light test / Final）の図版を Canvas 2D で描く。
 * 画像アセットを持たない方針なので、図版もすべて手続き的に生成する。
 * 乱数は種付きにして、リロードしても同じ絵になるようにしている。
 *
 * 生成した CanvasTexture の破棄は呼び出し側（process.ts）の責務。
 */
import { THREE } from "dom-sync-gl";

const W = 1000;
const H = 1250;

/** 種付き乱数（mulberry32） */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("[textures] 2D context を取得できません");
  return [canvas, ctx];
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 粒子感（どの図版にも薄く乗せる） */
function addGrain(ctx: CanvasRenderingContext2D, amount: number, seed: number) {
  const r = rng(seed);
  ctx.save();
  for (let i = 0; i < 9000; i++) {
    const v = r() > 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${r() * amount})`;
    ctx.fillRect(r() * W, r() * H, 1.5, 1.5);
  }
  ctx.restore();
}

/** 光源の芯 + 横のストリーク */
function drawLight(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  core: string,
  halo: string,
  streak: number,
) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, core);
  g.addColorStop(0.12, halo);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  if (streak > 0) {
    const s = ctx.createLinearGradient(x - W, y, x + W, y);
    s.addColorStop(0, "rgba(255,200,150,0)");
    s.addColorStop(0.5, `rgba(255,236,210,${streak})`);
    s.addColorStop(1, "rgba(255,200,150,0)");
    ctx.fillStyle = s;
    ctx.fillRect(0, y - 1.5, W, 3);
    ctx.globalAlpha = 0.35;
    ctx.fillRect(0, y - 8, W, 16);
    ctx.globalAlpha = 1;
  }
}

/** 01 Sketch — 暗い紙に鉛筆の構図線と寸法 */
export function drawSketch(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas();
  const r = rng(11);
  ctx.fillStyle = "#15141a";
  ctx.fillRect(0, 0, W, H);

  // 方眼
  ctx.strokeStyle = "rgba(220,215,200,0.06)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 50) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // 手の揺れを含んだ構図線
  ctx.strokeStyle = "rgba(235,228,212,0.55)";
  ctx.lineCap = "round";
  const wobbly = (x1: number, y1: number, x2: number, y2: number, passes = 2) => {
    for (let pass = 0; pass < passes; pass++) {
      ctx.lineWidth = 0.8 + r() * 1.2;
      ctx.beginPath();
      ctx.moveTo(x1 + (r() - 0.5) * 6, y1 + (r() - 0.5) * 6);
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        ctx.lineTo(x1 + (x2 - x1) * t + (r() - 0.5) * 3, y1 + (y2 - y1) * t + (r() - 0.5) * 3);
      }
      ctx.stroke();
    }
  };
  // 部屋の透視線
  const vx = W * 0.62;
  const vy = H * 0.42;
  for (const [x, y] of [
    [0, 0],
    [W, 0],
    [0, H],
    [W, H],
    [0, H * 0.7],
    [W, H * 0.78],
  ]) {
    wobbly(x, y, vx, vy, 2);
  }
  // 光源の円と照射範囲
  ctx.setLineDash([6, 8]);
  ctx.beginPath();
  ctx.arc(vx, vy, 150, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(vx, vy, 320, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  wobbly(vx - 420, vy, vx + 420, vy, 3);

  // 注記
  ctx.fillStyle = "rgba(235,228,212,0.7)";
  ctx.font = "500 26px 'JetBrains Mono', ui-monospace, monospace";
  ctx.fillText("ROOM 03 / 6.4 × 9.0 m", 60, 90);
  ctx.fillText("LAMP 2400 lm — 2700 K", 60, 130);
  // 右端で切れないよう、右揃えで余白の内側に置く
  ctx.textAlign = "right";
  ctx.fillText("afterimage ≈ 1.6 s", W - 60, vy - 180);
  ctx.textAlign = "left";
  ctx.font = "italic 400 64px 'Instrument Serif', serif";
  ctx.fillText("study no. 7", 60, H - 90);

  addGrain(ctx, 0.08, 7);
  return toTexture(canvas);
}

/** 02 Light test — 実験中の光。芯が強く、周囲はまだ粗い */
export function drawLightTest(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas();
  const r = rng(23);
  ctx.fillStyle = "#07070a";
  ctx.fillRect(0, 0, W, H);

  // 試験用の露光ストリップ（段階的な露出）
  for (let i = 0; i < 8; i++) {
    const v = Math.round(20 + i * 28);
    ctx.fillStyle = `rgb(${v},${Math.round(v * 0.7)},${Math.round(v * 0.45)})`;
    ctx.fillRect(60 + i * 110, H - 170, 100, 60);
  }
  ctx.fillStyle = "rgba(235,228,212,0.6)";
  ctx.font = "500 22px 'JetBrains Mono', ui-monospace, monospace";
  ctx.fillText("EV −3  …  +4", 60, H - 70);

  ctx.globalCompositeOperation = "lighter";
  drawLight(ctx, W * 0.58, H * 0.4, 520, "rgba(255,244,220,1)", "rgba(255,120,40,0.55)", 0.8);
  drawLight(ctx, W * 0.22, H * 0.64, 260, "rgba(160,240,255,0.7)", "rgba(40,140,170,0.25)", 0.3);
  // 散乱光の粒
  for (let i = 0; i < 160; i++) {
    const x = W * 0.58 + (r() - 0.5) * 700;
    const y = H * 0.4 + (r() - 0.5) * 500;
    const s = r() * 3 + 0.5;
    ctx.fillStyle = `rgba(255,${Math.round(150 + r() * 90)},120,${r() * 0.6})`;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";

  // 測光のクロスヘア
  ctx.strokeStyle = "rgba(235,228,212,0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W * 0.58 - 40, H * 0.4);
  ctx.lineTo(W * 0.58 + 40, H * 0.4);
  ctx.moveTo(W * 0.58, H * 0.4 - 40);
  ctx.lineTo(W * 0.58, H * 0.4 + 40);
  ctx.stroke();

  addGrain(ctx, 0.1, 29);
  return toTexture(canvas);
}

/** 03 Final — 完成した展示の光景。重なった光と長い残像 */
export function drawFinal(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas();
  const r = rng(41);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0b0708");
  bg.addColorStop(0.55, "#170a06");
  bg.addColorStop(1, "#050507");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.globalCompositeOperation = "lighter";
  // 残像の尾（弧を描く光の軌跡）
  for (let k = 0; k < 42; k++) {
    const t = k / 42;
    ctx.strokeStyle = `rgba(255,${Math.round(110 + t * 120)},${Math.round(40 + t * 120)},${0.05 + t * 0.12})`;
    ctx.lineWidth = 2 + t * 6;
    ctx.beginPath();
    ctx.arc(W * 0.5, H * 1.05, 380 + k * 9, Math.PI * 1.1, Math.PI * (1.1 + 0.8 * t));
    ctx.stroke();
  }
  drawLight(ctx, W * 0.5, H * 0.46, 620, "rgba(255,250,236,1)", "rgba(255,110,30,0.6)", 1);
  drawLight(ctx, W * 0.82, H * 0.2, 240, "rgba(255,220,170,0.6)", "rgba(255,90,20,0.25)", 0);
  drawLight(ctx, W * 0.15, H * 0.72, 300, "rgba(170,240,255,0.55)", "rgba(40,150,180,0.22)", 0.35);
  // 塵
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle = `rgba(255,230,200,${r() * 0.35})`;
    ctx.fillRect(r() * W, r() * H, 1.5, 1.5);
  }
  ctx.globalCompositeOperation = "source-over";

  // 床の反射
  const floor = ctx.createLinearGradient(0, H * 0.78, 0, H);
  floor.addColorStop(0, "rgba(255,140,60,0.18)");
  floor.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = floor;
  ctx.fillRect(0, H * 0.78, W, H * 0.22);

  addGrain(ctx, 0.08, 43);
  return toTexture(canvas);
}

/** 最初のリビール元になる、地と同じ色の無地 */
export function drawBlank(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas();
  ctx.fillStyle = "#07070a";
  ctx.fillRect(0, 0, W, H);
  return toTexture(canvas);
}
