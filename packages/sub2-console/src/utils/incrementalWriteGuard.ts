/** Incremental writes share payment's lock/session primitives, but have independent records.
 * No request body, notes, token or financial snapshot is persisted. No automatic replay.
 */
import { computed, ref, watch } from 'vue';
import { useAuthStore } from '../stores/auth';
import { paymentOperationID, paymentWriteLocks } from './paymentWriteCoordination';
import { paymentWriteUnknown } from './paymentWriteJournal';
import { accessTokenMatchesSession, storedTokenSessionID, AUTH_LINEAGE_EVENT } from '../api/authTokenLineage';

export const INCREMENTAL_WRITE_PREFIX = 'sub2-incremental-write-v1:';
export const INCREMENTAL_WRITE_EVENT = 'sub2-incremental-write-change';
type Kind = 'balance' | 'subscription';
interface Marker { version: 1; owner: number; target: number; kind: Kind; id: string; startedAt: number }
interface Context { owner: number; current: () => boolean }
interface Environment {
  storage: () => Storage;
  locks: typeof paymentWriteLocks;
  id: () => string;
  notify: () => void;
}
const validID = (id: number) => Number.isSafeInteger(id) && id > 0;
const blocked = '此前操作结果尚未核对，已阻止重复提交。请读取当前结果并核对后再开始新操作。';
const storageError = '操作保护存储不可用，已停止写入。请恢复网站存储后重试。';

export function createIncrementalWriteJournal(env: Environment) {
  // Proof is deliberately ephemeral: closing/reloading requires a fresh successful read.
  const proofs = new WeakMap<object, { marker: Marker; context: Context }>();
  function key(owner: number, kind: Kind, target: number) {
    if (!validID(owner) || !validID(target) || !['balance', 'subscription'].includes(kind)) throw Error(storageError);
    return `${INCREMENTAL_WRITE_PREFIX}${owner}:${kind}:${target}`;
  }
  function read(owner: number, kind: Kind, target: number): Marker | null {
    const raw = env.storage().getItem(key(owner, kind, target));
    if (raw === null) return null;
    const m = JSON.parse(raw) as Marker;
    if (!m || m.version !== 1 || m.owner !== owner || m.kind !== kind || m.target !== target ||
      typeof m.id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(m.id) ||
      !Number.isSafeInteger(m.startedAt) || m.startedAt <= 0 ||
      Object.keys(m).some(k => !['version', 'owner', 'target', 'kind', 'id', 'startedAt'].includes(k))) throw Error(storageError);
    return m;
  }
  function remove(m: Marker) {
    if (read(m.owner, m.kind, m.target)?.id !== m.id) throw Error('保护记录已变化，请重新读取核对。');
    env.storage().removeItem(key(m.owner, m.kind, m.target));
    if (read(m.owner, m.kind, m.target)) throw Error(storageError);
    env.notify();
  }
  async function locked<T>(c: Context, kind: Kind, target: number, work: () => Promise<T>): Promise<T> {
    if (!c.current()) throw Error('登录身份已变化，请重新打开操作窗口。');
    const locks = env.locks();
    if (!locks) throw Error(storageError);
    return locks.request(key(c.owner, kind, target), { ifAvailable: true }, async lock => {
      if (!lock) throw Error('另一窗口仍在处理此操作，请等待后重新核对。');
      if (!c.current()) throw Error('登录身份已变化，请重新打开操作窗口。');
      return work();
    });
  }
  async function run<T>(c: Context, kind: Kind, target: number, request: (id: string) => Promise<T>, valid: (value: T) => boolean): Promise<T> {
    return locked(c, kind, target, async () => {
      if (read(c.owner, kind, target)) throw Error(blocked);
      const marker: Marker = { version: 1, owner: c.owner, kind, target, id: env.id(), startedAt: Date.now() };
      env.storage().setItem(key(c.owner, kind, target), JSON.stringify(marker));
      if (read(c.owner, kind, target)?.id !== marker.id) throw Error(storageError);
      env.notify();
      if (!c.current()) throw Error('登录身份已变化，操作保护已保留。');
      let value: T;
      try { value = await request(marker.id); }
      catch (error) {
        const e = error as { status?: number; response?: { status?: number } };
        const status = e?.status ?? e?.response?.status;
        // 409 may mean processing/key conflict; never clear it as an ordinary refusal.
        if (c.current() && !paymentWriteUnknown(error) && status !== 409 && [400, 401, 403, 404, 422, 429].includes(status!)) {
          remove(marker); throw error;
        }
        throw Error(blocked);
      }
      if (!c.current()) throw Error('登录身份已变化，操作保护已保留。');
      if (!valid(value)) throw Error(blocked);
      remove(marker);
      return value;
    });
  }
  async function inspect<T>(c: Context, kind: Kind, target: number, request: () => Promise<T>, valid: (v: T) => boolean) {
    return locked(c, kind, target, async () => {
      const marker = read(c.owner, kind, target);
      if (!marker) throw Error('没有待核对记录，请重新打开操作窗口。');
      const value = await request();
      if (!c.current() || read(c.owner, kind, target)?.id !== marker.id || !valid(value)) throw Error('读取结果无效或身份已变化，保护仍保留。');
      const proof = {};
      proofs.set(proof, { marker, context: c });
      return { value, proof };
    });
  }
  async function acknowledge(c: Context, proof: object) {
    const entry = proofs.get(proof);
    if (!entry || entry.marker.owner !== c.owner || !entry.context.current()) throw Error('请先重新读取当前结果，再确认核对。');
    const m = entry.marker;
    await locked(c, m.kind, m.target, async () => {
      if (!entry.context.current()) throw Error('核对已失效，请重新读取。');
      remove(m); proofs.delete(proof);
    });
  }
  return { read, run, inspect, acknowledge };
}

export const incrementalWriteJournal = createIncrementalWriteJournal({
  storage: () => window.localStorage, locks: paymentWriteLocks, id: paymentOperationID,
  notify: () => window.dispatchEvent(new Event(INCREMENTAL_WRITE_EVENT))
});

/** API enforcement works even when no component is mounted. Refresh rotation keeps lineage. */
export function captureIncrementalOwner(expected?: { owner: number; token: string | null }): Context {
  let owner = 0, token: string | null = null, session: string | null = null;
  try {
    owner = expected?.owner ?? (JSON.parse(localStorage.getItem('auth_user') || 'null')?.id || 0);
    token = expected ? expected.token : localStorage.getItem('auth_token'); session = storedTokenSessionID();
  } catch { /* Fail closed below. */ }
  return { owner, current: () => validID(owner) && !!session && storedTokenSessionID() === session && accessTokenMatchesSession(owner, token) };
}

/** Presentation adapter: fresh target read + explicit acknowledgement, never a write retry. */
export function createIncrementalWriteGuard<T>(kind: Kind, get: (id: number) => Promise<T>, valid: (v: T, id: number) => boolean,
  describe: (value: T) => string) {
  const auth = useAuthStore();
  const target = ref<number | null>(null), pending = ref(false), error = ref(''), busy = ref(false), snapshot = ref('');
  let generation = 0, disposed = false, proof: object | null = null;
  function capture() {
    const base = captureIncrementalOwner(), version = generation, revision = auth.sessionRevision, id = target.value;
    return { owner: base.owner, current: () => !disposed && version === generation && revision === auth.sessionRevision &&
      auth.user?.id === base.owner && auth.isAdmin && id !== null && target.value === id && base.current() };
  }
  function refresh() {
    pending.value = false; error.value = '';
    if (!target.value) return;
    try {
      const c = capture();
      if (!c.current()) throw Error('登录身份已变化，请重新打开操作窗口。');
      pending.value = !!incrementalWriteJournal.read(c.owner, kind, target.value);
      if (!paymentWriteLocks()) throw Error(storageError);
    } catch (e) { error.value = e instanceof Error ? e.message : storageError; }
  }
  function reset(id: number | null = null) {
    generation++; proof = null; snapshot.value = ''; busy.value = false; target.value = id; refresh();
  }
  function changed() { proof = null; snapshot.value = ''; refresh(); }
  const stop = watch(() => [auth.user?.id, auth.sessionRevision], () => reset(), { flush: 'sync' });
  window.addEventListener('storage', changed);
  window.addEventListener(INCREMENTAL_WRITE_EVENT, changed);
  window.addEventListener(AUTH_LINEAGE_EVENT, refresh);
  function dispose() {
    disposed = true; reset(); stop(); window.removeEventListener('storage', changed);
    window.removeEventListener(INCREMENTAL_WRITE_EVENT, changed); window.removeEventListener(AUTH_LINEAGE_EVENT, refresh);
  }
  async function inspect() {
    if (!target.value || busy.value) return;
    const c = capture(), id = target.value;
    proof = null; snapshot.value = ''; error.value = ''; busy.value = true;
    try {
      const result = await incrementalWriteJournal.inspect(c, kind, id, () => get(id), v => valid(v, id));
      if (!c.current()) return;
      proof = result.proof; snapshot.value = describe(result.value);
    } catch (e) { if (c.current()) error.value = e instanceof Error ? e.message : '读取失败，操作保护仍保留。'; }
    finally { if (c.current()) busy.value = false; }
  }
  async function acknowledge() {
    if (!proof || busy.value) return false;
    const c = capture(); busy.value = true;
    try {
      await incrementalWriteJournal.acknowledge(c, proof);
      if (!c.current()) return false;
      reset(); return true;
    } catch (e) { if (c.current()) { proof = null; snapshot.value = ''; error.value = e instanceof Error ? e.message : storageError; } return false; }
    finally { if (c.current()) busy.value = false; }
  }
  return { pending, error, busy, snapshot, blocked: computed(() => !target.value || pending.value || !!error.value || busy.value),
    canAcknowledge: computed(() => !!snapshot.value && !busy.value), reset, refresh, capture, inspect, acknowledge, dispose };
}
