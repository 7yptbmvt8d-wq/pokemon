// Construit les données de l'app à partir de l'API TCGdex : cartes françaises, anglaises et japonaises, prix Cardmarket en €.
// Sorties : public/data/cards.json, public/data/prices.json, public/data/history/AAAA-MM-JJ.json (hebdo)
// Identifiants : cartes FR sans préfixe (ex. "sv03.5-025"), EN et JP préfixées ("en:sv03.5-025", "ja:SV2a-025").
import { mkdir, writeFile, readdir } from "node:fs/promises";

const OUT = new URL("../public/data/", import.meta.url);
const ASSETS = "https://assets.tcgdex.net/";
const LANGS = (process.env.LANGS || "fr,en,ja").split(",");
const SKIP_SERIES = new Set(["tcgp"]); // Pokémon TCG Pocket (cartes numériques)
const TYPES = {
  Feu: "f", Eau: "e", Plante: "p", "Électrique": "l", Psy: "y", Combat: "c", "Obscurité": "o", "Métal": "m", Incolore: "i", Dragon: "d", "Fée": "a",
  Fire: "f", Water: "e", Grass: "p", Lightning: "l", Psychic: "y", Fighting: "c", Darkness: "o", Metal: "m", Colorless: "i", Fairy: "a",
};
const TRAINER = new Set(["Dresseur", "Trainer"]), ENERGY = new Set(["Énergie", "Energy"]);
const LIMIT = +process.env.SETS_LIMIT || 0; // test : limiter le nombre d'extensions par langue

async function get(lang, path, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`https://api.tcgdex.net/v2/${lang}${path}`, { headers: { "User-Agent": "pokemon-collection/1.0" } });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {}
    await new Promise((s) => setTimeout(s, 800 * 2 ** i));
  }
  throw new Error(`Échec : ${lang}${path}`);
}
async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
const num = (x) => (x == null || x === 0 || isNaN(x) ? null : Math.round(x * 100) / 100);
const pre = (lang) => (lang === "fr" ? "" : lang + ":");

// Type d'extension : "main" (boosters/displays) ou hors complétion (promos, McDonald's, kits, jumbo…)
function kindOf(s) {
  if (["mc", "tk"].includes(s.serie?.id) || /^(jumbo|rc|xya|sve|mee|30th-c)$/i.test(s.id) || /mcdonald|énergie|energy|jumbo|kit d|trainer kit/i.test(s.name)) return "other";
  if (/^P-|-P$|p$|^(wp|np)$/i.test(s.id) || /promo|プロモ/i.test(s.name)) return "promo";
  return "main";
}

const sets = [], cards = [], prices = {}, dexFr = new Map();
for (const lang of LANGS) {
  const list = (await get(lang, "/sets")) ?? [];
  let full = (await pool(list, 8, (s) => get(lang, `/sets/${encodeURIComponent(s.id)}`))).filter((s) => s && !SKIP_SERIES.has(s.serie?.id));
  if (LIMIT) full = full.slice(-LIMIT);
  const meta = new Map(full.map((s) => [s.id, s])), refs = [];
  for (const s of full) {
    sets.push({
      id: pre(lang) + s.id, raw: s.id, lang, name: s.name, serie: s.serie?.name ?? "", serieId: s.serie?.id ?? "",
      // Japon : pas d'abréviation, le code imprimé sur la carte est l'identifiant (SV2a, M1S…)
      code: s.abbreviation?.official ?? (lang === "ja" ? s.id : ""), official: s.cardCount?.official ?? 0, total: s.cardCount?.total ?? s.cards?.length ?? 0,
      logo: s.logo ? s.logo.replace(ASSETS, "") : "", date: s.releaseDate ?? "", kind: kindOf(s),
    });
    for (const c of s.cards ?? []) refs.push({ set: s.id, ref: c });
  }
  let done = 0;
  await pool(refs, 24, async ({ set, ref }) => {
    const c = await get(lang, `/cards/${encodeURIComponent(ref.id)}`).catch(() => null);
    const v = c?.variants ?? {};
    const vs = (v.normal ? "n" : "") + (v.reverse ? "r" : "") + (v.holo ? "h" : "") + (v.firstEdition ? "1" : "");
    // Illustration : 1 = chemin standard <langue>/<série>/<extension>/<numéro>, 0 = aucune, sinon chemin
    const path = (c?.image ?? ref.image ?? "").replace(ASSETS, "");
    const img = !path ? 0 : path === `${lang}/${meta.get(set).serie?.id}/${set}/${ref.localId}` ? 1 : path;
    const t = TYPES[c?.types?.[0]] ?? (TRAINER.has(c?.category) ? "t" : ENERGY.has(c?.category) ? "n" : "");
    const dex = c?.dexId?.[0];
    if (lang === "fr" && dex && !dexFr.has(dex)) dexFr.set(dex, (c.name || "").replace(/[- ](ex|EX|GX|V|VMAX|VSTAR|V-UNION|LV\.X|δ|☆|◇|BREAK|Prime)$/u, "").trim());
    // Alias français (recherche « dracaufeu » pour Charizard / リザードン)
    const alias = lang !== "fr" && dex ? dex : 0;
    // Marque de règlement (lettre D, E, F, G, H… imprimée en bas à gauche depuis Épée et Bouclier)
    cards.push([pre(lang) + ref.id, pre(lang) + set, ref.localId, c?.name ?? ref.name, c?.rarity ?? "", vs || "n", img, t, c?.hp ?? 0, alias, c?.regulationMark ?? ""]);
    const cm = c?.pricing?.cardmarket;
    if (cm) {
      const p = [num(cm.trend), num(cm.low), num(cm.avg30), num(cm["trend-holo"]), num(cm["low-holo"]), num(cm["avg30-holo"])];
      if (p.some((x) => x != null)) prices[pre(lang) + ref.id] = p;
    }
    if (++done % 5000 === 0) console.log(`${lang} ${done} / ${refs.length}`);
  });
}
for (const c of cards) c[9] = c[9] ? dexFr.get(c[9]) ?? "" : "";
sets.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || LANGS.indexOf(a.lang) - LANGS.indexOf(b.lang) || a.id.localeCompare(b.id, "fr", { numeric: true }));
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
const per = Object.fromEntries(LANGS.map((l) => [l, cards.filter((c) => (sets[ord.get(c[1])].lang === l)).length]));
console.log(`${cards.length} cartes (${JSON.stringify(per)}), ${Object.keys(prices).length} prix, ${sets.length} extensions`);
