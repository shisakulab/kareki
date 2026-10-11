// OpenStreetMap（Overpass API）から和菓子屋を集めて data/shops/ を作る
//   node tools/build-shops.mjs            キャッシュがあれば再利用する
//   node tools/build-shops.mjs --refresh  問い合わせ直す
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isWagashiShop, tileKey, shopInfo } from '../logic.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(root, 'tools', '.cache', 'overpass-jp.json');
const OUT = path.join(root, 'data', 'shops');
const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const HEADERS = {
  'User-Agent': 'kareki-build-shops/1.3 (https://github.com/shisakulab/kareki)',
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

// 住所（都道府県＋市区町村＋大字町丁目）を、国土交通省「位置参照情報」の代表点のうち最も近いものから付ける。
// ダウンロードした ZIP は tools/.cache/isj/ に残して使い回す
const ISJ_DIR = path.join(root, 'tools', '.cache', 'isj');
const ISJ_UA = { 'User-Agent': HEADERS['User-Agent'] };
const MAX_ADDR_M = 2000; // これより遠い店には住所を付けない

// ZIP から指定の拡張子のファイルを取り出す（標準の zlib だけ。中央ディレクトリを読む）
function unzipFirst(buf, ext) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('ZIP の終端が見つかりません');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name.toLowerCase().endsWith(ext)) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + csize);
      return method === 0 ? data : inflateRawSync(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('ZIP に ' + ext + ' がありません');
}

// 都道府県ごとの CSV（Shift_JIS）を読み、[都道府県, 市区町村, 大字町丁目, 緯度, 経度] の一覧にする
async function loadIsjPoints() {
  await mkdir(ISJ_DIR, { recursive: true });
  const dec = new TextDecoder('shift_jis');
  const points = [];
  for (let n = 1; n <= 47; n++) {
    const code = String(n).padStart(2, '0');
    const file = path.join(ISJ_DIR, `${code}000-18.0b.zip`);
    if (!existsSync(file)) {
      const url = `https://nlftp.mlit.go.jp/isj/dls/data/18.0b/${code}000-18.0b.zip`;
      const res = await fetch(url, { headers: ISJ_UA });
      if (!res.ok) throw new Error(`位置参照情報を取得できませんでした：${url} HTTP ${res.status}`);
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
      console.log('  ダウンロード ' + code);
      await sleep(1000);
    }
    const text = dec.decode(unzipFirst(await readFile(file), '.csv'));
    const lines = text.split(/\r?\n/);
    // 列：都道府県コード, 都道府県名, 市区町村コード, 市区町村名, 大字町丁目コード, 大字町丁目名, 緯度, 経度, 原典資料コード, 区分コード
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i]) continue;
      const c = lines[i].split(',').map((x) => x.replace(/^"|"$/g, ''));
      const lat = Number(c[6]);
      const lng = Number(c[7]);
      if (!c[5] || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      points.push([c[1], c[3], c[5], lat, lng]);
    }
  }
  return points;
}

// 緯度経度 0.02 度の格子で索引を作る
const CELL = 0.02;
const cellKey = (iy, ix) => iy + '_' + ix;
function buildGrid(points) {
  const grid = new Map();
  for (const pt of points) {
    const k = cellKey(Math.floor(pt[3] / CELL), Math.floor(pt[4] / CELL));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(pt);
  }
  return grid;
}
function meters(lat1, lng1, lat2, lng2) {
  const dy = (lat2 - lat1) * 111320;
  const dx = (lng2 - lng1) * 111320 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.hypot(dx, dy);
}
// 周囲 ±2 マス（最短でも 3.6km 以上）を調べるので、2km 以内の点は必ず見つかる
function nearest(grid, lat, lng) {
  const iy = Math.floor(lat / CELL);
  const ix = Math.floor(lng / CELL);
  let best = null;
  let bestD = Infinity;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const list = grid.get(cellKey(iy + dy, ix + dx));
      if (!list) continue;
      for (const pt of list) {
        const d = meters(lat, lng, pt[3], pt[4]);
        if (d < bestD) { bestD = d; best = pt; }
      }
    }
  }
  return best && bestD <= MAX_ADDR_M ? { pt: best, d: bestD } : null;
}

const addrDistances = [];
async function addAddresses(rows) {
  console.log('位置参照情報を読みます');
  const points = await loadIsjPoints();
  const grid = buildGrid(points);
  console.log(`代表点 ${points.length} 件`);
  for (const r of rows) {
    const hit = nearest(grid, r[2], r[3]);
    if (!hit) continue;
    addrDistances.push(hit.d);
    // ad：都道府県＋市区町村（ほぼ確実）。tn：いちばん近い代表点の大字・町丁目（隣の町になることがあるので、画面では「付近」と出す）
    const ad = hit.pt[0] + hit.pt[1];
    const tn = hit.pt[2] || '';
    const info = r[4] || {};
    info.ad = ad;
    if (tn) info.tn = tn;
    if (!r[4]) r.push(info);
  }
  addrDistances.sort((a, b) => a - b);
  const med = addrDistances[Math.floor(addrDistances.length / 2)] || 0;
  const max = addrDistances[addrDistances.length - 1] || 0;
  console.log(`住所：付いた ${addrDistances.length} 件 / 付かない ${rows.length - addrDistances.length} 件、距離の中央値 ${med.toFixed(0)}m、最大 ${max.toFixed(0)}m`);
}
await addAddresses(kept);

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
  address: '住所：『位置参照情報ダウンロードサービス』（国土交通省）（https://nlftp.mlit.go.jp/isj/ ）をもとに shisaku_lab が作成（公共データ利用規約 PDL1.0）',
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
