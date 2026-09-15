/** Web Locks on secure origins; short IndexedDB transactions provide an ordinary-HTTP fallback. */
const LEASE_MS = 120_000;
const HEARTBEAT_MS = 10_000;
let database: Promise<IDBDatabase> | undefined;
interface Lease { name: string; id: string; until: number }
export function paymentOperationID(): string {
  const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}
function openDatabase(): Promise<IDBDatabase> {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('sub2-payment-write-coordination-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('leases', { keyPath: 'name' });
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); database = undefined; }; resolve(db); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('IndexedDB upgrade is blocked'));
  }).catch(error => { database = undefined; throw error; });
  return database;
}
async function changeLease(name: string, id: string, mode: 'claim' | 'renew' | 'release'): Promise<boolean> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('leases', 'readwrite'), store = tx.objectStore('leases'), read = store.get(name);
    let changed = false;
    read.onsuccess = () => {
      const previous = read.result as Lease | undefined;
      if (mode === 'claim' ? !!previous && previous.until > Date.now() : previous?.id !== id) return;
      if (mode === 'release') store.delete(name);
      else store.put({ name, id, until: Date.now() + LEASE_MS } satisfies Lease);
      changed = true;
    };
    tx.oncomplete = () => resolve(changed);
    tx.onabort = tx.onerror = () => reject(tx.error || Error('IndexedDB lease failed'));
  });
}
const fallbackLocks: Pick<LockManager, 'request'> = {
  async request(name: string, options: LockOptions | LockGrantedCallback, callback?: LockGrantedCallback) {
    const perform = typeof options === 'function' ? options : callback!;
    const id = paymentOperationID();
    if (!await changeLease(name, id, 'claim')) return perform(null);
    // The lease only coordinates live work. Expiry NEVER removes the persistent operation marker.
    const heartbeat = setInterval(() => { void changeLease(name, id, 'renew').catch(() => {}); }, HEARTBEAT_MS);
    try { return await perform({ name, mode: 'exclusive' } as Lock); }
    finally { clearInterval(heartbeat); await changeLease(name, id, 'release').catch(() => {}); }
  }
};
export function paymentWriteLocks(): Pick<LockManager, 'request'> | undefined {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks;
  return typeof indexedDB !== 'undefined' ? fallbackLocks : undefined;
}
