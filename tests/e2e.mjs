// Tests de bout en bout (Playwright, iPhone 17 Pro Max 440×956) : ajout, scan, complétion, hors ligne.
// Prérequis : données générées (npm run data) et serveur local (python3 -m http.server 8080 --directory public)
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
const { chromium } = createRequire(import.meta.url)("playwright");
const URL_ = process.env.APP_URL || "http://localhost:8080/";
const OUT = new URL("../test-results/", import.meta.url).pathname;
await mkdir(OUT, { recursive: true });

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "✓" : "✗"} ${msg}`); if (!cond) fails++; };
// Profil sur disque (comme un vrai téléphone) : en navigation privée, Chromium limite le quota et vide le cache
const { mkdtemp } = await import("node:fs/promises"), { tmpdir } = await import("node:os");
const ctx = await chromium.launchPersistentContext(await mkdtemp(`${tmpdir()}/pkcol-`), { viewport: { width: 440, height: 956 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "fr-FR", acceptDownloads: true });
const page = ctx.pages()[0] ?? await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
const shot = (n) => page.screenshot({ path: `${OUT}${n}.png` });
const store = () => page.evaluate(() => JSON.parse(localStorage.getItem("pkcol.v1") || "{}"));
const search = async (q) => { await page.fill("#q", q); await page.click("#search-form button[type=submit]"); await page.waitForTimeout(150); return page.$$eval("#results .result", (r) => r.map((x) => x.dataset.id)); };
const addFromSheet = async () => { await page.click("#save"); await page.waitForTimeout(250); };

await page.goto(URL_);
await page.waitForSelector("html[data-ready='1']", { timeout: 30000 });
await shot("01-accueil-vide");
ok(await page.isVisible("#empty"), "Accueil vide : invitation à ajouter");
const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
ok(noHScroll, "Pas de défilement horizontal à 440 px");

// ---- Recherche souple ----
await page.click(".nav .fab");
let r = await search("MEW 025"); ok(r[0] === "sv03.5-025" && r.includes("en:sv03.5-025"), `« MEW 025 » → Pikachu 151 FR puis EN (${r})`);
r = await search("MEW FR 025"); ok(r.length === 1 && r[0] === "sv03.5-025", "« MEW FR 025 » → uniquement FR");
r = await search("MEW EN 025"); ok(r.length === 1 && r[0] === "en:sv03.5-025", "« MEW EN 025 » → carte anglaise");
r = await search("F 051/196"); ok(r[0] === "swsh11-051", `« F 051/196 » (marque F + total) → Origine Perdue (${r[0]})`);
r = await search("G 025/165"); ok(r[0] === "sv03.5-025", "« G 025/165 » → 151");
r = await search("SV2a 25"); ok(r[0] === "ja:SV2a-025", `« SV2a 25 » → carte japonaise (${r[0]})`);
r = await search("MEW FR"); ok((await page.$$("#results .set-row")).length === 1, "« MEW FR » → extension 151 FR proposée");
r = await search("pikachu"); ok(r.some((x) => x.startsWith("ja:")) && r.some((x) => x.startsWith("en:")), "Nom français → cartes EN et JP aussi (alias)");
r = await search("025/165"); ok(r.includes("sv03.5-025"), `« 025/165 » → déduit par le total imprimé (${r.length} résultat(s))`);
r = await search("151 25"); ok(r[0] === "sv03.5-025", "« 151 25 » → nom d'extension + numéro");
r = await search("svi 1"); ok(r[0] === "sv01-001", `« svi 1 » → code SVI (${r[0]})`);
r = await search("25"); ok(r.length > 3 && (await page.textContent("#results")).includes("Numéro seul"), `« 25 » seul → liste des correspondances (${r.length})`);
r = await search("dracaufeu"); ok(r.length > 5, `Recherche par nom « dracaufeu » (${r.length})`);
await shot("02-recherche");

// ---- Ajout : fiche carte ----
await search("MEW 025");
await page.click("#results .result");
await page.waitForSelector("#sheet[open] #save");
await page.waitForTimeout(300);
await shot("03-fiche-ajout");
ok(await page.isVisible("#vars [data-v='r']"), "Variantes proposées (Normale / Reverse)");
await page.click("#vars [data-v='r']");
await page.click("#conds [data-c='Mint']");
await page.fill("[name=buy]", "0.50");
const coteR = await page.textContent("#cote");
await addFromSheet();
let s = await store();
ok(s.items?.length === 1 && s.items[0].v === "r" && s.items[0].cond === "Mint" && s.items[0].lang === "FR", "Carte ajoutée en Reverse / Mint / FR");
ok(/€/.test(coteR), `Cote reverse affichée (${coteR})`);
// Doublon identique → fusion
await page.click("#results .result"); await page.waitForSelector("#sheet[open] #save");
await page.click("#vars [data-v='r']"); await page.click("#conds [data-c='Mint']"); await page.fill("[name=buy]", "0.50");
await addFromSheet();
s = await store(); ok(s.items.length === 1 && s.items[0].qty === 2, "Doublon identique fusionné (×2)");
// Même carte, variante normale → nouvelle ligne
await page.click("#results .result"); await page.waitForSelector("#sheet[open] #save");
await addFromSheet();
s = await store(); ok(s.items.length === 2, "Variante différente → ligne séparée");

// ---- Investissement : achat scellé + provenance ----
await page.click(".nav [data-goto=home]");
await page.click('[data-act="invest"]');
await page.click("#p-add");
await page.selectOption("#p-form [name=type]", "Display");
await page.fill("#p-form [name=label]", "Display 151");
await page.fill("#p-form [name=price]", "180");
await page.click("#p-form button[type=submit]");
await page.waitForTimeout(200);
await shot("04-investissement");
await page.click("#sheet [data-close]");
await page.click(".nav .fab");
for (const q of ["MEW 006", "MEW 199", "MEW 001"]) {
  await search(q); await page.click("#results .result"); await page.waitForSelector("#sheet[open] #save");
  const src = await page.$eval("[name=src]", (e) => e.value);
  ok(!!src, `${q} : provenance « Display 151 » reprise par défaut`);
  await addFromSheet();
}
s = await store();
ok(s.items.filter((i) => i.src).length === 3, "3 cartes rattachées à l'achat scellé");

// ---- Accueil ----
await page.click(".nav [data-goto=home]");
await page.waitForTimeout(400);
await shot("05-accueil");
const total = await page.textContent("#total");
ok(/\d/.test(total), `Valeur totale affichée (${total})`);
ok(!!(await page.$("#chart-total svg polyline")), "Courbe de la valeur affichée dès le 1er jour (moyennes Cardmarket)");
ok(/depuis le/.test(await page.textContent("#delta")), `Variation sur la période : ${(await page.textContent("#delta")).trim()}`);
ok(/181/.test(await page.textContent("#stats")), "Tuile Investi = scellé 180 € + unité 2 × 0,50 €");
ok(await page.isVisible("#my-sets .set-row"), "Bloc « Mes sets » visible");
const ringTxt = await page.textContent("#ring-count");
ok(/3 \/ 165/.test(ringTxt.replace(/ | /g, " ")), `Anneau global : ${ringTxt.trim()} (199 = secrète, hors total officiel)`);
await page.click('#periods [data-p="30"]');
ok(await page.$eval('#periods [data-p="30"]', (b) => b.classList.contains("on")), "Choix de période 1M");
await page.click('#periods [data-p="180"]');
await page.locator("#grid").scrollIntoViewIfNeeded();
await shot("06-mes-cartes");
await page.selectOption("#sort", "value");
ok((await store()).settings.sort === "value", "Tri mémorisé");
await page.selectOption("#sort", "number");

// ---- Complétion : vue extension ----
await page.click("#my-sets .set-row");
await page.waitForSelector("#sheet[open] #binder");
await page.waitForTimeout(400);
await shot("07-extension");
let head = await page.textContent("#sheet .prog b");
ok(head.trim() === "3/165", `Une par numéro : 3/165 (${head.trim()})`);
const missing = await page.$$eval(".slot.miss", (x) => x.length);
ok(missing === 7, `Page 1 (001–009, 001 et 006 possédées) : 7 pochettes manquantes (${missing})`);
ok((await page.textContent(".slot:not(.miss) .vb")).includes("◆"), "Badge ◆ variantes possédées");
await page.click('#set-chips [data-show="missing"]');
ok((await page.$$eval(".slot", (x) => x.length)) === 9 && (await page.$$eval(".slot:not(.miss)", (x) => x.length)) === 0, "Filtre Manquantes");
await page.click('#set-chips [data-show="all"]');
// Balayage → page 2
const box = await page.locator("#binder").boundingBox();
await page.evaluate(({ x, y }) => {
  const el = document.querySelector("#binder"), t = (cx) => [new Touch({ identifier: 1, target: el, clientX: cx, clientY: y })];
  el.dispatchEvent(new TouchEvent("touchstart", { touches: t(x + 150), changedTouches: t(x + 150), bubbles: true }));
  el.dispatchEvent(new TouchEvent("touchend", { touches: [], changedTouches: t(x - 50), bubbles: true }));
}, { x: box.x + box.width / 2, y: box.y + 100 });
await page.waitForTimeout(200);
ok((await page.textContent("#dots .pg")).includes("Page 2"), "Balayage → page 2");
await page.evaluate(() => { document.querySelector("#sheet").scrollTop = 400; });
const y0 = await page.$eval("#sheet", (d) => d.scrollTop);
await page.click('#dots [data-page="0"]');
ok(Math.abs((await page.$eval("#sheet", (d) => d.scrollTop)) - y0) < 2 && (await page.textContent("#dots .pg")).includes("Page 1"), `Changement de page : position conservée (${y0} px)`);
await page.click('#set-mode [data-mode="master"]');
head = await page.textContent("#sheet .prog b");
ok(/^5\/\d{3}$/.test(head.trim()), `Master set : ${head.trim()} (secrètes + reverses)`);
await shot("08-master-set");
await page.click('#set-mode [data-mode="base"]');
ok(/pour compléter/i.test(await page.textContent("#sheet .cost-line")) && /€/.test(await page.textContent("#sheet .cost-line")), "Coût estimé pour compléter");
// Toucher une manquante → fiche → ajout → retour à la vue extension
await page.click(".slot.miss >> nth=0");
await page.waitForSelector("#sheet[open] #save");
ok(await page.isVisible("[data-back]"), "Fiche ouverte depuis l'extension (retour)");
await page.waitForTimeout(300);
await shot("09-fiche-depuis-extension");
await addFromSheet();
await page.waitForSelector("#sheet[open] #binder");
head = await page.textContent("#sheet .prog b");
ok(head.trim() === "4/165", `Retour à l'extension après ajout : ${head.trim()}`);
await page.click("#sheet [data-close]");

// ---- Fiche d'une carte possédée : stepper, recherchées ----
await page.click("#grid .tile >> nth=0");
await page.waitForSelector("#sheet[open] #q-plus");
await page.click("#q-plus");
ok(+(await page.textContent("#q-out")) >= 2, "Stepper + : quantité enregistrée");
await page.click("#sheet [data-close]");
await page.click(".nav .fab"); await search("MEW 150"); await page.click("#results .result"); await page.waitForSelector("#sheet[open] #wish-btn");
await page.click("#wish-btn"); await page.click('#prio [data-p="1"]'); await page.click("#sheet [data-close]");
await page.click(".nav [data-goto=home]"); await page.click("#b-wish");
ok((await page.$$("#wish-list .w-row")).length === 1, "Recherchées : 1 carte, priorité haute");
await shot("10-recherchees");
await page.click("#view-wish [data-goto=home]"); await page.click("#completion [data-goto=sets]");
await page.waitForTimeout(200);
await shot("11-sets");
ok((await page.$$(".nav button")).length === 3, "Barre : Collection / + / Réglages");
await page.click(".nav [data-goto=profile]");
await shot("12-profil");
ok((await page.textContent("#app-version")).includes("Version"), "Numéro de version dans Profil");
// Export CSV (séparateur ;) et JSON
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#export-csv")]);
const csv = await (await import("node:fs/promises")).readFile(await dl.path(), "utf8");
ok(csv.split("\n")[0].includes(";") && /0,50/.test(csv), "Export CSV ; avec décimales à virgule");
const [dj] = await Promise.all([page.waitForEvent("download"), page.click("#export")]);
ok(JSON.parse(await (await import("node:fs/promises")).readFile(await dj.path(), "utf8")).items.length >= 6, "Export JSON");

// ---- Scan (OCR) : illustration officielle comme « photo » ----
await page.click(".nav .fab");
const imgBuf = Buffer.from(await (await fetch("https://assets.tcgdex.net/fr/sv/sv03.5/025/high.png")).arrayBuffer());
await page.setInputFiles("#scan-input", { name: "photo.png", mimeType: "image/png", buffer: imgBuf });
await page.waitForFunction(() => /Lu sur la carte|non reconnu|indisponible/.test(document.querySelector("#scan-status").textContent), null, { timeout: 120000 });
const st = await page.textContent("#scan-status");
r = await page.$$eval("#results .result", (x) => x.map((e) => e.dataset.id));
ok(r.includes("sv03.5-025"), `Scan : ${st.trim()} → ${r.slice(0, 3)}`);
await shot("13-scan");
if (r.length) { await page.click(`#results .result[data-id="sv03.5-025"]`); await page.waitForSelector("#sheet[open] #save"); ok(await page.isVisible("[name=useScan]"), "Photo scannée proposée comme illustration"); await page.click("#sheet [data-close]"); }

// ---- Hors ligne ----
await page.goto(URL_); await page.waitForSelector("html[data-ready='1']");
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload(); await page.waitForSelector("html[data-ready='1']"); await page.waitForTimeout(3000);
await ctx.setOffline(true);
await page.reload(); await page.waitForSelector("html[data-ready='1']", { timeout: 20000 });
await page.waitForTimeout(500);
ok((await page.$$("#grid .tile")).length >= 6, "Hors ligne : app et collection affichées");
await page.click(".nav .fab"); r = await search("MEW 025");
ok(r[0] === "sv03.5-025", `Hors ligne : recherche disponible (données en cache) ${r.slice(0, 2)} ${await page.textContent("#data-info")}`);
await shot("14-hors-ligne");
await ctx.setOffline(false);

ok(!errors.length, `Aucune erreur JS ${errors.length ? errors.join(" | ") : ""}`);
await ctx.close();
console.log(fails ? `\n${fails} échec(s)` : "\nTous les tests passent");
process.exit(fails ? 1 : 0);
