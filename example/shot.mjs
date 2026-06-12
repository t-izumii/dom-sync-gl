import { chromium } from "playwright";

const URL = process.env.URL || "http://localhost:5181/";
const OUT = process.env.OUT || "/tmp";

const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});

const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

await page.goto(URL, { waitUntil: "networkidle" });
// loader (0->100) + shader warmup
await page.waitForTimeout(2500);

const shoot = async (name, y) => {
  await page.evaluate((yy) => window.scrollTo(0, yy), y);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${name}.png` });
};

// セクション位置を取得
const pos = await page.evaluate(() => {
  const r = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { top: b.top + window.scrollY, width: Math.round(b.width), height: Math.round(b.height), left: Math.round(b.left) };
  };
  return {
    manifesto: r(".manifesto"),
    manifestoText: r(".manifesto__text"),
    works: r(".works"),
    footer: r(".footer"),
    docW: document.documentElement.clientWidth,
  };
});

await shoot("01-hero", 0);
if (pos.manifesto) await shoot("02-manifesto", pos.manifesto.top - 120);
if (pos.works) await shoot("03-works", pos.works.top - 80);
if (pos.works) await shoot("03b-works", pos.works.top + 900);
if (pos.works) await shoot("03c-works", pos.works.top + 1900);
if (pos.footer) await shoot("04-footer", pos.footer.top - 80);

console.log(JSON.stringify({ pos, errors }, null, 2));

await browser.close();
