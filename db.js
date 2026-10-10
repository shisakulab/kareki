// IndexedDB `kareki`：shops / entries / photos / visits
const NAME = 'kareki';
const STORES = ['shops', 'entries', 'photos', 'visits'];
const VERSION = 2; // 2：visits（立ち寄り）を追加

let dbPromise = null;

export function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        // 既にあるストアは触らない（古いバージョンのデータを残す）
        for (const s of STORES) {
          if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const result = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(result.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const getAll = (store) => run(store, 'readonly', (s) => s.getAll());
export const get = (store, id) => run(store, 'readonly', (s) => s.get(id));
export const put = (store, value) => run(store, 'readwrite', (s) => s.put(value));
export const remove = (store, id) => run(store, 'readwrite', (s) => s.delete(id));
export const clear = (store) => run(store, 'readwrite', (s) => s.clear());

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

const blobToDataURL = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

const dataURLToBlob = async (url) => (await fetch(url)).blob();

// 写真を base64 で含めた1つの JSON
export async function exportAll() {
  const [shops, entries, photos, visits] = await Promise.all(STORES.map(getAll));
  const photoData = [];
  for (const p of photos) photoData.push({ id: p.id, data: await blobToDataURL(p.blob) });
  return { app: 'kareki', version: 2, exportedAt: new Date().toISOString(), shops, entries, visits, photos: photoData };
}

// 同じ id は上書き、それ以外は残す
export async function importAll(json) {
  if (!json || json.app !== 'kareki' || !Array.isArray(json.shops) || !Array.isArray(json.entries)) {
    throw new Error('菓暦のデータではありません');
  }
  for (const s of json.shops) await put('shops', s);
  for (const e of json.entries) await put('entries', e);
  for (const v of json.visits || []) await put('visits', v); // v1 の書き出しには無い
  for (const p of json.photos || []) {
    // 画像の data URL だけを受け付ける（それ以外の URL を読みに行かない）
    if (typeof p.data !== 'string' || !/^data:image\/(jpeg|png|webp|gif);base64,/.test(p.data)) continue;
    await put('photos', { id: p.id, blob: await dataURLToBlob(p.data) });
  }
}

export async function clearAll() {
  for (const s of STORES) await clear(s);
}
