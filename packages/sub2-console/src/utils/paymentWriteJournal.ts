/** Local duplicate-write protection, not backend idempotency. Never persist a request body. */
import { accessTokenMatchesSession } from '../api/authTokenLineage';
import { paymentOperationID, paymentWriteLocks } from './paymentWriteCoordination';
export const PAYMENT_WRITE_PREFIX = 'sub2-payment-write-v1:';
export const PAYMENT_WRITE_EVENT = 'sub2-payment-write-change';
export type PaymentWriteAction = 'refund' | 'refund-query' | 'provider-create' | 'provider-update' | 'provider-delete' | 'provider-sort';
export interface PaymentWriteMarker {
  version: 1;
  owner: number;
  scope: string;
  id: string;
  action: PaymentWriteAction;
  targets: number[];
  startedAt: number;
}
export interface PaymentWriteContext { owner: number; current: () => boolean }
export type WriteOutcome<T> = { kind: 'confirmed' | 'unknown' | 'rejected' | 'blocked' | 'stale'; value?: T; error?: unknown; message?: string };
interface JournalEnvironment {
  storage: () => Storage;
  locks: () => Pick<LockManager, 'request'> | undefined;
  id: () => string;
  notify: () => void;
  sessionMatches?: (owner: number, token: string | null | undefined) => boolean;
}
const actions: PaymentWriteAction[] = ['refund', 'refund-query', 'provider-create', 'provider-update', 'provider-delete', 'provider-sort'];
const validOwner = (id: number) => Number.isSafeInteger(id) && id > 0;
const validScope = (scope: string) => scope === 'providers' || /^refund:[1-9]\d*$/.test(scope);
const storageMessage = '无法安全保存或读取操作保护记录，已停止写入。请恢复浏览器存储后重试。';
const lockMessage = '此浏览器的多窗口操作保护不可用。请允许网站存储，或使用支持 IndexedDB 的浏览器。';
export function paymentWriteUnknown(error: unknown): boolean {
  const e = error as { status?: number; response?: { status?: number } } | null;
  const status = e?.status ?? e?.response?.status;
  return !status || status < 400 || status >= 500 || status === 408;
}
export function createPaymentWriteJournal(env: JournalEnvironment) {
  function key(owner: number, scope: string) {
    if (!validOwner(owner) || !validScope(scope)) throw Error(storageMessage);
    return `${PAYMENT_WRITE_PREFIX}${owner}:${scope}`;
  }
  function read(owner: number, scope: string): PaymentWriteMarker | null {
    const raw = env.storage().getItem(key(owner, scope));
    if (raw === null) return null;
    const value = JSON.parse(raw) as PaymentWriteMarker;
    if (!value || value.version !== 1 || value.owner !== owner || value.scope !== scope ||
      !/^[a-zA-Z0-9-]{8,80}$/.test(value.id) || !actions.includes(value.action) ||
      !Array.isArray(value.targets) || value.targets.length > 10000 || !value.targets.every(validOwner) ||
      !Number.isSafeInteger(value.startedAt) || value.startedAt <= 0 ||
      Object.keys(value).some(k => !['version', 'owner', 'scope', 'id', 'action', 'targets', 'startedAt'].includes(k))) throw Error(storageMessage);
    return value;
  }
  function list(owner: number) {
    const storage = env.storage(), prefix = `${PAYMENT_WRITE_PREFIX}${owner}:`, found: PaymentWriteMarker[] = [];
    for (let i = 0; i < storage.length; i++) {
      const name = storage.key(i);
      if (name?.startsWith(prefix)) {
        const marker = read(owner, name.slice(prefix.length));
        if (marker) found.push(marker);
      }
    }
    return found.sort((a, b) => a.startedAt - b.startedAt);
  }
  function remove(marker: PaymentWriteMarker) {
    if (read(marker.owner, marker.scope)?.id !== marker.id) return false;
    env.storage().removeItem(key(marker.owner, marker.scope));
    if (read(marker.owner, marker.scope)) throw Error(storageMessage);
    env.notify();
    return true;
  }
  function supported() { return !!env.locks()?.request; }
  async function run<T>(context: PaymentWriteContext, scope: string, action: PaymentWriteAction, targets: number[],
    request: () => Promise<T>, confirmed: (value: T) => boolean,
    options: { resume?: PaymentWriteMarker; definiteRejection?: (error: unknown) => boolean } = {}): Promise<WriteOutcome<T>> {
    if (!context.current()) return { kind: 'stale' };
    const locks = env.locks();
    if (!locks?.request) return { kind: 'blocked', message: lockMessage };
    try {
      return await locks.request(key(context.owner, scope), { ifAvailable: true }, async (lock): Promise<WriteOutcome<T>> => {
        if (!lock) return { kind: 'blocked', message: '另一窗口正在处理此操作，请等待结果后核对。' };
        if (!context.current()) return { kind: 'stale' };
        let marker = read(context.owner, scope);
        if (marker && marker.id !== options.resume?.id) return { kind: 'blocked', message: '此前操作结果尚未核对，已阻止重复提交。' };
        if (options.resume && marker?.id !== options.resume.id) return { kind: 'blocked', message: '保护记录已变化，请重新核对。' };
        if (!marker) {
          // Construct an explicit allowlist. No names, reasons, config, credentials or hashes of secrets.
          marker = { version: 1, owner: context.owner, scope, id: env.id(), action, targets: [...targets], startedAt: Date.now() };
          env.storage().setItem(key(context.owner, scope), JSON.stringify(marker));
          if (read(context.owner, scope)?.id !== marker.id) throw Error(storageMessage);
          env.notify();
        }
        if (!context.current()) { if (!options.resume) remove(marker); return { kind: 'stale' }; }
        try {
          const value = await request();
          if (!context.current()) return { kind: 'stale' };
          if (confirmed(value)) {
            if (!remove(marker)) return { kind: 'unknown', value, message: '保护记录已变化，请重新核对操作结果。' };
            return { kind: 'confirmed', value };
          }
          return { kind: 'unknown', value };
        } catch (error) {
          if (!context.current()) return { kind: 'stale' };
          // A rejected status query cannot prove that the ORIGINAL write did not execute.
          if (!options.resume && !paymentWriteUnknown(error) && (options.definiteRejection?.(error) ?? true)) {
            if (!remove(marker)) return { kind: 'unknown', error };
            return { kind: 'rejected', error };
          }
          return { kind: 'unknown', error };
        }
      });
    } catch { env.notify(); return { kind: 'blocked', message: storageMessage }; }
  }
  async function resolve(context: PaymentWriteContext, marker: PaymentWriteMarker): Promise<WriteOutcome<void>> {
    if (!context.current() || marker.owner !== context.owner) return { kind: 'stale' };
    const locks = env.locks();
    if (!locks?.request) return { kind: 'blocked', message: lockMessage };
    try {
      return await locks.request(key(context.owner, marker.scope), { ifAvailable: true }, (lock): WriteOutcome<void> => {
        if (!lock) return { kind: 'blocked', message: '操作仍在另一窗口执行，不能解除保护。' };
        if (!context.current()) return { kind: 'stale' };
        return remove(marker) ? { kind: 'confirmed' } : { kind: 'blocked', message: '保护记录已变化，请重新核对。' };
      });
    } catch { env.notify(); return { kind: 'blocked', message: storageMessage }; }
  }
  function matchesSession(owner: number, token: string | null | undefined): boolean {
    if (env.sessionMatches) return env.sessionMatches(owner, token);
    try {
      const storage = env.storage();
      return validOwner(owner) && !!token && storage.getItem('auth_token') === token && JSON.parse(storage.getItem('auth_user') || 'null')?.id === owner;
    } catch { return false; }
  }
  return { list, read, run, resolve, supported, matchesSession };
}
export const paymentWriteJournal = createPaymentWriteJournal({
  storage: () => window.localStorage,
  locks: paymentWriteLocks,
  id: paymentOperationID,
  sessionMatches: accessTokenMatchesSession,
  notify: () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(PAYMENT_WRITE_EVENT)); }
});
