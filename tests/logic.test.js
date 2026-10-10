import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthKeyOf, yearSummary, motifProgress, canonicalMotif, distanceMeters, isVerified,
  groupByDay, clampScore, shopStats, sortShopsByDistance, fitSize, shopStamp, monthMotifs,
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
