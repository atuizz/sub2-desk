<script setup lang="ts">
import './app-polish.css';
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { MacSheet } from '@sub2-mac/core';
import type { WindowInstance } from '@sub2-mac/core';
import { getPublicSettings } from '../../api/auth';
import { mcpAPI } from '../../api/mcp';
import { useStepUp, isStepUpCancelled, isStepUpBlocked, stepUpBlockReason } from '../../composables/useStepUp';
import TotpStepUpSheet from '../../components/auth/TotpStepUpSheet.vue';
import type { MCPGrant, MCPAuthorization, MCPConsent, MCPAccessScope } from '@/types';
import { useAuthStore } from '@/stores/auth';

const props = defineProps<{ win?: WindowInstance }>();
const auth = useAuthStore();
const stepUp = useStepUp();

const INVALID_REQUEST = '授权请求无效或不完整，尚未授予任何访问权限。';
const INVALID_REDIRECT = '服务器返回了非预期的地址，请从客户端重新发起连接。';

/** 解析并校验授权请求 query；任一不合规即抛错（上游 MCPOAuthAuthorizeView 照抄）。 */
function parseMcpAuthorization(query: Record<string, unknown>): MCPAuthorization {
  const required = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'resource'] as const;
  const allowed = [...required, 'scope', 'state'];
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key) || typeof value !== 'string' || value.length > 4096) {
      throw new Error(INVALID_REQUEST);
    }
    values[key] = value;
  }
  if (required.some(key => !values[key]) || values.response_type !== 'code'
    || values.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(values.code_challenge || '')
    || (values.scope !== undefined && values.scope !== '' && values.scope !== 'mcp')) {
    throw new Error(INVALID_REQUEST);
  }
  return values as unknown as MCPAuthorization;
}

/** 校验 preview 返回与请求一致，且 redirect_uri 合法。 */
function validateMcpPreview(result: MCPConsent, request: MCPAuthorization): void {
  if (result.client_id !== request.client_id || result.redirect_uri !== request.redirect_uri
    || result.resource !== request.resource || result.scope !== 'mcp' || typeof result.client_name !== 'string') {
    throw new Error(INVALID_REQUEST);
  }
  let redirect: URL;
  try {
    redirect = new URL(result.redirect_uri);
  } catch {
    throw new Error(INVALID_REQUEST);
  }
  if (!['https:', 'http:'].includes(redirect.protocol) || redirect.username || redirect.password || redirect.hash) {
    throw new Error(INVALID_REQUEST);
  }
}

/** 校验 authorize 返回的 redirect_url 与请求地址同 origin + pathname，且无凭据/hash。 */
function validateMcpRedirect(redirectUrl: string, expectedRedirectUri: string): void {
  let destination: URL;
  let expected: URL;
  try {
    destination = new URL(redirectUrl);
    expected = new URL(expectedRedirectUri);
  } catch {
    throw new Error(INVALID_REDIRECT);
  }
  if (destination.origin !== expected.origin || destination.pathname !== expected.pathname
    || destination.username || destination.password || destination.hash) {
    throw new Error(INVALID_REDIRECT);
  }
}

function isGrantActive(grant: MCPGrant): boolean {
  return !grant.revoked_at && !grant.invalidated && new Date(grant.expires_at).getTime() > Date.now();
}

function grantStatusText(grant: MCPGrant): string {
  if (grant.revoked_at) return '已撤销';
  if (grant.invalidated) return '已失效（账户权限或密码已变更）';
  return isGrantActive(grant) ? '有效' : '已过期';
}

function formatDateTime(dtStr?: string | null): string {
  if (!dtStr) return '-';
  const d = new Date(dtStr);
  if (isNaN(d.getTime())) return dtStr;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function errorText(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message || fallback;
  }
  return fallback;
}

// ---- 入口门控：mcp_enabled（PublicSettings 已含该字段，见 types/index.ts）----
const settingsLoading = ref(false);
const settingsError = ref('');
const mcpEnabled = ref<boolean | null>(null);
const serverDisabled = ref(false);

const endpoint = ref('');
const connectionLoading = ref(false);
const connectionError = ref('');
const grants = ref<MCPGrant[]>([]);
const grantsLoading = ref(false);
const grantsError = ref('');
const notice = ref('');
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

function showNotice(msg: string) {
  notice.value = msg;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.value = ''; }, 3000);
}

async function loadSettings(): Promise<void> {
  if (settingsLoading.value) return;
  settingsLoading.value = true;
  settingsError.value = '';
  try {
    const pub = await getPublicSettings();
    mcpEnabled.value = pub.mcp_enabled === true;
    if (mcpEnabled.value) {
      void loadConnection();
      void loadGrants();
    }
  } catch (err) {
    settingsError.value = errorText(err, '公开设置加载失败，请重试。');
    mcpEnabled.value = null;
  } finally {
    settingsLoading.value = false;
  }
}

async function loadConnection(): Promise<void> {
  if (connectionLoading.value) return;
  connectionLoading.value = true;
  connectionError.value = '';
  endpoint.value = '';
  try {
    const result = await mcpAPI.getConnectionConfig();
    endpoint.value = result.resource;
  } catch (err) {
    // 服务端未配置 MCP_PUBLIC_URL 时接口返回 503：按“未启用”处理，不展示连接入口。
    if ((err as { status?: number })?.status === 503) {
      serverDisabled.value = true;
      return;
    }
    connectionError.value = errorText(err, '无法加载 MCP 服务地址，请重试。');
  } finally {
    connectionLoading.value = false;
  }
}

async function loadGrants(): Promise<void> {
  if (grantsLoading.value) return;
  grantsLoading.value = true;
  grantsError.value = '';
  try {
    grants.value = await mcpAPI.listGrants();
  } catch (err) {
    if ((err as { status?: number })?.status === 503) {
      serverDisabled.value = true;
      return;
    }
    grantsError.value = errorText(err, '加载已授权应用失败，请重试。');
  } finally {
    grantsLoading.value = false;
  }
}

async function copyEndpoint(): Promise<void> {
  if (!endpoint.value) return;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(endpoint.value);
      showNotice('服务地址已复制');
    } else {
      throw new Error('clipboard unavailable');
    }
  } catch {
    showNotice('复制失败，请手动复制服务地址');
  }
}

// ---- 撤销授权 ----
const revokeTarget = ref<MCPGrant | null>(null);
const revoking = ref(false);
const revokeError = ref('');

function closeRevoke(): void {
  if (revoking.value) return;
  revokeTarget.value = null;
  revokeError.value = '';
}

async function revokeGrant(): Promise<void> {
  if (!revokeTarget.value || revoking.value || grantsLoading.value) return;
  revoking.value = true;
  revokeError.value = '';
  const id = revokeTarget.value.id;
  try {
    await mcpAPI.revokeGrant(id);
    grants.value = grants.value.map(grant => grant.id === id ? { ...grant, revoked_at: new Date().toISOString() } : grant);
    revokeTarget.value = null;
    showNotice('应用授权已撤销');
  } catch (err) {
    revokeError.value = errorText(err, '撤销应用授权失败。');
  } finally {
    revoking.value = false;
  }
}

// ---- 授权确认（MacSheet 承载；desk 无独立全屏授权路由页先例）----
const consentOpen = ref(false);
const consentLoading = ref(false);
const previewError = ref('');
const consent = ref<MCPConsent | null>(null);
const consentScope = ref<MCPAccessScope>('user');
const consentReadOnly = ref(true);
const consentSubmitting = ref(false);
const submitError = ref('');
let authorization: MCPAuthorization | null = null;
let consentGeneration = 0;

const redirectOrigin = computed(() => {
  if (!consent.value) return '';
  try {
    return new URL(consent.value.redirect_uri).origin;
  } catch {
    return '';
  }
});

/** 平台管理范围的批准走通用 TOTP step-up（上游 MCPOAuthAuthorizeView 同款流程）。 */
async function openMcpAuthorization(query: Record<string, unknown>): Promise<void> {
  const current = ++consentGeneration;
  consentOpen.value = true;
  consentLoading.value = true;
  previewError.value = '';
  submitError.value = '';
  consent.value = null;
  authorization = null;
  consentScope.value = 'user';
  consentReadOnly.value = true;
  try {
    const request = parseMcpAuthorization(query);
    const result = await mcpAPI.previewAuthorization({ ...request });
    if (current !== consentGeneration) return;
    validateMcpPreview(result, request);
    authorization = Object.freeze({ ...request });
    consent.value = result;
  } catch (err) {
    if (current === consentGeneration) previewError.value = errorText(err, '无法验证此授权请求。');
  } finally {
    if (current === consentGeneration) consentLoading.value = false;
  }
}

function closeConsent(): void {
  if (consentSubmitting.value) return;
  consentGeneration++;
  stepUp.onCancel();
  consentOpen.value = false;
  consent.value = null;
  authorization = null;
  previewError.value = '';
  submitError.value = '';
}

async function decideAuthorization(approved: boolean): Promise<void> {
  if (consentLoading.value || consentSubmitting.value || !consent.value || !authorization) return;
  const current = consentGeneration;
  const expectedRedirect = consent.value.redirect_uri;
  const input = {
    authorization: { ...authorization },
    approved,
    scope: approved && auth.isAdmin ? consentScope.value : 'user' as const,
    read_only: approved ? consentReadOnly.value : true
  };
  consentSubmitting.value = true;
  submitError.value = '';
  try {
    // 与上游一致：仅批准平台管理范围时走 step-up；后端在需要时返回
    // STEP_UP_REQUIRED（写操作始终强制，读操作仅在全局开关开启时强制），
    // 未开启 TOTP 或机器凭证时返回可区分的拦截码，不弹验证框。
    const action = async () => {
      // 已关闭/换代的确认单不重试，避免把旧授权发给新请求。
      if (current !== consentGeneration) throw new Error(INVALID_REQUEST);
      try {
        return await mcpAPI.authorize(input);
      } catch (err) {
        if (current !== consentGeneration) throw new Error(INVALID_REQUEST);
        throw err;
      }
    };
    const result = approved && input.scope === 'admin' ? await stepUp.run(action) : await action();
    if (current !== consentGeneration) return;
    validateMcpRedirect(result.redirect_url, expectedRedirect);
    window.location.assign(result.redirect_url);
    // 正常情况下页面随即跳转；若跳转未发生（被拦截/测试环境），恢复可操作状态，避免表单卡死。
    consentSubmitting.value = false;
  } catch (err) {
    if (current !== consentGeneration) return;
    if (isStepUpCancelled(err)) {
      // 用户取消了两步验证：静默恢复，不当作错误提示。
      submitError.value = '';
    } else if (isStepUpBlocked(err)) {
      submitError.value = stepUpBlockReason(err) === 'STEP_UP_ADMIN_API_KEY_FORBIDDEN'
        ? '当前使用管理员密钥登录，无法完成两步验证，平台管理范围无法批准。请改用浏览器账号登录后再试。'
        : '平台管理范围的授权需要你已开启两步验证（TOTP）。请先在“系统设置 → 安全”中开启两步验证，再重新发起授权。';
    } else {
      submitError.value = errorText(err, '无法完成授权，请重试。');
    }
    consentSubmitting.value = false;
  }
}

/** 从窗口 customData 取深链带来的授权 query；窗口已打开时深链会更新 customData，watch 会再次触发。 */
function maybeOpenMcpAuthorization(): void {
  const query = (props.win as unknown as { customData?: { mcp_authorize?: Record<string, unknown> } } | undefined)?.customData?.mcp_authorize;
  if (query && typeof query === 'object' && mcpEnabled.value) void openMcpAuthorization(query);
}

watch(() => {
  const query = (props.win as unknown as { customData?: { mcp_authorize?: Record<string, unknown> } } | undefined)?.customData?.mcp_authorize;
  return query ? JSON.stringify(query) : '';
}, (key) => {
  if (key) maybeOpenMcpAuthorization();
});

onMounted(() => {
  void loadSettings().then(() => {
    maybeOpenMcpAuthorization();
  });
});
onBeforeUnmount(() => {
  consentGeneration++;
  if (noticeTimer) clearTimeout(noticeTimer);
});
</script>

<template>
  <div class="user-app-polish mcp-workspace flex flex-col h-full select-none overflow-y-auto">
    <div class="p-4 sm:p-5 space-y-4 max-w-3xl w-full mx-auto">
      <div>
        <span class="workspace-eyebrow">开发与调用</span><h1 class="text-[17px] font-bold text-[var(--text-primary)] leading-tight">MCP 接入</h1>
        <p class="text-[11.5px] text-[var(--text-tertiary)] mt-0.5">通过 OAuth 连接 AI 助手，并管理它对你账户的访问权限。</p>
      </div>

      <p v-if="notice" role="status" class="text-xs px-3 py-2 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">{{ notice }}</p>

      <!-- 设置加载中 / 失败 -->
      <div v-if="settingsLoading" role="status" class="py-10 text-center text-sm text-[var(--text-tertiary)]">正在加载…</div>
      <div v-else-if="settingsError" class="rounded-xl border border-[var(--border-color)] p-4 space-y-3">
        <p role="alert" class="text-sm text-red-600 dark:text-red-400">{{ settingsError }}</p>
        <button type="button" class="px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] text-xs text-[var(--text-secondary)]" @click="loadSettings">重试</button>
      </div>

      <!-- MCP 未启用：隐藏入口（不显示禁用态、不调任何 MCP 接口） -->
      <div v-else-if="mcpEnabled === false || serverDisabled" class="rounded-xl border border-dashed border-[var(--border-color)] px-4 py-10 text-center">
        <h2 class="text-[14px] font-semibold text-[var(--text-primary)] mb-1">MCP 未启用</h2>
        <p class="text-xs text-[var(--text-tertiary)] leading-relaxed max-w-sm mx-auto">当前部署未配置 MCP 服务地址，MCP 接入处于关闭状态。配置 MCP_PUBLIC_URL 后才可连接 AI 助手。</p>
      </div>

      <template v-else-if="mcpEnabled === true">
        <!-- 连接卡片 -->
        <section class="rounded-xl border border-[var(--border-color)] bg-[var(--content-bg)] p-4 sm:p-5" :aria-busy="connectionLoading">
          <h2 class="text-[15px] font-semibold text-[var(--text-primary)]">连接你的 AI 助手</h2>
          <p class="mt-1 text-xs text-[var(--text-tertiary)]">请使用支持 Streamable HTTP 远程 MCP 和 OAuth 登录的客户端。</p>
          <div class="mt-4">
            <label for="mcp-endpoint" class="block text-xs font-medium text-[var(--text-secondary)] mb-1">服务地址</label>
            <div class="flex flex-col gap-2 sm:flex-row">
              <input
                id="mcp-endpoint"
                :value="endpoint"
                :placeholder="connectionLoading ? '正在加载服务地址…' : ''"
                readonly
                class="min-w-0 flex-1 px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] font-mono text-xs focus:outline-none"
              />
              <button
                type="button"
                :disabled="!endpoint || connectionLoading"
                class="shrink-0 px-3.5 py-1.5 rounded-[6px] border border-[var(--border-color)] text-xs font-medium text-[var(--text-secondary)] disabled:opacity-40"
                @click="copyEndpoint"
              >
                复制地址
              </button>
            </div>
            <div v-if="connectionError" class="mt-3 flex flex-wrap items-center gap-3">
              <p role="alert" class="text-xs text-red-600 dark:text-red-400">{{ connectionError }}</p>
              <button type="button" :disabled="connectionLoading" class="px-3 py-1 rounded-[6px] border border-[var(--border-color)] text-xs disabled:opacity-40" @click="loadConnection">刷新</button>
            </div>
            <ol class="mt-4 list-decimal space-y-1.5 pl-5 text-xs text-[var(--text-secondary)] leading-relaxed">
              <li>在 AI 客户端中添加远程 MCP 服务，并填写此服务地址。</li>
              <li>选择连接或登录，客户端会在浏览器中打开本平台。</li>
              <li>登录后核对应用及返回地址，选择访问范围和操作权限，再确认授权。</li>
            </ol>
          </div>
          <p class="mt-4 border-t border-[var(--border-color)] pt-3 text-xs text-[var(--text-tertiary)] leading-relaxed">个人权限可查看余额、用量和订阅，并管理自己的 API 密钥。管理员权限还可管理用户、分组和上游账号。实际可用工具由你批准的权限决定。</p>
        </section>

        <!-- 已授权应用 -->
        <section class="rounded-xl border border-[var(--border-color)] bg-[var(--content-bg)]">
          <div class="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-color)] p-4 sm:p-5">
            <div class="min-w-0">
              <h2 class="text-[15px] font-semibold text-[var(--text-primary)]">已授权应用</h2>
              <p class="mt-1 text-xs text-[var(--text-tertiary)] leading-relaxed">查看你已连接的应用。撤销授权后应用将失去访问权限；如需再次连接，请从客户端重新发起授权。</p>
            </div>
            <button
              type="button"
              :disabled="grantsLoading || revoking"
              class="shrink-0 px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] text-xs font-medium text-[var(--text-secondary)] disabled:opacity-40"
              @click="loadGrants"
            >
              刷新
            </button>
          </div>
          <div class="p-4 sm:p-5" :aria-busy="grantsLoading">
            <p v-if="grantsError" role="alert" class="text-xs text-red-600 dark:text-red-400">{{ grantsError }}</p>
            <p v-else-if="grantsLoading" role="status" class="py-8 text-center text-xs text-[var(--text-tertiary)]">正在加载已授权应用…</p>
            <p v-else-if="grants.length === 0" class="rounded-xl border border-dashed border-[var(--border-color)] px-4 py-10 text-center text-xs text-[var(--text-tertiary)]">尚未授权任何应用。请在 AI 客户端中使用上方服务地址发起连接。</p>
            <ul v-else class="divide-y divide-[var(--border-color)]">
              <li v-for="grant in grants" :key="grant.id" class="flex items-start justify-between gap-3 py-4 first:pt-0 last:pb-0">
                <div class="min-w-0 space-y-1.5">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="break-all font-medium text-[13px] text-[var(--text-primary)]">{{ grant.client_name }}</span>
                    <span class="rounded-md bg-black/5 dark:bg-white/10 px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">{{ grant.scope === 'admin' ? '平台管理' : '个人账户' }}</span>
                    <span class="rounded-md bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-600 dark:text-blue-400">{{ grant.read_only ? '只读' : '允许修改' }}</span>
                    <span class="text-[11px]" :class="isGrantActive(grant) ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--text-tertiary)]'">{{ grantStatusText(grant) }}</span>
                  </div>
                  <p class="truncate font-mono text-[11px] text-[var(--text-tertiary)]" :title="grant.client_id">{{ grant.client_id }}</p>
                  <div class="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
                    <span>授权于 {{ formatDateTime(grant.created_at) }}</span>
                    <span>到期时间：{{ formatDateTime(grant.expires_at) }}</span>
                    <span>{{ grant.last_used_at ? `上次使用：${formatDateTime(grant.last_used_at)}` : '尚未使用' }}</span>
                  </div>
                </div>
                <button
                  v-if="!grant.revoked_at"
                  type="button"
                  class="shrink-0 text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-40"
                  :aria-label="`撤销授权 ${grant.client_name}`"
                  :disabled="revoking"
                  @click="revokeTarget = grant; revokeError = ''"
                >
                  撤销授权
                </button>
              </li>
            </ul>
          </div>
        </section>
      </template>
    </div>

    <!-- 撤销确认 -->
    <MacSheet v-if="revokeTarget" v-slot="{ close }" :show="true" title="撤销应用授权" :loading="revoking" @close="closeRevoke">
      <p class="text-xs text-[var(--text-secondary)] leading-relaxed">“{{ revokeTarget.client_name }}”将失去平台访问权限。如需再次连接，请从该应用重新发起登录授权。</p>
      <p v-if="revokeError" role="alert" class="mt-3 text-xs text-red-600 dark:text-red-400">{{ revokeError }}</p>
      <div class="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-[var(--border-color)]">
        <button type="button" class="px-3.5 py-1.5 rounded-[6px] border border-[var(--border-color)] text-xs text-[var(--text-secondary)]" :disabled="revoking" @click="close">取消</button>
        <button type="button" :disabled="revoking || grantsLoading" class="px-3.5 py-1.5 rounded-[6px] bg-red-600 hover:bg-red-700 text-white text-xs font-medium disabled:opacity-50" @click="revokeGrant">{{ revoking ? '撤销中…' : '撤销授权' }}</button>
      </div>
    </MacSheet>

    <!-- 授权确认 -->
    <MacSheet v-if="consentOpen" v-slot="{ close }" :show="true" title="授权 MCP 应用" :loading="consentSubmitting" @close="closeConsent">
      <p class="text-[11px] text-[var(--text-tertiary)] mb-4">选择此应用可以代表你访问的资源和操作权限。</p>
      <div v-if="consentLoading" role="status" class="py-8 text-center text-xs text-[var(--text-tertiary)]">正在验证授权请求…</div>
      <div v-else-if="previewError" class="space-y-3">
        <p role="alert" class="text-xs text-red-600 dark:text-red-400">{{ previewError }}</p>
        <p class="text-xs text-[var(--text-tertiary)]">请返回 AI 客户端，重新发起连接。</p>
        <div class="flex justify-end">
          <button type="button" class="px-3.5 py-1.5 rounded-[6px] border border-[var(--border-color)] text-xs text-[var(--text-secondary)]" @click="close">管理 MCP 连接</button>
        </div>
      </div>
      <form v-else-if="consent" class="space-y-4 text-xs" @submit.prevent="decideAuthorization(true)">
        <div class="rounded-xl border border-[var(--border-color)] bg-black/[0.02] dark:bg-white/[0.02] p-3.5 space-y-3">
          <div>
            <p class="text-[var(--text-tertiary)]">应用名称（由客户端提供）</p>
            <p class="mt-0.5 break-all text-[15px] font-semibold text-[var(--text-primary)]">{{ consent.client_name }}</p>
          </div>
          <div>
            <p class="text-[var(--text-tertiary)]">客户端 ID</p>
            <p class="mt-0.5 truncate font-mono text-[11px] text-[var(--text-secondary)]" :title="consent.client_id">{{ consent.client_id }}</p>
          </div>
          <div>
            <p class="text-[var(--text-tertiary)]">返回地址</p>
            <p class="mt-0.5 break-all font-semibold text-[var(--text-primary)]">{{ redirectOrigin }}</p>
            <p class="mt-0.5 break-all font-mono text-[11px] text-[var(--text-secondary)]">{{ consent.redirect_uri }}</p>
          </div>
          <div>
            <p class="text-[var(--text-tertiary)]">申请访问</p>
            <p class="mt-0.5 text-[var(--text-secondary)]">通过 MCP 访问此平台，权限受下方选择的访问范围和操作权限限制。</p>
            <p class="mt-0.5 break-all font-mono text-[11px] text-[var(--text-secondary)]">{{ consent.resource }}</p>
          </div>
          <p class="border-t border-[var(--border-color)] pt-3 text-amber-700 dark:text-amber-400">应用名称由客户端自行提供，未经平台认证。请核对返回地址，仅在你主动连接此应用时确认授权。</p>
        </div>
        <p v-if="auth.user?.email" class="break-all text-[var(--text-secondary)]">当前登录账户：{{ auth.user.email }}</p>
        <div>
          <label for="mcp-consent-scope" class="block font-medium text-[var(--text-secondary)] mb-1">访问范围</label>
          <select id="mcp-consent-scope" v-model="consentScope" :disabled="consentSubmitting" class="w-full px-2.5 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] focus:outline-none">
            <option value="user">个人账户</option>
            <option v-if="auth.isAdmin" value="admin">平台管理</option>
          </select>
          <p class="mt-1.5 text-[11px] text-[var(--text-tertiary)]">{{ consentScope === 'admin' ? '允许访问平台管理工具，仅在你仍是有效管理员时可用。授权时可能需要两步验证。' : '只能访问你自己的资源，沿用平台现有的权限限制。' }}</p>
        </div>
        <div>
          <label for="mcp-consent-permissions" class="block font-medium text-[var(--text-secondary)] mb-1">操作权限</label>
          <select id="mcp-consent-permissions" v-model="consentReadOnly" :disabled="consentSubmitting" class="w-full px-2.5 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] focus:outline-none">
            <option :value="true">只读</option>
            <option :value="false">允许修改</option>
          </select>
          <p class="mt-1.5 text-[11px]" :class="consentReadOnly ? 'text-[var(--text-tertiary)]' : 'text-amber-700 dark:text-amber-400'">{{ consentReadOnly ? '只开放查询工具，适合分析用量、查看状态。' : '允许创建、修改和删除范围内的资源，包括 API 密钥和计费权益。请只授权给你信任的应用。' }}</p>
          <p v-if="consentScope === 'admin' && !consentReadOnly" class="mt-1 text-[11px] text-amber-700 dark:text-amber-400">平台管理的修改权限始终需要你已开启两步验证（TOTP），并在授权时完成验证。</p>
        </div>
        <p v-if="submitError" role="alert" class="text-xs text-red-600 dark:text-red-400">{{ submitError }}</p>
        <div class="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-color)]">
          <button type="button" class="px-3.5 py-1.5 rounded-[6px] border border-[var(--border-color)] text-xs text-[var(--text-secondary)]" :disabled="consentSubmitting" @click="decideAuthorization(false)">拒绝</button>
          <button type="submit" :disabled="consentSubmitting" class="px-3.5 py-1.5 rounded-[6px] bg-[#007aff] hover:bg-[#0071e3] text-white text-xs font-medium disabled:opacity-50">{{ consentSubmitting ? '处理中…' : '确认授权' }}</button>
        </div>
      </form>
    </MacSheet>

    <!-- 通用 TOTP step-up 验证框：仅批准平台管理范围且后端要求时弹出 -->
    <TotpStepUpSheet :controller="stepUp" />
  </div>
</template>

<style scoped>
.mcp-workspace>div{padding:26px;max-width:900px}.mcp-workspace h1{font-size:22px;font-weight:650}.mcp-workspace>div>div:first-child{padding-bottom:8px}.mcp-workspace section{border-color:var(--border-subtle);border-radius:14px;box-shadow:var(--surface-raised-shadow);background:var(--bg-surface)}.mcp-workspace section:first-of-type{background:var(--workspace-hero);padding:24px}.mcp-workspace section h2{font-size:16px}.mcp-workspace ol{list-style:none;counter-reset:connect;display:grid;gap:12px;padding:14px 0 0}.mcp-workspace ol li{counter-increment:connect;position:relative;padding-left:32px;min-height:24px;display:flex;align-items:center}.mcp-workspace ol li:before{content:counter(connect);position:absolute;left:0;top:0;width:23px;height:23px;display:grid;place-items:center;border-radius:7px;color:var(--workspace-blue);background:var(--selection-bg);font-weight:600}
@container app-window (max-width:600px){.mcp-workspace>div{padding:16px}.mcp-workspace section:first-of-type{padding:16px}}
</style>
