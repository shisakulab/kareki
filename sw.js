// キャッシュ優先。ファイルを変えたら VERSION を上げる
// Leaflet は vendor/ に同梱。地図タイルはキャッシュしない。data/shops/ は取得時にキャッシュ
const VERSION = 'kareki-v10';
const FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './db.js',
  './logic.js',
  './themes/jonamagashi.js',
  './vendor/leaflet.css',
  './vendor/leaflet.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // 店のデータ（data/shops/）は、取得したときにキャッシュする
  if (url.origin === self.location.origin && url.pathname.includes('/data/shops/')) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
