// Minimal PostgREST mimic for Pokefin UI audit.
const http = require("http");
const url = require("url");

let seed = 42;
function rand() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
function gauss() { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// FIXTURE_TODAY=YYYY-MM-DD pins the fixture date, so every run generates identical rows. The default is
// today (UTC): like the database, the RPCs measure their windows from the real clock, not from this date.
const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const PIN = process.env.FIXTURE_TODAY;
const _n = PIN ? new Date(PIN + "T00:00:00Z") : new Date();
// round-trip the string, so an overflowing date such as 2026-09-31 is refused rather than read as October 1
if (PIN && !(/^\d{4}-\d{2}-\d{2}$/.test(PIN) && !isNaN(_n) && iso(_n) === PIN)) throw new Error("FIXTURE_TODAY must be a real calendar date, YYYY-MM-DD");
const TODAY = new Date(Date.UTC(_n.getUTCFullYear(), _n.getUTCMonth(), _n.getUTCDate()));
// Freshness gates run against the real clock, as the database's current_date does, not against TODAY.
const realToday = () => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())); };
const freshSince = (days) => iso(new Date(realToday() - days * DAY));

const generations = [
  { id: 1, name: "Sun & Moon" },
  { id: 2, name: "Sword & Shield" },
  { id: 3, name: "Scarlet & Violet" },
  { id: 4, name: "Mega Evolution" },
];
const sets = [
  { id: 1, name: "Hidden Fates", code: "HIF", release_date: "2019-08-23", generation_id: 1, expansion_type: "Special Expansion", base: 1.9 },
  { id: 2, name: "Cosmic Eclipse", code: "CEC", release_date: "2019-11-01", generation_id: 1, expansion_type: "Main Series", base: 2.4 },
  { id: 3, name: "Evolving Skies", code: "EVS", release_date: "2021-08-27", generation_id: 2, expansion_type: "Main Series", base: 3.2 },
  { id: 4, name: "Brilliant Stars", code: "BRS", release_date: "2022-02-25", generation_id: 2, expansion_type: "Main Series", base: 1.6 },
  { id: 5, name: "Crown Zenith", code: "CRZ", release_date: "2023-01-20", generation_id: 2, expansion_type: "Special Expansion", base: 1.3 },
  { id: 6, name: "Scarlet & Violet 151", code: "MEW", release_date: "2023-09-22", generation_id: 3, expansion_type: "Special Expansion", base: 1.5 },
  { id: 7, name: "Paldean Fates", code: "PAF", release_date: "2024-01-26", generation_id: 3, expansion_type: "Special Expansion", base: 1.1 },
  { id: 8, name: "Surging Sparks", code: "SSP", release_date: "2024-11-08", generation_id: 3, expansion_type: "Main Series", base: 1.25 },
  { id: 9, name: "Prismatic Evolutions", code: "PRE", release_date: "2025-01-17", generation_id: 3, expansion_type: "Special Expansion", base: 1.7 },
  { id: 10, name: "Destined Rivals", code: "DRI", release_date: "2025-05-30", generation_id: 3, expansion_type: "Main Series", base: 1.15 },
  { id: 11, name: "Mega Evolution", code: "MEG", release_date: "2025-09-26", generation_id: 4, expansion_type: "Main Series", base: 1.0 },
  { id: 12, name: "Phantasmal Flames", code: "PFL", release_date: "2025-11-14", generation_id: 4, expansion_type: "Main Series", base: 0.95 },
  { id: 13, name: "Ascended Heroes", code: "ASC", release_date: "2026-08-22", generation_id: 4, expansion_type: "Special Expansion", base: 1.05 },
];
// A pinned date must not shrink the catalog: the capture scripts open fixed product ids (105, 110).
const NEWEST_RELEASE = sets.reduce((m, s) => (s.release_date > m ? s.release_date : m), "");
if (iso(TODAY) < NEWEST_RELEASE) throw new Error(`FIXTURE_TODAY must be ${NEWEST_RELEASE} or later (the newest set's release)`);
// nor run ahead of the real clock: production holds no rows dated after current_date
if (iso(TODAY) > iso(realToday())) throw new Error(`FIXTURE_TODAY must not be after today (${iso(realToday())})`);
const types = {
  booster_box: { id: 1, name: "booster_box", label: "Booster Box", msrp: 161, special: false },
  elite_trainer_box: { id: 2, name: "elite_trainer_box", label: "Elite Trainer Box", msrp: 50 },
  booster_bundle: { id: 3, name: "booster_bundle", label: "Booster Bundle", msrp: 27 },
  collection: { id: 4, name: "collection", label: "Collection Box", msrp: 40 },
  booster_pack: { id: 5, name: "booster_pack", label: "Booster Pack", msrp: 4.5 },
};
const colors = { 1: "#dc2626", 2: "#2563eb", 3: "#16a34a", 4: "#ca8a04", 5: "#7c3aed" };
function img(label, typeId) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='240'><rect width='200' height='240' rx='12' fill='${colors[typeId]}'/><rect x='14' y='14' width='172' height='212' rx='8' fill='white' opacity='0.18'/><text x='100' y='128' font-family='sans-serif' font-size='20' fill='white' text-anchor='middle'>${label}</text></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

const products = [];
let pid = 100;
for (const s of sets) {
  const special = s.expansion_type === "Special Expansion";
  const list = special ? ["elite_trainer_box", "booster_bundle", "collection", "booster_pack"] : ["booster_box", "elite_trainer_box", "booster_bundle", "booster_pack"];
  if (s.id === 3 || s.id === 8 || s.id === 10 || s.id === 12) list.push("collection");
  for (const t of list) {
    const tt = types[t];
    let variant = null;
    if (t === "collection") variant = ["Premium Collection", "Ultra Premium Collection", "Poster Collection", "Tin Collection"][s.id % 4];
    const ageYears = (TODAY - new Date(s.release_date)) / (365 * DAY);
    const current = Math.min(1800, tt.msrp * s.base * (1 + Math.max(0, ageYears) * (0.35 + rand() * 0.4)) * (0.85 + rand() * 0.3));
    products.push({ id: pid++, set: s, type: tt, variant, current: +current.toFixed(2) });
    if (t === "elite_trainer_box" && (s.id === 9 || s.id === 6)) {
      products.push({ id: pid++, set: s, type: tt, variant: "Pokemon Center Exclusive", current: +(current * 1.8).toFixed(2) });
    }
  }
}
// one stale product to exercise the freshness gate
products[5].stale = true;

// history
const history = {}; // id -> [{recorded_at, usd_price}]
for (const p of products) {
  const start = Math.max(new Date(p.set.release_date).getTime(), TODAY - 365 * DAY);
  const days = Math.round((TODAY - start) / DAY);
  const drift = (rand() - 0.35) * 0.0025; // daily drift
  const vol = 0.006 + rand() * 0.02;
  const pts = [];
  let v = p.current;
  for (let i = 0; i <= days; i++) {
    const d = new Date(TODAY - i * DAY);
    if (p.stale && i < 25) continue;
    pts.push({ recorded_at: iso(d) + "T02:" + String(10 + (p.id % 40)).padStart(2, "0") + ":00+00:00", usd_price: +v.toFixed(2) });
    v = v / (1 + drift + gauss() * vol);
    if (rand() < 0.01) v = v * (1 + (rand() - 0.5) * 0.25); // jumps
  }
  pts.reverse();
  history[p.id] = pts;
  if (p.stale) p.current = pts[pts.length - 1].usd_price;
}

// 0023: a price (and its returns) shows only when the newest price row is within 14 days
const isPriceFresh = (p) => history[p.id].at(-1).recorded_at.slice(0, 10) >= freshSince(14);

function priceAt(h, daysAgo) {
  const target = iso(new Date(TODAY - daysAgo * DAY));
  let best = null;
  for (const r of h) { if (r.recorded_at.slice(0, 10) <= target) best = r; }
  return best ? best.usd_price : null;
}
// 20260506: a return compares the current price with the newest daily row on or before current_date - n
function ret(h, n) { const cur = h[h.length - 1]?.usd_price; const t = freshSince(n); let past = null; for (const r of h) if (r.recorded_at.slice(0, 10) <= t) past = r.usd_price; if (!cur || !(past > 0)) return null; return ((cur - past) / past) * 100; }

function summaryRow(p) {
  const h = history[p.id];
  const last = h[h.length - 1];
  const fresh = isPriceFresh(p);
  return {
    id: p.id, usd_price: fresh ? last.usd_price : null, url: "https://www.tcgplayer.com/product/" + p.id,
    price_recorded_at: last.recorded_at, last_updated: last.recorded_at.replace("+00:00", ".412391"),
    variant: p.variant, image_url: img(p.set.code + " " + (p.type.label.split(" ").map(w=>w[0]).join("")), p.type.id), sku: p.set.code + "-" + p.type.id + (p.variant === "Pokemon Center Exclusive" ? "-PC" : ""),
    set_id: p.set.id, set_name: p.set.name, set_code: p.set.code, set_release_date: p.set.release_date, set_expansion_type: p.set.expansion_type,
    generation_id: p.set.generation_id, generation_name: generations.find(g => g.id === p.set.generation_id).name,
    product_type_id: p.type.id, product_type_name: p.type.name, product_type_label: p.type.label,
    return_1d: fresh ? ret(h, 1) : null, return_7d: fresh ? ret(h, 7) : null, return_30d: fresh ? ret(h, 30) : null,
    return_90d: fresh ? ret(h, 90) : null, return_180d: fresh ? ret(h, 180) : null, return_365d: fresh ? ret(h, 365) : null,
  };
}

// sales
const sales = {};
const listings = {};
for (const p of products) {
  const baseDemand = Math.max(1, 400 / Math.sqrt(p.current)) * (0.5 + rand());
  const rows = [];
  for (let i = 30; i >= 1; i--) {
    const d = new Date(TODAY - i * DAY);
    if (d < new Date(p.set.release_date)) continue;
    const q = Math.max(0, Math.round(baseDemand * (0.6 + rand() * 0.8) * (1 + (30 - i) * 0.01)));
    const mp = priceAt(history[p.id], i) || p.current;
    rows.push({ bucket_date: iso(d), granularity: "day", quantity_sold: q, transaction_count: Math.max(0, q - Math.round(rand() * 3)), low_sale_price: +(mp * 0.93).toFixed(2), high_sale_price: +(mp * 1.08).toFixed(2), market_price: mp });
  }
  // weekly Mondays for last 52 weeks
  const mon = new Date(TODAY); mon.setUTCDate(mon.getUTCDate() - ((mon.getUTCDay() + 6) % 7));
  for (let w = 52; w >= 1; w--) {
    const d = new Date(mon - w * 7 * DAY);
    if (d < new Date(p.set.release_date)) continue;
    const q = Math.round(baseDemand * 7 * (0.6 + rand() * 0.8));
    const mp = priceAt(history[p.id], w * 7) || p.current;
    rows.push({ bucket_date: iso(d), granularity: "week", quantity_sold: q, transaction_count: q, low_sale_price: +(mp * 0.9).toFixed(2), high_sale_price: +(mp * 1.1).toFixed(2), market_price: mp });
  }
  rows.sort((a, b) => a.bucket_date.localeCompare(b.bucket_date));
  sales[p.id] = rows;
  const ql = Math.round(baseDemand * (5 + rand() * 40));
  listings[p.id] = { active_listings: Math.round(ql / (2 + rand() * 3)) + 1, total_quantity_available: ql, lowest_listing_price: +(p.current * (0.96 + rand() * 0.06)).toFixed(2), snapshot_date: iso(new Date(TODAY - DAY)) };
}
function volumeRow(p) {
  const s = sales[p.id].filter(r => r.granularity === "day");
  const sum = (arr) => (arr.length ? arr.reduce((a, r) => a + r.quantity_sold, 0) : null);
  const l = listings[p.id];
  // 0022: windows are calendar ranges ending at current_date (the real clock), not row counts
  const w7 = s.filter(r => r.bucket_date >= freshSince(6));
  const w30 = s.filter(r => r.bucket_date >= freshSince(29));
  // 0022's prior CASE: exact daily with 28+ days covered, else exactly four weekly buckets scaled 30/28, else the daily partial
  const wp = s.filter(r => r.bucket_date >= freshSince(59) && r.bucket_date <= freshSince(30));
  const wk = sales[p.id].filter(r => r.granularity === "week" && r.bucket_date >= freshSince(63) && r.bucket_date <= freshSince(36));
  const prior = wp.length >= 28 ? sum(wp) : wk.length === 4 ? Math.round(sum(wk) * 30 / 28) : sum(wp);
  // 0021/0022: windows and listing depth need data within 3 days; the snapshot date always shows
  const salesFresh = s.length > 0 && s.at(-1).bucket_date >= freshSince(3);
  const listFresh = l.snapshot_date >= freshSince(3);
  return { product_id: p.id, units_sold_7d: salesFresh ? sum(w7) : null, units_sold_30d: salesFresh ? sum(w30) : null, units_sold_prior_30d: prior, transaction_count_30d: salesFresh && w30.length ? w30.reduce((a, r) => a + r.transaction_count, 0) : null, active_listings: listFresh ? l.active_listings : null, total_quantity_available: listFresh ? l.total_quantity_available : null, lowest_listing_price: listFresh ? l.lowest_listing_price : null, listings_snapshot_date: l.snapshot_date };
}

// get_market_product_metrics (20260506), ungated and windowed on the real clock (day >= current_date - n)
const win = (p, n) => history[p.id].filter(r => r.recorded_at.slice(0, 10) >= freshSince(n)).map(r => r.usd_price);
const mean = (v) => { v = v.filter(x => x != null && !isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const stdPop = (v) => { v = v.filter(x => x != null && !isNaN(x)); if (!v.length) return null; const m = mean(v); return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / v.length); };
// stddev_pop of daily % changes
function volatility90(p) { const y = win(p, 90); const ch = []; for (let i = 1; i < y.length; i++) if (y[i - 1] > 0) ch.push((y[i] - y[i - 1]) / y[i - 1] * 100); return stdPop(ch); }
// abs(min(...)) of the drop from the running peak
function drawdown365(p) { let peak = -Infinity, mdd = null; for (const v of win(p, 365)) { peak = Math.max(peak, v); if (peak > 0) mdd = Math.min(mdd ?? 0, (v - peak) / peak * 100); } return mdd == null ? null : Math.abs(mdd); }
// regr_slope(price, day index) / avg(price) * 100
function trend(p, n) { const y = win(p, n), k = y.length; if (k < 2) return null; const mx = (k - 1) / 2, my = y.reduce((a, b) => a + b, 0) / k; if (!my) return null; let sxy = 0, sxx = 0; y.forEach((v, x) => { sxy += (x - mx) * (v - my); sxx += (x - mx) ** 2; }); return (sxy / sxx) / my * 100; }

function setAnalytics() {
  // 0023 keeps stale products in the population: only returns and price_per_day need a fresh price
  const rows = sets.filter(s => products.some(p => p.set.id === s.id)).map(s => {
    const ps = products.filter(p => p.set.id === s.id);
    const fresh = ps.filter(isPriceFresh);
    const rs = ps.map(p => summaryRow(p));
    const avg = (k) => mean(rs.map(r => r[k]));
    // percentile_cont(0.5): the mean of the two middle values when the count is even
    const med = (k) => { const v = rs.map(r => r[k]).filter(x => x != null).sort((a, b) => a - b); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
    const cons = (k) => { const v = rs.map(r => r[k]).filter(x => x != null); return v.length ? (v.filter(x => x > 0).length / v.length) * 100 : null; };
    const days = Math.max(0, Math.round((realToday() - new Date(s.release_date)) / DAY));
    const a30 = avg("return_30d"), a90 = avg("return_90d"), a365 = avg("return_365d");
    return { key: s.code + ":" + s.name, name: s.name, code: s.code, generation: generations.find(g => g.id === s.generation_id).name, release_date: s.release_date, days_since_release: days, product_count: ps.length,
      avg30: a30, avg90: a90, avg365: a365, median30: med("return_30d"), median90: med("return_90d"), median365: med("return_365d"),
      consistency90: cons("return_90d"), consistency365: cons("return_365d"), volatility90: mean(ps.map(volatility90)), max_drawdown365: mean(ps.map(drawdown365)),
      trend90: mean(ps.map(p => trend(p, 90))), trend365: mean(ps.map(p => trend(p, 365))),
      price_per_day: fresh.length ? fresh.reduce((a, p) => a + p.current / Math.max(days, 1), 0) / fresh.length : null,
      momentum_score: a30 == null && a90 == null && a365 == null ? null : (a90 || 0) * 0.5 + (a30 || 0) * 0.3 + (a365 || 0) * 0.2, invest_score: null, rank: null };
  });
  // 0023's composite: weighted population z-scores; a term is 0 when its std is 0 or null or the value is null.
  // A set with no fresh returns is neither scored nor ranked, and sorts last.
  const W = { avg30: 0.2, avg90: 0.4, avg365: 0.2, consistency90: 0.15, consistency365: 0.1, trend90: 0.1, trend365: 0.05, volatility90: -0.2, max_drawdown365: -0.15 };
  const st = Object.fromEntries(Object.keys(W).map(k => [k, { m: mean(rows.map(r => r[k])), sd: stdPop(rows.map(r => r[k])) }]));
  rows.forEach(r => { if (r.avg30 == null && r.avg90 == null && r.avg365 == null) return; r.invest_score = Object.entries(W).reduce((a, [k, w]) => a + (st[k].sd && r[k] != null ? ((r[k] - st[k].m) / st[k].sd) * w : 0), 0); });
  const score = (r) => r.invest_score ?? -Infinity;
  rows.sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name)).forEach((r, i) => { if (r.invest_score != null) r.rank = i + 1; });
  return rows;
}

function parseFilter(q, col) {
  const v = q[col]; if (v == null) return null;
  return Array.isArray(v) ? v : [v];
}
function applyFilters(rows, q) {
  for (const [k, raw] of Object.entries(q)) {
    if (["select", "order", "limit", "offset"].includes(k)) continue;
    const vals = Array.isArray(raw) ? raw : [raw];
    for (const v of vals) {
      const m = /^(eq|gte|lte|gt|lt|in|is)\.(.*)$/.exec(v); if (!m) continue;
      const [, op, arg] = m;
      rows = rows.filter(r => {
        const x = r[k]; if (x === undefined) return true;
        const xs = typeof x === "string" ? x : x;
        if (op === "eq") return String(xs) === arg;
        if (op === "gte") return String(xs) >= arg;
        if (op === "lte") return String(xs) <= arg;
        if (op === "gt") return String(xs) > arg;
        if (op === "lt") return String(xs) < arg;
        if (op === "in") return arg.replace(/[()]/g, "").split(",").map(s => s.replace(/"/g, "")).includes(String(xs));
        if (op === "is") return arg === "null" ? xs == null : true;
        return true;
      });
    }
  }
  return rows;
}
function applyOrder(rows, q) {
  if (!q.order) return rows;
  const parts = q.order.split(",").map(p => p.split("."));
  return rows.slice().sort((a, b) => {
    for (const [c, dir] of parts) { const av = a[c], bv = b[c]; if (av === bv) continue; const r = av > bv ? 1 : -1; return dir === "desc" ? -r : r; }
    return 0;
  });
}
function applyRange(rows, q, req) {
  let start = 0, end = rows.length - 1;
  const rh = req.headers["range"];
  if (rh) { const m = /(\d+)-(\d+)/.exec(rh); if (m) { start = +m[1]; end = +m[2]; } }
  if (q.offset) start = +q.offset;
  if (q.limit) end = Math.min(end, start + +q.limit - 1);
  return rows.slice(start, end + 1);
}

const tables = {
  exchange_rates: () => { const r = []; for (let i = 0; i < 30; i++) r.push({ id: i + 1, usd_to_cad: +(1.37 + Math.sin(i / 5) * 0.01).toFixed(4), recorded_at: iso(new Date(TODAY - i * DAY)) + "T00:00:00" }); return r; },
  product_price_history: () => { const r = []; let id = 1; for (const p of products) for (const h of history[p.id]) r.push({ id: id++, product_id: p.id, ...h }); return r; },
  product_sales_history: () => { const r = []; for (const p of products) for (const s of sales[p.id]) r.push({ product_id: p.id, ...s }); return r; },
  product_listings_history: () => products.map(p => ({ product_id: p.id, ...listings[p.id] })),
  products: () => products.map(p => { const s = summaryRow(p); return { id: p.id, usd_price: history[p.id].at(-1).usd_price, last_updated: s.last_updated, url: s.url, image_url: s.image_url, variant: p.variant, sku: s.sku, active: true, set_id: p.set.id, name: p.set.name + " " + p.type.label,
    sets: { id: p.set.id, name: p.set.name, code: p.set.code, release_date: p.set.release_date, generation_id: p.set.generation_id, expansion_type: p.set.expansion_type, generations: generations.find(g => g.id === p.set.generation_id) },
    product_types: { id: p.type.id, name: p.type.name, label: p.type.label } }; }),
  sets: () => sets.map(({ base, ...s }) => s),
  generations: () => generations,
  product_types: () => Object.values(types).map(({ msrp, special, ...t }) => t),
};
const cache = {};
function table(name) { if (!cache[name]) cache[name] = tables[name](); return cache[name]; }

const server = http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  let body = "";
  req.on("data", c => body += c);
  req.on("end", () => {
    const send = (status, data, extra = {}) => {
      res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*", "Access-Control-Expose-Headers": "Content-Range", ...extra });
      res.end(JSON.stringify(data));
    };
    if (req.method === "OPTIONS") return send(204, null);
    const path = u.pathname;
    let m;
    if ((m = /^\/rest\/v1\/rpc\/(\w+)$/.exec(path))) {
      const fn = m[1];
      if (fn === "get_market_product_summaries") return send(200, products.map(summaryRow).sort((a, b) => (a.last_updated < b.last_updated ? 1 : a.last_updated > b.last_updated ? -1 : 0) || a.id - b.id)); // 0023's ORDER BY
      if (fn === "get_market_product_volume_metrics") return send(200, products.map(volumeRow));
      if (fn === "get_set_analytics") return send(200, setAnalytics());
      console.log("UNKNOWN RPC", fn, body);
      return send(200, []);
    }
    if ((m = /^\/rest\/v1\/(\w+)$/.exec(path))) {
      const t = m[1];
      if (!tables[t]) { console.log("UNKNOWN TABLE", req.method, req.url); return send(200, []); }
      let rows = applyFilters(table(t), u.query);
      rows = applyOrder(rows, u.query);
      const total = rows.length;
      rows = applyRange(rows, u.query, req);
      const accept = req.headers["accept"] || "";
      if (accept.includes("vnd.pgrst.object")) return send(rows.length ? 200 : 406, rows[0] || { code: "PGRST116", message: "no rows" });
      return send(200, rows, { "Content-Range": `0-${rows.length - 1}/${total}` });
    }
    if (path.startsWith("/auth/v1/")) { console.log("AUTH", req.method, path); return send(path.includes("user") ? 401 : 200, path.includes("user") ? { message: "no session" } : {}); }
    console.log("UNKNOWN PATH", req.method, req.url);
    send(404, { message: "not found" });
  });
});
server.listen(54399, "127.0.0.1", () => console.log("stub ready", products.length, "products; ids", products[0].id, "-", products.at(-1).id));
