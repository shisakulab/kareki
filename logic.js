// DOM に触らない純粋関数

export const VERIFY_METERS = 150;
export const PHOTO_MAX = 1280;

export const pad2 = (n) => String(n).padStart(2, '0');

// 今日の日付（端末のローカル時間）'YYYY-MM-DD'
export function todayStr(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

// '2026-03-05' → '03'
export function monthKeyOf(date) {
  return String(date).slice(5, 7);
}

export function yearOf(date) {
  return Number(String(date).slice(0, 4));
}

// 点数を 0.1 刻みに丸め、0〜5 に収める。null はそのまま
export function clampScore(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return Math.round(Math.min(5, Math.max(0, n)) * 10) / 10;
}

const scoreRank = (e) => (e.score === null || e.score === undefined ? -1 : e.score);

// その年の図鑑：埋まった月の数、月ごとの件数、月ごとの点数がいちばん高い記録
export function yearSummary(entries, year) {
  const months = [];
  for (let m = 1; m <= 12; m++) months.push({ key: pad2(m), count: 0, best: null });
  for (const e of entries) {
    if (yearOf(e.date) !== year) continue;
    const cell = months[Number(monthKeyOf(e.date)) - 1];
    if (!cell) continue;
    cell.count++;
    if (!cell.best || scoreRank(e) > scoreRank(cell.best)) cell.best = e;
  }
  return { filled: months.filter((c) => c.count > 0).length, months };
}

// 入力されたモチーフを、テーマの一覧の名前にそろえる（別名もここで寄せる）。空なら null
export function canonicalMotif(text, theme) {
  const t = (text || '').trim();
  if (!t) return null;
  return (theme.aliases && theme.aliases[t]) || t;
}

// 通算で集めたモチーフ。一覧にない自由入力は数えない。names は モチーフ→最新の品名
export function motifProgress(entries, theme) {
  const all = new Set(theme.periods.flatMap((p) => p.motifs));
  const names = {};
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const e of sorted) {
    const m = canonicalMotif(e.motif, theme);
    if (m && all.has(m)) names[m] = e.sweetName;
  }
  const collected = Object.keys(names);
  return { collected, names, count: collected.length, total: all.size };
}

// 2点間の距離（m）。{lat, lng}
export function distanceMeters(a, b) {
  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// 店から 150m 以内なら true（150m ちょうども含む）。位置か店がなければ false
export function isVerified(pos, shop, limit = VERIFY_METERS) {
  if (!pos || !shop) return false;
  return distanceMeters(pos, shop) <= limit;
}

// 近い順に並べ直す（元の配列は変えない）。位置がなければ名前順
export function sortShopsByDistance(shops, pos) {
  const list = shops.map((s) => ({ ...s, distance: pos ? distanceMeters(pos, s) : null }));
  if (pos) return list.sort((a, b) => a.distance - b.distance);
  return list.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

// 日付ごとにまとめて新しい日から。route は記録した順の店（同じ店が続いたら1つ、店なしは除く）
export function groupByDay(entries) {
  const byDate = new Map();
  for (const e of entries) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  const days = [];
  for (const [date, list] of byDate) {
    list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const route = [];
    for (const e of list) {
      if (!e.shopId) continue;
      if (route[route.length - 1] !== e.shopId) route.push(e.shopId);
    }
    days.push({ date, entries: list, route, isTour: new Set(route).size >= 2 });
  }
  return days.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// 店ごとの集計：行った回数、平均点（点数ありのみ。なければ null）、最近の記録
export function shopStats(shopId, entries) {
  const list = entries.filter((e) => e.shopId === shopId);
  const scored = list.filter((e) => e.score !== null && e.score !== undefined);
  const avg = scored.length ? scored.reduce((s, e) => s + e.score, 0) / scored.length : null;
  const latest = list.reduce((m, e) => (!m || e.date > m.date ? e : m), null);
  return { visits: list.length, avg, latest, entries: list };
}

// 長辺が max に収まるように縮めた大きさ（拡大はしない）
export function fitSize(w, h, max = PHOTO_MAX) {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

// 判子（店のマーカー）の中身。色は最近の記録の月、字は最近のモチーフ（なければ店名）の1文字目
export function shopStamp(shop, entries, theme) {
  const st = shopStats(shop.id, entries);
  if (!st.latest) return { empty: true, visits: 0, color: null, glyph: [...shop.name][0] || '', verified: false };
  const p = theme.periods.find((x) => x.key === monthKeyOf(st.latest.date));
  const withMotif = st.entries.filter((e) => e.motif).reduce((m, e) => (!m || e.date > m.date ? e : m), null);
  const text = (withMotif && withMotif.motif) || shop.name;
  return {
    empty: false, visits: st.visits, color: p ? p.color : null, glyph: [...text][0] || '',
    verified: st.entries.some((e) => e.verified),
  };
}

// その年・その月のお題：モチーフ5つそれぞれが集まったか（一覧にない自由入力は数えない）
export function monthMotifs(entries, theme, year, key) {
  const p = theme.periods.find((x) => x.key === key);
  if (!p) return { motifs: [], count: 0, total: 0, done: false };
  const got = new Set();
  for (const e of entries) {
    if (yearOf(e.date) !== year || monthKeyOf(e.date) !== key) continue;
    const m = canonicalMotif(e.motif, theme);
    if (m) got.add(m);
  }
  const motifs = p.motifs.map((name) => ({ name, got: got.has(name) }));
  const count = motifs.filter((m) => m.got).length;
  return { motifs, count, total: motifs.length, done: count === motifs.length };
}
