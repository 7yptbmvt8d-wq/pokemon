// Génère les PNG d'icônes à partir de icon.svg (Playwright requis)
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { readFile } from "node:fs/promises";
const svg = await readFile(new URL("../public/icons/icon.svg", import.meta.url), "utf8");
const b = await chromium.launch();
for (const s of [180, 192, 512]) {
  const p = await b.newPage({ viewport: { width: s, height: s } });
  await p.setContent(`<body style="margin:0">${svg.replace("<svg ", `<svg width="${s}" height="${s}" `)}</body>`);
  await p.screenshot({ path: new URL(`../public/icons/icon-${s}.png`, import.meta.url).pathname });
}
await b.close();
