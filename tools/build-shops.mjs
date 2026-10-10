// OpenStreetMap（Overpass API）から和菓子屋を集めて data/shops/ を作る
//   node tools/build-shops.mjs            キャッシュがあれば再利用する
//   node tools/build-shops.mjs --refresh  問い合わせ直す
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isWagashiShop, tileKey, shopInfo } from '../logic.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(root, 'tools', '.cache', 'overpass-jp.json');
const OUT = path.join(root, 'data', 'shops');
const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const HEADERS = {
  'User-Agent': 'kareki-build-shops/1.2 (https://github.com/shisakulab/kareki)',
  Accept: 'application/json',
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const queryAll = `[out:json][timeout:900];
area["ISO3166-1"="JP"]->.jp;
(
  nwr["shop"="confectionery"](area.jp);
  nwr["amenity"="cafe"]["name"~"甘味"](area.jp);
);
out center tags;`;

// 日本全体が駄目だったときの分割（南, 西, 北, 東）。重なりは id で重複を除く
const REGIONS = [
  [38.0, 137.0, 46.0, 149.0],   // 北海道・東北北部
  [33.0, 136.0, 38.0, 142.0],   // 関東・中部・東北南部
  [32.7, 130.8, 37.6, 136.2],   // 近畿・中国・四国・北陸西部
  [24.0, 122.5, 33.9, 132.2],   // 九州・沖縄
];
const queryRegion = ([s, w, n, e]) => `[out:json][timeout:600];
(
  nwr["shop"="confectionery"](${s},${w},${n},${e});
  nwr["amenity"="cafe"]["name"~"甘味"](${s},${w},${n},${e});
);
out center tags;`;

async function overpass(query) {
  const res = await fetch(ENDPOINT, { method: 'POST', headers: HEADERS, body: 'data=' + encodeURIComponent(query) });
  if (!res.ok) throw new Error(`Overpass ${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchAll() {
  const waits = [0, 60000, 180000]; // 最初 + 再試行2回
  for (let i = 0; i < waits.length; i++) {
    if (waits[i]) { console.log(`${waits[i] / 1000}秒待って再試行します`); await sleep(waits[i]); }
    try {
      console.log(`日本全体を問い合わせます（${i + 1}回目）`);
      return await overpass(queryAll);
    } catch (err) {
      console.log('失敗：' + err.message);
    }
  }
  console.log('日本全体は取れなかったので、4つの範囲に分けて問い合わせます');
  const byKey = new Map();
  let osm3s = null;
  for (const region of REGIONS) {
    let json = null;
    for (let i = 0; i < 3 && !json; i++) {
      if (i) await sleep(60000);
      try { json = await overpass(queryRegion(region)); } catch (err) { console.log(`範囲 ${region} 失敗：${err.message}`); }
    }
    if (!json) throw new Error('範囲を分けても取得できませんでした');
    osm3s = json.osm3s || osm3s;
    for (const el of json.elements) byKey.set(`${el.type}${el.id}`, el);
  }
  return { osm3s, elements: [...byKey.values()] };
}

async function loadRaw() {
  if (existsSync(CACHE) && !process.argv.includes('--refresh')) {
    console.log('キャッシュを使います：' + path.relative(root, CACHE));
    return JSON.parse(await readFile(CACHE, 'utf8'));
  }
  const json = await fetchAll();
  await mkdir(path.dirname(CACHE), { recursive: true });
  await writeFile(CACHE, JSON.stringify(json));
  return json;
}

// 等間隔に n 個ぬき出す（偏りを避ける）
function sample(list, n) {
  if (list.length <= n) return list;
  return Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]);
}

const raw = await loadRaw();
const kept = [];
const dropped = [];
const seen = new Set();
for (const el of raw.elements) {
  const tags = el.tags || {};
  const lat = el.lat ?? (el.center && el.center.lat);
  const lng = el.lon ?? (el.center && el.center.lon);
  if (lat === undefined || lng === undefined) continue;
  const id = `${el.type[0]}${el.id}`;
  if (seen.has(id)) continue;
  seen.add(id);
  const name = (tags.name || tags['name:ja'] || '').trim();
  if (isWagashiShop(tags)) {
    const row = [id, name, Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5];
    const info = shopInfo(tags); // 営業時間・電話・Web サイト（ある店だけ5番目に付ける）
    if (info) row.push(info);
    kept.push(row);
  } else {
    dropped.push({ name: name || '(名前なし)', shop: tags.shop || tags.amenity });
  }
}

// 区画ごとに分ける
const tiles = new Map();
for (const s of kept) {
  const key = tileKey(s[2], s[3]);
  if (!tiles.has(key)) tiles.set(key, []);
  tiles.get(key).push(s);
}
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
let bytes = 0;
for (const [key, list] of tiles) {
  list.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const body = JSON.stringify(list);
  bytes += Buffer.byteLength(body);
  await writeFile(path.join(OUT, `${key}.json`), body);
}
const meta = {
  builtAt: (raw.osm3s && raw.osm3s.timestamp_osm_base) || new Date().toISOString(),
  builtOn: new Date().toISOString().slice(0, 10),
  count: kept.length,
  tiles: [...tiles.keys()].sort(),
  source: '© OpenStreetMap contributors (ODbL) https://www.openstreetmap.org/copyright',
};
await writeFile(path.join(OUT, 'meta.json'), JSON.stringify(meta));
bytes += Buffer.byteLength(JSON.stringify(meta));

console.log(`取得 ${seen.size} 件 → 残した ${kept.length} 件 / 除いた ${dropped.length} 件`);
console.log(`区画 ${tiles.size} 個、合計 ${(bytes / 1024).toFixed(0)} KB`);
console.log('残した例：' + sample(kept, 20).map((s) => s[1]).join(' / '));
console.log('除いた例：' + sample(dropped, 20).map((d) => `${d.name}`).join(' / '));
if (process.argv.includes('--dump')) {
  await writeFile(path.join(root, 'tools', '.cache', 'kept.txt'), kept.map((s) => s[1]).join('\n'));
  await writeFile(path.join(root, 'tools', '.cache', 'dropped.txt'), dropped.map((d) => `${d.name}\t${d.shop}`).join('\n'));
}
