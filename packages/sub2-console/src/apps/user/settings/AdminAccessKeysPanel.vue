<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { MacButton, MacToggle, MacGroupCard, MacSheet, MacAlertSheet } from '@sub2-mac/core';
import { adminAccessKeysAPI, type Permission } from '@/api/admin/adminAccessKeys';
import type { AccessPolicy, AccessRule, AdminKey, AdminKeyInput } from '@/types';
import { getAllIncludingInactive } from '@/api/admin/groups';
import { listPlatformIds, platformDisplayName } from '@/constants/platformCatalog';
import { useAuthStore } from '@/stores/auth';
import { usePluginStepUp } from '../../admin/plugins/usePluginStepUp';

defineProps<{ sheetTarget?: HTMLElement | null }>();

const FULL_ACCESS_PHRASE = '开启全权访问';
const ACCOUNT_TYPES = ['oauth', 'setup-token', 'apikey', 'upstream', 'bedrock', 'service_account'];

const auth = useAuthStore();
const stepUp = usePluginStepUp();
// usePluginStepUp 返回普通对象：内部 ref 在模板里不会自动解包，解构为顶层 ref 再用。
const stepUpVisible = stepUp.visible;
const stepUpVerifying = stepUp.verifying;
const stepUpCode = stepUp.code;
const stepUpError = stepUp.error;
const verifyStepUp = stepUp.verify;
const cancelStepUp = stepUp.cancel;
const loaded = ref(false), loading = ref(false), busy = ref(false), error = ref(''), notice = ref('');
const items = ref<AdminKey[]>([]);
const permissions = ref<Permission[]>([]);
const groups = ref<{ id: number; name: string }[]>([]);
const secret = ref('');
// 创建/编辑草稿
const draft = ref<AdminKeyInput | null>(null);
const editingId = ref('');
const expiration = ref('');
const initialExpiration = ref('');
const ips = ref('');
const fullAccessPrompt = ref(false);
const fullAccessPhrase = ref('');
const fullAccessConfirmed = ref(false);
// 危险操作二次确认
const pendingAction = ref<{ kind: 'rotate' | 'revoke' | 'delete'; item: AdminKey } | null>(null);
let generation = 0, disposed = false;

const platformOptions = computed(() => listPlatformIds().map(id => ({ value: id, label: platformDisplayName(id) })));
const accountPermissions = computed(() => permissions.value.filter(p => p.scope === 'account'));
const groupPermissions = computed(() => permissions.value.filter(p => p.scope === 'group'));
const globalCategories = computed(() => {
  const categories = new Map<string, Permission[]>();
  for (const permission of permissions.value.filter(p => p.scope === 'global')) {
    const name = permission.category || '其他';
    categories.set(name, [...(categories.get(name) || []), permission]);
  }
  return Array.from(categories, ([name, list]) => ({ name, permissions: list }));
});

function permissionLabel(permission: Permission): string {
  return permission.label || `未知权限（${permission.id}）`;
}

function emptyRule(): AccessRule {
  return { permissions: [], group_ids: [], all_groups: false, include_ungrouped: false, account_types: [], platforms: [] };
}

function normalizeItem(item: AdminKey): AdminKey {
  return {
    ...item,
    allowed_ips: item.allowed_ips ?? [],
    policy: {
      full_access: item.policy?.full_access ?? false,
      global_permissions: item.policy?.global_permissions ?? [],
      rules: (item.policy?.rules ?? []).map(rule => ({
        ...rule,
        permissions: rule.permissions ?? [],
        group_ids: rule.group_ids ?? [],
        account_types: rule.account_types ?? [],
        platforms: rule.platforms ?? []
      }))
    } as AccessPolicy
  };
}

function ruleSummary(rule: AccessRule): string {
  const selectedGroups = rule.all_groups
    ? '所有分组（含未来分组）'
    : rule.group_ids.map(id => groups.value.find(group => group.id === id)?.name || `分组 #${id}`).join('、') || '无分组';
  const groupLabel = selectedGroups + (rule.include_ungrouped ? '，含未分组' : '');
  const types = rule.account_types.join('、') || '未选择类型（无账户权限）';
  const platforms = rule.platforms.join('、') || '不限平台';
  return `${groupLabel}；账户类型：${types}（仅限制账户操作）；平台：${platforms}；操作：${rule.permissions.length} 项`;
}

function status(item: AdminKey): string {
  if (item.revoked_at) return '已撤销';
  if (!item.enabled) return '已停用';
  if (item.expires_at && new Date(item.expires_at).getTime() <= Date.now()) return '已过期';
  return '已启用';
}

async function load() {
  if (!auth.isAdmin) return;
  const rev = ++generation;
  loading.value = true; loaded.value = false; error.value = '';
  try {
    const [result, allGroups] = await Promise.all([adminAccessKeysAPI.list(), getAllIncludingInactive()]);
    if (disposed || rev !== generation || !auth.isAdmin) return;
    items.value = (result.items ?? []).map(normalizeItem);
    permissions.value = result.permissions ?? [];
    groups.value = (allGroups ?? []).map(group => ({ id: group.id, name: group.name }));
    loaded.value = true;
  } catch (failure) {
    if (!disposed && rev === generation) error.value = (failure as { message?: string })?.message || '操作失败，请重试';
  } finally { if (rev === generation) loading.value = false; }
}

function edit(item?: AdminKey) {
  error.value = ''; notice.value = ''; secret.value = '';
  cancelFullAccess();
  fullAccessConfirmed.value = false;
  editingId.value = item?.id || '';
  draft.value = item
    ? JSON.parse(JSON.stringify({ name: item.name, description: item.description, enabled: item.enabled, expires_at: item.expires_at, allowed_ips: item.allowed_ips, policy: item.policy }))
    : { name: '', description: '', enabled: true, expires_at: null, allowed_ips: [], policy: { rules: [emptyRule()], global_permissions: [] } };
  const date = item?.expires_at ? new Date(item.expires_at) : null;
  expiration.value = date && Number.isFinite(date.getTime())
    ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    : '';
  initialExpiration.value = expiration.value;
  ips.value = item?.allowed_ips.join('\n') || '';
}

function closeEditor() {
  if (busy.value) return;
  draft.value = null;
}

function changeFullAccess(event: Event) {
  if (!draft.value || busy.value) return;
  if ((event.target as HTMLInputElement).checked) {
    fullAccessPhrase.value = '';
    fullAccessPrompt.value = true;
  } else {
    draft.value.policy.full_access = false;
    fullAccessConfirmed.value = false;
  }
}

function cancelFullAccess() {
  fullAccessPrompt.value = false;
  fullAccessPhrase.value = '';
}

function confirmFullAccess() {
  if (!draft.value || fullAccessPhrase.value !== FULL_ACCESS_PHRASE) return;
  draft.value.policy.full_access = true;
  fullAccessConfirmed.value = true;
  cancelFullAccess();
}

async function mutate(action: () => Promise<void>) {
  busy.value = true; error.value = ''; notice.value = ''; secret.value = '';
  try { await stepUp.run(action); }
  catch (failure) {
    if ((failure as { message?: string })?.message === '操作已取消') return;
    error.value = (failure as { message?: string })?.message || '操作失败，请重试';
  } finally { busy.value = false; }
}

function replace(item: AdminKey) {
  items.value = [normalizeItem(item), ...items.value.filter(key => key.id !== item.id)];
}

async function save() {
  if (!draft.value || busy.value || fullAccessPrompt.value) return;
  if (!draft.value.name.trim()) { error.value = '请输入密钥名称'; return; }
  const date = expiration.value ? new Date(expiration.value) : null;
  if (date && !Number.isFinite(date.getTime())) { error.value = '请输入有效的到期时间'; return; }
  const input: AdminKeyInput = JSON.parse(JSON.stringify(draft.value));
  input.confirm_full_access = !!input.policy.full_access && fullAccessConfirmed.value;
  input.name = input.name.trim();
  // 未修改日期时保留服务端原值，避免丢失秒数、微秒或时区精度。
  if (expiration.value !== initialExpiration.value) input.expires_at = date?.toISOString() || null;
  input.allowed_ips = ips.value.split(/[\n,]/).map(ip => ip.trim()).filter(Boolean);
  await mutate(async () => {
    if (editingId.value) replace(await adminAccessKeysAPI.update(editingId.value, input));
    else { const result = await adminAccessKeysAPI.create(input); replace(result.item); secret.value = result.key; }
    draft.value = null;
    notice.value = '密钥已保存';
  });
}

async function toggle(item: AdminKey) {
  await mutate(async () => {
    replace(await adminAccessKeysAPI.update(item.id, {
      name: item.name, description: item.description, enabled: !item.enabled,
      expires_at: item.expires_at, allowed_ips: item.allowed_ips, policy: item.policy
    }));
    notice.value = '密钥状态已更新';
  });
}

function requestAction(kind: 'rotate' | 'revoke' | 'delete', item: AdminKey) {
  if (busy.value) return;
  pendingAction.value = { kind, item };
}

function pendingMessage(): string {
  const action = pendingAction.value;
  if (!action) return '';
  if (action.kind === 'rotate') return `轮换“${action.item.name}”将立即使原密钥失效，是否继续？`;
  if (action.kind === 'revoke') return `永久撤销“${action.item.name}”后无法恢复，是否继续？`;
  return `确定删除“${action.item.name}”的密钥记录？删除只是从列表移除，历史操作记录仍会继续保留。`;
}

async function confirmPendingAction() {
  const action = pendingAction.value;
  if (!action || busy.value) return;
  pendingAction.value = null;
  if (action.kind === 'rotate') {
    await mutate(async () => {
      const result = await adminAccessKeysAPI.rotate(action.item.id);
      replace(result.item); secret.value = result.key; notice.value = '密钥已轮换';
    });
  } else if (action.kind === 'revoke') {
    await mutate(async () => {
      await adminAccessKeysAPI.revoke(action.item.id);
      replace({ ...action.item, enabled: false, revoked_at: new Date().toISOString() });
      if (editingId.value === action.item.id) draft.value = null;
      notice.value = '密钥已永久撤销';
    });
  } else {
    await mutate(async () => {
      await adminAccessKeysAPI.deleteRecord(action.item.id);
      items.value = items.value.filter(key => key.id !== action.item.id);
      if (editingId.value === action.item.id) draft.value = null;
      notice.value = '密钥已从列表移除，历史操作记录仍会继续保留';
    });
  }
}

async function copySecret() {
  try {
    await navigator.clipboard.writeText(secret.value);
    notice.value = '密钥已复制';
  } catch { error.value = '复制失败，请手动复制密钥'; }
}

watch([() => auth.user?.id, () => auth.user?.role], () => {
  generation++; loaded.value = false; loading.value = false;
  error.value = ''; notice.value = ''; draft.value = null; secret.value = '';
  if (auth.isAdmin) void load();
}, { flush: 'sync' });
onMounted(load);
onUnmounted(() => { disposed = true; generation++; });
</script>

<template>
  <section class="aak-settings" aria-label="管理员访问密钥">
    <MacGroupCard title="管理员访问密钥" description="按操作和资源范围授权；未勾选操作不生效。">
      <template v-if="!auth.isAdmin">
        <p class="aak-feedback">只有管理员可以管理管理员访问密钥。</p>
      </template>
      <template v-else>
        <p class="aak-warning">共享账户操作会影响所有关联分组；全站权限不受分组限制。</p>
        <p v-if="loading" role="status" class="aak-feedback">正在加载密钥及权限目录…</p>
        <p v-if="error" role="alert" class="aak-feedback aak-error">{{ error }}</p>
        <p v-if="notice" role="status" class="aak-feedback aak-ok">{{ notice }}</p>
        <div v-if="secret" class="aak-secret">
          <p>完整密钥仅展示本次，请立即复制保存。关闭后无法再次查看。</p>
          <code class="aak-secret-value">{{ secret }}</code>
          <div class="aak-row">
            <MacButton size="sm" @click="copySecret">复制密钥</MacButton>
            <MacButton size="sm" @click="secret = ''">已保存，关闭展示</MacButton>
          </div>
        </div>
        <div class="aak-toolbar">
          <MacButton size="sm" variant="primary" :disabled="busy || loading || !loaded" @click="edit()">创建管理密钥</MacButton>
          <MacButton size="sm" :disabled="busy || loading" @click="load">刷新列表</MacButton>
        </div>
        <div v-if="loaded && items.length === 0" class="aak-empty"><strong>尚未创建管理员密钥</strong><p>按操作和资源范围授权，创建第一把细粒度管理员密钥。</p></div>
        <article v-for="item in items" :key="item.id" class="aak-item">
          <p class="aak-item-head"><strong>{{ item.name }}</strong> <code>{{ item.key_prefix }}…</code> · {{ status(item) }}</p>
          <p class="aak-item-meta">{{ item.description || '无备注' }} · 到期：{{ item.expires_at || '永不过期' }}</p>
          <p class="aak-item-meta">最近使用：{{ item.last_used_at || '尚未使用' }} {{ item.last_used_ip }}</p>
          <div class="aak-summary">
            <p v-if="item.policy.full_access" class="aak-full">全权访问（兼容旧版管理员 Key）</p>
            <p>全站权限：{{ item.policy.global_permissions.length }} 项 · 资源规则：{{ item.policy.rules.length }} 条</p>
            <p v-for="(rule, index) in item.policy.rules" :key="index">规则 {{ index + 1 }}：{{ ruleSummary(rule) }}</p>
          </div>
          <div v-if="!item.revoked_at" class="aak-row">
            <MacButton size="sm" :disabled="busy" @click="edit(item)">编辑权限</MacButton>
            <MacButton size="sm" :disabled="busy" @click="toggle(item)">{{ item.enabled ? '停用' : '启用' }}</MacButton>
            <MacButton size="sm" :disabled="busy" @click="requestAction('rotate', item)">轮换</MacButton>
            <MacButton size="sm" variant="destructive" :disabled="busy" @click="requestAction('revoke', item)">永久撤销</MacButton>
          </div>
          <div v-else class="aak-row">
            <MacButton size="sm" variant="destructive" :disabled="busy" @click="requestAction('delete', item)">删除记录</MacButton>
          </div>
        </article>
      </template>
    </MacGroupCard>

    <Teleport v-if="sheetTarget" :to="sheetTarget">
      <MacSheet :show="!!draft" :title="editingId ? '编辑密钥' : '创建密钥'" :loading="busy" @close="closeEditor">
        <div v-if="draft" class="aak-form">
          <p v-if="error" role="alert" class="aak-feedback aak-error">{{ error }}</p>
          <label><span>名称</span><input v-model="draft.name" maxlength="100" autocomplete="off" /></label>
          <label><span>备注</span><textarea v-model="draft.description" maxlength="1000" rows="2" /></label>
          <label><span>有效期（本地时间，留空永不过期）</span><input v-model="expiration" type="datetime-local" /></label>
          <label><span>允许的 IP / CIDR（每行一个，留空不限制）</span><textarea v-model="ips" placeholder="192.0.2.1&#10;2001:db8::/32" rows="3" spellcheck="false" /></label>
          <label class="aak-check"><input v-model="draft.enabled" type="checkbox" :disabled="busy" />启用密钥</label>
          <div class="aak-full-zone">
            <label class="aak-check"><input type="checkbox" :checked="draft.policy.full_access || fullAccessPrompt" :disabled="busy" @change="changeFullAccess" />全权访问（兼容旧版管理员 Key）</label>
            <p class="aak-danger-text">开启后，此密钥可访问全部管理资源、读取敏感数据并修改账户和财务配置；未来新增的管理接口也将允许访问。分组、平台、账户类型和操作规则不再限制此密钥。仅限管理员登录会话及二次验证的接口仍遵循原要求。</p>
            <p v-if="draft.policy.full_access">资源规则已暂停，关闭全权访问后恢复；有效期、IP 限制、限流和审计继续生效。</p>
          </div>
          <fieldset :disabled="busy || !!draft.policy.full_access" class="aak-rules">
            <fieldset v-for="(rule, index) in draft.policy.rules" :key="index" class="aak-rule">
              <legend>账户与分组资源规则 {{ index + 1 }}</legend>
              <label class="aak-check"><input v-model="rule.all_groups" type="checkbox" />所有分组（包括未来分组）</label>
              <label><span>分组（可多选）</span>
                <select v-model="rule.group_ids" multiple :disabled="rule.all_groups">
                  <option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option>
                </select>
              </label>
              <label class="aak-check"><input v-model="rule.include_ungrouped" type="checkbox" />包含未分组账户</label>
              <div><span class="aak-field-label">账户类型（仅限制账户操作，未选表示无账户权限）</span>
                <div class="aak-checks"><label v-for="type in ACCOUNT_TYPES" :key="type" class="aak-check"><input v-model="rule.account_types" type="checkbox" :value="type" />{{ type }}</label></div>
              </div>
              <label><span>平台（可多选，未选表示不限平台）</span>
                <select v-model="rule.platforms" multiple>
                  <option v-for="platform in platformOptions" :key="platform.value" :value="platform.value">{{ platform.label }}</option>
                </select>
              </label>
              <div><span class="aak-field-label">允许的账户操作</span>
                <div class="aak-perms"><label v-for="permission in accountPermissions" :key="permission.id" class="aak-check"><input v-model="rule.permissions" type="checkbox" :value="permission.id" />{{ permissionLabel(permission) }} <span class="aak-perm-id">{{ permission.id }}</span></label></div>
              </div>
              <div v-if="groupPermissions.length" class="aak-group-perms">
                <span class="aak-field-label">允许的分组操作（受上方分组与平台限制）</span>
                <p class="aak-amber">分组模型白名单会限制分组可调用的模型。</p>
                <div class="aak-perms"><label v-for="permission in groupPermissions" :key="permission.id" class="aak-check"><input v-model="rule.permissions" type="checkbox" :value="permission.id" />{{ permissionLabel(permission) }} <span class="aak-perm-id">{{ permission.id }}</span></label></div>
              </div>
              <MacButton size="sm" :disabled="busy" @click="draft.policy.rules.splice(index, 1)">删除规则</MacButton>
            </fieldset>
            <MacButton size="sm" :disabled="busy" @click="draft.policy.rules.push(emptyRule())">添加资源规则</MacButton>
            <fieldset class="aak-globals">
              <legend>全站权限（默认全部关闭）</legend>
              <fieldset v-for="category in globalCategories" :key="category.name" class="aak-category">
                <legend>{{ category.name }}</legend>
                <div class="aak-perms"><label v-for="permission in category.permissions" :key="permission.id" class="aak-check"><input v-model="draft.policy.global_permissions" type="checkbox" :value="permission.id" />{{ permissionLabel(permission) }} <span class="aak-perm-id">{{ permission.id }}</span></label></div>
              </fieldset>
            </fieldset>
          </fieldset>
        </div>
        <template #footer>
          <MacButton size="sm" :disabled="busy" @click="closeEditor">取消</MacButton>
          <MacButton size="sm" variant="primary" :loading="busy" :disabled="busy || fullAccessPrompt" @click="save">保存密钥</MacButton>
        </template>
      </MacSheet>

      <MacSheet :show="fullAccessPrompt" title="确认开启全权访问" @close="cancelFullAccess">
        <div class="aak-form">
          <p class="aak-danger-text">开启后，此密钥可访问全部管理资源、读取敏感数据并修改账户和财务配置；未来新增的管理接口也将允许访问。分组、平台、账户类型和操作规则不再限制此密钥。仅限管理员登录会话及二次验证的接口仍遵循原要求。</p>
          <label><span>请输入“{{ FULL_ACCESS_PHRASE }}”以确认：</span>
            <input v-model="fullAccessPhrase" autocomplete="off" />
          </label>
        </div>
        <template #footer>
          <MacButton size="sm" @click="cancelFullAccess">取消</MacButton>
          <MacButton size="sm" variant="destructive" :disabled="fullAccessPhrase !== FULL_ACCESS_PHRASE" @click="confirmFullAccess">确认开启全权访问</MacButton>
        </template>
      </MacSheet>

      <MacSheet :show="stepUpVisible" title="二次验证" :loading="stepUpVerifying" @close="cancelStepUp">
        <div class="aak-form">
          <p>此操作需要二次验证。请输入动态验证码（6 位数字）。</p>
          <p v-if="stepUpError" role="alert" class="aak-feedback aak-error">{{ stepUpError }}</p>
          <label><span>动态验证码</span>
            <input v-model="stepUpCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 位数字" />
          </label>
        </div>
        <template #footer>
          <MacButton size="sm" :disabled="stepUpVerifying" @click="cancelStepUp">取消</MacButton>
          <MacButton size="sm" variant="primary" :loading="stepUpVerifying" :disabled="!/^\d{6}$/.test(stepUpCode)" @click="verifyStepUp">验证</MacButton>
        </template>
      </MacSheet>

      <MacAlertSheet :show="!!pendingAction" title="请确认" :message="pendingMessage()" confirm-text="确认" cancel-text="取消" danger :loading="busy" @cancel="pendingAction = null" @confirm="confirmPendingAction" />
    </Teleport>
  </section>
</template>

<style scoped>
.aak-settings{display:grid;min-width:0;font-size:13px;container-type:inline-size;container-name:aak-settings}
.aak-feedback{margin:12px 14px;padding:12px 14px;border:1px solid var(--border-subtle);border-radius:9px;background:var(--bg-surface);font-size:12px;color:var(--text-secondary)}
.aak-error{color:var(--status-danger,#c43731);overflow-wrap:anywhere}
.aak-ok{color:var(--status-success,#1f7a3a)}
.aak-warning{margin:12px 14px 0;padding:10px 12px;border-radius:9px;background:color-mix(in srgb,#f59e0b 10%,transparent);color:#92600a;font-size:12px;line-height:1.5}
.aak-secret{margin:12px 14px;padding:12px 14px;display:grid;gap:10px;border:1px solid #f59e0b;border-radius:9px;background:color-mix(in srgb,#f59e0b 7%,transparent);font-size:12px}
.aak-secret p{margin:0}
.aak-secret-value{display:block;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:7px;background:var(--window-bg-solid);font-family:ui-monospace,monospace;font-size:12px;user-select:all;overflow-wrap:anywhere}
.aak-toolbar{display:flex;gap:8px;flex-wrap:wrap;padding:12px 14px 4px}
.aak-empty{display:grid;gap:6px;text-align:center;padding:28px 16px;font-size:12px;color:var(--text-secondary)}
.aak-empty p{margin:0}
.aak-item{display:grid;gap:6px;margin:12px 14px;padding:14px;border:1px solid var(--border-subtle);border-radius:10px;background:var(--bg-surface)}
.aak-item-head{margin:0;font-size:12px}
.aak-item-head code{font-size:11px;color:var(--text-secondary)}
.aak-item-meta{margin:0;font-size:11px;color:var(--text-secondary);overflow-wrap:anywhere}
.aak-summary{display:grid;gap:3px;font-size:11px;color:var(--text-secondary)}
.aak-summary p{margin:0;overflow-wrap:anywhere}
.aak-full{font-weight:700;color:var(--status-danger,#c43731)}
.aak-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.aak-form{display:grid;gap:14px;min-width:0}
.aak-form label{display:grid;gap:7px;min-width:0}
.aak-form label>span{font-size:12px;font-weight:600}
.aak-form :is(input:not([type=checkbox]),textarea,select){box-sizing:border-box;width:100%;min-width:0;padding:7px 10px;border:1px solid var(--border-subtle);border-radius:7px;background:var(--window-bg-solid);color:var(--text-primary);font-size:12px}
.aak-form select[multiple]{min-height:88px}
.aak-form textarea{font-family:ui-monospace,monospace}
.aak-check{display:flex!important;flex-direction:row!important;align-items:center;gap:8px;font-size:12px;font-weight:400!important}
.aak-check input{flex:0 0 auto;width:15px;height:15px;accent-color:var(--accent,#007aff)}
.aak-field-label{font-size:12px;font-weight:600}
.aak-checks,.aak-perms{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;margin-top:8px}
.aak-perm-id{font-size:10px;color:var(--text-tertiary)}
.aak-full-zone{display:grid;gap:8px;padding:12px;border:1px solid #ef4444;border-radius:9px}
.aak-danger-text{margin:0;font-size:12px;line-height:1.6;color:var(--status-danger,#c43731)}
.aak-rules,.aak-rule,.aak-globals,.aak-category{display:grid;gap:14px;min-width:0;margin:0;padding:14px;border:1px solid var(--border-subtle);border-radius:9px}
.aak-rules{padding:0;border:0}
.aak-rule legend,.aak-globals legend,.aak-category legend{font-size:12px;font-weight:600;padding:0 4px}
.aak-group-perms{display:grid;gap:8px;padding:12px;border:1px solid #f59e0b;border-radius:9px}
.aak-amber{margin:0;font-size:11px;color:#92600a}
.aak-settings :is(input,textarea,select,button):focus-visible{outline:2px solid var(--accent,#007aff);outline-offset:3px}
.aak-settings :disabled{opacity:.55}
@container aak-settings (max-width:520px){.aak-checks,.aak-perms{grid-template-columns:minmax(0,1fr)}.aak-item{margin:10px}.aak-toolbar{padding:10px 10px 2px}}
</style>
