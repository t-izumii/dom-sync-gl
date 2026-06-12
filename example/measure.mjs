import { chromium } from "playwright";

const URL = process.env.URL || "http://localhost:5181/";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

const samples = await page.evaluate(async () => {
  const gl = document.querySelector("#gl");
  const out = [];
  const frames = 40;

  const translateY = () => {
    const m = new DOMMatrixReadOnly(getComputedStyle(gl).transform);
    return m.m42; // translateY
  };
  const effective = () => -document.documentElement.getBoundingClientRect().top;

  const wait = () => new Promise((r) => requestAnimationFrame(() => r()));

  // 連続 wheel をフレーム毎に流す（RafScroll が拾う）
  for (let i = 0; i < frames; i++) {
    window.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 70, cancelable: true, bubbles: true })
    );
    await wait();
    out.push({
      i,
      eff: Math.round(effective() * 10) / 10,
      tY: Math.round(translateY() * 10) / 10,
      lag: Math.round((effective() - translateY()) * 10) / 10,
    });
  }
  return out;
});

// 動いている区間の平均ズレ
const moving = samples.filter((s) => s.i > 3 && s.i < 35);
const avgLag =
  moving.reduce((a, s) => a + s.lag, 0) / Math.max(1, moving.length);
console.log("frame, effectiveScrollY, containerTranslateY, lag(px)");
for (const s of samples) console.log(`${s.i}\t${s.eff}\t${s.tY}\t${s.lag}`);
console.log("\n=== avg lag while scrolling:", Math.round(avgLag * 10) / 10, "px ===");

await browser.close();
