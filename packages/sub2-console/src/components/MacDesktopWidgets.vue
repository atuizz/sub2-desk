<script setup lang="ts">
import { getAppIcon } from '@/assets/appIcons';
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useAuthStore } from '../stores/auth';
import { useSystemStore } from '../stores/system';
import { usageAPI, type UserDashboardStats } from '../api/usage';
import { dashboardAPI } from '../api/admin/dashboard';
import type { DashboardStats } from '../types';
import { buildGatewayUrl } from '../api/url';
import {
  formatBalance,
  formatTokens,
  formatNumber,
} from '../utils/format';

const props = defineProps<{
  balance?: number;
  latency?: number;
}>();

const emit = defineEmits<{
  (e: 'openApp', appId: string): void;
}>();

const authStore = useAuthStore();
const systemStore = useSystemStore();

const dashboardStats = ref<UserDashboardStats | null>(null);
const adminStats = ref<DashboardStats | null>(null);
const measuredLatency = ref<number | null>(null);
const isOnline = ref(false);
const statsFailed = ref(false);
let generation = 0;
let probeTimer: any = null;
let statsTimer: any = null;

async function probeGateway() {
  const start = performance.now();
  try {
    const res = await fetch(buildGatewayUrl('/health'), { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const rtt = Math.max(1, Math.round(performance.now() - start));
      measuredLatency.value = rtt;
      systemStore.latency = rtt;
      isOnline.value = true;
      systemStore.connectionStatus = 'online';
    } else {
      isOnline.value = false;
      systemStore.connectionStatus = 'offline';
    }
  } catch {
    isOnline.value = false;
    systemStore.connectionStatus = 'offline';
  }
}

async function loadStats() {
  if (!authStore.isAuthenticated) {
    return;
  }
  try {
    const currentGeneration = generation;
    const userPromise = usageAPI.getDashboardStats();
    const adminPromise = authStore.isAdmin ? dashboardAPI.getStats() : Promise.resolve(null);

    const [userData, adminData] = await Promise.all([userPromise, adminPromise]);
    if (currentGeneration !== generation) return;
    statsFailed.value = false;
    dashboardStats.value = userData;
    if (adminData) {
      adminStats.value = adminData;
    }
  } catch (error) {
    statsFailed.value = true;
  }
}

watch(() => [authStore.user?.id, authStore.user?.role], () => { generation++; dashboardStats.value = null; adminStats.value = null; loadStats(); });
onMounted(() => {
  probeGateway();
  loadStats();
  probeTimer = setInterval(probeGateway, 15000);
  statsTimer = setInterval(loadStats, 30000);
});

onUnmounted(() => {
  if (probeTimer) clearInterval(probeTimer);
  if (statsTimer) clearInterval(statsTimer);
});

const userBalance = computed(() => {
  if (typeof props.balance === 'number') return formatBalance(props.balance);
  if (authStore.user?.balance !== undefined) return formatBalance(authStore.user.balance);
  return '—';
});

function metric(value: unknown, tokens = false) { return typeof value === 'number' && Number.isFinite(value) ? (tokens ? formatTokens(value) : formatNumber(value)) : '—'; }
const summary = computed(() => authStore.isAdmin ? adminStats.value : dashboardStats.value);
const gatewayLatency = computed(() => {
  if (!isOnline.value) return '--';
  return measuredLatency.value ?? '—';
});
</script>

<template>
  <aside class="desktop-widgets" aria-label="桌面概览">
    <button class="desktop-widget" type="button" @click="emit('openApp', 'dashboard')">
      <header><img :src="getAppIcon('dashboard')" alt="" /><span>{{ authStore.isAdmin ? '平台概览' : '账户余额' }}</span></header>
      <div class="widget-metric">{{ authStore.isAdmin ? metric(adminStats?.total_users) : (userBalance === '—' ? '—' : '$' + userBalance) }}</div>
      <p>{{ authStore.isAdmin ? '注册用户' : '可用余额' }}</p>
      <footer><span>{{ statsFailed ? '暂时无法更新' : authStore.isAdmin ? '账号 ' + metric(adminStats?.total_accounts) : '查看消费明细' }}</span><span aria-hidden="true">›</span></footer>
    </button>
    <button class="desktop-widget" type="button" @click="emit('openApp', 'activity')">
      <header><img :src="getAppIcon('activity')" alt="" /><span>今日用量</span></header>
      <div class="widget-metric">{{ metric(summary?.today_requests) }}<small>次</small></div>
      <p>{{ metric(summary?.today_tokens, true) }} Token</p>
      <footer><span>{{ statsFailed ? '暂时无法更新' : summary ? '查看使用记录' : '等待数据' }}</span><span aria-hidden="true">›</span></footer>
    </button>
    <button class="desktop-widget" type="button" @click="emit('openApp', 'network')">
      <header><img :src="getAppIcon('network')" alt="" /><span>后端连接</span></header>
      <div class="widget-metric">{{ isOnline ? gatewayLatency : '—' }}<small v-if="isOnline">ms</small></div>
      <p class="widget-status"><i :class="systemStore.connectionStatus" />{{ systemStore.connectionStatus === 'online' ? '已连接' : systemStore.connectionStatus === 'offline' ? '连接中断' : '等待连接' }}</p>
      <footer><span>查看可用渠道</span><span aria-hidden="true">›</span></footer>
    </button>
  </aside>
</template>
<style scoped>
.desktop-widgets { position:absolute;top:50px;left:22px;display:flex;gap:14px;z-index:0; }
.desktop-widget { width:160px;height:158px;display:flex;flex-direction:column;text-align:left;padding:15px;border-radius:22px;border:1px solid rgba(255,255,255,.32);color:rgba(255,255,255,.96);background:rgba(20,35,54,.32);backdrop-filter:blur(28px) saturate(125%);-webkit-backdrop-filter:blur(28px) saturate(125%);box-shadow:var(--shadow-widget);transition:background 160ms ease,transform 160ms ease; }
.desktop-widget:hover { background:rgba(20,35,54,.43); }.desktop-widget:active { transform:scale(.985); }
header { display:flex;gap:7px;align-items:center;font-size:11px;font-weight:550; }header img { width:20px;height:20px;object-fit:contain; }
.widget-metric { font-size:29px;letter-spacing:-1px;line-height:1.15;font-weight:600;margin-top:14px;font-variant-numeric:tabular-nums; }.widget-metric small { font-size:12px;letter-spacing:0;font-weight:400;margin-left:4px;opacity:.75; }
p { margin-top:5px;font-size:11px;color:rgba(255,255,255,.77); }.widget-status { display:flex;align-items:center;gap:5px; }.widget-status i { width:5px;height:5px;border-radius:50%;background:#ffffff88; }.widget-status i.online { background:#7ae2a0; }.widget-status i.offline { background:#eaba74; }
footer { margin-top:auto;padding-top:9px;display:flex;justify-content:space-between;font-size:10px;border-top:1px solid #ffffff18;color:#ffffffb3; }
.dark .desktop-widget { background:rgba(17,23,35,.45);border-color:#ffffff1c; }
@media(max-width:1150px) { .desktop-widget { width:145px;height:148px; }.desktop-widgets { gap:10px; } }
@media(max-width:767px) { .desktop-widgets { display:none; } }
@media(prefers-reduced-motion:reduce) { .desktop-widget { transition:none; } }
</style>
