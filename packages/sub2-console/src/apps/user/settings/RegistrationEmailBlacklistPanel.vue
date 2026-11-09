<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { MacButton, MacGroupCard, MacSheet, MacAlertSheet } from '@sub2-mac/core';
import { getRegistrationEmailBlacklist, updateRegistrationEmailBlacklist } from '@/api/admin/settings';
import { findBlacklistedEmailUsers, batchDisable, type BlacklistedEmailUser } from '@/api/admin/users';
import { useAuthStore } from '@/stores/auth';
import {
  parseBlacklistInput, mergeIntoBlacklist, chunkUserIds,
  BLACKLIST_VISIBLE_LIMIT, DISABLE_BATCH_SIZE
} from './registrationEmailBlacklist';

defineProps<{ sheetTarget?: HTMLElement | null }>();

const auth = useAuthStore();
const loaded = ref(false), loading = ref(false), error = ref(''), notice = ref('');
const savedEmails = ref<string[]>([]);
const maxEntries = ref(20000);
// 编辑器草稿
const editorOpen = ref(false);
const draft = ref<string[]>([]);
const bulkInput = ref('');
const bulkFeedback = ref('');
const searchKeyword = ref('');
const editorError = ref('');
const editorSaving = ref(false);
const discardPrompt = ref(false);
// 禁用命中用户
const checking = ref(false);
const matchedUsers = ref<BlacklistedEmailUser[]>([]);
const disableOpen = ref(false);
const disabling = ref(false);
const disableError = ref('');
const disabledCount = ref(0);
let generation = 0, disposed = false;

const addedCount = computed(() => draft.value.filter(email => !savedEmails.value.includes(email)).length);
const removedCount = computed(() => savedEmails.value.filter(email => !draft.value.includes(email)).length);
const dirty = computed(() => addedCount.value > 0 || removedCount.value > 0);
const overMax = computed(() => draft.value.length > maxEntries.value);
const filteredDraft = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase();
  const list = keyword ? draft.value.filter(email => email.includes(keyword)) : draft.value;
  return { list, total: list.length, truncated: list.length > BLACKLIST_VISIBLE_LIMIT };
});
const visibleDraft = computed(() => filteredDraft.value.list.slice(0, BLACKLIST_VISIBLE_LIMIT));

function formatCount(value: number): string { return value.toLocaleString('en-US'); }

async function load() {
  if (!auth.isAdmin) return;
  const rev = ++generation;
  loading.value = true; loaded.value = false; error.value = ''; notice.value = '';
  try {
    const data = await getRegistrationEmailBlacklist();
    if (disposed || rev !== generation || !auth.isAdmin) return;
    savedEmails.value = [...(data.emails ?? [])];
    maxEntries.value = typeof data.max === 'number' && data.max > 0 ? data.max : 20000;
    loaded.value = true;
  } catch (failure) {
    if (!disposed && rev === generation) error.value = (failure as { message?: string })?.message || '黑名单加载失败';
  } finally { if (rev === generation) loading.value = false; }
}

function openEditor() {
  if (!loaded.value || checking.value) return;
  draft.value = [...savedEmails.value];
  bulkInput.value = ''; bulkFeedback.value = ''; searchKeyword.value = ''; editorError.value = '';
  editorOpen.value = true;
}

function closeEditor() {
  if (editorSaving.value) return;
  if (dirty.value) { discardPrompt.value = true; return; }
  editorOpen.value = false;
}

function discardAndClose() {
  discardPrompt.value = false;
  editorOpen.value = false;
}

function addBulk() {
  if (!bulkInput.value.trim()) return;
  const parsed = parseBlacklistInput(bulkInput.value);
  const merged = mergeIntoBlacklist(draft.value, parsed.valid);
  draft.value = merged.list;
  const parts: string[] = [];
  if (merged.added.length > 0 || parsed.duplicates > 0 || merged.duplicates > 0) {
    parts.push(`新增 ${merged.added.length} 个，跳过重复 ${parsed.duplicates + merged.duplicates} 个`);
  }
  if (parsed.invalid.length > 0) {
    const sample = parsed.invalid.slice(0, 10).join('、');
    parts.push(`${parsed.invalid.length} 个格式无效，已留在输入框中：${sample}${parsed.invalid.length > 10 ? ' …' : ''}`);
    bulkInput.value = parsed.invalid.join('\n');
  } else {
    bulkInput.value = '';
  }
  bulkFeedback.value = parts.join('；');
}

function removeDraft(email: string) {
  draft.value = draft.value.filter(item => item !== email);
}

function clearDraft() {
  if (editorSaving.value) return;
  draft.value = [];
}

async function saveDraft() {
  if (!loaded.value || !dirty.value || editorSaving.value || overMax.value) return;
  editorError.value = '';
  const rev = generation;
  const snapshot = [...draft.value];
  editorSaving.value = true;
  try {
    const response = await updateRegistrationEmailBlacklist(snapshot);
    if (disposed || rev !== generation || !auth.isAdmin) return;
    savedEmails.value = [...response.emails];
    maxEntries.value = typeof response.max === 'number' && response.max > 0 ? response.max : maxEntries.value;
    draft.value = [...response.emails];
    notice.value = `黑名单已保存，共 ${formatCount(response.emails.length)} 个邮箱`;
    editorOpen.value = false;
    const added = response.added ?? [];
    if (added.length > 0) {
      await checkRegisteredUsers(added, { silentWhenNone: true });
    }
  } catch (failure) {
    // 保存失败保留草稿：编辑器保持打开，草稿原样保留。
    if (!disposed && rev === generation) editorError.value = (failure as { message?: string })?.message || '保存失败，请重试';
  } finally { if (rev === generation) editorSaving.value = false; }
}

async function checkRegisteredUsers(emails: string[], options: { silentWhenNone?: boolean } = {}) {
  if (emails.length === 0) return;
  checking.value = true;
  try {
    const result = await findBlacklistedEmailUsers(emails);
    matchedUsers.value = result.items ?? [];
    disabledCount.value = 0;
    disableError.value = '';
    if (matchedUsers.value.length > 0) {
      disableOpen.value = true;
    } else if (!options.silentWhenNone) {
      notice.value = '名单中没有仍在启用的已注册用户';
    }
  } catch (failure) {
    error.value = (failure as { message?: string })?.message || '检查已注册用户失败';
  } finally { checking.value = false; }
}

function closeDisableDialog() {
  if (disabling.value) return;
  disableOpen.value = false;
}

async function disableMatchedUsers() {
  if (matchedUsers.value.length === 0 || disabling.value) return;
  disabling.value = true;
  disableError.value = '';
  let affected = 0;
  try {
    // 分批提交；失败时弹窗只保留尚未提交的用户，重试从断点继续。
    for (const batch of chunkUserIds(matchedUsers.value.map(user => user.id))) {
      const result = await batchDisable(batch);
      affected += result.affected;
      matchedUsers.value = matchedUsers.value.slice(batch.length);
    }
    disabledCount.value = affected;
    notice.value = `已禁用 ${formatCount(affected)} 个用户`;
    disableOpen.value = false;
  } catch (failure) {
    // 已提交的批次不再保留；剩余用户留在弹窗里，可重试。
    disableError.value = (failure as { message?: string })?.message || '禁用失败，可重试剩余用户';
  } finally { disabling.value = false; }
}

watch([() => auth.user?.id, () => auth.user?.role], () => {
  generation++; loaded.value = false; loading.value = false;
  error.value = ''; notice.value = ''; editorOpen.value = false; disableOpen.value = false;
  if (auth.isAdmin) void load();
}, { flush: 'sync' });
onMounted(load);
onUnmounted(() => { disposed = true; generation++; });
</script>

<template>
  <section class="rbl-settings" aria-label="注册邮箱黑名单">
    <MacGroupCard title="邮箱黑名单（精确匹配）" description="禁止名单中的邮箱注册，或绑定为账号邮箱。按收件箱匹配：Gmail 地址里的点号、googlemail.com 域名，以及各邮箱的 + 后缀都视为同一邮箱。已注册的账号不受影响，可用「检查已注册用户」找出后禁用。名单在弹窗里单独保存，不受页面底部保存按钮影响。">
      <template v-if="!auth.isAdmin">
        <p class="rbl-feedback">只有管理员可以配置注册邮箱黑名单。</p>
      </template>
      <template v-else>
        <p v-if="loading" role="status" class="rbl-feedback">正在读取黑名单…</p>
        <p v-if="error" role="alert" class="rbl-feedback rbl-error">{{ error }} <MacButton v-if="!loaded" size="sm" @click="load">重试</MacButton></p>
        <p v-if="notice" role="status" class="rbl-feedback rbl-ok">{{ notice }}</p>
        <div v-if="loaded" class="rbl-summary">
          <span>当前 {{ formatCount(savedEmails.length) }} 个邮箱</span>
          <span class="rbl-actions">
            <MacButton size="sm" :disabled="savedEmails.length === 0 || checking" :loading="checking" @click="checkRegisteredUsers(savedEmails)">检查已注册用户</MacButton>
            <MacButton size="sm" variant="primary" :disabled="loading || checking" @click="openEditor">编辑名单</MacButton>
          </span>
        </div>
      </template>
    </MacGroupCard>

    <Teleport v-if="sheetTarget" :to="sheetTarget">
      <MacSheet :show="editorOpen" title="编辑邮箱黑名单" :loading="editorSaving" @close="closeEditor">
        <div class="rbl-editor">
          <p v-if="editorError" role="alert" class="rbl-feedback rbl-error">{{ editorError }}</p>
          <label><span>批量添加</span>
            <textarea v-model="bulkInput" rows="5" placeholder="每行一个邮箱，也可以用逗号、空格或分号分隔" spellcheck="false" />
          </label>
          <div class="rbl-row">
            <MacButton size="sm" :disabled="!bulkInput.trim() || editorSaving" @click="addBulk">添加到列表</MacButton>
            <span v-if="bulkFeedback" role="status" class="rbl-note">{{ bulkFeedback }}</span>
          </div>
          <div class="rbl-list-head">
            <strong>名单（{{ formatCount(draft.length) }} 个）</strong>
            <span v-if="dirty" class="rbl-pending">未保存：新增 {{ addedCount }}，移除 {{ removedCount }}</span>
          </div>
          <p v-if="overMax" role="alert" class="rbl-feedback rbl-error">名单最多 {{ formatCount(maxEntries) }} 个邮箱</p>
          <div class="rbl-row">
            <input v-model="searchKeyword" type="search" placeholder="搜索邮箱" aria-label="搜索邮箱" />
            <MacButton size="sm" :disabled="draft.length === 0 || editorSaving" @click="clearDraft">清空</MacButton>
          </div>
          <ul v-if="visibleDraft.length" class="rbl-list">
            <li v-for="email in visibleDraft" :key="email">
              <code>{{ email }}</code>
              <span v-if="!savedEmails.includes(email)" class="rbl-new">未保存</span>
              <button type="button" class="rbl-remove" :disabled="editorSaving" :aria-label="`移除 ${email}`" @click="removeDraft(email)">×</button>
            </li>
          </ul>
          <p v-else class="rbl-empty">{{ searchKeyword.trim() ? '没有匹配的邮箱' : '名单为空' }}</p>
          <p v-if="filteredDraft.truncated" class="rbl-note">共 {{ formatCount(filteredDraft.total) }} 条匹配，仅显示前 {{ BLACKLIST_VISIBLE_LIMIT }} 条，请用搜索缩小范围</p>
        </div>
        <template #footer>
          <MacButton size="sm" :disabled="editorSaving" @click="closeEditor">取消</MacButton>
          <MacButton size="sm" variant="primary" :loading="editorSaving" :disabled="!dirty || overMax" @click="saveDraft">保存名单</MacButton>
        </template>
      </MacSheet>

      <MacAlertSheet :show="discardPrompt" title="放弃未保存的改动？" :message="`还有新增 ${addedCount} 个、移除 ${removedCount} 个改动没有保存，关闭后会丢失。`" confirm-text="放弃改动" cancel-text="继续编辑" danger @cancel="discardPrompt = false" @confirm="discardAndClose" />

      <MacSheet :show="disableOpen" title="禁用命中黑名单的用户？" :loading="disabling" @close="closeDisableDialog">
        <div class="rbl-disable">
          <p>以下 {{ formatCount(matchedUsers.length) }} 个已注册用户的邮箱在黑名单中（含同一收件箱的别名变体）。禁用后无法登录，API Key 也会立即停用。是否禁用？</p>
          <p v-if="disableError" role="alert" class="rbl-feedback rbl-error">{{ disableError }}</p>
          <ul class="rbl-list rbl-users">
            <li v-for="user in matchedUsers" :key="user.id">
              <code>{{ user.email }}</code><span>{{ user.username }} · #{{ user.id }}</span>
            </li>
          </ul>
          <p class="rbl-note">每批 {{ DISABLE_BATCH_SIZE }} 人提交；中途失败时已禁用的不再重复提交，剩余用户可重试。</p>
        </div>
        <template #footer>
          <MacButton size="sm" :disabled="disabling" @click="closeDisableDialog">暂不禁用</MacButton>
          <MacButton size="sm" variant="destructive" :loading="disabling" :disabled="matchedUsers.length === 0" @click="disableMatchedUsers">禁用 {{ formatCount(matchedUsers.length) }} 个用户</MacButton>
        </template>
      </MacSheet>
    </Teleport>
  </section>
</template>

<style scoped>
.rbl-settings{display:grid;min-width:0;font-size:13px;container-type:inline-size;container-name:rbl-settings}
.rbl-feedback{margin:12px 14px;padding:12px 14px;border:1px solid var(--border-subtle);border-radius:9px;background:var(--bg-surface);font-size:12px;color:var(--text-secondary)}
.rbl-error{color:var(--status-danger,#c43731);overflow-wrap:anywhere}
.rbl-ok{color:var(--status-success,#1f7a3a)}
.rbl-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:14px 16px;font-size:12px}
.rbl-actions{display:flex;gap:8px;flex-wrap:wrap}
.rbl-editor{display:grid;gap:14px;min-width:0}
.rbl-editor label{display:grid;gap:7px;min-width:0}
.rbl-editor label>span{font-size:12px;font-weight:600}
.rbl-editor textarea,.rbl-row input{box-sizing:border-box;width:100%;min-width:0;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:7px;background:var(--window-bg-solid);color:var(--text-primary);font-size:12px;font-family:ui-monospace,monospace}
.rbl-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.rbl-row input{flex:1}
.rbl-note{font-size:11px;color:var(--text-secondary);line-height:1.5}
.rbl-list-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;font-size:12px}
.rbl-pending{font-size:11px;color:var(--accent,#007aff)}
.rbl-list{list-style:none;margin:0;padding:0;max-height:320px;overflow-y:auto;border:1px solid var(--border-subtle);border-radius:9px}
.rbl-list li{display:flex;align-items:center;gap:8px;min-width:0;padding:8px 10px;border-bottom:1px solid var(--border-subtle);font-size:12px}
.rbl-list li:last-child{border-bottom:0}
.rbl-list code{flex:1;min-width:0;overflow-wrap:anywhere;font-size:12px}
.rbl-new{flex:0 0 auto;font-size:10px;padding:2px 6px;border-radius:5px;background:color-mix(in srgb,var(--accent,#007aff) 10%,transparent);color:var(--accent,#007aff)}
.rbl-remove{flex:0 0 auto;width:24px;height:24px;border-radius:6px;color:var(--text-tertiary);font-size:16px;line-height:1}
.rbl-remove:hover:not(:disabled){color:var(--status-danger,#c43731);background:color-mix(in srgb,var(--status-danger,#c43731) 7%,transparent)}
.rbl-empty{margin:0;padding:16px;text-align:center;font-size:12px;color:var(--text-secondary);border:1px dashed var(--border-subtle);border-radius:9px}
.rbl-disable{display:grid;gap:12px;font-size:12px;line-height:1.6}
.rbl-disable p{margin:0}
.rbl-users{max-height:288px}
.rbl-users li span{flex:0 0 auto;font-size:11px;color:var(--text-secondary)}
.rbl-settings :is(input,textarea,button):focus-visible{outline:2px solid var(--accent,#007aff);outline-offset:3px}
.rbl-settings :disabled{opacity:.55}
@container rbl-settings (max-width:520px){.rbl-summary{padding:12px 14px}.rbl-actions{width:100%}}
</style>
