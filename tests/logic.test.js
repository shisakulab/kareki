import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthKeyOf, yearSummary, motifProgress, canonicalMotif, distanceMeters, isVerified, normalizeName, searchShops,
  groupByDay, clampScore, shopStats, sortShopsByDistance, fitSize, shopStamp, monthMotifs,
  isWagashiShop, tileKey, tilesForBounds, nearestShop, bearingDeg, canCheckIn, shopVisitDays,
  classifyClassic, classicOf, classicProgress,
} from '../logic.js';
import theme from '../themes/jonamagashi.js';

test('monthKeyOf: 日付から月のキー', () => {
  assert.equal(monthKeyOf('2026-03-05'), '03');
  assert.equal(monthKeyOf('2025-12-31'), '12');
});

test('theme: 12か月・各5モチーフ・全60が重複なし', () => {
  assert.equal(theme.periods.length, 12);
  assert.deepEqual(theme.periods.map((p) => p.key), ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']);
  for (const p of theme.periods) assert.equal(p.motifs.length, 5);
  assert.equal(new Set(theme.periods.flatMap((p) => p.motifs)).size, 60);
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

test('motifProgress: 同じモチーフは1回、一覧にない自由入力は数えない', () => {
  const entries = [
    { date: '2026-03-05', sweetName: '桜餅', motif: '桜' },
    { date: '2026-03-25', sweetName: '桜の練り切り', motif: '桜' },
    { date: '2026-04-01', sweetName: '藤の花', motif: '藤' },
    { date: '2026-04-02', sweetName: '謎', motif: 'ぜんぜん自由' },
    { date: '2026-04-03', sweetName: '無印', motif: null },
  ];
  const p = motifProgress(entries, theme);
  assert.equal(p.count, 2);
  assert.equal(p.total, 60);
  assert.deepEqual(p.collected.sort(), ['桜', '藤'].sort());
  assert.equal(p.names['桜'], '桜の練り切り'); // 新しいほうの品名
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

test('canonicalMotif: 別名をモチーフにそろえる。別名の行き先はすべて一覧にある', () => {
  const all = new Set(theme.periods.flatMap((p) => p.motifs));
  for (const [alias, to] of Object.entries(theme.aliases)) assert.ok(all.has(to), `${alias} → ${to}`);
  assert.equal(canonicalMotif(' 初音 ', theme), '鶯');
  assert.equal(canonicalMotif('桜', theme), '桜');
  assert.equal(canonicalMotif('ぜんぜん自由', theme), 'ぜんぜん自由');
  assert.equal(canonicalMotif('  ', theme), null);
  const p = motifProgress([{ date: '2026-05-01', sweetName: '柏餅', motif: '柏餅' }], theme);
  assert.deepEqual(p.collected, ['端午']);
});

test('shopStamp: 色は最近の月・字は最近のモチーフ・回数・場の有無・未記録', () => {
  const shop = { id: 's', name: '虎屋' };
  assert.equal(shopStamp(shop, [], theme).empty, true);
  const es = [
    { shopId: 's', date: '2026-03-01', motif: '雛', verified: true },
    { shopId: 's', date: '2026-10-02', motif: '栗', verified: false },
    { shopId: 'x', date: '2026-11-02', motif: '柿', verified: true },
  ];
  const s = shopStamp(shop, es, theme);
  assert.deepEqual([s.empty, s.visits, s.glyph, s.verified], [false, 2, '栗', true]);
  assert.equal(s.color, theme.periods[9].color);
  const noMotif = shopStamp(shop, [{ shopId: 's', date: '2026-10-02', motif: null, verified: false }], theme);
  assert.deepEqual([noMotif.glyph, noMotif.verified], ['虎', false]);
});

test('monthMotifs: 今年その月のモチーフだけ数える・満願', () => {
  const p = theme.periods[9];
  const es = p.motifs.map((m) => ({ date: '2026-10-05', motif: m }));
  es.push({ date: '2025-09-05', motif: theme.periods[8].motifs[0] }, { date: '2025-10-05', motif: p.motifs[0] });
  assert.equal(monthMotifs(es, theme, 2026, '10').done, true);
  const r = monthMotifs([es[0], es[5], { date: '2026-10-09', motif: '自由' }], theme, 2026, '10');
  assert.deepEqual([r.count, r.total, r.done], [1, 5, false]);
  assert.equal(monthMotifs(es, theme, 2024, '10').count, 0);
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
