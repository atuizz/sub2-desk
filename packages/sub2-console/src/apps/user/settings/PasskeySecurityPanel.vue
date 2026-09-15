<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { MacButton, MacGroupCard, MacSheet } from '@sub2-mac/core';
import { passkeyAPI, type PasskeyCredentialSummary } from '@/api/passkey';
const props = defineProps<{ enabled?: boolean; ready: boolean; sheetTarget: HTMLElement | null }>();
const rows = ref<PasskeyCredentialSummary[]>([]);
const loaded = ref(false), reading = ref(false), busy = ref(false), show = ref(false);
const submitting = ref(false);
const error = ref(''), notice = ref(''), name = ref(''), password = ref('');
const operation = ref<'register' | 'rename' | 'remove'>('register');
const selected = ref<PasskeyCredentialSummary | null>(null);
const allowed = computed(() => props.enabled === true && props.ready);
const title = computed(() => operation.value === 'register' ? '添加通行密钥' : operation.value === 'rename' ? '重命名通行密钥' : '删除通行密钥');
let generation = 0;
let controller: AbortController | null = null;
async function load() {
  if (!allowed.value || reading.value) return;
  const current = generation; reading.value = true; loaded.value = false; error.value = '';
  try { const result = await passkeyAPI.list(); if (current === generation) { rows.value = result; loaded.value = true; } }
  catch { if (current === generation) error.value = '通行密钥列表读取失败，请重试。'; }
  finally { if (current === generation) reading.value = false; }
}
function open(action: typeof operation.value, row?: PasskeyCredentialSummary) {
  if (!allowed.value || !loaded.value || busy.value) return;
  operation.value = action; selected.value = row || null; name.value = row?.name || ''; password.value = '';
  error.value = ''; notice.value = ''; show.value = true;
}
function clear() {
  // Abort the browser ceremony and invalidate late begin/finish responses.
  generation++; controller?.abort(); controller = null;
  busy.value = false; submitting.value = false; reading.value = false; show.value = false; password.value = ''; name.value = ''; selected.value = null;
}
function close() { if (!submitting.value) clear(); }
async function submit() {
  if (busy.value || !allowed.value || !loaded.value || !show.value) return;
  if (operation.value !== 'remove' && !name.value.trim()) { error.value = '请输入通行密钥名称'; return; }
  if (operation.value !== 'rename' && !password.value) { error.value = '请输入当前密码'; return; }
  if (operation.value === 'register' && !passkeyAPI.isSupported()) { error.value = '请使用支持通行密钥的浏览器和安全连接。'; password.value = ''; return; }
  const current = ++generation; busy.value = true; error.value = ''; controller = new AbortController();
  const secret = password.value; password.value = '';
  try {
    if (operation.value === 'register') await passkeyAPI.register(name.value.trim(), secret, controller.signal, () => { if (current === generation) submitting.value = true; });
    else if (selected.value) {
      submitting.value = true;
      if (operation.value === 'rename') await passkeyAPI.rename(selected.value.id, name.value.trim());
      else await passkeyAPI.remove(selected.value.id, secret);
    } else throw new Error('请选择通行密钥');
    if (current !== generation) return;
    clear(); notice.value = '通行密钥已更新。'; await load();
  } catch (e) {
    if (current === generation) error.value = ['NotAllowedError', 'AbortError'].includes((e as Error).name) ? '验证已取消，可重新尝试。' : (e as Error).message || '操作失败，请重试。';
  } finally { if (current === generation) { busy.value = false; submitting.value = false; password.value = ''; controller = null; } }
}
watch(allowed, value => { if (value) void load(); else { clear(); rows.value = []; loaded.value = false; } }, { immediate: true });
onUnmounted(clear);
</script>
<template>
  <MacGroupCard title="通行密钥 · Passkey">
    <div class="p-4 space-y-3 text-xs">
      <p>使用面容 ID、触控 ID、Windows Hello 或安全密钥登录。</p>
      <p v-if="!allowed">{{ enabled === false ? '管理员尚未开放通行密钥。' : '等待账户和站点设置确认。' }}</p>
      <template v-else>
        <p v-if="reading" role="status">正在读取…</p>
        <p v-if="error && !show" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
        <div class="flex gap-2"><MacButton :disabled="reading || busy" @click="load">刷新</MacButton><MacButton variant="primary" :disabled="!loaded || busy" @click="open('register')">添加通行密钥</MacButton></div>
        <p v-if="loaded && !rows.length">尚未添加通行密钥。</p>
        <div v-for="row in rows" :key="row.id" class="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-3">
          <div class="min-w-0 break-all"><strong>{{ row.name }}</strong><p class="text-[var(--text-secondary)]">{{ row.backup ? '可同步' : '设备密钥' }} · {{ row.last_used_at ? `最近使用 ${new Date(row.last_used_at).toLocaleString()}` : '尚未使用' }}</p></div>
          <div class="flex gap-2"><MacButton :disabled="busy" @click="open('rename', row)">重命名</MacButton><MacButton :disabled="busy" @click="open('remove', row)">删除</MacButton></div>
        </div>
      </template>
    </div>
  </MacGroupCard>
  <Teleport v-if="sheetTarget" :to="sheetTarget">
    <MacSheet :show="show" :title="title" :loading="submitting" @close="close">
      <form class="space-y-4 text-xs" @submit.prevent="submit">
        <p v-if="operation === 'remove'">确认删除「{{ selected?.name }}」？删除后该密钥将无法登录。</p>
        <label v-if="operation !== 'remove'" class="block">名称<input v-model="name" maxlength="100" :disabled="busy" class="passkey-input" autocomplete="off" /></label>
        <label v-if="operation !== 'rename'" class="block">当前密码<input v-model="password" type="password" autocomplete="current-password" :disabled="busy" class="passkey-input" /></label>
        <p v-if="busy" role="status">正在验证并提交，请按设备提示操作。</p><p v-if="error" role="alert">{{ error }}</p>
        <button type="submit" hidden :disabled="busy">确认</button>
      </form>
      <template #footer><MacButton :disabled="submitting" @click="close">取消</MacButton><MacButton :variant="operation === 'remove' ? 'destructive' : 'primary'" :loading="busy" @click="submit">{{ operation === 'remove' ? '确认删除' : '保存' }}</MacButton></template>
    </MacSheet>
  </Teleport>
</template>
<style scoped>.passkey-input{display:block;width:100%;margin-top:8px;padding:10px;border:1px solid var(--border-subtle);border-radius:8px;background:var(--bg-surface)}.passkey-input:focus-visible{outline:2px solid var(--accent)}</style>
