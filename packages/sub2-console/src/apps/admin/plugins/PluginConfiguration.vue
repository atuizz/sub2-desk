<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { MacSheet, MacButton } from '@sub2-mac/core';
import pluginsAPI, { type PluginInstallation, type PluginUISession } from '../../../api/admin/plugins';
import { totpAPI } from '../../../api/totp';
import { createPluginBridge, validatePluginSession } from './bridge';
import { adminError } from '../admin-feedback';
const props = defineProps<{ plugin: PluginInstallation }>();
const emit = defineEmits<{ close: [] }>();
const session = ref<PluginUISession | null>(null);
const frame = ref<HTMLIFrameElement | null>(null);
const frameLoading = ref(false);
const loading = ref(false), error = ref(''), notice = ref(''), height = ref(640);
const confirmation = ref(''), verifying = ref(false), code = ref(''), verifyError = ref('');
const needCode = ref(false);
let resolver: ((accepted: boolean) => void) | null = null;
let bridge: ReturnType<typeof createPluginBridge> | null = null;
let generation = 0, approvalGeneration = 0;
let frameLoaded = false;
let expiry: ReturnType<typeof setTimeout> | undefined;
let frameTimeout: ReturnType<typeof setTimeout> | undefined;
function settle(ok: boolean) { approvalGeneration++; verifying.value=false; resolver?.(ok); resolver = null; confirmation.value = ''; code.value = ''; needCode.value = false; }
function reset() { generation++; bridge?.dispose(); bridge = null; session.value = null; frameLoaded = false; frameLoading.value = false; clearTimeout(expiry); clearTimeout(frameTimeout); settle(false); }
function close() { reset(); emit('close'); }
async function approve(label: string) {
  if (resolver) throw new Error('另一项操作正在等待确认');
  confirmation.value = label; verifyError.value = '';
  const approved = await new Promise<boolean>(resolve => { resolver = resolve; });
  if (!approved) throw new Error('操作已取消');
}
async function sensitive<T>(label: string, action: () => Promise<T>, requestActive: () => boolean = () => true) {
  const epoch = generation;
  await approve(label);
  const active = () => { if (!requestActive() || epoch !== generation || !session.value || Date.parse(session.value.expires_at) <= Date.now()) throw new Error('会话或请求已失效，请重新操作'); };
  active();
  try { return await action(); }
  catch (err: any) {
    if (![err?.code, err?.reason].includes('STEP_UP_REQUIRED')) throw new Error(adminError(err, '操作失败'));
    active(); needCode.value = true;
    await approve('验证身份后继续' + label);
    active(); return await action();
  }
}
async function confirm() {
  if (verifying.value) return;
  if (!needCode.value) { settle(true); return; }
  if (!/^\d{6}$/.test(code.value)) { verifyError.value = '请输入6位动态验证码'; return; }
  verifying.value = true; verifyError.value = '';
  const epoch = generation, approval = approvalGeneration;
  try {
    const result = await totpAPI.stepUp(code.value);
    if (epoch !== generation || approval !== approvalGeneration) return;
    if (!result.verified) throw new Error('身份验证未通过');
    settle(true);
  } catch (err) { if (epoch === generation && approval === approvalGeneration) verifyError.value = adminError(err, '身份验证失败'); }
  finally { if (epoch === generation && approval === approvalGeneration) { verifying.value = false; code.value = ''; } }
}
async function open() {
  reset(); const epoch = generation; loading.value = true; error.value = ''; notice.value = '';
  try {
    const result = await pluginsAPI.createUISession(props.plugin.id);
    if (epoch !== generation) return;
    session.value = validatePluginSession(result, location.href);
    bridge = createPluginBridge({ session: session.value, frame: () => frame.value?.contentWindow ?? null,
      load: () => pluginsAPI.getConfig(props.plugin.id),
      save: (config, active) => sensitive('保存插件配置', () => pluginsAPI.saveConfig(props.plugin.id, config), active),
      test: active => sensitive('测试插件连接', () => pluginsAPI.test(props.plugin.id), active),
      resize: value => { height.value = value; }, notify: value => { notice.value = '插件消息：' + value; } });
    frameLoading.value = true;
    frameTimeout = setTimeout(() => { frameLoading.value = false; error.value = '配置页面未完成加载，请重新连接。'; }, 15000);
    expiry = setTimeout(() => { reset(); loading.value = false; error.value = '配置会话已过期，请重新连接。'; }, Math.min(2147483647, Date.parse(result.expires_at) - Date.now()));
  } catch (err) { if (epoch === generation) error.value = adminError(err, '配置页面无法打开'); }
  finally { if (epoch === generation) loading.value = false; }
}
function onMessage(event: MessageEvent) { void bridge?.handle(event); }
function onLoad() {
  // Initial scripts may request configuration before iframe load fires.
  if (frameLoaded) { generation++; bridge?.invalidate(); settle(false); }
  frameLoaded = true; frameLoading.value = false; clearTimeout(frameTimeout);
}
onMounted(() => { window.addEventListener('message', onMessage); void open(); });
onUnmounted(() => { reset(); window.removeEventListener('message', onMessage); });
</script>
<template>
  <MacSheet class="plugin-config-sheet" :show="true" :title="plugin.name + ' · 配置'" @close="close">
    <p v-if="loading || frameLoading" role="status">{{ loading ? '正在建立配置会话…' : '正在加载配置页面…' }}</p>
    <div v-if="error" role="alert"><p>{{ error }}</p><MacButton @click="open">重新连接</MacButton></div>
    <p v-if="notice" role="status" class="break-all text-xs">{{ notice }}</p>
    <iframe v-if="session" ref="frame" :src="session.url" sandbox="allow-scripts" referrerpolicy="no-referrer"
      :title="plugin.name + '配置页面'" class="w-full border-0 bg-white" :style="{ height: height + 'px' }" @load="onLoad" />
    <template #footer><MacButton @click="close">关闭</MacButton></template>
  </MacSheet>
  <MacSheet :show="!!confirmation" :title="confirmation" :loading="verifying" @close="settle(false)">
    <p>插件请求{{ confirmation }}。请确认这是你刚才发起的操作。</p>
    <label v-if="needCode">动态验证码<input v-model="code" autocomplete="one-time-code" inputmode="numeric" maxlength="6" /></label>
    <p v-if="verifyError" role="alert">{{ verifyError }}</p>
    <template #footer><MacButton :disabled="verifying" @click="settle(false)">取消</MacButton><MacButton variant="primary" :disabled="verifying" @click="confirm">确认</MacButton></template>
  </MacSheet>
</template>
<style scoped>
.plugin-config-sheet :deep(.mac-sheet-panel) { max-width: 960px; }
</style>
