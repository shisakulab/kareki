import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthKeyOf, yearSummary, distanceMeters, isVerified, normalizeName, searchShops,
  groupByDay, clampScore, shopStats, sortShopsByDistance, fitSize, shopStamp,
  isWagashiShop, tileKey, tilesForBounds, nearestShop, bearingDeg, canCheckIn, shopVisitDays,
  classifyClassic, classicOf, classicProgress,
} from '../logic.js';
import theme from '../themes/jonamagashi.js';

test('monthKeyOf: 日付から月のキー', () => {
  assert.equal(monthKeyOf('2026-03-05'), '03');
  assert.equal(monthKeyOf('2025-12-31'), '12');
});

test('theme: 12か月', () => {
  assert.equal(theme.periods.length, 12);
  assert.deepEqual(theme.periods.map((p) => p.key), ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']);
});

test('yearSummary: 埋まった月・件数・最高点の記録', () => {
  const entries = [
    { id: 'a', date: '2026-03-05', sweetName: 'A', score: 3.2 },
    { id: 'b', date: '2026-03-20', sweetName: 'B', score: 4.5 },
    { id: 'c', date: '2026-03-21', sweetName: 'C', score: null },
    { id: 'd', date: '2026-07-01', sweetName: 'D', score: null },
    { id: 'e', date: '2025-03-01', sweetName: 'E', score: 5 },
  ];
  const s = yearSummary(entries, 2026);
  assert.equal(s.filled, 2);
  assert.equal(s.months.length, 12);
  assert.equal(s.months[2].count, 3);
  assert.equal(s.months[2].best.id, 'b');
  assert.equal(s.months[6].count, 1);
  assert.equal(s.months[6].best.id, 'd'); // 点数なしだけの月でも1件を選ぶ
  assert.equal(s.months[0].count, 0);
  assert.equal(s.months[0].best, null);
});

test('distanceMeters: 既知の2点（東京駅〜新宿駅 約6.1km）', () => {
  const tokyo = { lat: 35.681236, lng: 139.767125 };
  const shinjuku = { lat: 35.690921, lng: 139.700258 };
  const d = distanceMeters(tokyo, shinjuku);
  assert.ok(Math.abs(d - 6100) / 6100 < 0.01, `d=${d}`);
  assert.equal(distanceMeters(tokyo, tokyo), 0);
  // 緯度1度 = 約111.19km
  const d1 = distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(Math.abs(d1 - 111195) / 111195 < 0.01);
});

test('isVerified: 150m の境目', () => {
  const shop = { lat: 35, lng: 135 };
  const at = (m) => ({ lat: 35 + m / 111195, lng: 135 }); // 北へ m メートル
  assert.equal(isVerified(at(149), shop), true);
  assert.equal(isVerified(at(151), shop), false);
  assert.equal(isVerified(shop, shop), true);
  assert.equal(isVerified(null, shop), false);
  assert.equal(isVerified(shop, null), false);
});

test('groupByDay: 日付ごと・新しい順・店の並び（連続は1つ）', () => {
  const entries = [
    { id: '1', date: '2026-03-05', shopId: 'A', createdAt: 100 },
    { id: '2', date: '2026-03-05', shopId: 'A', createdAt: 200 },
    { id: '3', date: '2026-03-05', shopId: 'B', createdAt: 300 },
    { id: '4', date: '2026-03-05', shopId: 'A', createdAt: 400 },
    { id: '5', date: '2026-03-10', shopId: 'C', createdAt: 50 },
    { id: '6', date: '2026-03-10', shopId: null, createdAt: 60 },
  ];
  const days = groupByDay(entries);
  assert.deepEqual(days.map((d) => d.date), ['2026-03-10', '2026-03-05']);
  assert.deepEqual(days[1].route, ['A', 'B', 'A']);
  assert.equal(days[1].isTour, true);
  assert.deepEqual(days[1].entries.map((e) => e.id), ['1', '2', '3', '4']);
  assert.deepEqual(days[0].route, ['C']);
  assert.equal(days[0].isTour, false);
  // 記録した順（createdAt）に並べ直される
  const d = groupByDay([
    { id: 'x', date: '2026-01-01', shopId: 'B', createdAt: 2 },
    { id: 'y', date: '2026-01-01', shopId: 'A', createdAt: 1 },
  ]);
  assert.deepEqual(d[0].route, ['A', 'B']);
});

test('clampScore: 0.1刻み・範囲・null', () => {
  assert.equal(clampScore(3.14), 3.1);
  assert.equal(clampScore(3.16), 3.2);
  assert.equal(clampScore(0.30000000000000004), 0.3);
  assert.equal(clampScore(-1), 0);
  assert.equal(clampScore(9), 5);
  assert.equal(clampScore(null), null);
  assert.equal(clampScore(0), 0);
});

test('shopStats / sortShopsByDistance / fitSize', () => {
  const entries = [
    { shopId: 'A', date: '2026-03-01', score: 4 },
    { shopId: 'A', date: '2026-05-01', score: 3 },
    { shopId: 'A', date: '2026-04-01', score: null },
    { shopId: 'B', date: '2026-04-01', score: null },
  ];
  const a = shopStats('A', entries);
  assert.equal(a.visits, 3);
  assert.equal(a.avg, 3.5);
  assert.equal(a.latest.date, '2026-05-01');
  assert.equal(shopStats('B', entries).avg, null);
  assert.equal(shopStats('Z', entries).latest, null);

  const shops = [{ id: 'far', name: 'f', lat: 36, lng: 135 }, { id: 'near', name: 'n', lat: 35.001, lng: 135 }];
  assert.deepEqual(sortShopsByDistance(shops, { lat: 35, lng: 135 }).map((s) => s.id), ['near', 'far']);

  assert.deepEqual(fitSize(4000, 3000), { w: 1280, h: 960 });
  assert.deepEqual(fitSize(600, 800), { w: 600, h: 800 });
  assert.deepEqual(fitSize(1000, 3000), { w: 427, h: 1280 });
});

test('shopStamp: 色は最近の月・字は最近のお題・回数・立ち寄りで二重の縁・未記録', () => {
  const shop = { id: 's', name: '虎屋' };
  assert.equal(shopStamp(shop, [], theme).empty, true);
  const es = [
    { shopId: 's', date: '2026-03-01', sweetName: 'ひなあられ', verified: true },
    { shopId: 's', date: '2026-10-02', sweetName: '栗蒸し羊羹', verified: false },
    { shopId: 'x', date: '2026-11-02', sweetName: '柿', verified: true },
  ];
  const s = shopStamp(shop, es, theme);
  assert.deepEqual([s.empty, s.visits, s.glyph, s.verified], [false, 2, '蒸', false]); // 記録だけでは二重の縁にしない
  assert.equal(shopStamp(shop, es, theme, [{ shopId: 's', at: Date.parse('2026-10-03') }]).verified, true); // 立ち寄りの判子があれば二重
  assert.equal(s.color, theme.periods[9].color);
  const noQuest = shopStamp(shop, [{ shopId: 's', date: '2026-10-02', sweetName: 'どら焼き', verified: false }], theme);
  assert.deepEqual([noQuest.glyph, noQuest.verified], ['虎', false]);
});

test('isWagashiShop: 和菓子屋は残し、洋菓子・地名・名前なしは除く', () => {
  const conf = (name, extra = {}) => ({ shop: 'confectionery', name, ...extra });
  for (const name of ['御菓子司 中里', '羽二重団子', '舟和 浅草本店', '亀十', 'ゼイタク煎餅', '梅園 甘味処', '桜餅 長命寺', '和菓子 いづみや']) {
    assert.equal(isWagashiShop(conf(name)), true, name);
  }
  assert.equal(isWagashiShop(conf('何とか堂', { confectionery: 'wagashi' })), true);
  assert.equal(isWagashiShop(conf('何とか堂', { confectionery: 'rice_crackers' })), true);
  // 洋菓子
  for (const name of ['パティスリー・ルシェル', 'Patisserie Ange', '洋菓子のフジ', 'チョコレート工房', 'ドーナツ屋', '和栗のモンブランケーキ', '大福とクレープ']) {
    assert.equal(isWagashiShop(conf(name)), false, name);
  }
  // 名前がない／語がない
  assert.equal(isWagashiShop({ shop: 'confectionery' }), false);
  assert.equal(isWagashiShop(conf('サンプル商店')), false);
  // 地名・交番・病院は、語を含んでも対象外
  assert.equal(isWagashiShop({ amenity: 'police', name: '団子坂交番' }), false);
  assert.equal(isWagashiShop({ highway: 'bus_stop', name: '団子坂下' }), false);
  assert.equal(isWagashiShop({ amenity: 'hospital', name: '餅田病院' }), false);
  // 甘味の喫茶店
  assert.equal(isWagashiShop({ amenity: 'cafe', name: '甘味処 みつ豆' }), true);
  assert.equal(isWagashiShop({ amenity: 'cafe', name: 'スターバックス' }), false);
  assert.equal(isWagashiShop({ amenity: 'cafe', name: '甘味とケーキ' }), false);
  assert.equal(isWagashiShop(null), false);
});

test('tileKey / tilesForBounds: 0.5度四方の区画', () => {
  assert.equal(tileKey(35.7148, 139.7967), '35.5_139.5');
  assert.equal(tileKey(35.5, 139.5), '35.5_139.5');
  assert.equal(tileKey(35.4999, 139.9999), '35.0_139.5');
  assert.equal(tileKey(43.06, 141.35), '43.0_141.0');
  assert.deepEqual(tilesForBounds(35.70, 139.70, 35.72, 139.80), ['35.5_139.5']);
  assert.deepEqual(tilesForBounds(35.4, 139.4, 35.6, 139.6), ['35.0_139.0', '35.0_139.5', '35.5_139.0', '35.5_139.5']);
  assert.equal(tilesForBounds(30, 120, 45, 150, 10).length, 10);
});

test('nearestShop / bearingDeg', () => {
  const pos = { lat: 35, lng: 135 };
  const shops = [
    { id: 'far', lat: 35.01, lng: 135 },
    { id: 'closed', lat: 35.0001, lng: 135, closed: true },
    { id: 'near', lat: 35.001, lng: 135 },
  ];
  const r = nearestShop(pos, shops);
  assert.equal(r.shop.id, 'near');
  assert.ok(Math.abs(r.distance - 111) < 2);
  assert.equal(nearestShop(pos, []), null);
  assert.equal(nearestShop(pos, [{ id: 'c', lat: 35, lng: 135, closed: true }]), null);
  assert.equal(nearestShop(null, shops), null);

  const o = { lat: 35, lng: 135 };
  assert.equal(Math.round(bearingDeg(o, { lat: 36, lng: 135 })), 0);
  assert.equal(Math.round(bearingDeg(o, { lat: 35, lng: 136 })), 90);
  assert.equal(Math.round(bearingDeg(o, { lat: 34, lng: 135 })), 180);
  assert.equal(Math.round(bearingDeg(o, { lat: 35, lng: 134 })), 270);
});

test('canCheckIn: 距離 − min(誤差, 30m) が 50m 以内', () => {
  assert.equal(canCheckIn(50, 0), true);
  assert.equal(canCheckIn(50.5, 0), false);
  assert.equal(canCheckIn(70, 20), true);   // 70 − 20 = 50
  assert.equal(canCheckIn(71, 20), false);
  assert.equal(canCheckIn(80, 30), true);   // 80 − 30 = 50
  assert.equal(canCheckIn(100, 500), false); // 誤差は 30m までしか引かない
  assert.equal(canCheckIn(50, null), true);
  assert.equal(canCheckIn(51, undefined), false);
});

test('shopVisitDays: 立ち寄りと記録を、日にち単位で数える', () => {
  const at = (y, m, d, hh = 12) => new Date(y, m - 1, d, hh).getTime();
  const entries = [
    { shopId: 's', date: '2026-10-02' },
    { shopId: 's', date: '2026-10-02' },
    { shopId: 'x', date: '2026-10-03' },
  ];
  const visits = [
    { shopId: 's', at: at(2026, 10, 2) },     // 記録と同じ日
    { shopId: 's', at: at(2026, 10, 9, 9) },
    { shopId: 's', at: at(2026, 10, 9, 18) }, // 同じ日の2回目
    { shopId: 'x', at: at(2026, 10, 3) },
  ];
  assert.equal(shopVisitDays(entries, visits, 's'), 2 + 0);
  assert.equal(shopVisitDays(entries, visits, 'x'), 1);
  assert.equal(shopVisitDays(entries, visits, 'none'), 0);
  assert.equal(shopVisitDays([], [], 's'), 0);
});

test('shopStamp: 立ち寄りだけでも判子が押され、二重の縁になる', () => {
  const shop = { id: 's', name: '亀十' };
  const visits = [{ shopId: 's', at: new Date(2026, 9, 9, 12).getTime() }];
  const s = shopStamp(shop, [], theme, visits);
  assert.deepEqual([s.empty, s.visits, s.glyph, s.verified], [false, 1, '亀', true]);
  assert.equal(s.color, theme.periods[9].color);
  assert.equal(shopStamp(shop, [], theme, [{ shopId: 'other', at: 0 }]).empty, true);
});

test('normalizeName / searchShops: 表記ゆれをそろえて探し、近い順に並べる', () => {
  assert.equal(normalizeName(' ふな わ '), 'フナワ');
  assert.equal(normalizeName('ＡＢＣ・菓子'), 'abc菓子');
  const shops = [
    { name: '舟和 本店', lat: 35.7111, lng: 139.7957 },
    { name: '舟和 仲見世', lat: 35.7130, lng: 139.7960 },
    { name: '亀十', lat: 35.7106, lng: 139.7967 },
    { name: 'ゼイタクせんべい', lat: 35.7047, lng: 139.7812 },
  ];
  const near = searchShops(shops, '舟和', { lat: 35.7128, lng: 139.7960 });
  assert.deepEqual(near.map((h) => h.shop.name), ['舟和 仲見世', '舟和 本店']);
  assert.ok(near[0].distance < near[1].distance);
  assert.deepEqual(searchShops(shops, 'センベイ').map((h) => h.shop.name), ['ゼイタクせんべい']);
  assert.equal(searchShops(shops, 'せんべい')[0].distance, null);
  assert.deepEqual(searchShops(shops, '  '), []);
  assert.equal(searchShops(shops, '和', null, 1).length, 1);
});

test('定番：30種・key 重複なし・語が別の定番にまたがらない', () => {
  assert.equal(theme.classics.length, 30);
  assert.equal(new Set(theme.classics.map((c) => c.key)).size, 30);
  // 正規化すると同じになる語は同じ定番の中だけ（別の定番にまたがらない）
  const owner = new Map();
  for (const c of theme.classics) for (const w of [c.name, ...c.aliases]) {
    const k = normalizeName(w);
    assert.ok(!owner.has(k) || owner.get(k) === c.key, w);
    owner.set(k, c.key);
  }
});

test('classifyClassic: 表の代表的な品名', () => {
  const cases = {
    '三笠': 'dorayaki', '苺大福': 'ichigodaifuku', '芋羊羹': 'imoyokan', '生八ツ橋': 'yatsuhashi', '御座候': 'imagawayaki',
    'みたらし団子': 'dango', '水ようかん': 'mizuyokan', '栗まんじゅう': 'kurimanju', '酒饅頭': 'sakemanju', '豆大福': 'mamedaifuku',
    '草餅': 'kusamochi', '長命寺': 'sakuramochi', 'かすてら': 'kasutera', '餡蜜': 'anmitsu', '鯛焼き': 'taiyaki', '落雁': 'rakugan',
  };
  for (const [name, key] of Object.entries(cases)) assert.equal(classifyClassic(name, theme), key, name);
});

test('classifyClassic: 長い語を優先・ひらがなカタカナ・当たらない', () => {
  assert.equal(classifyClassic('いちご大福', theme), 'ichigodaifuku');
  assert.equal(classifyClassic('栗饅頭', theme), 'kurimanju');
  assert.equal(classifyClassic('ドラヤキ', theme), 'dorayaki');
  assert.equal(classifyClassic('どら焼き（粒あん）', theme), 'dorayaki');
  assert.equal(classifyClassic('栗きんとん', theme), null);
  assert.equal(classifyClassic('', theme), null);
});

test('classicOf: 自動・手で null・手で選んだ key', () => {
  assert.equal(classicOf({ sweetName: 'どら焼き' }, theme), 'dorayaki');
  assert.equal(classicOf({ sweetName: 'どら焼き', classic: null }, theme), null);
  assert.equal(classicOf({ sweetName: 'どら焼き', classic: 'manju' }, theme), 'manju');
});

test('classicProgress: 同じ定番は1種、定番でない記録は数えない', () => {
  const es = [
    { date: '2026-01-01', sweetName: 'どら焼き', score: 3 },
    { date: '2026-02-01', sweetName: '三笠', score: 4.5 },
    { date: '2026-03-01', sweetName: '大福', classic: null, score: 5 },
    { date: '2026-03-02', sweetName: '栗きんとん', score: 5 },
  ];
  const p = classicProgress(es, theme);
  assert.equal(p.count, 1);
  assert.equal(p.total, 30);
  const d = p.classics.find((c) => c.key === 'dorayaki');
  assert.equal(d.count, 2);
  assert.equal(d.best.sweetName, '三笠');
});

test('shopInfo / formatOpeningHours: OSM の店の情報', async () => {
  const { shopInfo, formatOpeningHours } = await import('../logic.js');
  assert.equal(shopInfo({ name: 'x' }), null);
  assert.deepEqual(shopInfo({ opening_hours: 'Mo-Fr 10:00-18:00', phone: '+81 3-1234-5678;+81 3-0000-0000', website: 'https://example.jp/' }),
    { oh: 'Mo-Fr 10:00-18:00', tel: '+81 3-1234-5678', web: 'https://example.jp/' });
  assert.deepEqual(shopInfo({ website: 'javascript:alert(1)' }), null);
  assert.equal(formatOpeningHours('Mo-Fr 10:00-18:00;Sa 10:00-17:00'), '月〜金 10:00–18:00、土 10:00–17:00');
  assert.equal(formatOpeningHours('Tu off'), '火 定休');
  assert.equal(formatOpeningHours('Mo-Tu,Th-Su 09:00+ ("closes when sold out!"); We off'), '月〜火・木〜日 09:00〜 （closes when sold out!）、水 定休');
  assert.equal(formatOpeningHours('24/7'), '24時間');
});

test('shouldRemindBackup: 10件増えたか30日たったら勧める。あとでから7日は出さない', async () => {
  const { shouldRemindBackup } = await import('../logic.js');
  const D = 24 * 60 * 60 * 1000, now = 100 * D;
  assert.equal(shouldRemindBackup({ count: 0, now }), false);
  assert.equal(shouldRemindBackup({ count: 9, now }), false);
  assert.equal(shouldRemindBackup({ count: 10, now }), true);
  assert.equal(shouldRemindBackup({ count: 15, lastExportCount: 10, lastExportAt: now - 5 * D, now }), false);
  assert.equal(shouldRemindBackup({ count: 11, lastExportCount: 10, lastExportAt: now - 31 * D, now }), true);
  assert.equal(shouldRemindBackup({ count: 10, lastExportCount: 10, lastExportAt: now - 90 * D, now }), false);
  assert.equal(shouldRemindBackup({ count: 30, lastExportCount: 10, snoozedAt: now - 3 * D, now }), false);
  assert.equal(shouldRemindBackup({ count: 30, lastExportCount: 10, snoozedAt: now - 8 * D, now }), true);
});

test('isWagashiShop: 屋号らしい名前と cuisine=japanese を拾う', () => {
  const c = (name, extra = {}) => isWagashiShop({ shop: 'confectionery', name, ...extra });
  assert.equal(c('うさぎや'), true);
  assert.equal(c('うさぎや 本店'), true);
  assert.equal(c('翠江堂'), true);
  assert.equal(c('千秋庵'), true);
  assert.equal(c('Usagiya'), false);
  assert.equal(c('シャトレーゼ'), false);
  assert.equal(c('ピュール・ド・ソソギ'), false);
  assert.equal(c('なにか', { cuisine: 'japanese' }), true);
  assert.equal(c('洋菓子の店', { cuisine: 'japanese' }), false);
  assert.equal(isWagashiShop({ shop: 'bakery', name: 'うさぎや' }), false);
});

test('latestPhotoId / shopStamp: 判子に入れる写真', async () => {
  const { latestPhotoId, shopStamp } = await import('../logic.js');
  const es = [
    { date: '2026-10-01', shopId: 's', sweetName: 'a', photoId: 'p1', createdAt: 1 },
    { date: '2026-10-05', shopId: 's', sweetName: 'b', photoId: null, createdAt: 2 },
    { date: '2026-10-03', shopId: 's', sweetName: 'c', photoId: 'p3', createdAt: 3 },
  ];
  assert.equal(latestPhotoId(es), 'p3');
  assert.equal(latestPhotoId([{ date: '2026-01-01', photoId: null }]), null);
  assert.equal(shopStamp({ id: 's', name: '店' }, es, theme).photoId, 'p3');
});

// ---------- v1.4 季節の和菓子のお題 ----------
test('テーマ: 12か月すべてに quests が4つ、key の重複なし、hint あり', () => {
  const keys = [];
  for (const p of theme.periods) {
    assert.equal(p.quests.length, 4, p.key);
    for (const q of p.quests) {
      assert.ok(q.key.startsWith(p.key + '_'), q.key);
      assert.ok(q.name && q.hint && Array.isArray(q.aliases), q.key);
      keys.push(q.key);
    }
  }
  assert.equal(keys.length, 48);
  assert.equal(new Set(keys).size, 48);
});

test('classifyQuest: 月ごとの当てはめ・別名・長い語の優先', async () => {
  const { classifyQuest } = await import('../logic.js');
  assert.equal(classifyQuest('栗蒸し羊羹', theme, '10'), '10_kuri_mushi');
  assert.equal(classifyQuest('栗蒸し羊羹', theme, '03'), null);
  assert.equal(classifyQuest('おはぎ', theme, '03'), '03_botamochi');
  assert.equal(classifyQuest('ぼたもち', theme, '09'), '09_ohagi');
  assert.equal(classifyQuest('水無月', theme, '06'), '06_minazuki');
  assert.equal(classifyQuest('宇治金時', theme, '07'), '07_kakigori');
  assert.equal(classifyQuest('おしるこ', theme, '01'), '01_zenzai');
  assert.equal(classifyQuest('イチゴ大福', theme, '02'), '02_ichigo_daifuku');
  assert.equal(classifyQuest('', theme, '10'), null);
  assert.equal(classifyQuest('栗饅頭', theme, '13'), null);
  // 長い語を優先：「栗蒸し羊羹」は栗饅頭などではなく栗蒸し羊羹
  assert.equal(classifyQuest('新栗の栗蒸しようかん', theme, '10'), '10_kuri_mushi');
});

test('questOf: 記録の日付の月で自動・手で null・手で選んだ key', async () => {
  const { questOf } = await import('../logic.js');
  assert.equal(questOf({ date: '2026-10-05', sweetName: '栗蒸し羊羹' }, theme), '10_kuri_mushi');
  assert.equal(questOf({ date: '2026-03-03', sweetName: '栗蒸し羊羹' }, theme), null);
  assert.equal(questOf({ date: '2026-10-05', sweetName: '栗蒸し羊羹', quest: null }, theme), null);
  assert.equal(questOf({ date: '2026-10-05', sweetName: 'なにか', quest: '10_imo_yokan' }, theme), '10_imo_yokan');
});

test('monthQuests: 季節の和菓子4つ・写真・count・done', async () => {
  const { monthQuests } = await import('../logic.js');
  const es = [
    { date: '2026-10-01', sweetName: '栗蒸し羊羹', photoId: 'p1', createdAt: 1 },
    { date: '2026-10-05', sweetName: '栗蒸し羊羹', photoId: 'p2', createdAt: 2 },
    { date: '2025-10-05', sweetName: '栗饅頭', photoId: 'old', createdAt: 3 },
    { date: '2026-10-06', sweetName: '芋ようかん', photoId: null, createdAt: 4, quest: null },
  ];
  const r = monthQuests(es, theme, 2026, '10');
  assert.equal(r.total, 4);
  assert.equal(r.quests.length, 4);
  assert.deepEqual([r.count, r.done], [1, false]);
  const kuri = r.quests.find((q) => q.key === '10_kuri_mushi');
  assert.deepEqual([kuri.got, kuri.photoId], [true, 'p2']);
  assert.equal(r.quests.find((q) => q.key === '10_imo_yokan').got, false); // 手で「お題ではない」
  assert.equal(r.quests.find((q) => q.key === '10_kuri_manju').got, false); // 去年の記録は数えない
  // 4つそろうと満願
  const all = theme.periods[9].quests.map((q) => ({ date: '2026-10-02', sweetName: q.name }));
  const full = monthQuests(all, theme, 2026, '10');
  assert.deepEqual([full.count, full.done], [4, true]);
  assert.equal(monthQuests(es, theme, 2026, '99').total, 0);
});

test('questProgress: 通算 n/48', async () => {
  const { questProgress } = await import('../logic.js');
  assert.deepEqual(questProgress([], theme), { count: 0, total: 48, quests: 0 });
  const es = [
    { date: '2026-10-05', sweetName: '栗蒸し羊羹' },
    { date: '2025-10-05', sweetName: '栗蒸し羊羹' }, // 年が違っても同じお題は1つ
    { date: '2026-03-03', sweetName: '栗蒸し羊羹' }, // 3月には当たらない
  ];
  const r = questProgress(es, theme);
  assert.deepEqual([r.count, r.quests], [1, 1]);
});

test('判子の字：お題の和菓子は漢字1文字、店の判子はお題の字を優先', async () => {
  const { monthQuests, shopStamp } = await import('../logic.js');
  for (const p of theme.periods) {
    const gs = p.quests.map((q) => q.glyph);
    for (const q of p.quests) assert.ok(q.glyph && [...q.glyph].length === 1 && /\p{Script=Han}/u.test(q.glyph), `${p.key} ${q.name}`);
    assert.equal(new Set(gs).size, gs.length, `${p.key} の字が重なっている`);
  }
  const es = [{ date: '2026-10-05', shopId: 's', sweetName: '栗蒸し羊羹', createdAt: 1 }];
  const q = monthQuests(es, theme, 2026, '10');
  assert.equal(q.quests.find((x) => x.name === '栗蒸し羊羹').glyph, '蒸');
  assert.equal(shopStamp({ id: 's', name: '店' }, es, theme).glyph, '蒸');
  assert.equal(shopStamp({ id: 's', name: '店' }, [{ date: '2026-10-05', shopId: 's', sweetName: 'どら焼き', createdAt: 1 }], theme).glyph, '店');
});

test('isWagashiShop: 名前にたい焼き等の語を含む fast_food・cafe・bakery を拾う', () => {
  assert.equal(isWagashiShop({ amenity: 'fast_food', name: '浅草たい焼 花子' }), true);
  assert.equal(isWagashiShop({ amenity: 'fast_food', name: '鯛焼き屋' }), true);
  assert.equal(isWagashiShop({ amenity: 'cafe', name: '今川焼 まるや' }), true);
  assert.equal(isWagashiShop({ shop: 'bakery', name: '御座候 駅前店' }), true);
  assert.equal(isWagashiShop({ amenity: 'fast_food', name: 'マクドナルド' }), false);
  assert.equal(isWagashiShop({ amenity: 'fast_food' }), false);
  assert.equal(isWagashiShop({ shop: 'bakery', name: 'パン工房' }), false);
  assert.equal(isWagashiShop({ amenity: 'restaurant', name: 'たい焼き食堂' }), false);
});
