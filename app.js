import theme from './themes/jonamagashi.js';
import * as db from './db.js';
import {
  todayStr, monthKeyOf, yearOf, yearSummary, motifProgress, canonicalMotif, isVerified, sortShopsByDistance,
  groupByDay, clampScore, classicProgress, classicOf, classifyClassic, shopStats, fitSize, shopStamp, monthMotifs,
  distanceMeters, tilesForBounds, nearestShop, bearingDeg, canCheckIn, shopVisitDays, searchShops, tileKey, formatOpeningHours, shouldRemindBackup,
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

const state = { zukanTab: 'season', year: new Date().getFullYear(), shops: [], entries: [], visits: [], pos: null, acc: null, posAt: 0, maps: [] };
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

  const cprog = classicProgress(state.entries, theme);
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, [['season', '季節'], ['classic', '定番']].map(([k, label]) =>
    h('button', {
      class: 'tab' + (state.zukanTab === k ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': String(state.zukanTab === k),
      onclick: () => { state.zukanTab = k; openZukan(); },
    }, label)));

  const achv = h('div', { class: 'achv' },
    h('span', {}, isThisYear ? '今年 ' : `${state.year}年 `, h('b', {}, `${sum.filled}/12`), ' か月'),
    h('span', {}, '定番 ', h('b', {}, `${cprog.count}/${cprog.total}`)),
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

  const cgrid = h('div', { class: 'grid' }, cprog.classics.map((c) => {
    const cls = ['cell', 'classic'];
    const kids = [];
    if (c.count > 0) {
      cls.push('filled');
      if (c.best.photoId) { cls.push('photo'); kids.push(imgFor(c.best.photoId, '')); }
      kids.push(h('div', { class: 'mo' }, c.name));
      if (!c.best.photoId) kids.push(h('div', { class: 'nm' }, c.best.sweetName));
      kids.push(h('div', { class: 'stamp' + (c.best.verified ? ' ring' : '') }, c.count));
    } else {
      kids.push(h('div', { class: 'mt' }, c.name));
    }
    return h('button', { class: cls.join(' '), type: 'button', style: '--c:#c0527a', onclick: () => openClassic(c.key) }, kids);
  }));

  // 年の切り替えは季節のときだけ
  if (state.zukanTab === 'classic') bar.querySelector('.grow').replaceChildren(h('h1', { style: 'display:inline;font-size:22px' }, '定番'));
  showSheet(openZukan, [bar, tabs, achv, state.zukanTab === 'classic' ? cgrid : grid]);
}

// 定番ひとつの記録の一覧
function openClassic(key) {
  const c = theme.classics.find((x) => x.key === key);
  const list = state.entries.filter((e) => classicOf(e, theme) === key)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
  const bar = h('div', { class: 'bar' },
    h('button', { class: 'ibtn', type: 'button', 'aria-label': '戻る', onclick: openZukan }, '‹'),
    h('h2', { class: 'grow' }, c.name),
    h('span', { style: 'width:44px' }));
  const recs = list.length
    ? h('ul', { class: 'list' }, list.map((e) => h('li', {}, recRow(e, true))))
    : h('p', { class: 'muted' }, 'まだ記録がありません');
  showSheet(() => openClassic(key), [bar, h('h3', {}, '記録'), recs]);
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

  const hints = theme.hints || {};
  const motifs = h('div', { class: 'motifs', style: `--c:${p.color}` }, p.motifs.map((m) =>
    h('div', { class: 'motif' + (names[m] ? ' got' : '') }, (names[m] ? '✓ ' : '') + m,
      names[m] ? h('small', {}, names[m]) : null,
      hints[m] ? h('span', { class: 'hint' }, hints[m]) : null)));
  // お題の遊び方（いつでも開ける。初めてのときは開いた状態）
  const howto = h('details', { class: 'howto', open: !!intro },
    h('summary', {}, 'お題の遊び方'),
    h('ul', {},
      h('li', {}, '上生菓子は、季節の花や行事を、練り切りなどの形と色で表したお菓子です。和菓子屋は月ごとに品を入れ替えるので、その月にしか出会えない菓子があります。'),
      h('li', {}, 'お題は、その月に和菓子屋で出会いやすい5つの題材です。'),
      h('li', {}, '当てはまる上生菓子を見つけたら、記録するときにお題を選びます。判子が押され、5つそろうと「満願」です。'),
      h('li', {}, '菓子の名前（菓銘）は店ごとに違います。「乱菊」「着せ綿」など名前が違っても、菊をかたどっていれば「菊」です。栗や柿のように、素材そのものがお題のこともあります。'),
      h('li', {}, '月が替わるとお題も替わります。前の月の分は、図鑑の「季節」で振り返れます。'),
      h('li', {}, 'お題に合うかどうかは、自分で決めて大丈夫です。')));

  showSheet(() => openMonth(year, key, back), [bar, howto, h('h3', {}, '記録'), recs, h('h3', { style: 'margin-bottom:8px' }, 'モチーフ'), motifs].filter(Boolean));
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
  const cls = 'hanko' + (s.empty ? ' empty' : '') + (s.verified ? ' dbl' : '') + (s.photoId ? ' photo' : '');
  const node = s.empty
    ? h('div', { class: cls })
    : h('div', { class: cls, style: `--c:${s.color || NEUTRAL}` },
      // 写真があれば、その店で最後に撮った写真を丸く入れる。なければ字の判子
      h('div', { class: 'face' }, s.photoId ? imgFor(s.photoId, '') : h('span', { class: 'g' }, s.glyph)),
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


  mainMap.on('moveend', scheduleOsm);
  // 指で地図を動かしたら、自分についていくのをやめる（現在地ボタンでまた始める）
  mainMap.on('dragstart', () => setFollow(false));
  mainMap.getContainer().addEventListener('wheel', () => setFollow(false), { passive: true });
  mainMap.getContainer().addEventListener('touchstart', (e) => { if (e.touches.length > 1) setFollow(false); }, { passive: true });
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
    shopLinks(shop),
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => { record.setShop(shop.id); closeCard(); openRecord(); } }, 'ここで記録する'),
      h('button', { class: 'btn', type: 'button', onclick: () => checkIn(shop) }, '立ち寄る'),
      shop.osmId ? null : h('button', { class: 'btn', type: 'button', onclick: () => renameShop(shop) }, '名前を直す'),
      shop.osmId ? null : h('button', { class: 'btn', type: 'button', onclick: () => deleteShop(shop) }, '店を消す'),
      h('button', { class: 'btn', type: 'button', onclick: closeCard }, '閉じる')));
  document.body.append(card);
}

// 自分で追加した店：名前を直す・消す（記録は残し、店なしにする）
async function renameShop(shop) {
  const name = (prompt('店名を直します', shop.name) || '').trim();
  if (!name || name === shop.name) return;
  await db.put('shops', { ...shop, name });
  await loadData();
  render();
  showCard(shopOf(shop.id));
  toast('店名を直しました');
}
async function deleteShop(shop) {
  const n = state.entries.filter((e) => e.shopId === shop.id).length;
  if (!confirm(`「${shop.name}」を消しますか？${n ? `（${n}件の記録は残り、「店なし」になります）` : ''}`)) return;
  for (const e of state.entries.filter((x) => x.shopId === shop.id)) await db.put('entries', { ...e, shopId: null, verified: false });
  for (const v of state.visits.filter((x) => x.shopId === shop.id)) await db.remove('visits', v.id);
  await db.remove('shops', shop.id);
  await loadData();
  closeCard();
  render();
  updateNear();
  toast(`「${shop.name}」を消しました`);
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
        if (list) tiles.set(key, list.map(([osmId, name, lat, lng, info]) => ({ osmId, name, lat, lng, info: info || null })));
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

// 店のカードの下に出す情報：OSM の営業時間・電話・Web サイト（ある店だけ）と、Google マップで開くリンク
function osmInfoOf(shop) {
  if (shop.info) return shop.info;
  if (!shop.osmId) return null;
  const list = tiles.get(tileKey(shop.lat, shop.lng)) || [];
  const hit = list.find((x) => x.osmId === shop.osmId);
  return hit ? hit.info : null;
}
// 住所（国土地理院の逆ジオコーダーで調べて同梱したもの）。自分で追加した店にはない
function addressOf(shop) {
  const info = osmInfoOf(shop);
  return info && info.ad ? info.ad : '';
}
function shopLinks(shop) {
  const info = osmInfoOf(shop);
  // Google の公式のリンク形式（Maps URLs）。住所があれば「店名＋町名」、なければ店の位置で開く
  const query = info && info.ad ? `${shop.name} ${info.ad}` : `${shop.lat},${shop.lng}`;
  const gmap = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  const rows = [];
  if (info && info.ad) rows.push(h('p', { class: 'addr' }, info.ad));
  if (info && info.oh) rows.push(h('p', { class: 'hours' }, '営業時間：' + formatOpeningHours(info.oh)));
  const links = [h('a', { class: 'btn', href: gmap, target: '_blank', rel: 'noopener' }, 'Google マップで開く')];
  if (info && info.web) links.push(h('a', { class: 'btn', href: info.web, target: '_blank', rel: 'noopener' }, 'Web サイト'));
  rows.push(h('div', { class: 'links' }, links));
  if (info && (info.oh || info.web)) rows.push(h('p', { class: 'osmnote' }, 'OpenStreetMap の情報です（古い場合があります）。営業時間は Google マップでも確かめてください'));
  return rows;
}

function showOsmCard(s) {
  closeCard();
  const d = state.pos ? distanceMeters(state.pos, s) : null;
  card = h('div', { class: 'shopcard' },
    h('h2', {}, s.name),
    h('p', { class: 'sub' }, d === null ? '今いる場所は分かりません' : `今いる場所から ${fmtDist(d)}`),
    h('p', { class: 'muted' }, 'まだ立ち寄っていません'),
    shopLinks(s),
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => checkIn(s) }, '立ち寄って判子を押す'),
      h('button', { class: 'btn', type: 'button', onclick: () => markClosed(s) }, '閉店・和菓子屋ではない'),
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
  if (!confirm(`「${s.name}」を地図と知らせから外しますか？（閉店していた、和菓子屋ではなかった、など）`)) return;
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
// 歩いているあいだは地図が自分についてくる。指で地図を動かしたら止め、現在地ボタンでまた始める。シートが開いているときは動かさない
const locateEl = document.getElementById('locate');
let follow = true;
function setFollow(on) {
  follow = on;
  locateEl.classList.toggle('on', on);
}
locateEl.addEventListener('click', async () => {
  closeCard();
  const pos = state.pos && Date.now() - state.posAt < 20000 ? state.pos : await getPos(8000);
  if (!pos) { toast('今いる場所を取得できませんでした（位置情報の許可を確かめてください）'); return; }
  setFollow(true);
  setPosDot(pos);
  if (mainMap) mainMap.setView([pos.lat, pos.lng], Math.max(mainMap.getZoom(), 16), { animate: !reduceMotion() });
  startWatch();
});
function onWatch(p) {
  state.pos = { lat: p.coords.latitude, lng: p.coords.longitude };
  state.acc = p.coords.accuracy;
  state.posAt = Date.now();
  setPosDot(state.pos);
  if (mainMap && follow && sheetEl.hidden && !checking) {
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
  if (document.visibilityState === 'visible') { if (welcomed()) startWatch(); } else stopWatch();
});

function focusShop(t) {
  if (!mainMap) return;
  setFollow(false); // 店を見ているあいだは自分の位置に引き戻さない
  mainMap.setView([t.lat, t.lng], Math.max(mainMap.getZoom(), 16), { animate: !reduceMotion() });
  const reg = registeredOf(t);
  if (reg) showCard(reg);
  else showOsmCard(t);
}

// ---------- 店を探す ----------
// 自分の店（閉店にした店は除く）と、全国の和菓子屋データから店名で探す。初回だけ全区画（約100KB）を読み込む
let allTilesReady = null;
function loadAllTiles() {
  if (!allTilesReady) {
    allTilesReady = fetch('data/shops/meta.json')
      .then((r) => r.json())
      .then((meta) => ensureTiles(meta.tiles))
      .catch(() => { allTilesReady = null; });
  }
  return allTilesReady;
}
function searchPool() {
  const reg = registeredOsmIds();
  const all = [...tiles.values()].flat().filter((s) => !reg.has(s.osmId));
  return [...state.shops.filter((s) => !s.closed), ...all];
}
document.getElementById('search').addEventListener('click', () => { closeCard(); openSearch(); });
function openSearch(initial = '') {
  const input = h('input', { class: 'searchbox', type: 'search', placeholder: '店名で探す（例：舟和、せんべい）', value: initial, enterkeyhint: 'search', autocomplete: 'off' });
  const status = h('p', { class: 'sub' }, '');
  const list = h('ul', { class: 'list results' });
  const render = () => {
    const q = input.value;
    if (!q.trim()) { list.replaceChildren(); status.textContent = ready ? '和菓子屋の名前を入れてください' : '読み込んでいます…'; return; }
    const hits = searchShops(searchPool(), q, state.pos);
    status.textContent = hits.length ? `${hits.length === 50 ? '50件以上' : hits.length + '件'}${state.pos ? '（近い順）' : ''}`
      : ready ? '見つかりませんでした（地図を長押しすると店を追加できます）' : '読み込んでいます…';
    list.replaceChildren(...hits.map(({ shop, distance }) => {
      const days = shop.id ? shopVisitDays(state.entries, state.visits, shop.id) : 0;
      return h('li', {}, h('button', {
        type: 'button',
        onclick: () => { closeSheet(); focusShop(shop); },
      },
      h('span', { class: 'rl' }, h('span', { class: 'rn' }, shop.name), addressOf(shop) ? h('span', { class: 'ra' }, addressOf(shop)) : null),
      h('span', { class: 'rd' }, [days ? `判子 ${days}` : null, distance === null ? null : fmtDist(distance)].filter(Boolean).join(' ・ '))));
    }));
  };
  input.addEventListener('input', render);
  showSheet(() => openSearch(input.value), [h('h1', { style: 'font-size:22px;margin:4px 0 12px' }, '店を探す'), input, status, list],
    () => setTimeout(() => input.focus(), 50));
  let ready = false;
  render();
  loadAllTiles().then(() => { ready = true; render(); });
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
      h('div', { class: 'slot' + (m.got ? ' got' : '') + (m.photoId ? ' photo' : '') + (m.name === popName ? ' pop' : '') },
        h('div', { class: 'dot' }, m.photoId ? imgFor(m.photoId, '') : m.got ? [...m.name][0] : null),
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
  const f = { file: null, previewUrl: null, newPoint: null, classic: undefined, picking: false };
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

  const sweet = h('input', { type: 'text', placeholder: '例：どら焼き、栗きんとん', autocomplete: 'off', enterkeyhint: 'next' });
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
  const big = h('div', { class: 'bignum' }, '—');
  const shint = h('div', { class: 'shint' }, 'スライダーを動かすと点数が付きます');
  const scoreBox = h('div', { class: 'scorebox' }, big, range, shint,
    h('label', { class: 'check' }, noScore, '点数をつけない'));
  const note = h('textarea', { placeholder: '感想（任意）', rows: 3 });
  const save = h('button', { class: 'btn primary', type: 'button' }, '記録する');

  // 定番：品名から自動（f.classic が undefined）か、手で選んだ値（null＝定番ではない）
  const classicBox = h('div', { class: 'classicBox' });
  const currentClassic = () => (f.classic !== undefined ? f.classic : classifyClassic(sweet.value, theme));
  function renderClassic() {
    const cur = currentClassic();
    const c = cur ? theme.classics.find((x) => x.key === cur) : null;
    const label = c ? `定番：${c.name}` : (f.classic === null ? '定番：なし' : '定番：—（選ぶ）');
    const nodes = [h('button', { class: 'chip classicChip' + (c ? ' on' : ''), type: 'button', style: '--c:#c0527a', onclick: () => { f.picking = !f.picking; renderClassic(); } }, label)];
    if (f.picking) {
      const pick = (v) => { f.classic = v; f.picking = false; renderClassic(); };
      nodes.push(h('div', { class: 'chips classicList' },
        theme.classics.map((x) => h('button', { class: 'chip' + (cur === x.key ? ' on' : ''), type: 'button', style: '--c:#c0527a', onclick: () => pick(x.key) }, x.name)),
        h('button', { class: 'chip' + (f.classic === null ? ' on' : ''), type: 'button', style: '--c:#7f8b99', onclick: () => pick(null) }, '定番ではない')));
    }
    classicBox.replaceChildren(...nodes);
  }
  sweet.addEventListener('input', renderClassic);

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

  // 点数は、スライダーを動かしたときだけ付ける（触らなければ「点数なし」）
  function syncScore() {
    big.textContent = noScore.checked ? '—' : (Number(range.value) / 10).toFixed(1);
    scoreBox.classList.toggle('off', noScore.checked);
    shint.hidden = !noScore.checked;
  }
  range.addEventListener('input', () => { noScore.checked = false; syncScore(); });
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
    sweet.value = ''; f.classic = undefined; f.picking = false; renderClassic(); motifIn.value = ''; note.value = ''; newName.value = '';
    dateIn.value = todayStr();
    noScore.checked = true; range.value = 30;
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
        classic: f.classic !== undefined ? f.classic : classifyClassic(sweetName, theme),
        note: note.value.trim(), photoId, verified: isVerified(pos, shop), createdAt: Date.now(),
      };
      await db.put('entries', entry);
      const key = monthKeyOf(entry.date);
      const classicWas = entry.classic ? classicProgress(state.entries, theme).classics.find((c) => c.key === entry.classic) : null;
      const classicNew = !!(classicWas && classicWas.count === 0);
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
      if (classicNew) {
        const cp = classicProgress(state.entries, theme);
        toast(`定番図鑑に『${classicWas.name}』が入りました（${cp.count}/${cp.total}）`);
      }
      requestPersist();
      setTimeout(maybeRemindBackup, classicNew ? 2600 : 600);
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
    h('div', { class: 'f' }, h('label', { class: 'f' }, '品名（必須）', sweet), classicBox),
    h('label', { class: 'f' }, '店', shopSel), newBox,
    h('label', { class: 'f' }, '日付', dateIn),
    h('div', { class: 'f' }, h('label', { class: 'f' }, '今月のお題（上生菓子のとき）', motifIn), chips),
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
      h('p', { class: 'sub' }, '記録はこのスマホのブラウザの中だけにあります。機種変更やブラウザのデータ消去に備えて、ときどき書き出してください（写真を含めた1つの JSON ファイル）。読み込みは、同じ記録を上書きし、ほかは残します。'),
      h('p', { class: 'sub' }, (() => { const b = backupState(); return b.at ? `前回の書き出し：${todayStr(new Date(b.at))}（${b.count}件）` : 'まだ書き出していません'; })()),
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
      h('p', { class: 'sub' }, '菓暦（かれき）は、上生菓子や、どら焼きなど定番の和菓子を食べるたびに記録して、季節と定番の図鑑を埋めるアプリです。データはこの端末のブラウザの中にだけ保存され、外には送りません。'))]);
}

// ---------- データを守る ----------
// 書き出した日時と件数（この端末のメモ。読めなくても動く）
function backupState(update) {
  let cur = {};
  try { cur = JSON.parse(localStorage.getItem('kareki.backup') || '{}') || {}; } catch { cur = {}; }
  if (update) {
    cur = { ...cur, ...update };
    try { localStorage.setItem('kareki.backup', JSON.stringify(cur)); } catch { /* 保存できなくても続ける */ }
  }
  return cur;
}
// ブラウザに「このサイトのデータは消さないで」と頼む（対応していない端末では何もしない）
async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* 対応していなければそのまま */ }
}
// 記録が10件増えたか、30日たったら、書き出しを勧める
function maybeRemindBackup() {
  const b = backupState();
  if (!shouldRemindBackup({ count: state.entries.length, lastExportAt: b.at || 0, lastExportCount: b.count || 0, snoozedAt: b.snooze || 0 })) return;
  showSheet(null, [
    h('h2', { style: 'font-size:20px;text-align:center;margin:0 0 6px' }, '書き出しておきませんか？'),
    h('p', { class: 'sub', style: 'text-align:center;margin:0 0 14px' },
      `記録が ${state.entries.length} 件になりました。データはこのスマホのブラウザの中だけにあるので、機種変更やブラウザのデータ消去に備えて、ファイルに書き出しておくと安心です。`),
    h('div', { style: 'display:flex;gap:8px;justify-content:center' },
      h('button', { class: 'btn primary', type: 'button', onclick: async () => { await exportData(); closeSheet(); } }, '書き出す'),
      h('button', { class: 'btn', type: 'button', onclick: () => { backupState({ snooze: Date.now() }); closeSheet(); } }, 'あとで')),
  ], () => sheetEl.classList.add('small'));
}

async function exportData() {
  try {
    const json = await db.exportAll();
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(json)], { type: 'application/json' })), download: `kareki-${todayStr()}.json` });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    backupState({ at: Date.now(), count: state.entries.length, snooze: 0 });
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

// ---------- 初めて開いた人への説明 ----------
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function welcomed() { try { return localStorage.getItem('kareki.welcome') === '1'; } catch { return true; } }
function openWelcome(done) {
  const finish = () => { try { localStorage.setItem('kareki.welcome', '1'); } catch { /* 保存できなくても続ける */ } closeSheet(); done(); };
  showSheet(null, [
    h('h1', { style: 'font-size:24px;margin:4px 0 10px' }, '菓暦へようこそ'),
    h('ul', { class: 'welcome' },
      h('li', {}, '和菓子を食べたら「＋」で記録します。上生菓子は季節の図鑑に、どら焼きや大福などは定番の図鑑に入ります。'),
      h('li', {}, '上の「今月のお題」は、その月の上生菓子の題材です。5つ集めると満願です。'),
      h('li', {}, '地図の点線の丸は、近くの和菓子屋です。店の50m以内で「立ち寄って判子を押す」が押せます。'),
      h('li', {}, '位置情報は、近くの店を知らせて判子を押すためだけに使います。記録も位置も、このスマホの中にだけ保存し、外には送りません。'),
      isStandalone() ? null : h('li', {}, 'ホーム画面に追加すると、アプリのように開けて、データも消えにくくなります（iPhone は Safari の共有ボタン →「ホーム画面に追加」）。')),
    h('button', { class: 'btn primary', type: 'button', style: 'width:100%;margin-top:8px', onclick: finish }, 'はじめる'),
  ]);
}
// 現在地を取って地図を合わせ、位置を追い始める（初めての人は、説明を読んでから位置情報の許可を聞く）
function startLocation() {
  getPos().then((pos) => {
    if (!pos || !mainMap) return;
    mainMap.setView([pos.lat, pos.lng], 15);
    setPosDot(pos);
    updateNear();
  });
  if (document.visibilityState === 'visible') startWatch();
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
  if (welcomed()) startLocation();
  else openWelcome(startLocation);
  if (state.entries.length) requestPersist(); // 記録がある人は、データを消されにくくする
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    // 新しい版が入ったら、開いている画面を一度だけ読み込み直す（開き直さなくても新しい版になる）
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded || !sheetEl.hidden) return; // 初めての登録時と、入力中のシートがあるときは読み込み直さない
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => reg.update()).catch(() => {});
  }
})();
