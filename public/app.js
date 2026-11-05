// Ma Collection Pokémon — application locale (PWA), la collection ne quitte jamais l'appareil.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const deacc = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const CONDS = ["Mint", "Near Mint", "Excellent", "Good", "Light Played", "Played", "Poor"];
const VARS = { n: "Normale", r: "Reverse", h: "Holo", 1: "1re édition" };
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const fmtDate = (d) => d ? d.slice(8, 10) + "/" + d.slice(5, 7) + "/" + d.slice(0, 4) : "";
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------- Stockage local ----------
const KEY = "pkcol.v1";
const blank = () => ({ items: [], purchases: [], wish: {}, hist: {}, lastSnap: "", settings: { currency: "EUR", period: 180, sort: "number" } });
let store;
try { store = { ...blank(), ...JSON.parse(localStorage.getItem(KEY)) }; } catch { store = blank(); }
store.settings = { ...blank().settings, ...store.settings };
store.purchases ??= []; store.hist ??= {}; store.wish ??= {};
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { toast("Stockage plein : exporte puis supprime des photos."); } };

const idb = (() => {
  let p;
  const open = () => (p ??= new Promise((res, rej) => {
    const r = indexedDB.open("pkcol", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("photos");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction("photos", mode); const q = fn(t.objectStore("photos"));
      t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error);
    });
  };
  return { get: (k) => tx("readonly", (s) => s.get(k)), set: (k, v) => tx("readwrite", (s) => s.put(v, k)), del: (k) => tx("readwrite", (s) => s.delete(k)) };
})();
const photoUrls = new Map();
async function photoUrl(key) {
  if (photoUrls.has(key)) return photoUrls.get(key);
  const b = await idb.get(key).catch(() => null);
  const u = b ? URL.createObjectURL(b) : null; photoUrls.set(key, u); return u;
}

// ---------- Données cartes / prix (TCGdex) ----------
let ASSET = "https://assets.tcgdex.net/";
let cards = [], byId = new Map(), bySet = new Map(), sets = new Map(), setOrd = new Map(), prices = { p: {}, fx: { EUR: 1 }, updated: "" };
const hist = { dates: null, snaps: new Map() };

// Numéro normalisé : "025" → "25", "TG05" → "TG5", "SV045" → "SV45"
const normNum = (l) => { const m = String(l).toUpperCase().match(/^([A-Z]*)0*(\d+)([A-Z]*)$/); return m ? m[1] + m[2] + m[3] : String(l).toUpperCase(); };
const isOfficial = (c) => { const s = sets.get(c.s); return /^\d+$/.test(c.l) && s?.official > 0 && +c.l <= s.official; };
function numKey(c) {
  const m = String(c?.l ?? "").match(/^(\D*)(\d+)(.*)$/);
  return [setOrd.get(c?.s) ?? 1e6, m ? (m[1] ? 1 : 0) : 2, m ? m[1] : "", m ? +m[2] : 0, m ? m[3] : String(c?.l ?? "")];
}
function cmpKey(a, b) {
  for (let i = 0; i < a.length; i++) { if (a[i] === b[i]) continue; return typeof a[i] === "number" ? a[i] - b[i] : String(a[i]).localeCompare(String(b[i])); }
  return 0;
}
function img(c, big) {
  if (!c || !c.img) return null;
  const s = sets.get(c.s), path = c.img === 1 ? `${s.lang || "fr"}/${s.serieId}/${s.raw ?? s.id}/${c.l}` : c.img;
  return `${ASSET}${path}/${big ? "high" : "low"}.webp`;
}
const logoUrl = (s) => (s?.logo ? `${ASSET}${s.logo}.webp` : null);
const numLabel = (c) => { const s = sets.get(c?.s); return c ? (/^\d+$/.test(c.l) && s?.official ? `${c.l}/${String(s.official).padStart(String(c.l).length, "0")}` : c.l) : ""; };
// Langues des cartes : FR (sans préfixe), EN ("en:"), JP ("ja:")
const LANG_LABEL = { fr: "FR", en: "EN", ja: "JP" }, LRANK = { fr: 0, en: 1, ja: 2 };
const langOf = (c) => sets.get(c?.s)?.lang ?? "fr";
const lgTag = (lang) => (lang && lang !== "fr" ? `<span class="lg">${LANG_LABEL[lang]}</span>` : "");
// Nom affiché : carte japonaise suivie de son nom français
const nm = (c) => (c ? (langOf(c) === "ja" && c.a ? `${c.name} (${c.a})` : c.name) : "");
const setLabel = (s) => (s ? `${s.code && s.code !== s.name ? `${s.code} · ` : ""}${s.name}${s.lang && s.lang !== "fr" ? ` · ${LANG_LABEL[s.lang]}` : ""}` : "");
const defVariant = (c) => (c?.v.includes("n") ? "n" : c?.v.includes("h") ? "h" : c?.v[0] ?? "n");

async function loadData() {
  const [c, p] = await Promise.all([fetch("data/cards.json").then((r) => r.json()), fetch("data/prices.json").then((r) => r.json())]);
  ASSET = c.assets || ASSET; prices = p; prices.fx ??= { EUR: 1 };
  c.sets.forEach((s, i) => { sets.set(s.id, s); setOrd.set(s.id, i); bySet.set(s.id, []); });
  cards = c.cards.map(([id, s, l, name, r, v, im, t, hp, al, g]) => ({ id, s, l, name, r, v, img: im, t, hp, a: al || "", g: /^[A-Z]$/i.test(g || "") ? g.toUpperCase() : "", k: deacc(al ? `${name} ${al}` : name).toLowerCase() }));
  for (const x of cards) { byId.set(x.id, x); bySet.get(x.s)?.push(x); }
  snapshot();
}

// Point d'historique local à chaque nouvelle mise à jour des prix
const hk = (id, v) => (v === "r" ? id + "|r" : id);
function snapshot() {
  const d = prices.updated; if (!d) return;
  for (const k of new Set(store.items.map((i) => hk(i.id, i.v)))) addPoint(k, d);
  store.lastSnap = d; save();
}
function addPoint(key, d = prices.updated) {
  const [id, r] = key.split("|"), v = marketEUR(id, r ? "r" : "n"); if (v == null || !d) return;
  const h = (store.hist[key] ??= []);
  if (h.at(-1)?.[0] === d) h[h.length - 1] = [d, v]; else h.push([d, v]);
}
async function loadServerHist(from) {
  if (!hist.dates) hist.dates = await fetch("data/history/index.json").then((r) => r.json()).catch(() => []);
  const need = hist.dates.filter((d) => d >= from && !hist.snaps.has(d));
  await Promise.all(need.map(async (d) => hist.snaps.set(d, await fetch(`data/history/${d}.json`).then((r) => r.json()).catch(() => null))));
}

// ---------- Valeurs ----------
// Prix Cardmarket : [trend, low, avg30, trend-holo, low-holo, avg30-holo] — reverse → "-holo"
const marketEUR = (id, v) => { const p = prices.p[id]; if (!p) return null; return v === "r" ? p[3] ?? p[5] : p[0] ?? p[2]; };
const lowEUR = (id, v) => { const p = prices.p[id]; return p ? (v === "r" ? p[4] : p[1]) : null; };
const avg30EUR = (id, v) => { const p = prices.p[id]; return p ? (v === "r" ? p[5] : p[2]) : null; };
const hasManual = (it) => it.manual != null && it.manual !== "";
const unitEUR = (it) => (hasManual(it) ? +it.manual : marketEUR(it.id, it.v));
function money(eur, dec = 2) {
  if (eur == null || isNaN(eur)) return "—";
  const cur = store.settings.currency, k = prices.fx?.[cur] ?? 1;
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: cur, minimumFractionDigits: dec, maximumFractionDigits: dec }).format(eur * k);
}
const pct = (x) => (x == null || !isFinite(x) ? "" : (x >= 0 ? "+" : "") + (x * 100).toFixed(1).replace(".", ",") + " %");
const fromDate = () => (store.settings.period ? daysAgo(store.settings.period) : "0000");

// Amorce de l'historique : moyennes Cardmarket sur 30 jours, 7 jours et la veille, placées au milieu de leur période.
// Utilisées seulement avant le premier point réellement relevé : elles s'effacent à mesure que l'historique se construit.
const shiftDate = (d, n) => new Date(Date.parse(d) - n * 864e5).toISOString().slice(0, 10);
function seedPoints(id, v) {
  const p = prices.p[id], d = prices.updated; if (!p || !d) return [];
  const [a30, a7, a1] = v === "r" ? [p[5], p[8], p[9]] : [p[2], p[6], p[7]];
  return [[shiftDate(d, 15), a30], [shiftDate(d, 4), a7], [shiftDate(d, 1), a1]].filter((x) => x[1] != null);
}
function cardPoints(id, v, from = fromDate(), info) {
  const m = new Map(), i = v === "r" ? 1 : 0;
  for (const [d, s] of hist.snaps) { const x = s?.p[id]?.[i]; if (d >= from && x != null) m.set(d, x); }
  for (const [d, e] of store.hist[hk(id, v)] || []) if (d >= from) m.set(d, e);
  const first = [...m.keys()].sort()[0] ?? "9999";
  let seeded = 0;
  for (const [d, x] of seedPoints(id, v)) if (d >= from && d < first && !m.has(d)) { m.set(d, x); seeded++; }
  if (info) info.seeded = seeded;
  return [...m].sort((a, b) => a[0].localeCompare(b[0]));
}
function change(it) {
  if (hasManual(it)) return null;
  const pts = cardPoints(it.id, it.v); if (pts.length < 2 || !pts[0][1]) return null;
  return { abs: pts.at(-1)[1] - pts[0][1], rel: (pts.at(-1)[1] - pts[0][1]) / pts[0][1] };
}
function totalSeries() {
  const from = fromDate(), per = store.items.map((it) => [it, cardPoints(it.id, it.v, from)]);
  const dates = [...new Set(per.flatMap(([, p]) => p.map((x) => x[0])))].sort();
  return dates.map((d) => {
    let t = 0;
    for (const [it, pts] of per) {
      let v = unitEUR(it);
      if (!hasManual(it) && pts.length) { v = pts[0][1]; for (const [pd, pv] of pts) if (pd <= d) v = pv; }
      t += (v || 0) * it.qty;
    }
    return [d, t];
  });
}

// ---------- Composants (CardFrame, TypeBadge, ProgressRing, ProgressBar, SetRow, BinderPage, Stepper, PillFilter) ----------
const svg = (d) => `<svg class="i" viewBox="0 0 24 24">${d}</svg>`;
const ICONS = {
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', back: '<path d="m15 18-6-6 6-6"/>', star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>', minus: '<path d="M6 12h12"/>', plus: '<path d="M12 6v12M6 12h12"/>', link: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};
// Icônes d'énergie dessinées maison (trait 2,4)
const TYPES = {
  f: ["Feu", '<path d="M12 21c-4 0-6.5-2.7-6.5-6.2 0-3.6 3-5.6 4-9.3 2.6 1.8 3.2 4.3 3 6 1-.6 1.7-1.7 2-3 1.8 1.7 4 4 4 6.6 0 3.4-2.6 5.9-6.5 5.9z"/>'],
  e: ["Eau", '<path d="M12 3c3.5 4.6 6 8 6 11a6 6 0 0 1-12 0c0-3 2.5-6.4 6-11z"/>'],
  p: ["Plante", '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14z"/><path d="M5 19 13 11"/>'],
  l: ["Électrique", '<path d="M13 2 5 14h6l-1 8 8-12h-6z"/>'],
  y: ["Psy", '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>'],
  c: ["Combat", '<path d="M7 11V7.5a1.5 1.5 0 0 1 3 0V10M10 9.5V6.5a1.5 1.5 0 0 1 3 0V10M13 9.5V7a1.5 1.5 0 0 1 3 0v3M16 10a1.5 1.5 0 0 1 3 0v3a7 7 0 0 1-7 7h-1a5 5 0 0 1-5-5v-3a1.5 1.5 0 0 1 3 0"/>'],
  o: ["Obscurité", '<path d="M19 14.5A8 8 0 1 1 9.5 5a6.5 6.5 0 0 0 9.5 9.5z"/>'],
  m: ["Métal", '<path d="m12 3 7.8 4.5v9L12 21l-7.8-4.5v-9z"/><circle cx="12" cy="12" r="3"/>'],
  i: ["Incolore", '<path d="m12 4 2.2 5.8L20 12l-5.8 2.2L12 20l-2.2-5.8L4 12l5.8-2.2z"/>'],
  d: ["Dragon", '<path d="M4 18 12 4l8 14-8-4z"/>'],
  a: ["Fée", '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>'],
  t: ["Dresseur", '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'],
  n: ["Énergie", '<circle cx="12" cy="12" r="8"/><path d="M13 7 9 13h4l-1 4"/>'],
};
const MAIN_TYPES = ["f", "e", "p", "l", "y"];
const SETC = ["t-f", "t-e", "t-p", "t-l", "t-y", "t-a", "t-c", "t-d"];
const setCls = (sid) => SETC[(setOrd.get(sid) ?? 0) % SETC.length];
const typeCls = (c) => `t-${c?.t ?? ""}`;
// Symbole de rareté (design : ● commune, ◆ peu commune, ★ rare, ★H rare holo, ultra, secrète)
const RSYM = { C: "●", PC: "◆", R: "★", RH: "★H" };
function rsym(c) { const { code, tier } = rarity(c?.r); return RSYM[code] ?? (tier === "SCR" ? "★★★" : tier === "UR" ? "★★" : code === "PR" ? "PR" : code ? "★" : ""); }
// Rareté : code court + palier (C commune, R rare, UR ultra/ex/V, SCR illustration/hyper/secrète)
function rarity(r = "") {
  const x = deacc(r).toLowerCase();
  const map = [["sans rarete", "—", "C"], ["none", "—", "C"], ["peu commune", "PC", "C"], ["uncommon", "PC", "C"], ["commune", "C", "C"], ["common", "C", "C"], ["promo", "PR", "R"],
    ["illustration speciale", "SIR", "SCR"], ["special illustration", "SIR", "SCR"], ["illustration", "IR", "SCR"], ["secret", "SCR", "SCR"], ["character super", "CSR", "SCR"], ["character", "CHR", "SCR"],
    ["amazing", "AR", "UR"], ["triple", "RRR", "UR"], ["radiant", "RAD", "UR"], ["legend", "LEG", "UR"], ["black white", "BWR", "SCR"],
    ["mega hyper", "MHR", "SCR"], ["hyper", "HR", "SCR"], ["magnifique", "MR", "SCR"], ["chromatique", "CUR", "SCR"], ["shiny", "SR", "SCR"], ["noir blanc", "BWR", "SCR"],
    ["high-tech", "ACE", "UR"], ["ultra", "UR", "UR"], ["double", "RR", "UR"], ["vmax", "VMAX", "UR"], ["vstar", "VSTAR", "UR"], ["holo rare v", "V", "UR"], ["lv.x", "LV.X", "UR"],
    ["prime", "PRIME", "UR"], ["legende", "LEG", "UR"], ["radieux", "RAD", "UR"], ["full art", "FA", "UR"], ["rare holo", "RH", "R"], ["holo rare", "RH", "R"], ["rare", "R", "R"]];
  const hit = map.find(([k]) => x.includes(k));
  return hit ? { code: hit[1] === "—" ? "" : hit[1], tier: hit[2] } : { code: "", tier: "R" };
}
// CardFrame : cadre jaune 63:88, illustration ou emplacement générique avec reflet holo
function cardFrame(card, { src, qty = 1, holo = false, big = false, cls = "", width } = {}) {
  const u = src ?? img(card, big);
  return `<div class="cf-wrap"${width ? ` style="width:${width}px"` : ""}><div class="cf ${typeCls(card)}${holo ? " holo" : ""} ${cls}">
    ${u ? `<img loading="${big ? "eager" : "lazy"}" alt="${esc(card?.name ?? "")}" src="${u}">` : `<span class="ph"></span><span class="ph-t">${esc(card?.name ?? "?")}<br>${esc(numLabel(card))} ${esc(rsym(card))}</span>`}
    </div>${qty > 1 ? `<span class="qb" aria-label="${qty} exemplaires">×${qty}</span>` : ""}</div>`;
}
const isHolo = (v) => v === "h" || v === "r";
const statTile = (label, value, { hint = "", cls = "", display = true, act = "" } = {}) =>
  `<div class="stat${act ? " act" : ""}"${act ? ` data-act="${act}" role="button" tabindex="0"` : ""} aria-label="${esc(label)} : ${esc(value)}${hint ? ", " + esc(hint) : ""}"><span class="l">${esc(label)}</span><span class="v ${display ? "" : "plain"} ${cls}">${esc(value)}</span>${hint ? `<span class="h">${esc(hint)}</span>` : ""}</div>`;
function trend(rel) {
  if (rel == null || !isFinite(rel)) return "";
  const v = rel * 100, n = Math.abs(v) < 0.05, f = (x) => x.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  return `<span class="trend ${n ? "flat" : v > 0 ? "gain" : "loss"}" aria-label="${n ? "Stable" : `${v > 0 ? "Hausse" : "Baisse"} de ${f(Math.abs(v))} pour cent`}">${n ? "—" : v > 0 ? `▲ +${f(v)} %` : `▼ −${f(-v)} %`}</span>`;
}
const pctInt = (r) => (r * 100).toLocaleString("fr-FR", { maximumFractionDigits: r > 0 && r < 0.1 ? 1 : 0 }) + " %";
// SetRow : badge code coloré, nom, X/Y, %, barre ; illustration de ta meilleure carte en fond
function setRow(x, { lite = false } = {}) {
  const s = x.s, full = x.have === x.total && x.total > 0;
  return `<button class="set-row ${setCls(s.id)}${full ? " full" : ""}${lite ? " lite" : ""}" data-set="${esc(s.id)}" aria-label="${esc(s.name)} : ${x.have} sur ${x.total}">
    ${x.best ? `<img class="bg" alt="" loading="lazy" src="${img(x.best)}">` : ""}
    <span class="code">${esc(s.code || s.raw?.toUpperCase().slice(0, 5) || "")}${s.lang && s.lang !== "fr" ? `<small>${LANG_LABEL[s.lang]}</small>` : ""}</span>
    <span class="mid"><span class="top"><span class="nm">${esc(s.name)}</span>${lite ? `<span class="ct">${x.have} / ${x.total}</span>` : ""}</span>
      ${lite ? `<span class="ms">${esc(s.serie)}${s.date ? ` · ${s.date.slice(0, 4)}` : ""}</span>` : `<span class="ms">Master set : ${x.mHave} / ${x.mTotal}</span>`}</span>
    ${lite ? "" : `<span class="foot"><span class="pct">${pctInt(x.rate)}</span><span class="ct"><b>${x.have}</b> / ${x.total}</span></span>`}
    <span class="bar"><span style="width:${(x.rate * 100).toFixed(1)}%"></span></span>
  </button>`;
}
// Statistiques de complétion d'une extension (même non entamée)
function setStat(sid) {
  const c = completion().find((x) => x.key === sid); if (c) return c;
  const inf = setInfo(sid); return { key: sid, s: inf.s, have: 0, total: inf.total, rate: 0, mHave: 0, mTotal: inf.mTotal, best: null };
}

// ---------- Vue Mon classeur ----------
let typeFilter = "", doublesOnly = false;
const qtyById = () => { const m = new Map(); for (const it of store.items) m.set(it.id, (m.get(it.id) || 0) + it.qty); return m; };
async function renderHome() {
  const items = store.items, comp = completion();
  let total = 0, n = 0;
  for (const it of items) { total += (unitEUR(it) || 0) * it.qty; n += it.qty; }
  // Anneau : complétion globale des extensions entamées
  const have = comp.reduce((a, x) => a + x.have, 0), tot = comp.reduce((a, x) => a + x.total, 0), r = tot ? have / tot : 0;
  $("#ring").style.setProperty("--p", (r * 100).toFixed(1));
  $("#ring").setAttribute("aria-label", `Complétion globale : ${pctInt(r)}`);
  $("#ring-pct").textContent = Math.round(r * 100) + "%";
  $("#ring-count").innerHTML = `<b>${have.toLocaleString("fr-FR")}</b> / ${tot.toLocaleString("fr-FR")} cartes`;
  const q = qtyById(), doubles = [...q.values()].filter((x) => x >= 2).length, wish = Object.keys(store.wish).length;
  $("#b-doubles").textContent = `${doubles} double${doubles > 1 ? "s" : ""}`;
  $("#b-doubles").setAttribute("aria-pressed", doublesOnly);
  $("#b-wish").textContent = `${wish} recherchée${wish > 1 ? "s" : ""}`;

  // Valeur + courbe
  const inv = invest();
  $("#total").textContent = money(total);
  $$("#periods .pill").forEach((b) => { const on = +b.dataset.p === store.settings.period; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
  const series = totalSeries();
  if (series.length) series[series.length - 1][1] = total;
  const ok = priceChart("total", $("#chart-total"), series, { color: "var(--blue)", axis: $("#axis-total") });
  $("#chart-empty").hidden = ok || !items.length;
  if (series.length >= 2) {
    const d = series.at(-1)[1] - series[0][1], rr = series[0][1] ? d / series[0][1] : 0;
    const f = (x) => Math.abs(x * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
    $("#delta").innerHTML = `<span class="${Math.abs(rr) < 0.0005 ? "flat" : d > 0 ? "gain" : "loss"}">${Math.abs(rr) < 0.0005 ? "— stable" : `${d > 0 ? "▲ +" : "▼ −"}${money(Math.abs(d))} (${f(rr)} %)`}</span> depuis le ${fmtDate(series[0][0])}`;
  } else $("#delta").textContent = "";
  const pl = inv.val - inv.cost;
  $("#stats").innerHTML =
    statTile("Cartes", String(n), { hint: `${items.length} réf.` }) +
    statTile("Investi", inv.cost ? money(inv.cost, 0) : "—", { hint: "Gérer ›", act: "invest" }) +
    statTile("Plus-value", inv.cost ? `${pl >= 0 ? "+" : "−"}${money(Math.abs(pl), 0)}` : "—", { cls: inv.cost ? (pl >= 0 ? "gain" : "loss") : "", hint: inv.cost ? pct(pl / inv.cost) : "" });

  // Plus fortes hausses / baisses
  const ch = items.map((it) => [it, change(it)]).filter(([it, c]) => c && (unitEUR(it) || 0) >= 0.5 && Math.abs(c.rel) >= 0.0005);
  const up = ch.filter(([, c]) => c.rel > 0).sort((a, b) => b[1].rel - a[1].rel).slice(0, 3);
  const dn = ch.filter(([, c]) => c.rel < 0).sort((a, b) => a[1].rel - b[1].rel).slice(0, 3);
  const mv = (arr) => arr.map(([it, c]) => { const cd = byId.get(it.id); return `<div class="mover" data-uid="${it.uid}">${cardFrame(cd, { width: 34 })}<div class="grow"><div class="nm">${esc(nm(cd) || it.id)}</div>${trend(c.rel)}</div></div>`; }).join("") || `<div class="muted small">—</div>`;
  $("#movers").innerHTML = ch.length ? `<div class="stk"><h3>Hausses</h3>${mv(up)}</div><div class="stk"><h3>Baisses</h3>${mv(dn)}</div>` : "";

  // Par type
  const tc = {}; for (const it of items) { const t = byId.get(it.id)?.t; if (t) tc[t] = (tc[t] || 0) + it.qty; }
  const tlist = [...MAIN_TYPES, ...Object.keys(TYPES).filter((t) => !MAIN_TYPES.includes(t) && tc[t])];
  $("#types").innerHTML = tlist.map((t) => `<button class="type-dot t-${t}${typeFilter === t ? " on" : typeFilter ? " off" : ""}" data-type="${t}" aria-label="${TYPES[t][0]} : ${tc[t] || 0} cartes${typeFilter === t ? " (filtre actif)" : ""}" aria-pressed="${typeFilter === t}"><span class="d">${svg(TYPES[t][1])}</span>${tc[t] || 0}</button>`).join("");
  $("#type-clear").hidden = !typeFilter;

  // Mes sets : 5 plus avancés
  $("#completion").hidden = !comp.length;
  $("#my-sets").innerHTML = [...comp].sort((a, b) => b.rate - a.rate || setOrd.get(b.key) - setOrd.get(a.key)).slice(0, 5).map((x) => setRow(x)).join("");
  renderGrid();
}

function renderGrid() {
  const q = deacc($("#filter").value.trim()).toLowerCase(), sort = $("#sort").value, qty = qtyById();
  let list = store.items.map((it) => ({ it, c: byId.get(it.id), v: unitEUR(it) }));
  if (typeFilter) list = list.filter((x) => x.c?.t === typeFilter);
  if (doublesOnly) list = list.filter((x) => qty.get(x.it.id) >= 2);
  if (q) list = list.filter((x) => { const s = sets.get(x.c?.s); return deacc(`${x.c?.name} ${x.c?.l} ${numLabel(x.c)} ${s?.name} ${s?.code} ${x.c?.r} ${VARS[x.it.v]} ${x.it.note ?? ""}`).toLowerCase().includes(q); });
  const plOf = (x) => (hasBuy(x.it) ? ((x.v || 0) - x.it.buy) * x.it.qty : -Infinity);
  const VORD = { n: 0, h: 1, r: 2, 1: 3 };
  const sorters = {
    value: (a, b) => (b.v || 0) * b.it.qty - (a.v || 0) * a.it.qty,
    added: (a, b) => (b.it.added || "").localeCompare(a.it.added || ""),
    number: (a, b) => cmpKey(numKey(a.c), numKey(b.c)) || VORD[a.it.v] - VORD[b.it.v],
    change: (a, b) => (change(b.it)?.rel ?? -Infinity) - (change(a.it)?.rel ?? -Infinity),
    pl: (a, b) => plOf(b) - plOf(a),
  };
  list.sort(sorters[sort] ?? sorters.number);
  $("#empty").hidden = store.items.length > 0;
  $("#cards-count").textContent = store.items.length ? `${list.length} réf.${typeFilter ? ` · ${TYPES[typeFilter][0]}` : ""}${doublesOnly ? " · doubles" : ""}` : "";
  let lastSet = null;
  $("#grid").innerHTML = list.map(({ it, c, v }) => {
    let head = "";
    if (sort === "number" && c && c.s !== lastSet) {
      lastSet = c.s; const s = sets.get(c.s);
      head = `<div class="grid-head">${s.kind === "main" ? setRow(setStat(c.s), { lite: true }) : `<div class="grp-head">${esc(setLabel(s))}<span>${s.kind === "promo" ? "Promos · hors complétion" : "Hors complétion"}</span></div>`}</div>`;
    }
    const s = sets.get(c?.s);
    return head + `<div class="tile" data-uid="${it.uid}" role="button" tabindex="0" aria-label="${esc(c?.name ?? "")} ${esc(numLabel(c))}">
      ${cardFrame(c, { qty: it.qty, holo: isHolo(it.v) })}
      <div class="t-name">${esc(nm(c) || "Carte inconnue")}</div>
      <div class="t-meta">${lgTag(s?.lang)}${esc(s?.code || s?.name || "")} ${esc(numLabel(c))} ${esc(rsym(c))}${it.v !== "n" ? ` · <span class="vtag">${esc(VARS[it.v])}</span>` : ""}</div>
      <div class="t-price"><b>${money(v)}</b>${trend(change(it)?.rel)}</div>
    </div>`; }).join("") || (store.items.length ? `<p class="muted small grid-head">Aucune carte pour ce filtre.</p>` : "");
  for (const it of list.filter((x) => x.it.photo)) photoUrl(it.it.uid).then((u) => { const im = u && $(`#grid .tile[data-uid="${it.it.uid}"] img`); if (im) im.src = u; });
}

// ---------- Vue Sets ----------
let setsMode = "mine", setsLang = "";
function renderSets() {
  const { rest, langs } = splitLang($("#set-filter").value), q = NORM(rest), comp = new Map(completion().map((x) => [x.key, x]));
  $$("#sets-chips .pill").forEach((b) => b.classList.toggle("on", b.dataset.s === setsMode));
  $$("#sets-langs .pill").forEach((b) => b.classList.toggle("on", b.dataset.l === setsLang));
  let list = [...sets.values()].filter((s) => s.kind === "main");
  const wanted = langs.length ? langs : setsLang ? [setsLang] : null;
  if (wanted) list = list.filter((s) => wanted.includes(s.lang));
  if (setsMode === "mine" && !q) list = list.filter((s) => comp.has(s.id));
  if (q) list = list.filter((s) => NORM(`${s.code}${s.name}`).includes(q) || NORM(s.name).includes(q) || NORM(s.code) === q || NORM(s.raw) === q);
  list.sort((a, b) => setOrd.get(b.id) - setOrd.get(a.id));
  $("#sets-sub").textContent = `${comp.size} extension${comp.size > 1 ? "s" : ""} entamée${comp.size > 1 ? "s" : ""} sur ${[...sets.values()].filter((s) => s.kind === "main").length}`;
  let serie = null;
  $("#sets-list").innerHTML = list.map((s) => {
    const sk = s.serie + s.lang, h = sk !== serie ? `<div class="serie">${esc(s.serie)}${s.lang !== "fr" ? ` · ${LANG_LABEL[s.lang]}` : ""}</div>` : ""; serie = sk;
    return h + `<div style="margin-bottom:14px">${setRow(comp.get(s.id) ?? setStat(s.id), { lite: !comp.has(s.id) })}</div>`;
  }).join("") || `<div class="empty"><p>${setsMode === "mine" && !q ? "Aucune extension entamée. Ajoute une carte ou parcours « Toutes les extensions »." : "Aucune extension trouvée."}</p></div>`;
}

// ---------- Recherchées (wishlist) ----------
const PRIO = { 1: "Haute", 2: "Moyenne", 3: "Basse" };
function renderWish() {
  const list = Object.entries(store.wish).map(([id, p]) => ({ c: byId.get(id), p })).filter((x) => x.c)
    .sort((a, b) => a.p - b.p || cmpKey(numKey(a.c), numKey(b.c)));
  const cost = list.reduce((a, x) => a + (marketEUR(x.c.id, defVariant(x.c)) || 0), 0);
  $("#wish-sub").textContent = list.length ? `${list.length} carte${list.length > 1 ? "s" : ""} · ≈ ${money(cost, 0)}` : "Touche l'étoile sur une fiche carte pour l'ajouter";
  $("#wish-list").innerHTML = list.map(({ c, p }) => { const s = sets.get(c.s); return `<div class="stk w-row" data-id="${esc(c.id)}" role="button" tabindex="0">
      ${cardFrame(c, { width: 56 })}
      <div class="grow"><div class="name">${esc(nm(c))}</div><div class="sub">${lgTag(s?.lang)} ${esc(s?.code || s?.name)} ${esc(numLabel(c))} ${esc(rsym(c))}</div>
        <span class="prio p${p}">Priorité ${PRIO[p].toLowerCase()}</span></div>
      <div class="price">${money(marketEUR(c.id, defVariant(c)))}</div></div>`; }).join("")
    || `<div class="empty"><div class="ic">${svg(ICONS.star)}</div><p>Aucune carte recherchée.</p></div>`;
}

// ---------- Profil ----------
function renderProfile() {
  const comp = completion(), inv = invest(), q = qtyById();
  let total = 0, n = 0; for (const it of store.items) { total += (unitEUR(it) || 0) * it.qty; n += it.qty; }
  const best = store.items.reduce((a, it) => ((unitEUR(it) || 0) > (a ? unitEUR(a) || 0 : -1) ? it : a), null);
  $("#p-stats").innerHTML = statTile("Cartes", String(n), { hint: `${q.size} différentes` }) + statTile("Valeur", money(total, 0)) + statTile("Investi", inv.cost ? money(inv.cost, 0) : "—", { hint: "Gérer ›", act: "invest" });
  $("#p-stats2").innerHTML = statTile("Sets entamés", String(comp.length), { hint: `${comp.filter((x) => x.have === x.total).length} complet(s)` }) +
    statTile("Doubles", String([...q.values()].filter((x) => x >= 2).length)) +
    statTile("Top carte", best ? money(unitEUR(best), 0) : "—", { display: false, hint: best ? byId.get(best.id)?.name : "" });
}
// PriceChart : courbe SVG, ligne pointillée de référence (prix d'achat), point final, lecture au doigt
const charts = {};
function priceChart(key, el, pts, { height = 110, color = "var(--accent)", ref = null, grid = false, endDot = true, axis, readout } = {}) {
  charts[key] = { el, pts, opts: { height, color, ref, grid, endDot, axis, readout } };
  const w = el.clientWidth;
  if (!w || pts.length < 2) { el.innerHTML = ""; if (axis) axis.innerHTML = ""; if (readout) readout.textContent = ""; return false; }
  const data = pts.map((p) => p[1]), vals = ref != null ? [...data, ref] : data;
  const min = Math.min(...vals), max = Math.max(...vals), pad = 6, span = max - min || 1;
  const y = (v) => pad + (1 - (v - min) / span) * (height - pad * 2), x = (i) => (i / (data.length - 1)) * w;
  const last = data.at(-1), first = data[0];
  el.innerHTML = `<svg width="${w}" height="${height}" role="img" aria-label="Évolution de la cote, ${last >= first ? "en hausse" : "en baisse"}">
    ${grid ? [0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${w}" y1="${height * f}" y2="${height * f}" style="stroke:var(--line)" stroke-width="1"/>`).join("") : ""}
    ${ref != null ? `<line x1="0" x2="${w}" y1="${y(ref)}" y2="${y(ref)}" style="stroke:var(--muted)" stroke-width="1" stroke-dasharray="4 4"/>` : ""}
    <polyline points="${data.map((v, i) => `${x(i)},${y(v)}`).join(" ")}" fill="none" style="stroke:${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    ${endDot ? `<circle cx="${x(data.length - 1)}" cy="${y(last)}" r="5" style="fill:${color}"/>` : ""}
    <circle class="cursor" r="5" cx="0" cy="0" visibility="hidden" style="fill:${color};stroke:var(--bg)" stroke-width="2"/>
  </svg>`;
  if (axis) axis.innerHTML = `<span>${fmtDate(pts[0][0])}</span><span>${fmtDate(pts.at(-1)[0])}</span>`;
  const show = (i) => { if (readout) readout.textContent = `${fmtDate(pts[i][0])} · ${money(data[i])}`; };
  if (readout) readout.textContent = ref != null ? `Ligne pointillée : prix d'achat (${money(ref)})` : "";
  const cur = el.querySelector(".cursor");
  el.onpointermove = el.onpointerdown = (e) => {
    const i = Math.max(0, Math.min(data.length - 1, Math.round(((e.clientX - el.getBoundingClientRect().left) / w) * (data.length - 1))));
    cur.setAttribute("cx", x(i)); cur.setAttribute("cy", y(data[i])); cur.setAttribute("visibility", "visible"); show(i);
  };
  el.onpointerleave = () => cur.setAttribute("visibility", "hidden");
  return true;
}
let resizeT;
addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => { for (const [k, c] of Object.entries(charts)) if (c.el.isConnected) priceChart(k, c.el, c.pts, c.opts); }, 150); });

// ---------- Complétion ----------
// Une par numéro : numéros officiels (≤ cardCount.official) possédés / official.
// Master set : toutes les cartes de l'extension (secrètes comprises, cardCount.total) + leurs reverses.
// Seules les extensions de boosters/displays sont suivies (pas de promos, kits, McDonald's…) ; tampons et avant-premières jamais proposés.
const entryKey = (id, v) => `${id}|${v === "r" ? "r" : "b"}`;
function setInfo(sid) {
  const s = sets.get(sid), cs = bySet.get(sid) || [];
  const off = cs.filter(isOfficial), nums = new Set(off.map((c) => normNum(c.l)));
  const mTotal = cs.length + cs.filter((c) => c.v.includes("r")).length;
  return { s, cs, nums, total: s.official || nums.size, mTotal };
}
function completion() {
  const owned = new Map();
  for (const it of store.items) {
    const c = byId.get(it.id), s = sets.get(c?.s); if (!c || s.kind !== "main") continue;
    if (!owned.has(s.id)) owned.set(s.id, { nums: new Set(), entries: new Set(), best: null, bestV: -1 });
    const o = owned.get(s.id), v = unitEUR(it) ?? 0;
    if (isOfficial(c)) o.nums.add(normNum(c.l));
    o.entries.add(entryKey(c.id, it.v));
    if (v > o.bestV && c.img) { o.bestV = v; o.best = c; }
  }
  return [...owned].map(([sid, o]) => { const inf = setInfo(sid); return { key: sid, s: inf.s, have: o.nums.size, total: inf.total, rate: inf.total ? o.nums.size / inf.total : 0, mHave: o.entries.size, mTotal: inf.mTotal, best: o.best }; })
    .sort((a, b) => setOrd.get(a.key) - setOrd.get(b.key));
}

// ---------- Investissement (achats à l'unité + achats scellés) ----------
const PTYPES = ["Booster", "Display", "ETB", "Coffret", "Lot", "Autre"];
const hasBuy = (it) => !it.src && it.buy !== "" && it.buy != null;
const purchase = (pid) => store.purchases.find((p) => p.pid === pid);
const pLabel = (p) => `${p.label || p.type}${p.qty > 1 ? ` ×${p.qty}` : ""}`;
function invest() {
  let unit = 0, unitVal = 0, srcVal = 0;
  for (const it of store.items) {
    const v = (unitEUR(it) || 0) * it.qty;
    if (it.src && purchase(it.src)) srcVal += v;
    else if (hasBuy(it)) { unit += +it.buy * it.qty; unitVal += v; }
  }
  const sealed = store.purchases.reduce((a, p) => a + (+p.price || 0), 0);
  return { unit, sealed, cost: unit + sealed, val: unitVal + srcVal };
}
function purchaseStats(p) {
  let n = 0, val = 0;
  for (const it of store.items) if (it.src === p.pid) { n += it.qty; val += (unitEUR(it) || 0) * it.qty; }
  return { n, val, ratio: p.price ? val / p.price : null, rel: p.price ? (val - p.price) / p.price : null };
}

// ---------- Recherche / ajout ----------
// Saisie souple : "025/165", "MEW 025", "151 25", "sv03.5 25", "TG05/TG30" ou nom de carte.
const NORM = (s) => deacc(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
// Mots de langue dans la saisie : "MEW FR 025", "151 anglais", "SV2a JP 25"
const LWORDS = { FR: "fr", FRANCAIS: "fr", FRANCAISE: "fr", EN: "en", ENG: "en", ANG: "en", ANGLAIS: "en", ANGLAISE: "en", JP: "ja", JA: "ja", JAP: "ja", JAPONAIS: "ja", JAPONAISE: "ja" };
function splitLang(raw) {
  const langs = []; const rest = deacc(raw).trim().split(/\s+/).filter((w) => { const l = LWORDS[w.toUpperCase()]; if (l) { langs.push(l); return false; } return true; }).join(" ");
  return { rest, langs };
}
let qLangs = [];
function resolveSets(tok, loose = true) {
  const T = NORM(tok); if (!T) return [];
  const all = [...sets.values()].filter((s) => !qLangs.length || qLangs.includes(s.lang));
  const exact = all.filter((s) => NORM(s.code) === T || NORM(s.raw ?? s.id) === T || NORM(s.name) === T);
  if (exact.length || !loose) return exact;
  return T.length >= 3 ? all.filter((s) => NORM(s.name).startsWith(T)) : [];
}
const recentFirst = (a, b) => LRANK[langOf(a)] - LRANK[langOf(b)] || setOrd.get(b.s) - setOrd.get(a.s) || cmpKey(numKey(a), numKey(b));
function search(input) {
  const sp = splitLang(input); let raw = sp.rest; qLangs = sp.langs;
  // Marque de règlement en tête ("F 051/196", "G MEW 025") : lettre seule imprimée en bas à gauche
  let qMark = ""; { const w = raw.trim().split(/\s+/); if (w.length > 1 && /^[A-J]$/i.test(w[0])) { qMark = w[0].toUpperCase(); raw = w.slice(1).join(" "); } }
  const q = deacc(raw).trim().toUpperCase().replace(/\s+/g, " ");
  if (!q) return { list: [], sets: [] };
  const okLang = (c) => !qLangs.length || qLangs.includes(langOf(c));
  const byMark = (list) => { if (!qMark) return list; const f = list.filter((c) => !c.g || c.g === qMark); return f.length ? f : list; };
  const inSets = (ss, num) => { const n = normNum(num), ids = new Set(ss.map((s) => s.id)); return byMark(cards.filter((c) => ids.has(c.s) && normNum(c.l) === n)); };
  // 1) [CODE] [FR] NNN/TTT
  let m = q.match(/^(?:(.+?)\s+)?(?:FR\s+)?([A-Z]{0,4}\d{1,4}[A-Z]?)\s*\/\s*([A-Z]{0,4}\d{1,4})$/);
  if (m) {
    const [, code, num, tot] = m;
    const allL = [...sets.values()].filter((s) => !qLangs.length || qLangs.includes(s.lang));
    let ss = code ? resolveSets(code) : allL, unknown = false;
    if (code && !ss.length) { ss = allL; unknown = true; } // code non reconnu : on se fie au total imprimé
    if (/^\d+$/.test(tot)) { const byTot = ss.filter((s) => s.official === +tot); if (byTot.length) ss = byTot; else if (!code) ss = ss.filter((s) => s.total === +tot); }
    if (unknown) { const byTot = ss.filter((s) => s.official === +tot); ss = byTot.length ? byTot : ss.filter((s) => s.total === +tot); }
    const list = inSets(ss, num).sort(recentFirst);
    return { list, msg: list.length ? "" : `Aucune carte ${num}/${tot}${code && !unknown ? ` dans « ${code} »` : ""}.`, hint: unknown && list.length ? `« ${code} » n'est pas un code d'extension : cartes n° ${num}/${tot} :` : "" };
  }
  // 2) EXTENSION NUMÉRO ("MEW 025", "151 25", "sv03.5 25")
  m = q.match(/^(.+?)\s+#?([A-Z]{0,4}\d{1,4}[A-Z]?)$/);
  if (m) { const ss = resolveSets(m[1]); if (ss.length) { const list = inSets(ss, m[2]).sort(recentFirst); return { list, msg: list.length ? "" : `Pas de n° ${m[2]} dans ${ss.map((s) => s.name).join(", ")}.` }; } }
  // 3) Code collé ("MEW025")
  m = q.match(/^([A-Z]{2,4})(\d{1,3})$/);
  if (m) { const ss = resolveSets(m[1]); if (ss.length) { const list = inSets(ss, m[2]); if (list.length) return { list }; } }
  // 4) Numéro seul : insuffisant, on liste les correspondances
  if (/^\d{1,3}$/.test(q)) {
    const n = normNum(q), list = cards.filter((c) => c.l && normNum(c.l) === n && sets.get(c.s).kind === "main" && okLang(c)).sort(recentFirst).slice(0, 60);
    return { list, msg: "", hint: "Numéro seul : ajoute le code d'extension (MEW 025) ou le total imprimé (025/165). Correspondances :" };
  }
  // 5) Extension seule ("MEW", "151", "Évolutions Prismatiques") puis nom de carte
  const ss = resolveSets(q).filter((s) => s.kind !== "x").sort((x, y) => LRANK[x.lang] - LRANK[y.lang] || setOrd.get(y.id) - setOrd.get(x.id)).slice(0, 8);
  const k = deacc(raw).trim().toLowerCase(); if (k.length < 2) return { list: [], sets: ss };
  const all = cards.filter((c) => c.k.includes(k) && okLang(c)).sort((a, b) => (b.k.startsWith(k) - a.k.startsWith(k)) || recentFirst(a, b));
  const cap = { fr: 0, en: 0, ja: 0 }, list = all.filter((c) => cap[langOf(c)]++ < 40); // 40 max par langue
  return { list, sets: ss, hint: ss.length && list.length ? `Cartes dont le nom contient « ${raw} » :` : "" };
}
function renderResults(res) {
  const { list, msg, hint, sets: ss = [] } = res;
  const setsHtml = ss.length ? `<p class="hint">Extension${ss.length > 1 ? "s" : ""} — touche pour ouvrir le classeur :</p>` + ss.map((s) => setRow(setStat(s.id), { lite: true })).join("") : "";
  if (!list.length) { $("#results").innerHTML = setsHtml || `<p class="hint">${esc(msg || "Aucune carte trouvée. Exemples : MEW 025, 025/165, 151 25, MEW EN 025 ou Pikachu.")}</p>`; return; }
  const q = qtyById();
  $("#results").innerHTML = setsHtml + (hint ? `<p class="hint">${esc(hint)}</p>` : list.length > 1 ? `<p class="hint">${list.length} résultats — choisis la bonne carte :</p>` : "") +
    list.map((c) => {
      const s = sets.get(c.s), owned = q.get(c.id) || 0;
      return `<div class="stk result" data-id="${esc(c.id)}" role="button" tabindex="0">
        ${cardFrame(c, { width: 60 })}
        <div class="grow"><div class="name">${esc(nm(c))}</div>
          <div class="sub">${esc(numLabel(c))} ${esc(rsym(c))}${c.r ? ` · ${esc(c.r)}` : ""}</div>
          <div class="sub">${lgTag(s?.lang)} ${esc(setLabel(s))}${owned ? ` · <b class="gain">${owned} possédée${owned > 1 ? "s" : ""}</b>` : ""}</div></div>
        <div class="price">${money(marketEUR(c.id, defVariant(c)))}</div></div>`;
    }).join("");
}

// ---------- Modales plein écran (page verrouillée derrière) ----------
let lockY = 0, sheetBack = null;
function openModal(y = 0) {
  const d = $("#sheet");
  if (!d.open) { lockY = scrollY; document.body.style.top = `-${lockY}px`; document.documentElement.classList.add("modal-open"); d.showModal(); }
  d.scrollTop = y; // y : position conservée (changement de page du classeur, retour depuis une carte)
}
function onModalClose() {
  sheetBack = null; delete charts.card;
  document.documentElement.classList.remove("modal-open"); document.body.style.top = ""; scrollTo(0, lockY);
}
const ICON_X = svg(ICONS.x);

// ---------- Détail d'un set : classeur 3×3 ----------
function setRows(sid, mode) {
  const inf = setInfo(sid), own = new Map(), ownV = new Map();
  for (const it of store.items) {
    if (byId.get(it.id)?.s !== sid) continue;
    const k = entryKey(it.id, it.v); own.set(k, (own.get(k) || 0) + it.qty);
    if (!ownV.has(it.id)) ownV.set(it.id, new Map()); ownV.get(it.id).set(it.v, (ownV.get(it.id).get(it.v) || 0) + it.qty);
  }
  const cs = [...inf.cs].sort((a, b) => cmpKey(numKey(a), numKey(b)));
  if (mode === "master") return cs.flatMap((c) => {
    const vb = ownV.get(c.id), bv = vb ? [...vb.keys()].find((k) => k !== "r") : null;
    return [
      { card: c, v: bv ?? defVariant(c), label: c.v.includes("h") && !c.v.includes("n") ? "Holo" : "", have: own.get(entryKey(c.id, "n")) || 0, price: marketEUR(c.id, defVariant(c)) },
      ...(c.v.includes("r") ? [{ card: c, v: "r", label: "Reverse", have: own.get(entryKey(c.id, "r")) || 0, price: marketEUR(c.id, "r") }] : []),
    ];
  });
  return cs.filter(isOfficial).map((c) => {
    const vm = ownV.get(c.id), have = vm ? [...vm.values()].reduce((a, b) => a + b, 0) : 0;
    const pr = [marketEUR(c.id, defVariant(c)), c.v.includes("r") ? marketEUR(c.id, "r") : null].filter((x) => x != null);
    const v = vm ? (["h", "r", "1", "n"].find((k) => vm.has(k)) ?? defVariant(c)) : defVariant(c);
    return { card: c, v, have, vOwned: vm ? vm.size : 0, versions: c.v.length, price: pr.length ? Math.min(...pr) : null };
  });
}
function binderPos(c, v) {
  const s = sets.get(c.s); if (s?.kind !== "main") return "Hors classeur d'extension (promo / hors série)";
  let rows = setRows(c.s, "base"), i = rows.findIndex((r) => r.card.id === c.id), pre = "";
  if (i < 0) { rows = setRows(c.s, "master"); i = rows.findIndex((r) => r.card.id === c.id && (v === "r") === (r.v === "r")); pre = "Master set · "; }
  return i < 0 ? "" : `${pre}Page ${Math.floor(i / 9) + 1} · emplacement ${(i % 9) + 1}`;
}
function openSet(sid, show = "all", mode = "base", page = 0, y = 0) {
  const inf = setInfo(sid), s = inf.s; if (!s) return;
  const rows = setRows(sid, mode);
  const missing = rows.filter((r) => !r.have), have = rows.length - missing.length;
  const cost = missing.reduce((a, r) => a + (r.price || 0), 0), noPrice = missing.filter((r) => r.price == null).length;
  const list = show === "missing" ? missing : show === "owned" ? rows.filter((r) => r.have) : rows;
  const pages = Math.max(1, Math.ceil(list.length / 9)); page = Math.min(Math.max(0, page), pages - 1);
  const x = setStat(sid), rate = rows.length ? have / rows.length : 0;
  const slot = (r) => r.have
    ? `<button class="slot" data-id="${esc(r.card.id)}" data-v="${r.v}" data-own="1" aria-label="${esc(nm(r.card))} ${esc(numLabel(r.card))}, possédée ×${r.have}">
        ${cardFrame(r.card, { qty: r.have, holo: isHolo(r.v) })}
        ${mode === "base" && r.versions > 1 ? `<span class="vb" title="${r.vOwned} variante(s) possédée(s) sur ${r.versions}">◆ ${r.vOwned}/${r.versions}</span>` : ""}
        <span class="lab">${esc(numLabel(r.card))}${r.label ? ` · ${esc(r.label)}` : ""}</span></button>`
    : `<button class="slot miss" data-id="${esc(r.card.id)}" data-v="${r.v}" aria-label="Manquante : ${esc(nm(r.card))} ${esc(numLabel(r.card))}${r.label ? " " + esc(r.label) : ""}, ajouter">
        <span class="hole">${img(r.card) ? `<img alt="" loading="lazy" src="${img(r.card)}">` : ""}<b>#${esc(r.card.l)}</b><span>${esc(nm(r.card))}${r.label ? ` · ${esc(r.label)}` : ""}</span><i>+</i><small>${money(r.price)}</small></span>
        <span class="lab">${esc(numLabel(r.card))}</span></button>`;
  const dots = pages <= 12 ? Array.from({ length: pages }, (_, i) => `<button data-page="${i}" class="${i === page ? "on" : ""}" aria-label="Page ${i + 1}"></button>`).join("")
    : `<button data-page="${page - 1}" aria-label="Page précédente" ${page ? "" : "disabled"}></button><button class="on" aria-label="Page ${page + 1}"></button><button data-page="${page + 1}" aria-label="Page suivante" ${page < pages - 1 ? "" : "disabled"}></button>`;
  $("#sheet-body").innerHTML = `
    <header class="hdr m-hdr ${setCls(sid)}" style="--hc:var(--tc)"><div class="hdr-in">
      <div class="hdr-top"><button class="round" data-close aria-label="Retour">${svg(ICONS.back)}</button>
        <span class="chipdark">SET ${esc(s.code || s.raw || s.id)}${s.lang !== "fr" ? ` · ${LANG_LABEL[s.lang]}` : ""} · ${mode === "master" ? inf.mTotal : inf.total} cartes</span>
        <button class="round" id="mode-btn" aria-label="Basculer en ${mode === "master" ? "une par numéro" : "master set"}">${svg(ICONS.filter)}</button></div>
      <h1>${esc(s.name)}</h1>
      <div class="sub">${esc(s.serie)}${s.date ? ` · sortie le ${fmtDate(s.date)}` : ""}</div>
      <div class="prog"><div class="bar thick"><span style="width:${(rate * 100).toFixed(1)}%"></span></div><b>${have}/${rows.length}</b></div>
    </div></header>
    <div class="wrap">
      <div class="pills" id="set-chips" role="group" aria-label="Filtre">
        <button class="pill ${show === "all" ? "on" : ""}" data-show="all">Toutes</button>
        <button class="pill ${show === "owned" ? "on" : ""}" data-show="owned">Possédées · ${have}</button>
        <button class="pill ${show === "missing" ? "on" : ""}" data-show="missing">Manquantes · ${missing.length}</button>
      </div>
      <div class="pills" id="set-mode" role="group" aria-label="Mode de complétion" style="margin-top:0">
        <button class="pill sm ${mode === "base" ? "on" : ""}" data-mode="base">Une par numéro · ${pctInt(x.rate)}</button>
        <button class="pill sm ${mode === "master" ? "on" : ""}" data-mode="master">Master set · ${x.mHave}/${x.mTotal}</button>
      </div>
      <div class="stk cost-line" style="margin-bottom:14px"><span>Pour compléter${noPrice ? ` <span class="muted small">(${noPrice} sans prix)</span>` : ""}</span><span class="num">${missing.length ? money(cost, 0) : "Complet !"}</span></div>
      <div class="binder" id="binder"><div class="page">${list.slice(page * 9, page * 9 + 9).map(slot).join("") || `<p style="color:#fff;grid-column:1/-1;text-align:center">Aucune carte.</p>`}</div></div>
      <div class="dots" id="dots">${dots}<span class="pg">Page ${page + 1} / ${pages}</span></div>
      <p class="muted small" style="margin-top:14px">${mode === "base"
        ? `Une pochette par numéro officiel (1 à ${inf.total}). ◆ = variantes possédées / disponibles. Coût : prix tendance le plus bas parmi les variantes de chaque numéro manquant.`
        : `Master set : toutes les cartes, secrètes comprises (${inf.cs.length}), et chaque reverse.`} Promos, cartes tamponnées et avant-premières non comptées. Balaye pour changer de page, touche une pochette vide pour ajouter la carte.</p>
    </div>`;
  openModal(y);
  const go_ = (sh = show, mo = mode, pg = 0) => openSet(sid, sh, mo, pg, $("#sheet").scrollTop);
  $$("#set-chips .pill").forEach((b) => b.onclick = () => go_(b.dataset.show, mode));
  $$("#set-mode .pill").forEach((b) => b.onclick = () => go_(show, b.dataset.mode));
  $("#mode-btn").onclick = () => go_(show, mode === "master" ? "base" : "master");
  $$("#dots [data-page]").forEach((b) => b.onclick = () => go_(show, mode, +b.dataset.page));
  // Balayage gauche / droite
  const bd = $("#binder"); let sx = null, sy = 0;
  bd.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  bd.addEventListener("touchend", (e) => {
    if (sx == null) return; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { const np = page + (dx < 0 ? 1 : -1); if (np >= 0 && np < pages) { bd.dataset.swiped = "1"; go_(show, mode, np); } }
  });
  $$(".slot").forEach((t) => t.onclick = () => {
    const yb = $("#sheet").scrollTop; sheetBack = () => openSet(sid, show, mode, page, yb);
    const id = t.dataset.id, v = t.dataset.v;
    const it = t.dataset.own && (store.items.find((i) => i.id === id && i.v === v) ?? store.items.find((i) => i.id === id && (mode === "base" || (i.v === "r") === (v === "r"))));
    openSheet(it ? { uid: it.uid } : { id, v });
  });
}

// ---------- Fiche Investissement ----------
function openInvest(editPid) {
  const inv = invest(), pl = inv.val - inv.cost;
  const list = [...store.purchases].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const ed = editPid === "new" ? { pid: "", type: "Display", label: "", qty: 1, price: "", date: today() } : editPid ? purchase(editPid) : null;
  const opt = (arr, cur) => arr.map((x) => `<option ${x === cur ? "selected" : ""}>${x}</option>`).join("");
  $("#sheet-body").innerHTML = `
    <header class="hdr m-hdr" style="--hc:var(--green)"><div class="hdr-in">
      <div class="hdr-top"><button class="round" data-close aria-label="Retour">${svg(ICONS.back)}</button><span class="chipdark">Achats</span><span style="width:44px"></span></div>
      <h1 style="color:var(--ink)">Investissement</h1><div class="sub" style="color:var(--ink)">Achats à l'unité et produits scellés</div></div></header>
    <div class="wrap">
    <div class="stats3" style="margin-top:0">
      ${statTile("Total investi", money(inv.cost, 0))}
      ${statTile("Scellé", money(inv.sealed, 0), { hint: `${store.purchases.length} achat${store.purchases.length > 1 ? "s" : ""}` })}
      ${statTile("À l'unité", money(inv.unit, 0))}
    </div>
    ${inv.cost ? `<div class="stk pl-line" style="margin-top:14px"><span>Plus-value (cartes rattachées à un coût)</span><b class="${pl >= 0 ? "gain" : "loss"}">${pl >= 0 ? "+" : "−"}${money(Math.abs(pl))} ${trend(pl / inv.cost)}</b></div>` : ""}
    <div class="sec"><h2>Achats scellés</h2></div>
    ${ed ? `<form class="stk form" id="p-form">
      <label class="field">Type<select name="type">${opt(PTYPES, ed.type)}</select></label>
      <label class="field">Quantité<input name="qty" type="number" min="1" step="1" value="${ed.qty}" required></label>
      <label class="field full">Intitulé<input name="label" value="${esc(ed.label)}" placeholder="ex. Display 151"></label>
      <label class="field">Prix payé total (€)<input name="price" type="number" min="0" step="0.01" inputmode="decimal" value="${ed.price}" required></label>
      <label class="field">Date d'achat<input name="date" type="date" value="${ed.date || ""}"></label>
      <div class="actions field full" style="margin-top:4px">
        ${ed.pid ? `<button type="button" class="btn danger" id="p-del">Supprimer</button>` : ""}
        <button type="button" class="btn" id="p-cancel">Annuler</button>
        <button type="submit" class="btn primary">${ed.pid ? "Enregistrer" : "Ajouter l'achat"}</button>
      </div></form>`
    : `<button class="btn red wide" id="p-add">+ Ajouter un achat (booster, display, ETB…)</button>`}
    <div class="results">${list.length ? list.map((p) => { const st = purchaseStats(p); return `<div class="stk w-row" data-pid="${p.pid}" role="button" tabindex="0">
        <div class="grow"><div class="name">${esc(pLabel(p))}</div><div class="sub">${esc(p.type)}${p.date ? " · " + fmtDate(p.date) : ""} · ${st.n} carte${st.n > 1 ? "s" : ""} rattachée${st.n > 1 ? "s" : ""}</div>
          <div class="sub">Valeur ${money(st.val)}${st.ratio != null && st.n ? ` · rentabilité <b class="${st.ratio >= 1 ? "gain" : "loss"}">${Math.round(st.ratio * 100)} %</b>` : ""}</div></div>
        <div class="price">${money(+p.price)}<br>${st.n ? trend(st.rel) : ""}</div></div>`; }).join("")
    : `<p class="hint">Aucun achat scellé.</p>`}</div>
    <p class="muted small" style="margin-top:14px">En ajoutant chaque carte sortie de cet achat, choisis-le dans « Provenance » : son coût est porté par l'achat, pas par la carte. La dernière provenance est reprise par défaut pour enchaîner l'ouverture d'une display. Rentabilité = valeur des cartes rattachées / prix payé.</p>
    </div>`;
  openModal();
  $("#p-add") && ($("#p-add").onclick = () => openInvest("new"));
  $("#p-cancel") && ($("#p-cancel").onclick = () => openInvest());
  $$("[data-pid]").forEach((r) => r.onclick = () => openInvest(r.dataset.pid));
  $("#p-del") && ($("#p-del").onclick = () => {
    const st = purchaseStats(ed);
    if (!confirm(`Supprimer cet achat ?${st.n ? ` Les ${st.n} carte(s) rattachée(s) restent dans la collection, sans coût.` : ""}`)) return;
    store.purchases = store.purchases.filter((p) => p.pid !== ed.pid);
    for (const it of store.items) if (it.src === ed.pid) it.src = "";
    if (store.settings.lastSrc === ed.pid) store.settings.lastSrc = "";
    save(); refreshViews(); openInvest(); toast("Achat supprimé");
  });
  const f = $("#p-form");
  if (f) f.onsubmit = (e) => {
    e.preventDefault(); const fd = new FormData(f);
    const data = { type: fd.get("type"), label: fd.get("label").trim(), qty: Math.max(1, parseInt(fd.get("qty")) || 1), price: Math.round(+fd.get("price") * 100) / 100, date: fd.get("date") };
    if (ed.pid) Object.assign(ed, data);
    else { const p = { pid: uid(), ...data }; store.purchases.push(p); store.settings.lastSrc = p.pid; }
    save(); refreshViews(); openInvest(); toast(ed.pid ? "Achat modifié" : "Achat ajouté");
  };
}

// ---------- Fiche carte (ajout / édition) ----------
let scanBlob = null;
const FLANGS = ["FR", "JP", "EN"];
async function openSheet({ id, v, uid: u }) {
  const existing = u ? store.items.find((i) => i.uid === u) : null;
  const lastSrc = purchase(store.settings.lastSrc) ? store.settings.lastSrc : "";
  const c0 = byId.get(existing?.id ?? id);
  const it = existing ?? { id, v: v && c0?.v.includes(v) ? v : defVariant(c0), qty: 1, cond: "Near Mint", lang: LANG_LABEL[langOf(c0)] || "FR", buy: "", buyDate: today(), manual: "", note: "", src: lastSrc };
  const c = byId.get(it.id), s = sets.get(c?.s);
  const own = it.photo ? await photoUrl(it.uid) : null;
  const vlist = (c?.v || "n").split("");
  const st = { v: it.v, cond: it.cond, lang: FLANGS.includes(it.lang) ? it.lang : "FR", qty: it.qty };
  const wished = () => store.wish[it.id] != null;

  $("#sheet-body").innerHTML = `
    <header class="hdr c-hdr ${typeCls(c)}" style="--hc:var(--tc)"><div class="hdr-in"><div class="hdr-top">
      <button class="round" ${sheetBack ? "data-back" : "data-close"} aria-label="${sheetBack ? "Retour à l'extension" : "Retour"}">${svg(ICONS.back)}</button>
      <span class="sub">${esc(s?.name ?? "")} · ${esc(numLabel(c))}</span>
      <button class="round star${wished() ? " on" : ""}" id="wish-btn" aria-pressed="${wished()}" aria-label="${wished() ? "Retirer des recherchées" : "Ajouter aux recherchées"}">${svg(ICONS.star)}</button>
    </div></div></header>
    <div class="wrap">
      <div class="bigcard-wrap" id="bigcard">${cardFrame(c, { src: own ?? undefined, big: true, holo: isHolo(it.v), cls: "bigcard" })}</div>
      ${own ? `<div class="pills" style="justify-content:center;margin-top:18px"><button class="pill sm" data-img="off">Illustration officielle</button><button class="pill sm on" data-img="own">Ma photo</button></div>` : ""}
      <div class="c-title"><h2>${esc(nm(c) || "Carte")}</h2>${c?.r ? `<span class="rbadge">${esc(rsym(c))} ${esc(c.r)}</span>` : ""}</div>
      <div class="tiles2">
        <div class="stk"><div class="tl" id="cote-l">Cote moyenne</div><div class="tv" id="cote">—</div><div class="th" id="cote-h"></div></div>
        <div class="stk"><div class="tl">Langue</div><div class="seg" id="langs" role="group" aria-label="Langue">${FLANGS.map((l) => `<button type="button" data-l="${l}" class="${l === st.lang ? "on" : ""}" aria-pressed="${l === st.lang}">${l}</button>`).join("")}</div></div>
      </div>
      <div class="lbl">Variante</div>
      <div class="vars" id="vars" role="group" aria-label="Variante">${vlist.map((k) => `<button type="button" data-v="${k}" class="${k === st.v ? "on" : ""}" aria-pressed="${k === st.v}">${VARS[k]}</button>`).join("")}</div>
      <div class="lbl">État</div>
      <div class="conds" id="conds" role="group" aria-label="État">${CONDS.map((k) => `<button type="button" data-c="${k}" class="${k === st.cond ? "on" : ""}" aria-pressed="${k === st.cond}">${k}</button>`).join("")}</div>
      <div id="prio-wrap"></div>
      <div class="inbinder"><div><b>${existing ? "Dans mon classeur" : "À ajouter au classeur"}</b><span>${esc(c ? binderPos(c, it.v) : "")}</span></div>
        <div class="stepper"><button type="button" id="q-minus" aria-label="Retirer un exemplaire">${svg(ICONS.minus)}</button><output id="q-out" aria-live="polite">${st.qty}</output><button type="button" class="plus" id="q-plus" aria-label="Ajouter un exemplaire">${svg(ICONS.plus)}</button></div></div>
      <div class="stk" style="margin-top:16px">
        <div class="chart-readout" id="card-readout"></div>
        <div class="chart" id="chart-card"></div>
        <div class="chart-axis" id="axis-card"></div>
        <p class="empty-chart" id="card-chart-empty" hidden>Historique en cours de constitution (un point par semaine et à chaque mise à jour des prix).</p>
        <p class="empty-chart" id="card-chart-seed" hidden>Début de courbe : moyennes Cardmarket (30 jours, 7 jours, veille), en attendant l'historique relevé chaque semaine.</p>
        <div id="card-stats"></div>
      </div>
      <form class="stk form" id="item-form" style="margin-top:16px">
        <label class="field full">Provenance<select name="src"><option value="">Achat à l'unité</option>${[...store.purchases].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map((p) => `<option value="${p.pid}" ${p.pid === it.src ? "selected" : ""}>${esc(pLabel(p))}${p.date ? " · " + fmtDate(p.date) : ""}</option>`).join("")}</select></label>
        <label class="field" data-unit>Prix d'achat unitaire (€)<input name="buy" type="number" min="0" step="0.01" inputmode="decimal" value="${it.buy ?? ""}"></label>
        <label class="field" data-unit>Date d'achat<input name="buyDate" type="date" value="${it.buyDate ?? ""}"></label>
        <label class="field full">Prix manuel (€), prioritaire sur Cardmarket<input name="manual" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Vide = prix Cardmarket" value="${it.manual ?? ""}"></label>
        <label class="field full">Notes<textarea name="note" rows="2">${esc(it.note)}</textarea></label>
        <label class="field full">Ma photo de la carte<input name="photo" type="file" accept="image/*"></label>
        ${!existing && scanBlob ? `<label class="field full check"><input type="checkbox" name="useScan" checked> Utiliser la photo scannée comme illustration</label>` : ""}
        ${existing && it.photo ? `<label class="field full check"><input type="checkbox" name="delPhoto"> Supprimer ma photo</label>` : ""}
      </form>
      <div class="actions">
        ${existing ? `<button class="btn danger" id="del">Supprimer</button>` : ""}
        <a class="btn" href="https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${encodeURIComponent((langOf(c) === "ja" ? c?.a : c?.name) || c?.name || "")}&mode=gallery" target="_blank" rel="noopener">Cardmarket ${svg(ICONS.link)}</a>
        <button class="btn primary" id="save">${existing ? "Enregistrer" : "Ajouter au classeur"}</button>
      </div>
    </div>`;
  openModal();
  const back = $("[data-back]"); if (back) back.onclick = () => sheetBack();
  $$("[data-img]").forEach((b) => b.onclick = () => {
    $("#bigcard img").src = b.dataset.img === "own" ? own : img(c, true);
    $$("[data-img]").forEach((x) => x.classList.toggle("on", x === b));
  });
  const seg = (sel, key, attr) => $$(`${sel} button`).forEach((b) => b.onclick = () => {
    st[key] = b.dataset[attr]; $$(`${sel} button`).forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
    if (key === "v") { $("#bigcard .cf").classList.toggle("holo", isHolo(st.v)); refresh(); }
  });
  seg("#langs", "lang", "l"); seg("#vars", "v", "v"); seg("#conds", "cond", "c");
  const renderPrio = () => {
    $("#prio-wrap").innerHTML = wished() ? `<div class="lbl">Priorité (recherchées)</div><div class="vars" id="prio">${[1, 2, 3].map((p) => `<button type="button" data-p="${p}" class="${store.wish[it.id] === p ? "on" : ""}">${PRIO[p]}</button>`).join("")}</div>` : "";
    $$("#prio button").forEach((b) => b.onclick = () => { store.wish[it.id] = +b.dataset.p; save(); renderPrio(); renderWish(); });
  };
  renderPrio();
  $("#wish-btn").onclick = () => {
    if (wished()) delete store.wish[it.id]; else store.wish[it.id] = 2;
    save(); const on = wished(), b = $("#wish-btn");
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); b.setAttribute("aria-label", on ? "Retirer des recherchées" : "Ajouter aux recherchées");
    toast(on ? "Ajoutée aux recherchées" : "Retirée des recherchées"); renderPrio(); refreshViews();
  };
  // Stepper : sur une carte possédée, la quantité est enregistrée immédiatement
  const setQty = (q) => {
    st.qty = Math.max(1, q); $("#q-out").textContent = st.qty; $("#q-minus").disabled = st.qty <= 1;
    if (existing) { existing.qty = st.qty; save(); refreshViews(); }
    refresh();
  };
  $("#q-minus").onclick = () => setQty(st.qty - 1); $("#q-plus").onclick = () => setQty(st.qty + 1); $("#q-minus").disabled = st.qty <= 1;
  const f = $("#item-form"), srcSel = f.elements.src;
  const syncSrc = () => $$("#item-form [data-unit]").forEach((l) => (l.hidden = !!srcSel.value));
  srcSel.onchange = () => { syncSrc(); refresh(); }; syncSrc();

  // Cote et courbe de la variante choisie
  async function refresh() {
    const cur = { ...it, v: st.v, manual: f.elements.manual.value, qty: st.qty, buy: f.elements.buy.value, src: srcSel.value };
    const unit = unitEUR(cur), bought = hasBuy(cur), src = cur.src ? purchase(cur.src) : null;
    const plv = existing && bought ? ((unit || 0) - cur.buy) * cur.qty : null;
    $("#cote").textContent = money(unit);
    $("#cote-l").textContent = hasManual(cur) ? "Cote (prix manuel)" : "Cote moyenne";
    $("#cote-h").innerHTML = hasManual(cur) ? "Saisie manuelle" : `Tendance Cardmarket · ${esc(VARS[cur.v].toLowerCase())} ${trend(change(cur)?.rel)}`;
    $("#card-stats").innerHTML = `<div class="stats3">
      ${statTile("Plus bas", money(lowEUR(cur.id, cur.v)), { display: false })}
      ${statTile("Moy. 30 j", money(avg30EUR(cur.id, cur.v)), { display: false })}
      ${statTile(`Total ×${cur.qty}`, money((unit || 0) * cur.qty), { display: false })}
    </div>
    ${existing && src ? `<div class="pl-line"><span class="muted">Provenance</span><b>${esc(pLabel(src))}${src.date ? ` · ${fmtDate(src.date)}` : ""}</b></div>` : ""}
    ${plv != null ? `<div class="pl-line"><span class="muted">Plus-value</span><b class="${plv >= 0 ? "gain" : "loss"}">${plv >= 0 ? "+" : "−"}${money(Math.abs(plv))} ${trend(cur.buy ? plv / (cur.buy * cur.qty) : null)}</b></div>` : ""}`;
    await loadServerHist(fromDate());
    if (!$("#sheet").open || !$("#chart-card")) return;
    const seedInfo = {};
    const ok = priceChart("card", $("#chart-card"), cardPoints(cur.id, cur.v, fromDate(), seedInfo), { grid: true, ref: bought ? +cur.buy : null, axis: $("#axis-card"), readout: $("#card-readout") });
    $("#card-chart-empty").hidden = ok; $("#card-chart-seed").hidden = !ok || !seedInfo.seeded;
  }
  f.elements.manual.onchange = refresh; f.elements.buy.onchange = refresh;
  $("#save").onclick = () => saveItem(existing, it, st);
  if (existing) $("#del").onclick = async () => {
    if (!confirm("Supprimer cette carte de la collection ?")) return;
    store.items = store.items.filter((i) => i.uid !== existing.uid);
    if (existing.photo) idb.del(existing.uid).catch(() => {});
    save(); refreshViews(); toast("Carte supprimée");
    if (sheetBack) sheetBack(); else $("#sheet").close();
  };
  await refresh();
}
function trendText(rel) {
  if (rel == null || !isFinite(rel)) return "";
  const v = rel * 100; if (Math.abs(v) < 0.05) return "— stable";
  return `${v > 0 ? "▲ +" : "▼ −"}${Math.abs(v).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

async function resizeImage(blob, max = 900) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  return new Promise((r) => cv.toBlob(r, "image/jpeg", 0.85));
}

async function saveItem(existing, base, st) {
  const f = $("#item-form"); if (!f.reportValidity()) return;
  const fd = new FormData(f);
  const num = (k) => (fd.get(k) === "" ? "" : Math.round(+fd.get(k) * 100) / 100);
  const data = { qty: st.qty, v: st.v, cond: st.cond, lang: st.lang, buy: num("buy"), buyDate: fd.get("buyDate"), manual: num("manual"), note: fd.get("note").trim(), src: fd.get("src") || "" };
  if (data.src) { data.buy = ""; data.buyDate = ""; }
  if (!existing) store.settings.lastSrc = data.src;
  const file = fd.get("photo"), withPhoto = (file && file.size) || (!existing && fd.get("useScan"));
  let it;
  if (existing) { it = Object.assign(existing, data); toast("Modifications enregistrées"); }
  else {
    // Doublon identique (même carte, variante, état, langue, provenance) : on cumule la quantité
    const twin = !withPhoto && store.items.find((i) => i.id === base.id && i.v === data.v && i.cond === data.cond && i.lang === data.lang && (i.src || "") === data.src && !i.photo);
    if (twin) { twin.qty += data.qty; if (data.note && !twin.note) twin.note = data.note; it = twin; toast(`Déjà dans le classeur : quantité ×${twin.qty}`); }
    else { it = { uid: uid(), id: base.id, added: new Date().toISOString(), ...data }; store.items.push(it); toast("Carte ajoutée au classeur"); }
    if (store.wish[base.id] != null) delete store.wish[base.id];
  }
  addPoint(hk(it.id, it.v));
  const blob = file && file.size ? file : !existing && fd.get("useScan") ? scanBlob : null;
  if (blob) { await idb.set(it.uid, await resizeImage(blob)); it.photo = true; photoUrls.delete(it.uid); }
  else if (fd.get("delPhoto")) { await idb.del(it.uid); it.photo = false; photoUrls.delete(it.uid); }
  save(); refreshViews();
  if (sheetBack) sheetBack(); else $("#sheet").close();
  if (!existing && $("#q").value && $("#view-scan").classList.contains("active")) renderResults(search($("#q").value));
}

// ---------- Scan (OCR du code d'extension et du numéro) ----------
const loadScript = (src) => new Promise((res, rej) => { if ([...document.scripts].some((s) => s.src === src)) return res(); const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });

function prepCanvas(bmp, [fx, fy, fw, fh], width = 1800) {
  const sx = Math.round(bmp.width * fx), sy = Math.round(bmp.height * fy), sw = Math.round(bmp.width * fw), sh = Math.round(bmp.height * fh), k = width / sw;
  const cv = Object.assign(document.createElement("canvas"), { width, height: Math.round(sh * k) });
  const ctx = cv.getContext("2d");
  ctx.filter = "grayscale(1) contrast(1.8)";
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  return cv;
}
// Confusions OCR fréquentes : O/0, I/1, S/5, B/8 (+ Z/2, G/6)
const DIG = (s) => s.replace(/[OQD]/g, "0").replace(/[IL|!]/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2").replace(/G/g, "6");
const LET = (s) => s.replace(/0/g, "O").replace(/1/g, "I").replace(/5/g, "S").replace(/8/g, "B").replace(/2/g, "Z").replace(/6/g, "G");
const CODES = () => new Set([...sets.values()].map((s) => (s.code || "").toUpperCase()).filter(Boolean));
function candidates(text) {
  const t = text.toUpperCase().replace(/[\\|]/g, "/"), codes = CODES(), out = new Map();
  const add = (label, list) => { for (const c of list) if (!out.has(c.id)) out.set(c.id, { c, label }); };
  // "MEW FR 025/165", "025/165", "TG05/TG30"
  for (const m of t.matchAll(/(?:\b([D-J])\s+)?(?:([A-Z0-9]{2,4})\s+)?(?:(FR|EN)\s+)?([A-Z]{0,2}[0-9OQDILSBZG]{1,3})\s*\/\s*([A-Z]{0,2}[0-9OQDILSBZG]{2,3})/g)) {
    const fix = (x) => { const p = x.match(/^([A-Z]{0,2}?)([0-9OQDILSBZG]+)$/); return p ? (p[1] && /^(TG|GG|SV|RC|H)$/.test(p[1]) ? p[1] : "") + DIG(p[2]) : DIG(x); };
    const num = fix(m[4]), tot = fix(m[5]), code = m[2] ? LET(m[2]) : "", lg = m[3] ? ` ${m[3]}` : "", mk = m[1] ? `${m[1]} ` : "";
    if (code && codes.has(code)) { const r = search(`${mk}${code}${lg} ${num}/${tot}`); if (r.list.length) { add(`${mk}${code}${lg} ${num}/${tot}`, r.list); continue; } }
    const r = search(`${mk}${lg} ${num}/${tot}`.trim()); if (r.list.length) add(`${mk}${num}/${tot}`, r.list);
  }
  // Promos et cartes sans total : "SVP FR 045", "MEW 025"
  if (!out.size) for (const m of t.matchAll(/\b([A-Z0-9]{2,4})\s+(?:FR\s+)?([0-9OQDILSBZG]{2,3})\b/g)) {
    const code = LET(m[1]); if (!codes.has(code)) continue;
    const r = search(`${code} ${DIG(m[2])}`); if (r.list.length) add(`${code} ${DIG(m[2])}`, r.list);
  }
  return [...out.values()];
}
async function scan(file) {
  scanBlob = file;
  const st = $("#scan-status");
  $("#scan-preview").innerHTML = `<img alt="" src="${URL.createObjectURL(file)}">`;
  $("#results").innerHTML = "";
  try {
    st.textContent = "Chargement de la reconnaissance de texte…";
    await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js");
    const bmp = await createImageBitmap(file);
    const worker = await Tesseract.createWorker("eng");
    await worker.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/ " });
    // bas gauche (code + numéro), bas de la carte, carte entière, haut (photo à l'envers)
    const zones = [[0, 0.86, 0.55, 0.14], [0, 0.78, 1, 0.22], [0, 0.6, 1, 0.4], [0, 0, 1, 1]];
    let found = [];
    for (const [i, z] of zones.entries()) {
      st.textContent = `Lecture du numéro… (${i + 1}/${zones.length})`;
      const { data } = await worker.recognize(prepCanvas(bmp, z, z[2] < 1 ? 1600 : 1800));
      found = candidates(data.text);
      if (found.length) break;
    }
    await worker.terminate();
    if (!found.length) { st.textContent = "Numéro non reconnu. Saisis-le ci-dessus (ex. MEW 025 ou 025/165) — la photo sera proposée comme illustration."; return; }
    const labels = [...new Set(found.map((x) => x.label))];
    st.innerHTML = `Lu sur la carte : <b>${labels.map(esc).join(", ")}</b>`;
    $("#q").value = labels[0];
    renderResults({ list: found.map((x) => x.c), hint: found.length > 1 ? `${found.length} correspondances — choisis la bonne carte :` : "" });
  } catch (e) {
    console.error(e); st.textContent = "Reconnaissance indisponible (connexion requise au premier usage). Saisis le numéro manuellement.";
  }
}

// ---------- Import / export ----------
const download = (name, data, type) => { const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([data], { type })), download: name }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
const blobToDataURL = (b) => new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
async function exportJSON() {
  const photos = {};
  for (const it of store.items) if (it.photo) { const b = await idb.get(it.uid).catch(() => null); if (b) photos[it.uid] = await blobToDataURL(b); }
  download(`collection-pokemon-${today()}.json`, JSON.stringify({ app: "pkcol", version: 1, ...store, photos }), "application/json");
}
async function importJSON(file) {
  try {
    const d = JSON.parse(await file.text()); if (!Array.isArray(d.items)) throw 0;
    if (!confirm(`Remplacer la collection actuelle par ${d.items.length} référence(s) ?`)) return;
    for (const [k, url] of Object.entries(d.photos || {})) await idb.set(k, await (await fetch(url)).blob());
    delete d.photos; delete d.app; delete d.version;
    store = { ...blank(), ...d, settings: { ...blank().settings, ...d.settings } };
    photoUrls.clear(); snapshot(); save(); applySettings(); refreshViews(); toast("Collection importée");
  } catch { toast("Fichier invalide"); }
}
function exportCSV() {
  const dec = (x) => (x == null || x === "" ? "" : (+x).toFixed(2).replace(".", ","));
  const rows = [["Extension", "Code", "Numéro", "Nom", "Rareté", "Variante", "Quantité", "État", "Langue", "Provenance", "Prix achat unitaire (€)", "Date achat", "Valeur unitaire (€)", "Valeur totale (€)", "Prix manuel", "Notes"]];
  const list = [...store.items].sort((a, b) => cmpKey(numKey(byId.get(a.id)), numKey(byId.get(b.id))));
  for (const it of list) {
    const c = byId.get(it.id) || {}, s = sets.get(c.s) || {}, u = unitEUR(it);
    rows.push([s.name, s.code, numLabel(c), c.name, c.r, VARS[it.v], it.qty, it.cond, it.lang, it.src ? pLabel(purchase(it.src) || { type: "" }) : "Unité", dec(it.buy), fmtDate(it.buyDate), dec(u), u != null ? dec(u * it.qty) : "", hasManual(it) ? "oui" : "", it.note]);
  }
  download(`collection-pokemon-${today()}.csv`, "﻿" + rows.map((r) => r.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n"), "text/csv;charset=utf-8");
}

// ---------- Navigation / UI ----------
const VIEWS = ["home", "sets", "scan", "wish", "profile"];
let current = "home";
function refreshViews() {
  if (current === "home") renderHome(); else if (current === "sets") renderSets(); else if (current === "wish") renderWish(); else if (current === "profile") renderProfile();
}
function go(v) {
  if (!VIEWS.includes(v)) return;
  current = v;
  $$(".view").forEach((s) => s.classList.toggle("active", s.id === "view-" + v));
  const tab = v === "sets" || v === "wish" ? "home" : v; // Sets et Recherchées : depuis l'onglet Collection
  $$(".nav button").forEach((b) => { const on = b.dataset.goto === tab; b.classList.toggle("on", on); if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  refreshViews();
  window.scrollTo(0, 0);
  if (v === "scan") setTimeout(() => $("#q").focus({ preventScroll: true }), 60);
}
let toastT;
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2200); }
function applySettings() { $("#currency").value = store.settings.currency; $("#sort").value = store.settings.sort ?? "number"; }

document.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches(".tile, .result, .stat.act, .w-row")) { e.preventDefault(); e.target.click(); } });
document.addEventListener("click", (e) => {
  if (e.target.closest("#sheet")) { if (e.target.closest("[data-close]") || e.target === $("#sheet")) $("#sheet").close(); return; }
  const g = e.target.closest("[data-goto]"); if (g) return go(g.dataset.goto);
  if (e.target.closest('[data-act="invest"]')) return openInvest();
  const set = e.target.closest("[data-set]"); if (set) { sheetBack = null; return openSet(set.dataset.set); }
  const tile = e.target.closest(".tile, .mover"); if (tile) { sheetBack = null; return openSheet({ uid: tile.dataset.uid }); }
  const r = e.target.closest(".result, #wish-list .w-row"); if (r) { sheetBack = null; return openSheet({ id: r.dataset.id }); }
  const t = e.target.closest("[data-type]"); if (t) { typeFilter = typeFilter === t.dataset.type ? "" : t.dataset.type; renderHome(); return $("#my-cards").scrollIntoView({ behavior: "smooth" }); }
});
$("#type-clear").onclick = () => { typeFilter = ""; renderHome(); };
$("#b-doubles").onclick = () => { doublesOnly = !doublesOnly; renderHome(); if (doublesOnly) $("#my-cards").scrollIntoView({ behavior: "smooth" }); };
$("#go-search").onclick = () => { $("#my-cards").scrollIntoView({ behavior: "smooth" }); setTimeout(() => $("#filter").focus({ preventScroll: true }), 350); };
$("#sheet").addEventListener("close", () => { onModalClose(); refreshViews(); });
$("#search-form").onsubmit = (e) => { e.preventDefault(); scanBlob = null; $("#scan-preview").innerHTML = ""; $("#scan-status").textContent = ""; $("#q").blur(); renderResults(search($("#q").value)); };
$("#scan-input").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) scan(f); };
applySettings();
$("#sort").addEventListener("input", () => { store.settings.sort = $("#sort").value; save(); renderGrid(); });
$("#filter").addEventListener("input", renderGrid);
$("#set-filter").addEventListener("input", renderSets);
$("#sets-chips").onclick = (e) => { const b = e.target.closest(".pill"); if (!b) return; setsMode = b.dataset.s; renderSets(); };
$("#sets-langs").onclick = (e) => { const b = e.target.closest(".pill"); if (!b) return; setsLang = b.dataset.l; renderSets(); };
$("#periods").onclick = async (e) => {
  const b = e.target.closest(".pill"); if (!b) return;
  store.settings.period = +b.dataset.p; save();
  await loadServerHist(fromDate()); renderHome();
};
$("#currency").onchange = (e) => { store.settings.currency = e.target.value; save(); toast("Devise enregistrée"); };
$("#export").onclick = exportJSON;
$("#export-csv").onclick = exportCSV;
$("#import").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importJSON(f); };
$("#reset").onclick = () => { if (confirm("Effacer toute la collection de cet appareil ? (exporte-la avant)")) { store = blank(); save(); applySettings(); refreshViews(); toast("Collection effacée"); } };

// ---------- Démarrage ----------
(async () => {
  try { await loadData(); }
  catch (e) { console.error("loadData", e); toast("Données indisponibles — vérifie ta connexion."); }
  $("#updated").textContent = prices.updated ? `Cotes Cardmarket du ${fmtDate(prices.updated)}` : "";
  const per = (l) => [...sets.values()].filter((s) => s.lang === l);
  $("#data-info").textContent = `${cards.length.toLocaleString("fr-FR")} cartes · ${sets.size} extensions (${["fr", "en", "ja"].map((l) => `${per(l).length} ${LANG_LABEL[l]}`).join(", ")}) · prix Cardmarket du ${fmtDate(prices.updated)}`;
  refreshViews();
  await loadServerHist(fromDate()); refreshViews();
  document.documentElement.dataset.ready = "1";
})();
let swReg = null;
// Mises à jour : vérification à chaque retour dans l'app, rechargement automatique quand une nouvelle version est prête
const APP_VERSION = "7 (05/11/2026)";
$("#app-version").textContent = `Version de l'app : ${APP_VERSION}`;
// Stockage persistant : évite que le navigateur vide la collection et le cache hors ligne
navigator.storage?.persist?.().catch(() => {});
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading || $("#sheet").open) return;
    reloading = true; location.reload();
  });
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((reg) => {
    swReg = reg;
    const check = () => reg.update().catch(() => {});
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
    addEventListener("pageshow", check);
    setInterval(check, 30 * 60e3);
  }).catch(() => {});
}

// ---------- Tirer vers le bas pour actualiser ----------
(() => {
  const el = $("#ptr"), THRESHOLD = 80, MAX = 130;
  let y0 = null, dy = 0, busy = false;
  const set = (d) => {
    const t = Math.min(d, MAX) * 0.6;
    el.style.transform = `translateY(${t - 70 + 70 * Math.min(1, d / THRESHOLD)}px) rotate(${d * 2.5}deg)`;
    el.style.opacity = Math.min(1, d / 40);
    el.classList.toggle("ready", d >= THRESHOLD);
  };
  const reset = () => { el.classList.add("anim"); el.style.transform = ""; el.style.opacity = ""; el.classList.remove("ready", "spin"); setTimeout(() => el.classList.remove("anim"), 260); };
  addEventListener("touchstart", (e) => {
    if (busy || $("#sheet").open || e.touches.length !== 1 || scrollY > 0) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0; el.classList.remove("anim");
  }, { passive: true });
  addEventListener("touchmove", (e) => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0 || scrollY > 0) { if (dy < 0) y0 = null; set(0); return; }
    set(dy);
  }, { passive: true });
  addEventListener("touchend", async () => {
    if (y0 == null) return;
    y0 = null;
    if (dy < THRESHOLD) return reset();
    busy = true;
    el.classList.add("anim", "spin", "ready"); el.style.transform = "translateY(0)"; el.style.opacity = 1;
    try { await swReg?.update(); } catch {}
    setTimeout(() => location.reload(), 300);
  });
  addEventListener("touchcancel", () => { y0 = null; reset(); });
})();
