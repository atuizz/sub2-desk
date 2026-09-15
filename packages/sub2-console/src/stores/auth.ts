import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { login as apiLogin, login2FA as apiLogin2FA, register as apiRegister, logout as apiLogout,
  getCurrentUser, getAuthToken, clearAuthToken, setAuthToken, persistOAuthTokenContext, isTotp2FARequired } from '@/api/auth';
import type { RegisterRequest, User, ActionCaptchaRequestProof } from '@/types';
import type { OAuthTokenResponse } from '@/api/auth';
export type UserProfile = User;

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(getAuthToken() || null), user = ref<UserProfile | null>(null);
  const isOfflineMode = ref(false), isLoading = ref(false), errorMsg = ref<string | null>(null);
  const requires2FA = ref(false), temp2FAToken = ref<string | null>(null);
  const sessionRevision = ref(0);
  const isAuthenticated = computed(() => !!token.value && !!user.value);
  const isAdmin = computed(() => isAuthenticated.value && user.value?.role === 'admin');
  let generation = 0;
  function clearSession() {
    clearAuthToken(); token.value = null; user.value = null;
    requires2FA.value = false; temp2FAToken.value = null; isOfflineMode.value = false;
    sessionRevision.value++;
  }
  // Only the current attempt may publish or clear an identity. API methods called
  // below use persist=false so a late HTTP response cannot mutate local storage.
  async function commit(response: OAuthTokenResponse & { user?: User }, current: number, signal?: AbortSignal) {
    if (current !== generation) throw new Error('登录操作已失效');
    signal?.throwIfAborted();
    if (!response.access_token?.trim()) throw new Error('登录凭证缺失，请重试');
    clearSession();
    try {
      setAuthToken(response.access_token); persistOAuthTokenContext(response);
      const me = response.user?.id ? response.user : (await getCurrentUser()).data;
      if (current !== generation) throw new Error('登录操作已失效');
      signal?.throwIfAborted();
      if (!me?.id) throw new Error('账户信息读取失败，请重新登录');
      localStorage.setItem('auth_user', JSON.stringify(me));
      user.value = me as User; token.value = response.access_token;
    } catch (error) { if (current === generation) clearSession(); throw error; }
  }
  async function acceptExternalSession(response: OAuthTokenResponse, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const current = ++generation; isLoading.value = true;
    try { await commit({ ...response, user: undefined }, current, signal); }
    finally { if (current === generation) isLoading.value = false; }
  }
  async function initAuth(options: { redirectOnFailure?: boolean } = {}) {
    const current = ++generation, saved = getAuthToken();
    if (!saved || saved.startsWith('mock-')) { clearSession(); isLoading.value = false; return; }
    isLoading.value = true;
    try {
      const response = await getCurrentUser(options);
      const { data } = response;
      // Axios keeps the headers of the successful retry. A refreshed /auth/me
      // belongs to that token; a late response from a replaced session does not.
      const header = response.config?.headers?.Authorization;
      const verifiedToken = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : saved;
      if (current !== generation || getAuthToken() !== verifiedToken) return;
      if (!data?.id) throw new Error('账户信息读取失败');
      localStorage.setItem('auth_user', JSON.stringify(data));
      user.value = data as User; token.value = verifiedToken; isOfflineMode.value = false;
    } catch { if (current === generation && (!getAuthToken() || getAuthToken() === saved)) clearSession(); }
    finally { if (current === generation) isLoading.value = false; }
  }
  function failure(error: unknown, fallback: string) {
    const e = error as { code?: string | number; status?: number; message?: string };
    if (e?.code === 'ERR_NETWORK' || e?.message?.includes('Network Error')) return '无法连接到 Sub2API 后端服务，请检查站点连接后重试。';
    if (e?.status && e.status >= 500) return 'Sub2API 后端暂时无法处理登录请求，请稍后重试。';
    if (e?.status === 429 || e?.code === 429) return '请求过于频繁，请稍后再试。';
    return e?.message || fallback;
  }
  async function login(account: string, password: string, proof: ActionCaptchaRequestProof = {}): Promise<{ success: boolean; requires2FA?: boolean; message?: string }> {
    if (isLoading.value) return { success: false };
    const current = ++generation; clearSession(); isLoading.value = true; errorMsg.value = null;
    try {
      const response = await apiLogin({ email: account, password, ...proof }, false);
      if (current !== generation) return { success: false };
      if (isTotp2FARequired(response)) {
        if (!response.temp_token?.trim()) throw new Error('二次验证凭证缺失，请重新登录');
        requires2FA.value = true; temp2FAToken.value = response.temp_token;
        return { success: false, requires2FA: true };
      }
      await commit(response, current);
      return { success: true };
    } catch (e) {
      if (current !== generation) return { success: false };
      errorMsg.value = failure(e, '用户名或密码错误，请重试'); return { success: false, message: errorMsg.value };
    } finally { if (current === generation) isLoading.value = false; }
  }
  async function verify2FA(code: string): Promise<{ success: boolean; message?: string }> {
    if (isLoading.value) return { success: false };
    if (!temp2FAToken.value || !/^\d{6}$/.test(code)) {
      errorMsg.value = !temp2FAToken.value ? '二次验证凭证缺失，请返回登录后重试' : '请输入 6 位数字验证码';
      return { success: false, message: errorMsg.value };
    }
    const current = ++generation; isLoading.value = true; errorMsg.value = null;
    try {
      const response = await apiLogin2FA({ temp_token: temp2FAToken.value, totp_code: code }, false);
      if (current !== generation) return { success: false };
      await commit(response, current); return { success: true };
    } catch (e) {
      if (current !== generation) return { success: false };
      errorMsg.value = failure(e, '验证码错误，请重新输入'); return { success: false, message: errorMsg.value };
    } finally { if (current === generation) isLoading.value = false; }
  }
  async function register(data: RegisterRequest): Promise<{ success: boolean; message?: string }> {
    if (isLoading.value) return { success: false };
    const current = ++generation; clearSession(); isLoading.value = true; errorMsg.value = null;
    try {
      const response = await apiRegister(data, false);
      if (current !== generation) return { success: false };
      await commit(response, current); return { success: true };
    } catch (e) {
      if (current !== generation) return { success: false };
      errorMsg.value = failure(e, '注册失败，请检查填写内容'); return { success: false, message: errorMsg.value };
    } finally { if (current === generation) isLoading.value = false; }
  }
  async function logout() {
    ++generation;
    // Capture the old refresh token before synchronously clearing local state.
    const revoke = apiLogout(false);
    clearSession(); isLoading.value = false; errorMsg.value = null;
    try { await revoke; } catch { /* Remote revocation cannot restore local state. */ }
  }
  function updateBalance(newBalance: number) { if (user.value) user.value.balance = newBalance; }
  return { token, user, sessionRevision, isAuthenticated, isAdmin, isOfflineMode, isLoading, errorMsg, requires2FA, temp2FAToken,
    initAuth, acceptExternalSession, fetchCurrentUser: initAuth, login, verify2FA, register, logout, updateBalance };
});
