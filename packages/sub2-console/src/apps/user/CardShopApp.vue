<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { MacAppIcon, MacButton, useWindowManager, type WindowInstance } from '@sub2-mac/core';
import { getAppIcon } from '@/assets/appIcons';
import { useCardShopStore } from '@/stores/cardShop';
import { frameRestriction } from '@/utils/cardShop';

defineProps<{ win?: WindowInstance }>();
const store = useCardShopStore();
const wm = useWindowManager();
const selectedId = ref('');
const selected = computed(() => store.shops.find(shop => shop.id === selectedId.value) ?? null);
const frameKey = ref(0);
const frameStatus = ref<'loading' | 'unverified' | 'error' | 'slow'>('loading');
const restriction = computed(() => selected.value ? frameRestriction(selected.value.url, window.location.origin) : '');
const fallback = computed(() => !!restriction.value || frameStatus.value === 'slow' || frameStatus.value === 'error');
let timer: ReturnType<typeof setTimeout> | undefined;

function stopTimer() { if (timer) clearTimeout(timer); timer = undefined; }
function reloadFrame() {
  stopTimer(); frameKey.value++; frameStatus.value = 'loading';
  if (selected.value && !restriction.value) timer = setTimeout(() => { frameStatus.value = 'slow'; }, 12000);
}
function frameLoaded() { stopTimer(); frameStatus.value = 'unverified'; }
function frameFailed() { stopTimer(); frameStatus.value = 'error'; }
watch(() => store.shops, shops => {
  if (!shops.some(shop => shop.id === selectedId.value)) selectedId.value = shops[0]?.id || '';
}, { immediate: true, flush: 'sync' });
watch([() => selected.value?.id, () => selected.value?.url], reloadFrame, { immediate: true });
onMounted(() => { void store.load(); });
onUnmounted(stopTimer);
</script>

<template>
  <div class="card-shop-app">
    <header class="shop-toolbar">
      <div class="shop-identity"><MacAppIcon :src="getAppIcon('card_shop')" :size="40" /><div class="shop-identity-copy"><strong>网上小铺</strong><span>购买后使用兑换码充值</span></div></div>
      <label class="shop-picker">店铺<select v-model="selectedId" :disabled="!store.shops.length" aria-label="选择店铺"><option v-if="!store.shops.length" value="">暂无店铺</option><option v-for="shop in store.shops" :key="shop.id" :value="shop.id">{{ shop.name }}</option></select></label>
      <MacButton v-if="!restriction" :disabled="!selected" @click="reloadFrame">刷新网页</MacButton>
      <a v-if="selected" class="shop-external" :href="selected.url" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">外部打开 ↗</a>
      <MacButton v-else disabled>外部打开 ↗</MacButton>
      <MacButton variant="primary" :disabled="!wm" @click="wm?.openApp('voucher')">兑换购买的卡密</MacButton>
    </header>
    <div class="shop-address"><span>店铺域名</span><strong>{{ selected?.domain || '—' }}</strong><MacButton size="sm" :loading="store.loading" @click="store.reload()">重新读取店铺</MacButton></div>
    <div v-if="store.loading && !selected" class="shop-empty" role="status">正在读取店铺配置…</div>
    <div v-else-if="store.error && !selected" class="shop-empty" role="alert"><strong>店铺暂不可用</strong><p>{{ store.error }}</p><MacButton @click="store.reload()">重试</MacButton></div>
    <div v-else-if="!selected" class="shop-empty"><strong>尚未配置网上小铺</strong><p>请联系管理员添加店铺。已有兑换码可直接兑换。</p><MacButton @click="store.reload()">重新读取</MacButton></div>
    <template v-else>
      <div v-if="store.error" class="shop-notice" role="alert"><span>{{ store.error }}。当前显示上次读取的店铺。</span><MacButton size="sm" @click="store.reload()">重试配置</MacButton></div>
      <p v-if="!restriction && frameStatus==='loading'" class="shop-loading" role="status">正在打开店铺…</p>
      <iframe v-if="!restriction" v-show="!fallback" :key="frameKey" :src="selected.url" :title="`${selected.name} 店铺网页`" class="shop-frame" sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" @load="frameLoaded" @error="frameFailed" />
      <div v-if="fallback" class="shop-empty"><strong>{{ selected.name }}</strong><p>{{ restriction || '店铺暂未加载完成，可以直接打开店铺，或重试应用内浏览。' }}</p><a class="shop-external" :href="selected.url" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">打开店铺购买 ↗</a><MacButton v-if="!restriction" @click="reloadFrame">重试应用内浏览</MacButton><p>购买后回到这里，点击“兑换购买的卡密”。</p></div>
    </template>
    <footer class="shop-footer">购买后点击上方按钮兑换卡密。若网页无法显示，请外部打开。</footer>
  </div>
</template>

<style scoped>
.card-shop-app{display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;background:var(--bg-surface);color:var(--text-primary)}
.shop-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:12px 16px;background:var(--window-bg-solid);border-bottom:1px solid var(--border-subtle)}
.shop-identity{display:flex;align-items:center;gap:8px;margin-right:auto}.shop-identity-copy{display:grid;gap:3px}.shop-identity strong{font-size:14px}.shop-identity-copy span{font-size:11px;color:var(--text-secondary)}
.shop-picker{display:flex;align-items:center;gap:6px;font-size:12px;min-width:0}.shop-picker select{max-width:200px;min-width:0;padding:5px 8px;border:1px solid var(--border-subtle);border-radius:7px;background:var(--bg-surface);color:var(--text-primary)}
.shop-external{display:inline-flex;align-items:center;min-height:28px;padding:4px 10px;border:1px solid var(--border-subtle);border-radius:7px;font-size:12px;background:var(--window-bg-solid);color:var(--accent,#007aff);text-decoration:none}
.shop-external:focus-visible,.shop-picker select:focus-visible{outline:3px solid rgb(0 122 255 / 35%);outline-offset:2px}
.shop-address{display:flex;align-items:center;gap:10px;padding:8px 16px;font-size:11px;border-bottom:1px solid var(--border-subtle);min-width:0}.shop-address span{color:var(--text-secondary)}.shop-address strong{flex:1;min-width:0;overflow-wrap:anywhere;font-weight:500;user-select:text}
.shop-frame{flex:1;width:100%;min-height:120px;border:0;background:#fff}.shop-empty{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:12px;padding:24px;font-size:12px;overflow:auto}.shop-empty p{color:var(--text-secondary);max-width:420px}
.shop-loading{padding:6px 16px;font-size:11px;color:var(--text-secondary)}
.shop-notice{display:flex;align-items:center;gap:12px;padding:10px 16px;background:var(--bg-canvas);font-size:11px;line-height:1.5;color:var(--text-secondary)}.shop-notice span{flex:1;min-width:0}.shop-footer{font-size:10px;color:var(--text-secondary);padding:8px 16px;border-top:1px solid var(--border-subtle);line-height:1.5}
@container app-window (max-width:540px){.shop-toolbar{padding:10px;gap:8px}.shop-identity{width:100%}.shop-picker{flex:1}.shop-picker select{max-width:140px}.shop-notice{padding:8px 10px}.shop-address{padding:8px 10px}}
</style>
