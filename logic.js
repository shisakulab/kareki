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

// 判子（店のマーカー）の中身。色は最近の記録・立ち寄りの月、字は最近のモチーフ（なければ店名）の1文字目
// 回数は、記録か立ち寄りがあった日数。二重の縁（verified）は、立ち寄りか、その場での記録が1つでもあるとき
export function shopStamp(shop, entries, theme, visits = []) {
  const st = shopStats(shop.id, entries);
  const myVisits = visits.filter((v) => v.shopId === shop.id);
  if (!st.latest && !myVisits.length) return { empty: true, visits: 0, color: null, glyph: [...shop.name][0] || '', verified: false };
  const lastEntry = st.latest ? st.latest.date : '';
  const lastVisit = myVisits.reduce((m, v) => { const d = todayStr(new Date(v.at)); return d > m ? d : m; }, '');
  const latestDate = lastEntry > lastVisit ? lastEntry : lastVisit;
  const p = theme.periods.find((x) => x.key === monthKeyOf(latestDate));
  const withMotif = st.entries.filter((e) => e.motif).reduce((m, e) => (!m || e.date > m.date ? e : m), null);
  const text = (withMotif && withMotif.motif) || shop.name;
  return {
    empty: false, visits: shopVisitDays(entries, visits, shop.id), color: p ? p.color : null, glyph: [...text][0] || '',
    verified: myVisits.length > 0 || st.entries.some((e) => e.verified),
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

// ---------- v1.2 近くの和菓子屋 ----------
export const CHECKIN_METERS = 50;
export const ACCURACY_CAP = 30;
export const NEAR_METERS = 300;
export const TILE_DEG = 0.5;

const WAGASHI_WORDS = [
  '和菓子', '御菓子司', 'お菓子司', '菓子司', '菓舗', '菓匠', '甘味', '餅', '団子', '饅頭', '最中', '羊羹', '羊かん',
  'どら焼', 'どらやき', 'きんつば', '金鍔', '大福', 'せんべい', '煎餅', 'おかき', 'あられ', 'たい焼', 'たいやき',
  '今川焼', 'わらび', 'もなか', 'まんじゅう', 'ようかん', 'だんご', 'おはぎ', 'かりんとう', '練り切り', '上生',
  '餡', '大判焼', '回転焼', 'ういろう', '落雁', '鯛焼', 'もち', 'かるかん', '八ツ橋', '八つ橋', 'ぜんざい', 'みたらし', '草餅',
  '菓子舗', '菓子店', '菓子屋', '菓子処', '菓司', '菓寮', 'モナカ',
];
// 店名に「和菓子の語」がなくても有名な和菓子屋（ごく一部）
const WAGASHI_BRANDS = [
  '舟和', '亀十', '虎屋', 'とらや', '空也', '榮太樓', '栄太楼', '鶴屋吉信', '塩瀬総本家', '千鳥屋', '鼓月', '源吉兆庵', '御座候',
  '亀屋万年堂', '田子の月', '梅林堂', '文明堂', '薩摩蒸氣屋', '十万石', '一六本舗', '伊勢屋', '松月堂', '紅葉堂',
];
const WESTERN_WORDS = [
  'ケーキ', 'パティスリー', 'パティシエ', '洋菓子', 'チョコ', 'ショコラ', 'ドーナツ', 'ドーナッツ', 'クレープ', 'シュー', 'プリン',
  'マカロン', 'タルト', 'パンケーキ', 'ベーカリー', 'ジェラート', 'アイスクリーム', 'クッキー', 'キャンディ', 'ホットケーキ', '駄菓子', 'まちおか', 'コージーコーナー', 'シャトレーゼ', '不二家',
  'patisserie', 'patissier', 'pâtisserie', 'cake', 'chocolat', 'chocolate', 'bakery', 'donut', 'crepe', 'macaron', 'sweets',
];
const nameOf = (tags) => String((tags && (tags.name || tags['name:ja'])) || '').normalize('NFKC').trim();

// OSM のタグから、和菓子屋らしいか。shop=confectionery か、名前に「甘味」を含む amenity=cafe だけが対象
export function isWagashiShop(tags) {
  if (!tags) return false;
  const name = nameOf(tags);
  if (!name) return false;
  const lower = name.toLowerCase();
  if (tags.shop === 'confectionery') {
    if (['wagashi', 'japanese', 'rice_crackers'].includes(tags.confectionery)) return true;
    if (WESTERN_WORDS.some((w) => lower.includes(w.toLowerCase()))) return false;
    return WAGASHI_WORDS.some((w) => name.includes(w)) || WAGASHI_BRANDS.some((w) => name.includes(w));
  }
  if (tags.amenity === 'cafe') {
    if (WESTERN_WORDS.some((w) => lower.includes(w.toLowerCase()))) return false;
    return name.includes('甘味');
  }
  return false;
}

// 0.5度四方の区画のキー（下端の緯度_経度）。例 35.5_139.5
export function tileKey(lat, lng) {
  const f = (v) => (Math.floor(v / TILE_DEG + 1e-9) * TILE_DEG).toFixed(1);
  return `${f(lat)}_${f(lng)}`;
}

// 範囲（南・西・北・東）にかかる区画のキーの一覧。広すぎる範囲は最大 max 個で打ち切る
export function tilesForBounds(s, w, n, e, max = 64) {
  const keys = [];
  const i0 = Math.floor(s / TILE_DEG + 1e-9);
  const i1 = Math.floor(n / TILE_DEG + 1e-9);
  const j0 = Math.floor(w / TILE_DEG + 1e-9);
  const j1 = Math.floor(e / TILE_DEG + 1e-9);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      if (keys.length >= max) return keys;
      keys.push(`${(i * TILE_DEG).toFixed(1)}_${(j * TILE_DEG).toFixed(1)}`);
    }
  }
  return keys;
}

// いちばん近い店と距離。閉店にした店は除く。なければ null
export function nearestShop(pos, shops) {
  if (!pos) return null;
  let best = null;
  for (const shop of shops) {
    if (shop.closed) continue;
    const distance = distanceMeters(pos, shop);
    if (!best || distance < best.distance) best = { shop, distance };
  }
  return best;
}

// a から b への方角（北が 0、時計回り、0〜360 度）
export function bearingDeg(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLng = rad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// 立ち寄れるか：距離 − min(位置の誤差, 30m) が 50m 以内（誤差が分からなければ 0 とみなす）
export function canCheckIn(distance, accuracy) {
  const acc = Number.isFinite(accuracy) ? Math.max(0, accuracy) : 0;
  return distance - Math.min(acc, ACCURACY_CAP) <= CHECKIN_METERS;
}

// その店に「立ち寄り」か「記録」があった日数（同じ日は1日）
export function shopVisitDays(entries, visits, shopId) {
  const days = new Set();
  for (const e of entries) if (e.shopId === shopId) days.add(e.date);
  for (const v of visits) if (v.shopId === shopId) days.add(todayStr(new Date(v.at)));
  return days.size;
}

// 店名の検索用に表記をそろえる：全角・半角（NFKC）、大文字小文字、ひらがな→カタカナ、空白と中黒を除く
export function normalizeName(s) {
  return (s || '').normalize('NFKC').toLowerCase()
    .replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\s・･]/g, '');
}

// 店名で探す。pos があれば近い順、なければ名前順。{ shop, distance } の一覧を返す
export function searchShops(shops, query, pos = null, limit = 50) {
  const q = normalizeName(query);
  if (!q) return [];
  const hits = shops
    .filter((s) => normalizeName(s.name).includes(q))
    .map((shop) => ({ shop, distance: pos ? distanceMeters(pos, shop) : null }));
  hits.sort((a, b) => (a.distance !== null && b.distance !== null
    ? a.distance - b.distance
    : a.shop.name.localeCompare(b.shop.name, 'ja')));
  return hits.slice(0, limit);
}

// ---------- v1.3 定番の和菓子の図鑑 ----------
// 品名に定番の name / aliases が含まれていれば、その key。複数当たれば、いちばん長い語を優先。なければ null
export function classifyClassic(sweetName, theme) {
  const t = normalizeName(sweetName);
  if (!t || !theme || !theme.classics) return null;
  let best = null;
  let bestLen = 0;
  for (const c of theme.classics) {
    for (const w of [c.name, ...(c.aliases || [])]) {
      const n = normalizeName(w);
      if (n && t.includes(n) && n.length > bestLen) { best = c.key; bestLen = n.length; }
    }
  }
  return best;
}

// 記録の定番：手で決めた値（null＝定番ではない）があればそれ、なければ自動で振り分ける
export function classicOf(entry, theme) {
  return entry.classic !== undefined ? entry.classic : classifyClassic(entry.sweetName, theme);
}

// 集めた定番の数・合計・定番ごとの件数と、点数がいちばん高い記録
export function classicProgress(entries, theme) {
  const list = (theme.classics || []).map((c) => ({ key: c.key, name: c.name, count: 0, best: null }));
  const byKey = new Map(list.map((c) => [c.key, c]));
  for (const e of entries) {
    const cell = byKey.get(classicOf(e, theme));
    if (!cell) continue;
    cell.count++;
    if (!cell.best || scoreRank(e) > scoreRank(cell.best)) cell.best = e;
  }
  return { count: list.filter((c) => c.count > 0).length, total: list.length, classics: list };
}

// OSM のタグから、店のカードに出す情報を取り出す（ない項目は省く。何もなければ null）
// web は http(s) のものだけ（javascript: などを通さない）
export function shopInfo(tags) {
  const t = tags || {};
  const out = {};
  const oh = (t.opening_hours || '').trim();
  const tel = (t.phone || t['contact:phone'] || '').trim();
  const web = (t.website || t['contact:website'] || '').trim();
  if (oh) out.oh = oh.slice(0, 200);
  if (tel) out.tel = tel.split(';')[0].trim().slice(0, 40);
  if (/^https?:\/\/[^\s]+$/i.test(web)) out.web = web.slice(0, 300);
  return Object.keys(out).length ? out : null;
}

// OSM の opening_hours を日本語の読みやすい形にする（よく使う書き方だけ。読めない部分はそのまま残す）
const DAY_JA = { Mo: '月', Tu: '火', We: '水', Th: '木', Fr: '金', Sa: '土', Su: '日', PH: '祝' };
export function formatOpeningHours(oh) {
  if (!oh) return '';
  if (oh.trim() === '24/7') return '24時間';
  return oh.split(';').map((part) => part.trim()).filter(Boolean).map((part) => part
    .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (d) => DAY_JA[d])
    .replace(/([月火水木金土日祝])-([月火水木金土日祝])/g, '$1〜$2')
    .replace(/(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/g, '$1–$2')
    .replace(/(\d{1,2}:\d{2})\+/g, '$1〜')
    .replace(/\b(off|closed)\b/gi, '定休')
    .replace(/,/g, '・')
    .replace(/\(?"([^"]*)"\)?/g, '（$1）'))
    .join('、');
}

// 書き出しを勧めるか。前回の書き出しから記録が10件以上増えた、または30日以上たって記録が増えたとき。
// 「あとで」を押してから7日は出さない
const DAY_MS = 24 * 60 * 60 * 1000;
export function shouldRemindBackup({ count, lastExportAt = 0, lastExportCount = 0, snoozedAt = 0, now = Date.now() }) {
  if (!count || count <= lastExportCount) return false;
  if (snoozedAt && now - snoozedAt < 7 * DAY_MS) return false;
  if (count - lastExportCount >= 10) return true;
  return !!lastExportAt && now - lastExportAt >= 30 * DAY_MS;
}
