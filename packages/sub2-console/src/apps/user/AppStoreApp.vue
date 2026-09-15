<script setup lang="ts">
import { getAppIcon } from '@/assets/appIcons';
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import './app-polish.css';
import type { WindowInstance } from '@sub2-mac/core';
import modelPlazaAPI, {
  type ModelPlazaResponse,
  type ModelPlazaGroup,
  type PlazaModel
} from '../../api/modelPlaza';
import ModelPricingSheet from './ModelPricingSheet.vue';

defineProps<{
  win?: WindowInstance;
}>();

const inspectedModel = ref<{ model: PlazaModel; group: ModelPlazaGroup } | null>(null);
let request: AbortController | null = null;
onBeforeUnmount(() => request?.abort());

const plazaData = ref<ModelPlazaResponse | null>(null);
const loading = ref(false);
const loadFailed = ref(false);

const selectedPlatform = ref<string>('all');
const selectedGroupId = ref<number | 'all'>('all');
const selectedRate = ref<number | 'all'>('all');
const searchQuery = ref('');

const searchActive = computed(() => searchQuery.value.trim() !== '');

async function loadPlaza() {
  request?.abort();
  const current = new AbortController();
  request = current;
  loading.value = true;
  loadFailed.value = false;
  try {
    const res = await modelPlazaAPI.getModelPlaza({ signal: current.signal });
    if (current.signal.aborted) return;
    plazaData.value = res || { description: '', groups: [] };
  } catch (err) {
    if (current.signal.aborted) return;
    console.error('Failed to load model plaza:', err);
    loadFailed.value = true;
    // Preserve the last successful catalogue on refresh failure.
  } finally {
    if (request === current) loading.value = false;
  }
}

// Available filter options derived from live groups
const platforms = computed(() => {
  if (!plazaData.value?.groups) return [];
  const set = new Set<string>();
  plazaData.value.groups.forEach(g => {
    if (g.platform) set.add(g.platform);
  });
  return Array.from(set);
});

const rates = computed(() => {
  if (!plazaData.value?.groups) return [];
  const set = new Set<number>();
  plazaData.value.groups.forEach(g => {
    const r = g.user_rate_multiplier ?? g.rate_multiplier;
    if (typeof r === 'number') set.add(r);
  });
  return Array.from(set).sort((a, b) => a - b);
});

// Filter groups based on platform and group selection
const filteredGroups = computed(() => {
  if (!plazaData.value?.groups) return [];
  return plazaData.value.groups.filter(group => {
    if (selectedPlatform.value !== 'all' && group.platform.toLowerCase() !== selectedPlatform.value.toLowerCase()) {
      return false;
    }
    if (selectedGroupId.value !== 'all' && group.id !== selectedGroupId.value) {
      return false;
    }
    if (selectedRate.value !== 'all') {
      const r = group.user_rate_multiplier ?? group.rate_multiplier;
      if (r !== selectedRate.value) return false;
    }
    return true;
  }).map(group => {
    if (!searchActive.value) return group;
    const q = searchQuery.value.toLowerCase().trim();
    const filteredModels = group.models.filter(m =>
      m.name.toLowerCase().includes(q)
    );
    return { ...group, models: filteredModels };
  }).filter(group => {
    return !searchActive.value || group.models.length > 0;
  });
});

// All models flattened for App Store discovery view
const allModelsCount = computed(() => {
  if (!plazaData.value?.groups) return 0;
  let count = 0;
  plazaData.value.groups.forEach(g => count += g.models.length);
  return count;
});

const visibleModelsCount = computed(() => filteredGroups.value.reduce((count, group) => count + group.models.length, 0));
function modelSummary(model: PlazaModel, group: ModelPlazaGroup): string {
  const pricing = model.pricing;
  if (!pricing) return '定价未提供';
  const rate = group.user_rate_multiplier ?? group.rate_multiplier;
  if (pricing.billing_mode === 'token' || !pricing.billing_mode) {
    return `入 ${formatPriceUnit(pricing.input_price, rate)} · 出 ${formatPriceUnit(pricing.output_price, rate)}`;
  }
  const multiplier = pricing.billing_mode === 'image' && group.image_rate_independent ? group.image_rate_multiplier : rate;
  const unit = pricing.billing_mode === 'image' ? '张' : '次';
  return pricing.per_request_price == null ? '定价未提供' : `$${(pricing.per_request_price * multiplier).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}/${unit}`;
}

function platformIconBg(platform?: string): string {
  switch (platform?.toLowerCase()) {
    case 'anthropic': return 'bg-gradient-to-tr from-[#d97757] to-[#b3593b] text-white';
    case 'openai': return 'bg-gradient-to-tr from-[#10a37f] to-[#0b6b54] text-white';
    case 'gemini':
    case 'google': return 'bg-gradient-to-tr from-[#4285f4] via-[#9b72cb] to-[#d96570] text-white';
    case 'deepseek': return 'bg-gradient-to-tr from-[#4d6bfe] to-[#243bb5] text-white';
    case 'grok':
    case 'xai': return 'bg-gradient-to-tr from-[#262626] to-[#0a0a0a] text-white border border-white/10';
    default: return 'bg-gradient-to-tr from-[#8b5cf6] to-[#6d28d9] text-white';
  }
}

function platformBadgeClass(platform?: string): string {
  switch (platform?.toLowerCase()) {
    case 'anthropic': return 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20';
    case 'openai': return 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    case 'gemini':
    case 'google': return 'text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20';
    case 'deepseek': return 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/20';
    default: return 'text-purple-600 dark:text-purple-400 bg-purple-500/10 border-purple-500/20';
  }
}

function formatPriceUnit(price: number | null | undefined, multiplier: number = 1): string {
  if (price == null) return '—';
  const val = price * 1000000 * multiplier;
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}/1M`;
}

onMounted(() => {
  loadPlaza();
});
</script>

<template>
  <div class="user-app-polish appstore-app relative h-full flex flex-col bg-[#f5f5f7] dark:bg-[#1e1e20] text-[#1d1d1f] dark:text-[#f5f5f7] select-none text-[13px] overflow-hidden font-sans">
    <!-- Mac App Store Top Navigation Bar -->
    <div class="app-toolbar h-13 px-5 border-b border-black/[0.08] dark:border-white/[0.08] flex items-center justify-between bg-white/75 dark:bg-[#28282b]/75 backdrop-blur-xl shrink-0 gap-4 z-10">
      <!-- Left Branding -->
      <div class="flex items-center gap-3 shrink-0">
        <img :src="getAppIcon('appstore')" alt="模型广场" class="w-7 h-7 object-contain drop-shadow-sm" />
        <div>
          <h1 class="app-title">模型广场</h1>
          <div class="text-[10px] text-black/45 dark:text-white/45">共收录 {{ allModelsCount }} 款可用 AI 模型</div>
        </div>
      </div>

      <!-- Segmented Category Bar (App Store Style) -->
      <div class="app-filterbar flex items-center p-0.5 rounded-[9px] bg-black/[0.06] dark:bg-white/[0.08] border border-black/[0.04] dark:border-white/[0.06] text-xs">
        <button
          class="px-3 py-1 rounded-[7px] text-[11.5px] font-medium transition-all"
          :class="selectedPlatform === 'all' ? 'bg-white dark:bg-[#38383a] text-black dark:text-white shadow-xs font-semibold' : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
          @click="selectedPlatform = 'all'"
        >
          探索全部
        </button>
        <button
          v-for="p in platforms"
          :key="p"
          class="px-3 py-1 rounded-[7px] text-[11.5px] font-medium capitalize transition-all"
          :class="selectedPlatform.toLowerCase() === p.toLowerCase() ? 'bg-white dark:bg-[#38383a] text-black dark:text-white shadow-xs font-semibold' : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
          @click="selectedPlatform = p"
        >
          {{ p }}
        </button>
      </div>

      <!-- Right Controls: Search & Refresh -->
      <div class="app-actions">
        <!-- NSSearchField Capsule -->
        <div class="relative w-52">
          <svg class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-black/40 dark:text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            v-model="searchQuery"
            type="text"
            aria-label="搜索模型名称" placeholder="搜索模型名称"
            class="w-full h-7 pl-8 pr-6 bg-black/[0.04] dark:bg-white/[0.08] border border-black/10 dark:border-white/10 rounded-full text-xs text-black dark:text-white placeholder:text-black/40 dark:placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[#007aff]/30 focus:border-[#007aff] transition-all"
          />
          <button
            v-if="searchQuery"
            aria-label="清除搜索" @click="searchQuery = ''"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-black/30 dark:text-white/30 hover:text-black/60 dark:hover:text-white/60 text-xs"
          >
            ✕
          </button>
        </div>

        <button
          @click="loadPlaza"
          :disabled="loading"
          class="w-7 h-7 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 transition-all flex items-center justify-center text-black/65 dark:text-white/75"
          title="刷新模型市场"
        >
          <svg class="w-3.5 h-3.5" :class="loading ? 'animate-spin' : ''" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
        </button>
      </div>
    </div>

    <div class="plaza-group-filter">
      <label>分组 <select v-model="selectedGroupId" aria-label="筛选模型分组"><option value="all">全部分组</option><option v-for="group in plazaData?.groups || []" :key="group.id" :value="group.id">{{ group.name }}</option></select></label>
      <span role="status">{{ loading ? '正在刷新…' : `${filteredGroups.length} 个分组 · ${visibleModelsCount} 个模型条目` }}</span>
    </div>
    <div v-if="loadFailed && plazaData" class="app-notice" data-tone="error" role="alert"><span>刷新失败，当前显示上次加载的目录。</span><button :disabled="loading" @click="loadPlaza">重试</button></div>
    <!-- Main Content Stream (Mac App Store Layout) -->
    <div class="app-content flex-1 overflow-y-auto space-y-5">
      <section v-if="!loading && !loadFailed && selectedPlatform === 'all' && !searchActive" class="app-panel model-overview app-section-heading">
        <div><h2>找到适合的模型</h2><p class="text-xs mt-1 text-[var(--app-muted)]">按平台、分组和计费倍率比较当前可用模型。</p></div>
        <div class="text-right shrink-0"><strong class="text-xl font-semibold tabular-nums">{{ allModelsCount }}</strong><span class="ml-1 text-xs text-[var(--app-muted)]">个模型</span></div>
      </section>

      <!-- 2. Rate Filter Chips (Subtle Mac Pill Group) -->
      <div v-if="rates.length > 1" class="app-filterbar flex items-center gap-2 text-xs">
        <span class="text-[11px] text-black/45 dark:text-white/45 font-medium">计费倍率：</span>
        <button
          class="px-2.5 py-0.5 rounded-full text-[11px] font-mono transition-all"
          :class="selectedRate === 'all' ? 'bg-[#007aff] text-white font-medium shadow-xs' : 'bg-black/[0.04] dark:bg-white/[0.08] text-black/70 dark:text-white/70 hover:bg-black/8 dark:hover:bg-white/12'"
          @click="selectedRate = 'all'"
        >
          全部
        </button>
        <button
          v-for="r in rates"
          :key="'rate-' + r"
          class="px-2.5 py-0.5 rounded-full text-[11px] font-mono transition-all"
          :class="selectedRate === r ? 'bg-[#007aff] text-white font-medium shadow-xs' : 'bg-black/[0.04] dark:bg-white/[0.08] text-black/70 dark:text-white/70 hover:bg-black/8 dark:hover:bg-white/12'"
          @click="selectedRate = r"
        >
          {{ r }}x
        </button>
      </div>

      <!-- Loading State -->
      <div v-if="loading && !plazaData" class="h-64 flex flex-col items-center justify-center gap-3 text-black/40 dark:text-white/40">
        <svg class="w-6 h-6 animate-spin text-[#007aff]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle class="opacity-25" cx="12" cy="12" r="10" />
          <path class="opacity-75" d="M4 12a8 8 0 018-8v8H4z" fill="currentColor" />
        </svg>
        <span class="text-xs font-medium">正在载入模型市场...</span>
      </div>

      <div v-else-if="loadFailed && !plazaData" class="app-empty" role="alert"><strong>模型目录暂时无法加载</strong><p>请检查连接，或确认当前站点已开放模型广场。</p><button class="app-retry" @click="loadPlaza">重新加载</button></div>
      <!-- Empty State -->
      <div v-else-if="filteredGroups.length === 0" class="h-64 flex flex-col items-center justify-center p-12 text-center text-black/40 dark:text-white/40">
        <img :src="getAppIcon('appstore')" alt="Empty" class="w-12 h-12 object-contain opacity-30 grayscale mb-3" />
        <div class="text-sm font-semibold text-black/70 dark:text-white/70">{{ searchActive ? '未找到符合条件的模型' : '暂无可用模型分组' }}</div>
        <div class="text-xs text-black/40 dark:text-white/40 mt-1">请尝试更换搜索关键字或重置平台过滤筛选</div>
        <button class="app-retry mt-3" @click="searchQuery = ''; selectedPlatform = 'all'; selectedRate = 'all'; selectedGroupId = 'all'">清除筛选</button>
      </div>

      <!-- 3. Model Groups Sections -->
      <div v-else class="space-y-8">
        <div
          v-for="group in filteredGroups"
          :key="'group-' + group.id"
          class="space-y-3"
        >
          <!-- Group Section Header (Apple Section Style) -->
          <div class="app-section-heading flex items-center justify-between pb-2 border-b border-black/[0.06] dark:border-white/[0.06]">
            <div class="flex items-center gap-2.5">
              <span
                class="w-2 h-2 rounded-full"
                :class="group.platform === 'anthropic' ? 'bg-amber-500' : group.platform === 'openai' ? 'bg-emerald-500' : 'bg-blue-500'"
              ></span>
              <h3 class="app-long-value text-[15px] font-semibold text-black/90 dark:text-white/90 tracking-tight">
                {{ group.name }}
              </h3>
              <span
                :class="platformBadgeClass(group.platform)"
                class="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
              >
                {{ group.platform }}
              </span>
              <span
                v-if="group.is_exclusive"
                class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20"
              >
                专属
              </span>
              <span
                v-if="group.subscription_type === 'subscription'"
                class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20"
              >
                订阅
              </span>
            </div>

            <!-- Rate Badge -->
            <div class="text-xs font-mono font-medium text-black/55 dark:text-white/55">
              分组倍率: <span class="font-bold text-black/80 dark:text-white/90">{{ (group.user_rate_multiplier ?? group.rate_multiplier).toFixed(2) }}x</span>
            </div>
          </div>

          <p v-if="group.description" class="text-xs text-black/50 dark:text-white/50 leading-relaxed">
            {{ group.description }}
          </p>

          <!-- Mac App Store Grid of Models (Authentic App Row Cards) -->
          <div class="app-model-grid grid grid-cols-1 md:grid-cols-2 gap-3">
            <div
              v-for="model in group.models"
              :key="model.name"
              class="app-panel p-4 rounded-xl bg-white/85 dark:bg-[#252528]/85 border border-black/[0.06] dark:border-white/[0.08] shadow-xs hover:shadow-md transition-all flex items-center justify-between gap-4 group"
            >
              <!-- Left: Vendor Emblem & Details -->
              <div class="flex items-center gap-3.5 min-w-0">
                <!-- Squircle Vendor Emblem -->
                <div
                  class="w-11 h-11 rounded-[13px] flex items-center justify-center font-bold text-sm shadow-xs shrink-0 select-none"
                  :class="platformIconBg(group.platform)"
                >
                  <span v-if="group.platform === 'anthropic'">A</span>
                  <span v-else-if="group.platform === 'openai'">AI</span>
                  <span v-else-if="group.platform === 'gemini' || group.platform === 'google'">G</span>
                  <span v-else-if="group.platform === 'deepseek'">DS</span>
                  <span v-else>LLM</span>
                </div>

                <!-- Text Details -->
                <div class="min-w-0 space-y-0.5">
                  <div class="font-semibold text-xs text-black/90 dark:text-white/90 truncate group-hover:text-[#007aff] transition-colors">
                    {{ model.name }}
                  </div>
                  <div class="text-[10.5px] text-black/45 dark:text-white/45 truncate">
                    {{ group.name }} · {{ group.platform.toUpperCase() }}
                  </div>
                  <!-- Pricing Pill -->
                  <div class="text-[11px] font-mono text-black/70 dark:text-white/70 tabular-nums pt-0.5">
                    {{ modelSummary(model, group) }}
                  </div>
                </div>
              </div>

              <!-- Right: Mac App Store Classic "获取" / "就绪" (GET) Pill Button -->
              <div class="shrink-0 flex flex-col items-end gap-1">
                <button
                  type="button"
                  :aria-label="`查看 ${model.name} 定价`"
                  @click="inspectedModel = { model, group }"
                  class="h-6 px-3.5 rounded-full bg-black/[0.06] dark:bg-white/[0.1] hover:bg-[#007aff] hover:text-white text-[#007aff] dark:text-[#0a84ff] font-bold text-[11px] uppercase tracking-wide transition-all shadow-2xs active:scale-95 cursor-pointer"
                >
                  查看定价
                </button>
                <span class="text-[9.5px] text-black/35 dark:text-white/35 font-mono">标准时段</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <ModelPricingSheet :model="inspectedModel?.model || null" :group="inspectedModel?.group" @close="inspectedModel = null" />
  </div>
</template>

<style scoped>
.plaza-group-filter { display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:8px 16px;border-bottom:1px solid var(--border-subtle);font-size:11px;flex-shrink:0;color:var(--text-secondary); }
.plaza-group-filter label { display:flex;align-items:center;gap:8px;min-width:0; }.plaza-group-filter select { max-width:240px;min-width:0;padding:4px 8px;border:1px solid var(--border-subtle);border-radius:6px;background:var(--control-bg);color:var(--text-primary); }
.appstore-app .app-model-grid { grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr)); }
.appstore-app .app-model-grid > .app-panel { padding:12px;box-shadow:none; }
@container app-window (max-width:500px) { .plaza-group-filter select { max-width:200px; }.appstore-app .app-section-heading { flex-wrap:wrap;gap:8px; } }
</style>
