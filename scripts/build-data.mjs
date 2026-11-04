// Construit les données de l'app à partir de l'API TCGdex (français, prix Cardmarket en €).
// Sorties : public/data/cards.json, public/data/prices.json, public/data/history/AAAA-MM-JJ.json (hebdo)
import { mkdir, writeFile, readdir } from "node:fs/promises";

const OUT = new URL("../public/data/", import.meta.url);
const API = "https://api.tcgdex.net/v2/fr";
const ASSETS = "https://assets.tcgdex.net/";
const SKIP_SERIES = new Set(["tcgp"]); // Pokémon TCG Pocket (cartes numériques)
const TYPES = { Feu: "f", Eau: "e", Plante: "p", "Électrique": "l", Psy: "y", Combat: "c", "Obscurité": "o", "Métal": "m", Incolore: "i", Dragon: "d", "Fée": "a" };
const LIMIT = +process.env.SETS_LIMIT || 0; // test : limiter le nombre d'extensions

async function get(path, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(API + path, { headers: { "User-Agent": "pokemon-collection/1.0" } });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {}
    await new Promise((s) => setTimeout(s, 800 * 2 ** i));
  }
  throw new Error("Échec : " + path);
}
async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
const num = (x) => (x == null || x === 0 || isNaN(x) ? null : Math.round(x * 100) / 100);

// Type d'extension : "main" (boosters/displays) ou hors complétion (promos, McDonald's, kits, jumbo…)
function kindOf(s) {
  if (["mc", "tk"].includes(s.serie?.id) || /^(jumbo|rc|xya|sve|mee|30th-c)$/.test(s.id) || /mcdonald|énergie|jumbo|kit d/i.test(s.name)) return "other";
  if (/^P-|p$|^(wp|np)$/i.test(s.id) || /promo/i.test(s.name)) return "promo";
  return "main";
}

const list = (await get("/sets")) ?? [];
let full = (await pool(list, 8, (s) => get(`/sets/${encodeURIComponent(s.id)}`))).filter((s) => s && !SKIP_SERIES.has(s.serie?.id));
if (LIMIT) full = full.filter((s) => s.serie?.id === "sv").slice(-LIMIT);

const sets = [], refs = [];
for (const s of full) {
  sets.push({
    id: s.id, name: s.name, serie: s.serie?.name ?? "", serieId: s.serie?.id ?? "",
    code: s.abbreviation?.official ?? "", official: s.cardCount?.official ?? 0, total: s.cardCount?.total ?? s.cards?.length ?? 0,
    logo: s.logo ? s.logo.replace(ASSETS, "") : "", symbol: s.symbol ? s.symbol.replace(ASSETS, "") : "",
    date: s.releaseDate ?? "", kind: kindOf(s),
  });
  for (const c of s.cards ?? []) refs.push({ set: s.id, ref: c });
}
sets.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.id.localeCompare(b.id, "fr", { numeric: true }));

const cards = [], prices = {};
let done = 0;
await pool(refs, 24, async ({ set, ref }) => {
  const c = await get(`/cards/${encodeURIComponent(ref.id)}`).catch(() => null);
  const v = c?.variants ?? {};
  const vs = (v.normal ? "n" : "") + (v.reverse ? "r" : "") + (v.holo ? "h" : "") + (v.firstEdition ? "1" : "");
  // Illustration : 1 = chemin standard fr/<série>/<extension>/<numéro>, 0 = aucune, sinon chemin
  const meta = full.find((x) => x.id === set), path = (c?.image ?? ref.image ?? "").replace(ASSETS, "");
  const img = !path ? 0 : path === `fr/${meta.serie?.id}/${set}/${ref.localId}` ? 1 : path;
  // Type (1re énergie) en code court, PV
  const t = TYPES[c?.types?.[0]] ?? (c?.category === "Dresseur" ? "t" : c?.category === "Énergie" ? "n" : "");
  cards.push([ref.id, set, ref.localId, c?.name ?? ref.name, c?.rarity ?? "", vs || "n", img, t, c?.hp ?? 0]);
  const cm = c?.pricing?.cardmarket;
  if (cm) {
    const p = [num(cm.trend), num(cm.low), num(cm.avg30), num(cm["trend-holo"]), num(cm["low-holo"]), num(cm["avg30-holo"])];
    if (p.some((x) => x != null)) prices[ref.id] = p;
  }
  if (++done % 2000 === 0) console.log(`${done} / ${refs.length}`);
});
const ord = new Map(sets.map((s, i) => [s.id, i]));
cards.sort((a, b) => ord.get(a[1]) - ord.get(b[1]) || a[2].localeCompare(b[2], "fr", { numeric: true }));

// Taux de change (devise d'affichage), base EUR
let fx = { EUR: 1, USD: 1.1, GBP: 0.85, CHF: 0.95 };
try { const r = await (await fetch("https://api.frankfurter.dev/v1/latest?from=EUR&to=USD,GBP,CHF")).json(); fx = { EUR: 1, ...r.rates }; } catch {}

const updated = new Date().toISOString().slice(0, 10);
await mkdir(new URL("history/", OUT), { recursive: true });
await writeFile(new URL("cards.json", OUT), JSON.stringify({ updated, assets: ASSETS, sets, cards }));
await writeFile(new URL("prices.json", OUT), JSON.stringify({ updated, fx, p: prices }));

// Instantané hebdomadaire (prix "trend" normal et reverse) : le lundi, ou si aucun point depuis 7 jours
const hdir = new URL("history/", OUT);
const dates = (await readdir(hdir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort();
const last = dates.at(-1);
const age = last ? (Date.parse(updated) - Date.parse(last)) / 864e5 : Infinity;
if (!LIMIT && (age >= 7 || (new Date().getUTCDay() === 1 && last !== updated))) {
  const snap = {};
  for (const [id, p] of Object.entries(prices)) if (p[0] != null || p[3] != null) snap[id] = [p[0], p[3]];
  await writeFile(new URL(`${updated}.json`, hdir), JSON.stringify({ p: snap }));
  dates.push(updated);
}
await writeFile(new URL("index.json", hdir), JSON.stringify(dates));
console.log(`${cards.length} cartes, ${Object.keys(prices).length} prix, ${sets.length} extensions`);
