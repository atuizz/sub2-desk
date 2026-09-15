<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { MacButton, MacSheet } from '@sub2-mac/core';
import { useAuthStore } from '../stores/auth';
import { getPublicModels } from '../api/public';
import { channelMonitorUserAPI, type UserMonitorView, type UserMonitorDetail } from '../api/channelMonitor';
import MonitorV2 from './MonitorV2.vue';
import type { ModelPlazaResponse, ModelPlazaGroup, PlazaModel } from '../api/modelPlaza';
import type { PublicSettings } from '../types';
import ModelPricingSheet from '../apps/user/ModelPricingSheet.vue';
import SafeContent from './SafeContent.vue';
import PlazaComparison from './PlazaComparison.vue';
import userChannelsAPI, { type UserAvailableChannel, type UserSupportedModel } from '../api/channels';
import userGroupsAPI from '../api/groups';
const props = defineProps<{ page: 'model-plaza' | 'monitor' | 'available-channels'; settings: PublicSettings }>();
const auth = useAuthStore();
const denied = computed(() => props.page === 'available-channels' ? !props.settings.available_channels_enabled ? '可用渠道尚未开放。' : !auth.isAuthenticated ? '登录后可查看可用渠道。' : ''
  : props.page === 'monitor' ? !props.settings.channel_monitor_enabled ? '此功能尚未开放。' : !auth.isAuthenticated ? '登录后可查看渠道状态。' : ''
  : !props.settings.model_plaza_enabled ? '模型广场尚未开放。' : props.settings.model_plaza_require_auth && !auth.isAuthenticated ? '登录后可查看模型广场。' : '');
const loading = ref(false); const error = ref(''); const search = ref(''); const groupId = ref('');
const platform = ref(''); const rateFilter = ref('');
const platformOptions = computed(() => [...new Set((plaza.value?.groups || []).map(group => group.platform))]);
const rateOptions = computed(() => [...new Set((plaza.value?.groups || []).map(group => group.user_rate_multiplier ?? group.rate_multiplier))].sort((a, b) => a - b));
const plaza = ref<ModelPlazaResponse | null>(null); const monitors = ref<UserMonitorView[]>([]);
const isV2 = computed(() => props.page === 'monitor' && props.settings.channel_monitor_mode === 'v2');
const selected = ref<{ model: PlazaModel | UserSupportedModel; group?: ModelPlazaGroup } | null>(null);
const channels = ref<UserAvailableChannel[]>([]); const rates = ref<Record<number, number>>({}); const ratesError = ref('');
const visibleChannels = computed(() => channels.value.filter(channel => `${channel.name} ${channel.description} ${channel.platforms.flatMap(section => section.supported_models.map(model => model.name)).join(' ')}`.toLowerCase().includes(search.value.toLowerCase())));
const detail = ref<UserMonitorDetail | null>(null); const detailId = ref<number | null>(null); const detailLoading = ref(false); const detailError = ref('');
let generation = 0; let detailGeneration = 0; let controller: AbortController | undefined;
onBeforeUnmount(() => { generation++; detailGeneration++; controller?.abort(); });
const groups = computed(() => (plaza.value?.groups || []).filter(group => !groupId.value || String(group.id) === groupId.value)
  .filter(group => (!platform.value || group.platform === platform.value) && (!rateFilter.value || String(group.user_rate_multiplier ?? group.rate_multiplier) === rateFilter.value))
  .sort((a, b) => (a.user_rate_multiplier ?? a.rate_multiplier) - (b.user_rate_multiplier ?? b.rate_multiplier))
  .map(group => ({ ...group, models: group.models.filter(model => `${group.name} ${model.name} ${model.platform}`.toLowerCase().includes(search.value.toLowerCase())) })).filter(group => group.models.length));
function closeDetail() { detailGeneration++; detailId.value = null; detail.value = null; detailLoading.value = false; detailError.value = ''; }
async function inspect(id: number) {
  const request = ++detailGeneration; detailId.value = id; detail.value = null; detailLoading.value = true; detailError.value = '';
  try { const data = await channelMonitorUserAPI.status(id); if (request === detailGeneration) detail.value = data; }
  catch { if (request === detailGeneration) detailError.value = '监控详情读取失败，请重试。'; }
  finally { if (request === detailGeneration) detailLoading.value = false; }
}
async function load() {
  const request = ++generation; controller?.abort(); controller = new AbortController(); closeDetail(); selected.value = null;
  plaza.value = null; monitors.value = []; channels.value = []; rates.value = {}; ratesError.value = ''; error.value = ''; loading.value = false;
  if (denied.value || isV2.value) return;
  loading.value = true;
  try {
    if (props.page === 'available-channels') {
      const [data, groupRates] = await Promise.all([userChannelsAPI.getAvailable({ signal: controller.signal }),
        userGroupsAPI.getUserGroupRates().catch(() => { if (request === generation) ratesError.value = '专属倍率未能读取，以下仅显示分组默认倍率。'; return {}; })]);
      if (request === generation) { channels.value = data; rates.value = groupRates; }
    } else if (props.page === 'model-plaza') {
      const data = await getPublicModels(controller.signal, auth.isAuthenticated ? auth.token || undefined : undefined);
      if (request === generation) plaza.value = data;
    } else {
      const data = await channelMonitorUserAPI.list({ signal: controller.signal });
      if (request === generation) monitors.value = data.items || [];
    }
  } catch { if (request === generation) error.value = '读取失败，功能可能未开放或会话已过期。请重试。'; }
  finally { if (request === generation) loading.value = false; }
}
watch(() => [props.page, props.settings, auth.user?.id, auth.token], load, { immediate: true });
const status = (value: string) => ({ operational: '正常', degraded: '降级', failed: '不可用', error: '检测失败', healthy: '健康', warning: '警告', critical: '严重', unknown: '未知' }[value] || '未检测');
const metric = (n: number | null | undefined, suffix = '') => n == null || !Number.isFinite(n) ? '—' : `${n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}${suffix}`;
</script>
<template>
  <section>
    <p v-if="denied" class="public-message">{{ denied }} <a v-if="!auth.isAuthenticated" href="/login" class="public-link">前往登录</a></p>
    <MonitorV2 v-else-if="isV2" :settings="settings" />
    <template v-else>
      <div class="public-form">
        <template v-if="page === 'model-plaza'"><label class="public-grow">搜索模型<input v-model="search" type="search" /></label><label>分组<select v-model="groupId"><option value="">全部分组</option><option v-for="group in plaza?.groups || []" :key="group.id" :value="String(group.id)">{{ group.name }}</option></select></label></template>
        <template v-if="page === 'model-plaza'"><label>平台<select v-model="platform" aria-label="平台"><option value="">全部平台</option><option v-for="name in platformOptions" :key="name">{{ name }}</option></select></label><label>倍率<select v-model="rateFilter" aria-label="倍率"><option value="">全部倍率</option><option v-for="value in rateOptions" :key="value" :value="String(value)">×{{ value }}</option></select></label><MacButton @click="search = ''; groupId = ''; platform = ''; rateFilter = ''">清除筛选</MacButton></template>
        <label v-else-if="page === 'available-channels'" class="public-grow">搜索渠道或模型<input v-model="search" type="search" /></label>

        <MacButton :disabled="loading" @click="load">刷新</MacButton>
      </div>
      <p v-if="loading" role="status" class="public-message">正在读取…</p><p v-else-if="error" role="alert" class="public-message public-error">{{ error }}</p>
      <template v-else-if="page === 'available-channels'">
        <p v-if="ratesError" class="public-message public-error" role="alert">{{ ratesError }}</p><p v-if="!visibleChannels.length" class="public-message">没有符合条件的渠道。</p>
        <section v-for="(channel, index) in visibleChannels" :key="index"><h2>{{ channel.name }}</h2><p>{{ channel.description }}</p>
          <div v-for="(section, sectionIndex) in channel.platforms" :key="sectionIndex"><h3>{{ section.platform }}</h3>
            <dl class="public-facts"><template v-for="group in section.groups" :key="group.id"><dt>{{ group.name }} · {{ group.is_exclusive ? '专属' : '公开' }} · {{ group.subscription_type === 'subscription' ? '订阅' : '标准' }}</dt><dd>倍率 ×{{ metric(rates[group.id] ?? group.rate_multiplier) }}<span v-if="group.peak_rate_enabled"> · 高峰 {{ group.peak_start }}–{{ group.peak_end }} ×{{ metric(group.peak_rate_multiplier) }}</span></dd></template></dl>
            <button v-for="model in section.supported_models" :key="model.name" class="public-row" @click="selected = { model }"><span>{{ model.name }}</span><span>查看渠道基础定价</span></button>
          </div>
        </section>
      </template>
      <template v-else-if="page === 'model-plaza'">
        <SafeContent v-if="plaza?.description" :content="plaza.description" />
        <p v-if="!groups.length" class="public-message">没有符合条件的模型。</p>
        <section v-for="group in groups" :key="group.id"><h2>{{ group.name }}</h2><p>{{ group.description }}</p><PlazaComparison :group="group" /></section>
      </template>
      <template v-else>
        <p v-if="!monitors.length" class="public-message">暂无可查看的监控。</p>
        <section v-for="monitor in monitors" :key="monitor.id"><button class="public-row" @click="inspect(monitor.id)"><span><strong>{{ monitor.name }}</strong><br />{{ monitor.primary_model }}</span><span>{{ status(monitor.primary_status) }} · {{ metric(monitor.primary_latency_ms, ' ms') }}<br />7 天可用率 {{ metric(monitor.availability_7d, '%') }}</span></button>
          <details v-if="monitor.timeline?.length"><summary>检查时间线</summary><div class="public-table-wrap"><table class="public-table"><tbody><tr v-for="(point, index) in monitor.timeline" :key="index"><td>{{ point.checked_at }}</td><td>{{ status(point.status) }}</td><td>{{ metric(point.latency_ms, ' ms') }}</td></tr></tbody></table></div></details>
        </section>
      </template>
    </template>
    <ModelPricingSheet :model="selected?.model || null" :group="selected?.group" @close="selected = null" />
    <MacSheet :show="detailId !== null" :title="detail?.name || '监控详情'" @close="closeDetail">
      <p v-if="detailLoading" role="status">正在读取…</p><div v-else-if="detailError" role="alert"><p>{{ detailError }}</p><MacButton @click="detailId !== null && inspect(detailId)">重试</MacButton></div>
      <dl v-for="model in detail?.models || []" :key="model.model" class="public-facts"><dt>模型</dt><dd>{{ model.model }}</dd><dt>状态</dt><dd>{{ status(model.latest_status) }}</dd><dt>7 / 15 / 30 天可用率</dt><dd>{{ metric(model.availability_7d, '%') }} / {{ metric(model.availability_15d, '%') }} / {{ metric(model.availability_30d, '%') }}</dd><dt>当前 / 7 天平均延迟</dt><dd>{{ metric(model.latest_latency_ms, ' ms') }} / {{ metric(model.avg_latency_7d_ms, ' ms') }}</dd></dl>
    </MacSheet>
  </section>
</template>
