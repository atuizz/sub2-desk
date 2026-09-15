import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { PAYMENT_WRITE_EVENT, PAYMENT_WRITE_PREFIX, paymentWriteJournal, type PaymentWriteMarker } from './paymentWriteJournal';
import { AUTH_LINEAGE_EVENT, AUTH_LINEAGE_KEY, storedTokenSessionID } from '../api/authTokenLineage';

/** Refresh from storage on same-page writes, other tabs and identity changes. */
export function usePaymentWriteGuard(owner: () => number | null | undefined, token: () => string | null | undefined, session: () => unknown) {
  const entries = ref<PaymentWriteMarker[]>([]), storageError = ref(''), sessionValid = ref(false), sessionIdentity = ref<string | null>(null);
  let generation = 0, disposed = false;
  function refresh() {
    entries.value = []; storageError.value = '';
    const id = owner();
    sessionValid.value = !!id && paymentWriteJournal.matchesSession(id, token());
    const identity = sessionValid.value ? storedTokenSessionID() : null;
    if (identity !== sessionIdentity.value) { generation++; sessionIdentity.value = identity; }
    if (!id) return;
    try {
      entries.value = paymentWriteJournal.list(id);
      if (!paymentWriteJournal.supported()) storageError.value = '此浏览器的多窗口操作保护不可用。请允许网站存储，或使用支持 IndexedDB 的浏览器。';
    } catch { storageError.value = '操作保护记录无法读取。请恢复浏览器存储；当前不能提交写入。'; }
    if (!sessionValid.value && !storageError.value) storageError.value = '登录身份或浏览器存储已变化，请重新登录后核对操作记录。';
  }
  function onStorage(event: StorageEvent) {
    if (event.key === null || event.key?.startsWith(PAYMENT_WRITE_PREFIX) || [AUTH_LINEAGE_KEY, 'auth_token', 'auth_user', 'refresh_token'].includes(event.key || '')) refresh();
  }
  watch([owner, token, session], (next, old) => { if (next[0] !== old?.[0] || next[2] !== old?.[2]) generation++; refresh(); }, { flush: 'sync', immediate: true });
  window.addEventListener('storage', onStorage);
  window.addEventListener(PAYMENT_WRITE_EVENT, refresh);
  window.addEventListener(AUTH_LINEAGE_EVENT, refresh);
  onBeforeUnmount(() => { disposed = true; generation++; window.removeEventListener('storage', onStorage); window.removeEventListener(PAYMENT_WRITE_EVENT, refresh); window.removeEventListener(AUTH_LINEAGE_EVENT, refresh); });
  function capture() {
    const id = owner() || 0, version = generation, identity = sessionIdentity.value;
    return { owner: id, current: () => !disposed && version === generation && owner() === id && !!identity && storedTokenSessionID() === identity && paymentWriteJournal.matchesSession(id, token()) };
  }
  const available = computed(() => sessionValid.value && !storageError.value);
  return { entries, storageError, sessionValid, sessionIdentity, available, capture, refresh, journal: paymentWriteJournal };
}
