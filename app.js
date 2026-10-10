import theme from './themes/jonamagashi.js';
import * as db from './db.js';
import {
  todayStr, monthKeyOf, yearOf, yearSummary, motifProgress, canonicalMotif, isVerified, sortShopsByDistance,
  groupByDay, clampScore, shopStats, fitSize, shopStamp, monthMotifs,
  distanceMeters, tilesForBounds, nearestShop, bearingDeg, canCheckIn, shopVisitDays,
  NEAR_METERS, CHECKIN_METERS, ACCURACY_CAP,
} from './logic.js';

const GSI_URL = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png';
const GSI_ATTR = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>';
const TOKYO = { lat: 35.681236, lng: 139.767125 };
const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';
const NEUTRAL = '#8a8178';
const QUEST_HELP = '上生菓子は、季節を形と色で表すお菓子です。今月のお題に合う上生菓子をお店で見つけて記録すると、判子が押されます。';

const mapEl = document.getElementById('map');
const questEl = document.getElementById('quest');
const nearEl = document.getElementById('near');
const fabEl = document.getElementById('fab');
const scrim = document.getElementById('scrim');
const sheetEl = document.getElementById('sheet');
const sheetBody = document.getElementById('sheetbody');
const grabEl = document.getElementById('grab');
const toastEl = document.getElementById('toast');

const state = { year: new Date().getFullYear(), shops: [], entries: [], visits: [], pos: null, acc: null, posAt: 0, maps: [] };
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const period = (key) => theme.periods.find((p) => p.key === key);

// ---------- 小さな道具 ----------
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
}

const scoreText = (s) => (s === null || s === undefined ? '—' : s.toFixed(1));
function fmtDate(d) {
  const [y, m, day] = d.split('-').map(Number);
  return `${y}年${m}月${day}日（${'日月火水木金土'[new Date(y, m - 1, day).getDay()]}）`;
}
const shopOf = (id) => state.shops.find((s) => s.id === id);

// 写真（IndexedDB の Blob → objectURL）
const urls = new Map();
async function photoSrc(id) {
  if (urls.has(id)) return urls.get(id);
  const p = await db.get('photos', id);
  if (!p) return null;
  const u = URL.createObjectURL(p.blob);
  urls.set(id, u);
  return u;
}
function imgFor(photoId, cls) {
  const img = h('img', { class: cls, alt: '', loading: 'lazy' });
  photoSrc(photoId).then((u) => { if (u) img.src = u; else img.remove(); });
  return img;
}
function dropPhotoCache() {
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
}

// 位置情報（15秒以内の結果は使い回す）
// force：キャッシュを使わず、取り直す
function getPos(timeout = 6000, force = false) {
  if (!force && state.pos && Date.now() - state.posAt < 15000) return Promise.resolve(state.pos);
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        state.pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        state.acc = p.coords.accuracy;
        state.posAt = Date.now();
        resolve(state.pos);
      },
      // 測り直せなかったときは、1分以内に取れた位置で代える（立ち止まっていると更新が来ない端末があるため）
      () => resolve(!force && state.pos && Date.now() - state.posAt < 60000 ? state.pos : null),
      { enableHighAccuracy: true, timeout, maximumAge: force ? 0 : 15000 },
    );
  });
}

async function loadData() {
  [state.shops, state.entries, state.visits] = await Promise.all([db.getAll('shops'), db.getAll('entries'), db.getAll('visits')]);
}

// 長辺 1280px の JPEG に描き直す（撮影情報は消える）
async function resizePhoto(file) {
  let src;
  let w;
  let hgt;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
    w = src.width; hgt = src.height;
  } catch {
    const url = URL.createObjectURL(file);
    src = new Image();
    src.src = url;
    await src.decode();
    w = src.naturalWidth; hgt = src.naturalHeight;
    URL.revokeObjectURL(url);
  }
  const size = fitSize(w, hgt);
  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size.w, size.h);
  ctx.drawImage(src, 0, 0, size.w, size.h);
  if (src.close) src.close();
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) throw new Error('写真を変換できませんでした');
  return blob;
}

// ---------- 地図の共通部品 ----------
// 日記・店の位置の指定など、シートの中の小さな地図（シートを変えるたびに捨てる）
function makeMap(el, opts = {}) {
  const map = L.map(el, opts);
  L.tileLayer(GSI_URL, { attribution: GSI_ATTR, maxZoom: 18 }).addTo(map);
  state.maps.push(map);
  return map;
}
function destroyMaps() {
  for (const m of state.maps) m.remove();
  state.maps = [];
}
const pinIcon = (color, text = '') =>
  L.divIcon({ className: '', html: `<div class="pin" style="--c:${color}">${text}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] });

// ---------- シート（下からせり上がるパネル） ----------
const sheet = { redo: null };
// redo：データが変わったときに同じ内容で開き直す関数。after：画面に付いたあとにやること
function showSheet(redo, nodes, after) {
  sheet.redo = redo;
  destroyMaps();
  sheetBody.replaceChildren(...nodes.flat().filter((n) => n !== null && n !== undefined && n !== false));
  sheetBody.scrollTop = 0;
  sheetEl.style.transform = '';
  sheetEl.classList.remove('small');
  sheetEl.hidden = false;
  scrim.hidden = false;
  if (after) after();
}
function closeSheet() {
  sheet.redo = null;
  sheetEl.hidden = true;
  sheetEl.classList.remove('small');
  scrim.hidden = true;
  sheetEl.style.transform = '';
  destroyMaps();
  sheetBody.replaceChildren();
}
function openRecord() {
  showSheet(null, [record.node], () => record.refresh()); // 地図の大きさが決まってから更新する
}
scrim.addEventListener('click', closeSheet);
// 上の端をつかんで下げると閉じる
{
  let startY = null;
  grabEl.addEventListener('pointerdown', (e) => { startY = e.clientY; grabEl.setPointerCapture(e.pointerId); sheetEl.classList.add('drag'); });
  grabEl.addEventListener('pointermove', (e) => {
    if (startY === null) return;
    sheetEl.style.transform = `translateY(${Math.max(0, e.clientY - startY)}px)`;
  });
  const end = (e) => {
    if (startY === null) return;
    const dy = e.clientY - startY;
    startY = null;
    sheetEl.classList.remove('drag');
    if (e.type === 'pointerup' && dy > 80) closeSheet();
    else sheetEl.style.transform = '';
  };
  grabEl.addEventListener('pointerup', end);
  grabEl.addEventListener('pointercancel', end);
}
fabEl.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-open]');
  if (!b) return;
  closeCard();
  if (b.dataset.open === 'zukan') openZukan();
  else if (b.dataset.open === 'diary') openDiary();
  else openRecord();
});

// データが変わったあとに、地図・お題・開いているシートを描き直す
function render() {
  drawMap();
  drawQuest();
  if (!sheetEl.hidden && sheet.redo) sheet.redo();
}

// ---------- 図鑑 ----------
function openZukan() {
  const sum = yearSummary(state.entries, state.year);
  const prog = motifProgress(state.entries, theme);
  const now = new Date();
  const isThisYear = state.year === now.getFullYear();
  const nowKey = String(now.getMonth() + 1).padStart(2, '0');

  const bar = h('div', { class: 'bar' },
    h('span', { style: 'width:44px' }),
    h('div', { class: 'grow' },
      h('button', { class: 'ibtn', type: 'button', 'aria-label': '前の年', onclick: () => { state.year--; openZukan(); } }, '‹'),
      h('h1', { style: 'display:inline;font-size:22px' }, ` ${state.year} `),
      h('button', { class: 'ibtn', type: 'button', 'aria-label': '次の年', onclick: () => { state.year++; openZukan(); } }, '›')),
    h('button', { class: 'ibtn', type: 'button', 'aria-label': '設定', onclick: openSettings }, '⚙'));

  const achv = h('div', { class: 'achv' },
    h('span', {}, isThisYear ? '今年 ' : `${state.year}年 `, h('b', {}, `${sum.filled}/12`), ' か月'),
    h('span', {}, 'モチーフ 通算 ', h('b', {}, `${prog.count}/${prog.total}`)),
    h('span', {}, '立ち寄った店 ', h('b', {}, new Set(state.visits.map((v) => v.shopId).filter(shopOf)).size), ' 軒'));

  const grid = h('div', { class: 'grid' }, sum.months.map((c) => {
    const p = period(c.key);
    const cls = ['cell'];
    const kids = [];
    if (c.count > 0) {
      cls.push('filled');
      if (c.best.photoId) { cls.push('photo'); kids.push(imgFor(c.best.photoId, '')); }
      kids.push(h('div', { class: 'mo' }, p.label));
      if (!c.best.photoId) kids.push(h('div', { class: 'nm' }, c.best.sweetName));
      kids.push(h('div', { class: 'stamp' + (c.best.verified ? ' ring' : '') }, c.count));
    } else {
      kids.push(h('div', { class: 'mo' }, p.label));
      kids.push(h('div', { class: 'mt' }, `${p.motifs[0]}…`));
    }
    if (isThisYear && c.key === nowKey) cls.push('now');
    return h('button', { class: cls.join(' '), type: 'button', style: `--c:${p.color}`, onclick: () => openMonth(state.year, c.key, openZukan) }, kids);
  }));

  showSheet(openZukan, [bar, achv, grid]);
}

// back：戻るボタンで開く画面（省略なら閉じる）。intro：先頭に出す一言の説明
function openMonth(year, key, back = closeSheet, intro = null) {
  const p = period(key);
  const list = state.entries.filter((e) => yearOf(e.date) === year && monthKeyOf(e.date) === key)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
  const names = motifProgress(list, theme).names;

  const bar = h('div', { class: 'bar' },
    h('button', { class: 'ibtn', type: 'button', 'aria-label': '戻る', onclick: back }, '‹'),
    h('h2', { class: 'grow' }, `${year} ${p.label}`),
    h('span', { style: 'width:44px' }));

  const recs = list.length
    ? h('ul', { class: 'list' }, list.map((e) => h('li', {}, recRow(e, true))))
    : h('p', { class: 'muted' }, 'まだ記録がありません');

  const motifs = h('div', { class: 'motifs', style: `--c:${p.color}` }, p.motifs.map((m) =>
    h('div', { class: 'motif' + (names[m] ? ' got' : '') }, (names[m] ? '✓ ' : '') + m,
      names[m] ? h('small', {}, names[m]) : null)));

  showSheet(() => openMonth(year, key, back), [bar, intro ? h('p', { class: 'intro' }, intro) : null, h('h3', {}, '記録'), recs, h('h3', { style: 'margin-bottom:8px' }, 'モチーフ'), motifs].filter(Boolean));
}

// 記録1件の行。withDelete なら削除ボタン付き
function recRow(e, withDelete) {
  const shop = shopOf(e.shopId);
  const meta = [fmtDate(e.date).replace(/^\d+年/, ''), shop ? shop.name : null, e.score !== null && e.score !== undefined ? `${scoreText(e.score)}点` : null]
    .filter(Boolean).join(' ・ ');
  const note = (e.note || '').split('\n')[0];
  return h('div', { class: 'rec' + (e.photoId ? '' : ' nophoto') },
    e.photoId ? imgFor(e.photoId, 'ph') : null,
    h('div', { style: 'min-width:0' },
      h('div', { class: 't' }, e.sweetName, e.verified ? h('span', { class: 'badge', title: 'その場で記録' }, '場') : null),
      h('div', { class: 'n' }, meta),
      note ? h('div', { class: 'n' }, note) : null),
    withDelete ? h('button', { class: 'ibtn', type: 'button', 'aria-label': '削除', style: 'font-size:14px', onclick: () => deleteEntry(e) }, '削除') : null);
}

async function deleteEntry(e) {
  if (!confirm(`「${e.sweetName}」の記録を消しますか？`)) return;
  await db.remove('entries', e.id);
  if (e.photoId) {
    await db.remove('photos', e.photoId);
    if (urls.has(e.photoId)) { URL.revokeObjectURL(urls.get(e.photoId)); urls.delete(e.photoId); }
  }
  await loadData();
  render(); // 開いている月のシートも描き直される
}

// ---------- 地図（ホーム） ----------
let mainMap = null;
let markerLayer = null;
let posDot = null;
let card = null;
const markers = new Map(); // 店のid → Leaflet のマーカー
let osmLayer = null;
function closeCard() { if (card) { card.remove(); card = null; } }

function hankoIcon(shop) {
  const s = shopStamp(shop, state.entries, theme, state.visits);
  const cls = 'hanko' + (s.empty ? ' empty' : '') + (s.verified ? ' dbl' : '');
  const node = s.empty
    ? h('div', { class: cls })
    : h('div', { class: cls, style: `--c:${s.color || NEUTRAL}` },
      h('div', { class: 'face' }, h('span', { class: 'g' }, s.glyph)),
      s.visits >= 2 ? h('span', { class: 'cnt' }, s.visits) : null);
  return L.divIcon({ className: 'hanko-wrap', html: node, iconSize: [44, 44], iconAnchor: [22, 22] });
}

function initMap() {
  if (typeof L === 'undefined') {
    mapEl.replaceChildren(h('p', { class: 'muted', style: 'padding:80px 16px' }, '地図を読み込めませんでした（通信を確認してください）'));
    return;
  }
  mainMap = L.map(mapEl, { zoomControl: false });
  L.control.zoom({ position: 'topright' }).addTo(mainMap);
  L.tileLayer(GSI_URL, { attribution: GSI_ATTR, maxZoom: 18 }).addTo(mainMap);
  mainMap.attributionControl.addAttribution(OSM_ATTR);
  osmLayer = L.layerGroup().addTo(mainMap);
  markerLayer = L.layerGroup().addTo(mainMap);

  if (state.shops.length) mainMap.fitBounds(L.latLngBounds(state.shops.map((s) => [s.lat, s.lng])).pad(0.3), { maxZoom: 16 });
  else mainMap.setView([TOKYO.lat, TOKYO.lng], 14);

  getPos().then((pos) => {
    if (!pos) return;
    mainMap.setView([pos.lat, pos.lng], 15);
    setPosDot(pos);
    updateNear();
  });

  mainMap.on('moveend', scheduleOsm);
  // 指で触れたときだけ「自分で動かした」と数える（開いた直後の自動のズームは数えない）
  mainMap.getContainer().addEventListener('pointerdown', () => { lastUserMove = Date.now(); });
  mainMap.getContainer().addEventListener('wheel', () => { lastUserMove = Date.now(); }, { passive: true });
  mainMap.on('click', closeCard);
  mainMap.on('contextmenu', async (ev) => {
    const name = (prompt('この場所に店を追加します。店名は？') || '').trim();
    if (!name) return;
    await db.put('shops', { id: db.newId(), name, lat: ev.latlng.lat, lng: ev.latlng.lng, memo: '', createdAt: Date.now() });
    await loadData();
    drawMap();
    toast(`「${name}」を追加しました`);
  });
}

function drawMap() {
  if (!mainMap) return;
  closeCard();
  markerLayer.clearLayers();
  markers.clear();
  for (const shop of state.shops) {
    if (shop.closed) continue;
    const m = L.marker([shop.lat, shop.lng], { icon: hankoIcon(shop), title: shop.name }).on('click', () => showCard(shop));
    m.addTo(markerLayer);
    markers.set(shop.id, m);
  }
  refreshOsm();
}

function setPosDot(pos) {
  if (!mainMap) return;
  if (posDot) posDot.setLatLng([pos.lat, pos.lng]);
  else posDot = L.circleMarker([pos.lat, pos.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#2f6fdb', fillOpacity: 1, interactive: false }).addTo(mainMap);
}

function showCard(shop) {
  closeCard();
  const st = shopStats(shop.id, state.entries);
  const sorted = [...st.entries].sort((a, b) => (a.date < b.date ? 1 : -1));
  card = h('div', { class: 'shopcard' },
    h('h2', {}, shop.name),
    h('p', { class: 'sub' }, `行った回数 ${shopVisitDays(state.entries, state.visits, shop.id)}回 ・ 平均 ${st.avg === null ? '—' : st.avg.toFixed(1) + '点'}`),
    sorted.length
      ? h('ul', { class: 'list' }, sorted.map((e) => h('li', {}, recRow(e, false))))
      : h('p', { class: 'muted' }, 'まだ記録がありません'),
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => { record.setShop(shop.id); closeCard(); openRecord(); } }, 'ここで記録する'),
      h('button', { class: 'btn', type: 'button', onclick: () => checkIn(shop) }, '立ち寄る'),
      h('button', { class: 'btn', type: 'button', onclick: closeCard }, '閉じる')));
  document.body.append(card);
}

// ---------- 近くの和菓子屋（OpenStreetMap から作った data/shops/） ----------
const OSM_MIN_ZOOM = 14;
const OSM_MAX_SHOWN = 200;
const tiles = new Map(); // 区画のキー → [{ osmId, name, lat, lng }, …]（読み込んだらメモリに持つ）
const tilePending = new Map();
let osmSeq = 0;
let osmTimer = 0;

function loadTile(key) {
  if (tiles.has(key)) return Promise.resolve();
  if (!tilePending.has(key)) {
    tilePending.set(key, fetch(`data/shops/${key}.json`)
      .then((r) => (r.ok ? r.json() : [])) // その区画に店がなければファイルがない
      .catch(() => null) // 通信の失敗は覚えない（次にまた試す）
      .then((list) => {
        tilePending.delete(key);
        if (list) tiles.set(key, list.map(([osmId, name, lat, lng]) => ({ osmId, name, lat, lng })));
      }));
  }
  return tilePending.get(key);
}
const ensureTiles = (keys) => Promise.all(keys.filter((k) => !tiles.has(k)).map(loadTile));
const osmShopsIn = (keys) => keys.flatMap((k) => tiles.get(k) || []);
const registeredOsmIds = () => new Set(state.shops.filter((s) => s.osmId).map((s) => s.osmId));
// OSM の店（id なし）を、登録済みの店に引き当てる。自分の店はそのまま
const registeredOf = (t) => (t.id ? t : state.shops.find((s) => s.osmId && s.osmId === t.osmId) || null);

function scheduleOsm() {
  clearTimeout(osmTimer);
  osmTimer = setTimeout(refreshOsm, 150);
}

function osmIcon(s) {
  return L.divIcon({
    className: 'hanko-wrap', iconSize: [36, 36], iconAnchor: [18, 18],
    html: h('div', { class: 'hanko osm' }, h('span', { class: 'g' }, [...s.name][0] || '')),
  });
}

// 見えている範囲の、まだ立ち寄っていない和菓子屋（ズーム 14 以上、最大 200 件）
async function refreshOsm() {
  if (!mainMap) return;
  const seq = ++osmSeq;
  if (mainMap.getZoom() < OSM_MIN_ZOOM) { osmLayer.clearLayers(); return; }
  const b = mainMap.getBounds();
  const keys = tilesForBounds(b.getSouth(), b.getWest(), b.getNorth(), b.getEast());
  await ensureTiles(keys);
  if (seq !== osmSeq) return; // その間にまた動いた
  osmLayer.clearLayers();
  const reg = registeredOsmIds();
  const c = b.getCenter();
  const list = osmShopsIn(keys).filter((s) => !reg.has(s.osmId) && b.contains([s.lat, s.lng]));
  if (list.length > OSM_MAX_SHOWN) {
    list.sort((x, y) => distanceMeters(c, x) - distanceMeters(c, y));
    list.length = OSM_MAX_SHOWN;
  }
  for (const s of list) {
    L.marker([s.lat, s.lng], { icon: osmIcon(s), title: s.name }).on('click', () => showOsmCard(s)).addTo(osmLayer);
  }
}

const fmtDist = (m) => (m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`);

function showOsmCard(s) {
  closeCard();
  const d = state.pos ? distanceMeters(state.pos, s) : null;
  card = h('div', { class: 'shopcard' },
    h('h2', {}, s.name),
    h('p', { class: 'sub' }, d === null ? '今いる場所は分かりません' : `今いる場所から ${fmtDist(d)}`),
    h('p', { class: 'muted' }, 'まだ立ち寄っていません'),
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => checkIn(s) }, '立ち寄って判子を押す'),
      h('button', { class: 'btn', type: 'button', onclick: () => markClosed(s) }, '閉店していた'),
      h('button', { class: 'btn', type: 'button', onclick: closeCard }, '閉じる')));
  document.body.append(card);
}

const visitedToday = (target) => {
  const reg = registeredOf(target);
  return !!reg && state.visits.some((v) => v.shopId === reg.id && todayStr(new Date(v.at)) === todayStr());
};

// 店を登録する（OSM の店は、立ち寄ったか閉店にしたときに初めて shops に入る。osmId で重複させない）
async function registerOsm(s, extra = {}) {
  const shop = { id: db.newId(), osmId: s.osmId, name: s.name, lat: s.lat, lng: s.lng, memo: '', createdAt: Date.now(), ...extra };
  await db.put('shops', shop);
  return shop;
}

async function markClosed(s) {
  if (!confirm(`「${s.name}」は閉店していましたか？ 地図と知らせから外します。`)) return;
  const reg = registeredOf(s);
  if (reg) await db.put('shops', { ...reg, closed: true });
  else await registerOsm(s, { closed: true });
  await loadData();
  closeCard();
  render();
  updateNear();
  toast(`「${s.name}」を外しました`);
}

// 立ち寄る：位置を取り直して 50m 以内かを確かめ、立ち寄りを保存して判子を押す
let checking = false;
async function checkIn(target) {
  if (checking) return;
  checking = true;
  try {
    // 位置を追っていれば、20秒以内の位置をそのまま使う（測り直すと数秒待たせるため）
    let pos = state.pos && Date.now() - state.posAt < 20000 ? state.pos : null;
    if (!pos) { toast('今いる場所を確かめています…'); pos = await getPos(8000, true); }
    if (!pos) { toast('今いる場所を取得できませんでした'); return; }
    const d = distanceMeters(pos, target);
    if (!canCheckIn(d, state.acc)) {
      const rest = Math.ceil(d - Math.min(state.acc || 0, ACCURACY_CAP) - CHECKIN_METERS);
      toast(`もう少し近づいてください（あと ${Math.max(1, rest)}m）`);
      updateNear();
      return;
    }
    const shop = registeredOf(target) || await registerOsm(target);
    await db.put('visits', { id: db.newId(), shopId: shop.id, at: Date.now(), lat: pos.lat, lng: pos.lng });
    await loadData();
    closeCard();
    drawMap();
    await celebrate(shop, null);
    openVisited(shop, shopVisitDays(state.entries, state.visits, shop.id));
    updateNear();
  } catch (err) {
    toast('保存できませんでした：' + (err && err.message ? err.message : err));
  } finally {
    checking = false;
  }
}

// 判子を押したあとの小さなシート
function openVisited(shop, n) {
  showSheet(null, [
    h('h2', { style: 'font-size:22px;text-align:center;margin:0 0 4px' }, '判子を押しました'),
    h('p', { class: 'sub', style: 'text-align:center' }, `${shop.name}（${n}回目）`),
    h('p', { style: 'text-align:center;margin:8px 0 14px' }, '上生菓子を記録する？'),
    h('div', { style: 'display:flex;gap:8px;justify-content:center' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => { record.setShop(shop.id); openRecord(); } }, '記録する'),
      h('button', { class: 'btn', type: 'button', onclick: closeSheet }, 'あとで')),
  ], () => sheetEl.classList.add('small'));
}

// ---------- 近づいたら知らせる（開いているあいだだけ位置を追う） ----------
let watchId = null;
let nearSig = '';
// 歩いているあいだは地図が自分についてくる。自分で地図を動かしたら 15 秒は止める。シートが開いているときも動かさない
let lastUserMove = 0;
function onWatch(p) {
  state.pos = { lat: p.coords.latitude, lng: p.coords.longitude };
  state.acc = p.coords.accuracy;
  state.posAt = Date.now();
  setPosDot(state.pos);
  if (mainMap && Date.now() - lastUserMove > 15000 && sheetEl.hidden && !checking) {
    mainMap.panTo([state.pos.lat, state.pos.lng], { animate: !reduceMotion() });
  }
  updateNear();
}
function startWatch() {
  if (watchId !== null || !navigator.geolocation) return;
  watchId = navigator.geolocation.watchPosition(onWatch, () => {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
}
function stopWatch() {
  if (watchId === null) return;
  navigator.geolocation.clearWatch(watchId);
  watchId = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') startWatch();
  else stopWatch();
});

function focusShop(t) {
  if (!mainMap) return;
  mainMap.setView([t.lat, t.lng], Math.max(mainMap.getZoom(), 16), { animate: !reduceMotion() });
  const reg = registeredOf(t);
  if (reg) showCard(reg);
  else showOsmCard(t);
}

// 300m 以内でいちばん近い店（自分の店と OSM の店。閉店にした店は除く）を、お題のカードの下に出す
async function updateNear() {
  const pos = state.pos;
  if (!pos) return;
  const keys = tilesForBounds(pos.lat - 0.004, pos.lng - 0.005, pos.lat + 0.004, pos.lng + 0.005);
  await ensureTiles(keys);
  const reg = registeredOsmIds();
  const best = nearestShop(pos, [...state.shops, ...osmShopsIn(keys).filter((s) => !reg.has(s.osmId))]);
  drawNear(best && best.distance <= NEAR_METERS ? best : null);
}

function drawNear(best) {
  if (!best) {
    nearSig = '';
    nearEl.hidden = true;
    document.body.classList.remove('hasnear');
    return;
  }
  const { shop, distance } = best;
  const can = canCheckIn(distance, state.acc);
  const done = visitedToday(shop);
  const deg = Math.round(bearingDeg(state.pos, shop) / 10) * 10;
  const sig = [shop.id || shop.osmId, Math.round(distance / 5), deg, can, done].join('|');
  if (sig === nearSig && !nearEl.hidden) return; // 変わっていなければ描き直さない（押している最中に消えないように）
  nearSig = sig;
  nearEl.replaceChildren(...[
    h('button', { class: 'nearmain', type: 'button', onclick: () => focusShop(shop) },
      h('span', { class: 'arrow', style: `transform:rotate(${deg}deg)`, 'aria-hidden': 'true' }, '↑'),
      h('span', { class: 'nt' }, `${shop.name} まで ${fmtDist(distance)}`)),
    can && !done ? h('button', { class: 'nearpush', type: 'button', onclick: () => checkIn(shop) }, '立ち寄って判子を押す') : null,
    can && done ? h('div', { class: 'neardone' }, '今日は押しました') : null].filter(Boolean)); // replaceChildren は null を文字の "null" にしてしまう
  nearEl.hidden = false;
  document.body.classList.add('hasnear');
}

// ---------- 今月のお題（スタンプラリーのカード） ----------
// popName：いま埋まったモチーフ。その空欄だけ「ポン」と押す
function drawQuest(popName = null) {
  const now = new Date();
  const key = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  const p = period(key);
  const q = monthMotifs(state.entries, theme, year, key);
  questEl.style.setProperty('--c', p.color);
  questEl.onclick = () => {
    let intro = null;
    try { // 初めて開いたときだけ、一言の説明を出す
      if (!localStorage.getItem('kareki.questHelp')) { localStorage.setItem('kareki.questHelp', '1'); intro = QUEST_HELP; }
    } catch { /* 保存できなければ出さない */ }
    openMonth(year, key, closeSheet, intro);
  };
  questEl.setAttribute('aria-label', `${p.label}のお題 ${q.count}/${q.total}`);
  questEl.replaceChildren(
    h('div', { class: 'qtop' },
      h('b', { class: 'qtitle' }, `${p.label}のお題`),
      q.done ? h('span', { class: 'manganji' }, '満願') : null,
      h('span', { class: 'qcount' }, `${q.count}/${q.total}`)),
    h('div', { class: 'slots' }, q.motifs.map((m) =>
      h('div', { class: 'slot' + (m.got ? ' got' : '') + (m.name === popName ? ' pop' : '') },
        h('div', { class: 'dot' }, m.got ? [...m.name][0] : null),
        m.got ? null : h('small', {}, m.name)))));
}

// 保存したあとの演出：店へ動く → 判子がポン → お題の空欄がポン
async function celebrate(shop, newlyGot) {
  const motion = !reduceMotion();
  if (shop && mainMap) {
    const z = Math.max(mainMap.getZoom(), 15);
    if (motion) mainMap.flyTo([shop.lat, shop.lng], z, { duration: 0.6 });
    else mainMap.setView([shop.lat, shop.lng], z, { animate: false });
    if (motion) await sleep(750);
    const mk = markers.get(shop.id);
    const el = mk && mk.getElement();
    const hk = el && el.querySelector('.hanko');
    if (hk && motion) {
      hk.classList.add('pop');
      hk.addEventListener('animationend', () => hk.classList.remove('pop'), { once: true });
      await sleep(550);
    }
  }
  drawQuest(motion ? newlyGot : null);
}

// ---------- 日記 ----------
function openDiary() {
  const days = groupByDay(state.entries);
  if (!days.length) {
    showSheet(openDiary, [h('h1', { style: 'font-size:22px;margin:4px 0 12px' }, '日記'), h('p', { class: 'muted' }, 'まだ記録がありません')]);
    return;
  }
  const mini = [];
  const nodes = days.map((d) => {
    const box = h('section', { class: 'day' },
      h('h3', {}, fmtDate(d.date), d.isTour ? h('span', { class: 'tour' }, '巡った日') : null));
    if (d.isTour && typeof L !== 'undefined') {
      const el = h('div', { class: 'minimap' });
      box.append(el);
      mini.push({ el, route: d.route });
    }
    box.append(h('ul', { class: 'list' }, d.entries.map((e) =>
      h('li', { onclick: () => openMonth(yearOf(e.date), monthKeyOf(e.date), openDiary) }, recRow(e, false)))));
    return box;
  });
  showSheet(openDiary, [h('h1', { style: 'font-size:22px;margin:4px 0 12px' }, '日記'), ...nodes], () => drawMinis(mini));
}

function drawMinis(mini) {
  if (typeof L === 'undefined') return;
  for (const { el, route } of mini) {
    const pts = route.map(shopOf).filter(Boolean).map((s) => [s.lat, s.lng]);
    if (pts.length < 2) { el.remove(); continue; }
    const map = makeMap(el, { zoomControl: false, dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false });
    L.polyline(pts, { color: '#2b2622', weight: 3, dashArray: '6 6' }).addTo(map);
    pts.forEach((pt, i) => L.marker(pt, { icon: pinIcon('#fff', `<span style="font-size:11px;font-weight:700;color:#2b2622;display:block;text-align:center;line-height:12px">${i + 1}</span>`), interactive: false }).addTo(map));
    map.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 16 });
  }
}

// ---------- 記録する ----------
function buildRecord() {
  const f = { file: null, previewUrl: null, newPoint: null };
  let pickMap = null;
  let pickMarker = null;

  const cam = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  const album = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const preview = h('img', { class: 'preview', alt: '選んだ写真', hidden: true });
  const clearPhoto = h('button', { class: 'btn', type: 'button', hidden: true }, '写真をはずす');
  const setFile = (file) => {
    if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    f.file = file || null;
    f.previewUrl = file ? URL.createObjectURL(file) : null;
    preview.hidden = !file;
    clearPhoto.hidden = !file;
    if (file) preview.src = f.previewUrl;
  };
  cam.addEventListener('change', () => { setFile(cam.files[0]); cam.value = ''; });
  album.addEventListener('change', () => { setFile(album.files[0]); album.value = ''; });
  clearPhoto.addEventListener('click', () => setFile(null));

  const sweet = h('input', { type: 'text', placeholder: '例：桜餅の練り切り', autocomplete: 'off', enterkeyhint: 'next' });
  const shopSel = h('select', { 'aria-label': '店' });
  const newName = h('input', { type: 'text', placeholder: '新しい店の名前', autocomplete: 'off' });
  const pickEl = h('div', { class: 'pickmap' });
  const useHere = h('button', { class: 'btn', type: 'button' }, '今いる場所を使う');
  const newBox = h('div', { class: 'newshop', hidden: true },
    h('label', { class: 'f' }, '店名', newName),
    h('p', { class: 'sub' }, '場所：地図をタップして指定するか、今いる場所を使います'),
    useHere, pickEl);
  const dateIn = h('input', { type: 'date', value: todayStr() });
  const motifIn = h('input', { type: 'text', placeholder: '下から選ぶか、自由に入力', autocomplete: 'off' });
  const chips = h('div', { class: 'chips' });
  const noScore = h('input', { type: 'checkbox' });
  const range = h('input', { type: 'range', min: 0, max: 50, step: 1, value: 30, 'aria-label': '点数' });
  const big = h('div', { class: 'bignum' }, '3.0');
  const scoreBox = h('div', { class: 'scorebox' }, big, range,
    h('label', { class: 'check' }, noScore, '点数をつけない'));
  const note = h('textarea', { placeholder: '感想（任意）', rows: 3 });
  const save = h('button', { class: 'btn primary', type: 'button' }, '記録する');

  const monthPeriod = () => period(monthKeyOf(dateIn.value || todayStr()));
  function renderChips() {
    const p = monthPeriod();
    chips.replaceChildren(...p.motifs.map((m) =>
      h('button', {
        class: 'chip' + (motifIn.value === m ? ' on' : ''), type: 'button', style: `--c:${p.color}`,
        onclick: () => { motifIn.value = motifIn.value === m ? '' : m; renderChips(); },
      }, m)));
  }
  motifIn.addEventListener('input', renderChips);
  dateIn.addEventListener('change', renderChips);

  function syncScore() {
    big.textContent = (Number(range.value) / 10).toFixed(1);
    scoreBox.classList.toggle('off', noScore.checked);
  }
  range.addEventListener('input', syncScore);
  noScore.addEventListener('change', syncScore);

  function fillShops() {
    const keep = shopSel.value;
    const list = sortShopsByDistance(state.shops.filter((s) => !s.closed), state.pos);
    shopSel.replaceChildren(
      h('option', { value: '' }, '（店なし・家など）'),
      ...list.map((s) => h('option', { value: s.id }, s.distance === null ? s.name : `${s.name}（${s.distance < 1000 ? Math.round(s.distance) + 'm' : (s.distance / 1000).toFixed(1) + 'km'}）`)),
      h('option', { value: '__new__' }, '＋ 新しい店を追加'));
    shopSel.value = [...shopSel.options].some((o) => o.value === keep) ? keep : '';
  }

  function setPoint(latlng) {
    f.newPoint = { lat: latlng.lat, lng: latlng.lng };
    if (pickMap) {
      if (pickMarker) pickMarker.setLatLng(latlng);
      else pickMarker = L.marker(latlng, { icon: pinIcon('#c0527a') }).addTo(pickMap);
    }
  }
  function syncNewBox() {
    const isNew = shopSel.value === '__new__';
    newBox.hidden = !isNew;
    if (pickMap) {
      if (state.maps.includes(pickMap)) pickMap.remove(); // 画面切り替えで破棄済みのことがある
      state.maps = state.maps.filter((m) => m !== pickMap);
      pickMap = null; pickMarker = null;
    }
    if (isNew && typeof L !== 'undefined') {
      const c = f.newPoint || state.pos || TOKYO;
      pickMap = makeMap(pickEl, {});
      pickMap.setView([c.lat, c.lng], 16);
      pickMap.on('click', (ev) => setPoint(ev.latlng));
      if (f.newPoint) setPoint(f.newPoint);
    }
  }
  shopSel.addEventListener('change', syncNewBox);
  useHere.addEventListener('click', async () => {
    useHere.disabled = true;
    const pos = await getPos();
    useHere.disabled = false;
    if (!pos) { toast('今いる場所を取得できませんでした。地図で指定してください'); return; }
    setPoint(pos);
    if (pickMap) pickMap.setView([pos.lat, pos.lng], 17);
    toast('今いる場所を設定しました');
  });

  function reset() {
    setFile(null);
    sweet.value = ''; motifIn.value = ''; note.value = ''; newName.value = '';
    dateIn.value = todayStr();
    noScore.checked = false; range.value = 30;
    f.newPoint = null;
    shopSel.value = '';
    syncScore(); renderChips();
  }

  save.addEventListener('click', async () => {
    const sweetName = sweet.value.trim();
    if (!sweetName) { toast('品名を入れてください'); sweet.focus(); return; }
    if (!dateIn.value) { toast('日付を入れてください'); return; }
    save.disabled = true;
    try {
      let shop = null;
      if (shopSel.value === '__new__') {
        const name = newName.value.trim();
        if (!name) { toast('新しい店の名前を入れてください'); save.disabled = false; return; }
        const pt = f.newPoint || await getPos(4000);
        if (!pt) { toast('店の場所を地図で指定してください'); save.disabled = false; return; }
        shop = { id: db.newId(), name, lat: pt.lat, lng: pt.lng, memo: '', createdAt: Date.now() };
        await db.put('shops', shop);
      } else if (shopSel.value) {
        shop = shopOf(shopSel.value);
      }
      const pos = shop ? await getPos(4000) : null;
      let photoId = null;
      if (f.file) {
        photoId = db.newId();
        await db.put('photos', { id: photoId, blob: await resizePhoto(f.file) });
      }
      const entry = {
        id: db.newId(), date: dateIn.value, shopId: shop ? shop.id : null, sweetName,
        motif: canonicalMotif(motifIn.value, theme),
        score: noScore.checked ? null : clampScore(Number(range.value) / 10),
        note: note.value.trim(), photoId, verified: isVerified(pos, shop), createdAt: Date.now(),
      };
      await db.put('entries', entry);
      const key = monthKeyOf(entry.date);
      const wasGot = monthMotifs(state.entries, theme, yearOf(entry.date), key).motifs.some((m) => m.name === entry.motif && m.got);
      await loadData();
      reset();
      closeSheet();
      drawMap();
      const now = new Date();
      const inThisMonth = yearOf(entry.date) === now.getFullYear() && key === String(now.getMonth() + 1).padStart(2, '0');
      const isMotif = period(key).motifs.includes(entry.motif);
      if (!inThisMonth) drawQuest();
      await celebrate(shop, inThisMonth && isMotif && !wasGot ? entry.motif : null);
    } catch (err) {
      toast('保存できませんでした：' + (err && err.message ? err.message : err));
    }
    save.disabled = false;
  });

  const node = h('div', { class: 'form' },
    h('h1', { style: 'font-size:22px' }, '記録する'),
    h('div', {}, h('div', { class: 'photoRow' },
      h('button', { class: 'btn', type: 'button', onclick: () => cam.click() }, 'カメラで撮る'),
      h('button', { class: 'btn', type: 'button', onclick: () => album.click() }, 'アルバムから'),
      preview, clearPhoto), cam, album),
    h('label', { class: 'f' }, '品名（必須）', sweet),
    h('label', { class: 'f' }, '店', shopSel), newBox,
    h('label', { class: 'f' }, '日付', dateIn),
    h('div', { class: 'f' }, h('label', { class: 'f' }, 'モチーフ', motifIn), chips),
    h('div', { class: 'f' }, '点数（0.0〜5.0）', scoreBox),
    h('label', { class: 'f' }, '感想', note),
    save);

  reset();
  fillShops();
  return {
    node,
    // シートを開くたびに呼ぶ：店の候補とモチーフを最新にする
    refresh() {
      fillShops();
      renderChips();
      syncNewBox();
      getPos(3000).then((pos) => { if (pos && !sheetEl.hidden && sheetBody.contains(node)) fillShops(); });
    },
    setShop(id) { fillShops(); shopSel.value = id; },
  };
}

// ---------- 設定 ----------
function openSettings() {
  const importIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  importIn.addEventListener('change', async () => {
    const file = importIn.files[0];
    importIn.value = '';
    if (!file) return;
    try {
      await db.importAll(JSON.parse(await file.text()));
      dropPhotoCache();
      await loadData();
      render();
      toast('読み込みました');
    } catch (err) {
      toast('読み込めませんでした：' + (err && err.message ? err.message : err));
    }
  });

  const bar = h('div', { class: 'bar' },
    h('button', { class: 'ibtn', type: 'button', 'aria-label': '戻る', onclick: openZukan }, '‹'),
    h('h2', { class: 'grow' }, '設定'),
    h('span', { style: 'width:44px' }));

  showSheet(openSettings, [bar,
    h('div', { class: 'setrow' },
      h('h3', {}, 'データ'),
      h('p', { class: 'sub' }, '写真を含めた1つの JSON ファイルです。読み込みは、同じ記録を上書きし、ほかは残します。'),
      h('button', { class: 'btn', type: 'button', onclick: exportData }, '書き出す'),
      h('button', { class: 'btn', type: 'button', onclick: () => importIn.click() }, '読み込む'),
      importIn,
      h('button', { class: 'btn danger', type: 'button', onclick: wipe }, '全部消す')),
    h('div', { class: 'setrow' },
      h('h3', {}, '地図の出典'),
      h('p', { class: 'sub' }, '地図タイル：', h('a', { href: 'https://maps.gsi.go.jp/development/ichiran.html', target: '_blank', rel: 'noopener' }, '国土地理院（淡色地図）'),
        ' ／ 地図表示：Leaflet'),
      h('p', { class: 'sub' }, '和菓子屋の位置：', h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }, '© OpenStreetMap contributors'),
        '（ODbL）。名前から和菓子屋らしい店を選んでいるので、違う店や抜けがあります。')),
    h('div', { class: 'setrow' },
      h('h3', {}, 'このアプリについて'),
      h('p', { class: 'sub' }, '菓暦（かれき）は、上生菓子を食べるたびに記録して12か月の図鑑を埋めるアプリです。データはこの端末のブラウザの中にだけ保存され、外には送りません。'))]);
}

async function exportData() {
  try {
    const json = await db.exportAll();
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(json)], { type: 'application/json' })), download: `kareki-${todayStr()}.json` });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  } catch (err) {
    toast('書き出せませんでした：' + (err && err.message ? err.message : err));
  }
}

async function wipe() {
  if (!confirm('記録・店・写真をすべて消します。元に戻せません。よろしいですか？')) return;
  if (!confirm('本当に全部消しますか？（先に書き出しておくと安心です）')) return;
  await db.clearAll();
  dropPhotoCache();
  await loadData();
  closeSheet();
  render();
  toast('全部消しました');
}

// ---------- 起動 ----------
const record = buildRecord();

(async () => {
  try {
    await loadData();
  } catch (err) {
    mapEl.textContent = '保存領域を開けませんでした：' + (err && err.message ? err.message : err);
    return;
  }
  initMap();
  render();
  if (document.visibilityState === 'visible') startWatch();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
