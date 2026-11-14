// Saved swings (pictures + body outline + results) in the phone's browser
// storage (IndexedDB). Keeps the most recent swings only.

const DB = 'golfsim', STORE = 'swings', KEEP = 25;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    } catch (e) { reject(e); }
  });
  return dbp;
}
function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const st = t.objectStore(STORE);
    let out;
    Promise.resolve(fn(st)).then((v) => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function saveSwing(rec) {
  await tx('readwrite', (st) => { st.put(rec); });
  // trim to the newest KEEP
  const keys = await tx('readonly', (st) => req(st.getAllKeys()));
  if (keys.length > KEEP) {
    const old = keys.sort((a, b) => a - b).slice(0, keys.length - KEEP);
    await tx('readwrite', (st) => { for (const k of old) st.delete(k); });
  }
}
// list without the pictures (fast)
export async function listSwings() {
  const all = await tx('readonly', (st) => req(st.getAll()));
  return all.map((r) => ({ ...r, frames: undefined, nFrames: r.frames ? r.frames.length : 0 })).sort((a, b) => b.id - a.id);
}
export async function getSwing(id) { return tx('readonly', (st) => req(st.get(id))); }
export async function deleteSwing(id) { return tx('readwrite', (st) => { st.delete(id); }); }
