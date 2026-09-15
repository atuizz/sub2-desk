// Shared in-memory browser primitives for payment regression scripts. No real storage or network.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const req = createRequire(path.join(root, 'packages/sub2-console/package.json'));
const ts = req('typescript'), vue = req('vue');
function memoryStorage() {
  const values = new Map();
  return { values, get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key), clear: () => values.clear() };
}
function memoryLocks() {
  const busy = new Set();
  return { busy, async request(name, options, fn) {
    if (busy.has(name)) return fn(null);
    busy.add(name); try { return await fn({ name }); } finally { busy.delete(name); }
  } };
}
function protection(options = {}) {
  const storage = options.storage || memoryStorage(), locks = options.locks === undefined ? memoryLocks() : options.locks;
  const unmounted = [], events = new EventTarget();
  if (!storage.getItem('auth_user')) {
    storage.setItem('auth_user', JSON.stringify({ id: options.owner || 99 }));
    storage.setItem('auth_token', options.token || 'fixture-only');
  }
  const window = { localStorage: storage, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events) };
  const modules = {}, read = name => {
    name = path.resolve(root, 'packages/sub2-console/src/utils', name);
    if (modules[name]) return modules[name];
    const exports = {};
    modules[name] = exports;
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(name + '.ts', 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText, { exports, require: module => module === 'vue' ? { ...vue, ...options.vue, onBeforeUnmount: fn => unmounted.push(fn) } : read(path.resolve(path.dirname(name), module)),
      window, localStorage:storage, TextEncoder, navigator: { locks }, crypto: require('node:crypto').webcrypto, Event, Date, console });
    modules[name] = exports; return exports;
  };
  const api = { ...read('paymentWriteJournal'), ...read('usePaymentWriteGuard') };
  return { ...api, window, storage, locks, event(key) { const e = new Event('storage'); e.key = key; window.dispatchEvent(e); },
    setIdentity(id, token = 'fixture-only') { storage.setItem('auth_user', JSON.stringify({ id })); storage.setItem('auth_token', token); },
    close() { unmounted.forEach(fn => fn()); } };
}
module.exports = { protection, memoryStorage, memoryLocks };
