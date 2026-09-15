<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { MacButton, MacAlertSheet, MacDraftGuard } from '@sub2-mac/core';
import { getAppIcon } from '@/assets/appIcons';
import { getSettings, updateSettings } from '@/api/admin/settings';
import { useAuthStore } from '@/stores/auth';
import { useCardShopStore } from '@/stores/cardShop';
import { supportsShopEmbed } from '@/utils/cardShop';
import { CARD_SHOP_PREFIX, readMenuItems, shopDrafts, shopFingerprint, mergeShopItems, validateShopDrafts, safeShopURL, type CardShopDraft } from '@/utils/cardShop';

defineProps<{ sheetTarget?: HTMLElement | null }>();

const auth = useAuthStore();
const publicStore = useCardShopStore();
const drafts = ref<CardShopDraft[]>([]);
const loaded = ref(false), loading = ref(false), saving = ref(false), error = ref(''), message = ref('');
const baseline = ref(''), initialDrafts = ref('');
const dirty = computed(() => initialDrafts.value !== '' && JSON.stringify(drafts.value) !== initialDrafts.value);
const confirmReload = ref(false);
let generation = 0, disposed = false;

function shopInfo(value: string) {
  if (!value.trim()) return { domain: '填写店铺地址后自动识别', provider: '新店铺', mode: '待填写地址', tone: 'empty' };
  try {
    const url = new URL(safeShopURL(value));
    const name = url.hostname.replace(/^www\./, '');
    const provider = name === 'catfk.com' ? '云猫寄售' : name === '16688.com.cn' ? '16688 小铺' : '自定义店铺';
    return { domain: url.hostname, provider, mode: supportsShopEmbed(value.trim()) ? '应用内浏览' : '外部浏览器', tone: supportsShopEmbed(value.trim()) ? 'embedded' : 'external' };
  } catch { return { domain: '请填写完整的 http:// 或 https:// 地址', provider: '店铺地址', mode: '地址待完善', tone: 'invalid' }; }
}
function requestReload() {
  if (saving.value || loading.value) return;
  if (dirty.value) confirmReload.value = true;
  else void load();
}
function reloadConfirmed() { confirmReload.value = false; void load(); }

async function load() {
  if (!auth.isAdmin || saving.value) return;
  const rev = ++generation;
  loading.value = true; loaded.value = false; error.value = ''; message.value = ''; drafts.value = [];
  try {
    const data = await getSettings();
    if (disposed || rev !== generation || !auth.isAdmin) return;
    const items = readMenuItems(data);
    drafts.value = shopDrafts(items); baseline.value = shopFingerprint(items);
    initialDrafts.value = JSON.stringify(drafts.value); loaded.value = true;
  } catch (failure) {
    if (!disposed && rev === generation) error.value = (failure as { message?: string })?.message || '无法读取小铺配置';
  } finally { if (rev === generation) loading.value = false; }
}

function add() {
  if (!loaded.value || saving.value || !auth.isAdmin) return;
  drafts.value.push({ id: CARD_SHOP_PREFIX + crypto.randomUUID().replace(/-/g, '').slice(0, 16), name: '', url: '' });
}
function remove(id: string) {
  if (!loaded.value || saving.value || !auth.isAdmin) return;
  drafts.value = drafts.value.filter(shop => shop.id !== id);
}
async function save() {
  if (!auth.isAdmin || !loaded.value || !dirty.value || saving.value || loading.value) return;
  error.value = ''; message.value = '';
  try { validateShopDrafts(drafts.value); }
  catch (failure) { error.value = (failure as Error).message; return; }
  const rev = generation;
  const snapshot = drafts.value.map(draft => ({ ...draft }));
  let submitted = false;
  saving.value = true;
  try {
    const latest = readMenuItems(await getSettings());
    if (disposed || rev !== generation || !auth.isAdmin) return;
    const merged = mergeShopItems(latest, snapshot, baseline.value);
    submitted = true;
    const response = await updateSettings({ custom_menu_items: merged });
    if (disposed || rev !== generation || !auth.isAdmin) return;
    const saved = readMenuItems(response);
    if (shopFingerprint(saved) !== shopFingerprint(merged)) {
      loaded.value = false;
      throw new Error('保存已提交，但返回的小铺配置与提交内容不一致，请重新读取确认');
    }
    drafts.value = shopDrafts(saved); baseline.value = shopFingerprint(saved);
    initialDrafts.value = JSON.stringify(drafts.value);
    message.value = '小铺配置已保存';
    await publicStore.reload();
    if (!disposed && rev === generation && publicStore.error) message.value = '配置已保存，但公共店铺列表刷新失败，请在小铺中重新读取';
  } catch (failure) {
    if (!disposed && rev === generation) {
      if (submitted) loaded.value = false;
      error.value = ((failure as { message?: string })?.message || '保存失败') + (submitted ? '；请重新读取确认保存结果后再修改。' : '');
    }
  } finally { if (rev === generation) saving.value = false; }
}

watch([() => auth.user?.id, () => auth.user?.role], () => {
  generation++; drafts.value = []; loaded.value = false; loading.value = false; saving.value = false;
  baseline.value = ''; initialDrafts.value = ''; error.value = ''; message.value = '';
  confirmReload.value = false;
  if (auth.isAdmin) void load();
}, { flush: 'sync' });
onMounted(load);
onUnmounted(() => { disposed = true; generation++; });
</script>

<template>
  <section class="shop-settings" aria-label="小铺与兑换设置">
    <MacDraftGuard :dirty="dirty" :busy="saving" />
    <header class="shop-page-heading">
      <img :src="getAppIcon('card_shop')" width="40" height="40" alt="" />
      <div><h2>网上小铺</h2><p>连接卡密店铺，让用户购买后返回兑换。</p></div>
      <MacButton v-if="auth.isAdmin" size="sm" :disabled="!loaded || saving || loading" @click="add"><span aria-hidden="true" class="add-symbol">＋</span>添加店铺</MacButton>
    </header>
      <p v-if="!auth.isAdmin">只有管理员可以配置网上小铺。</p>
      <template v-else>
        <p v-if="loading" role="status" class="shop-feedback">正在读取店铺配置…</p>
        <p v-if="error" role="alert" class="shop-feedback shop-settings-error">{{ error }}</p>
        <div class="shop-config-group">
          <fieldset :disabled="!loaded || saving || loading" class="shop-settings-fields">
            <article v-for="(shop,index) in drafts" :key="shop.id" class="shop-edit-row" :aria-label="`店铺 ${index+1}`">
              <div class="shop-row-heading">
                <span class="shop-index" aria-hidden="true">{{ String(index+1).padStart(2,'0') }}</span>
                <div class="shop-identity"><strong>{{ shopInfo(shop.url).provider }}</strong><span>{{ shopInfo(shop.url).domain }}</span></div>
                <span class="shop-open-mode" :class="shopInfo(shop.url).tone">{{ shopInfo(shop.url).mode }}</span>
                <button type="button" class="shop-remove" :aria-label="`移除店铺 ${index+1}${shop.name ? '：'+shop.name : ''}`" title="移除此店铺入口" @click="remove(shop.id)"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.25" stroke="currentColor" stroke-width="1.3"/><path d="M6.5 10h7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></button>
              </div>
              <div class="shop-inputs">
                <label><span>店铺名称</span><input v-model="shop.name" :aria-label="`店铺 ${index+1} 名称`" placeholder="例如：我的卡密小铺" autocomplete="off" /></label>
                <label><span>店铺地址</span><input v-model="shop.url" :aria-label="`店铺 ${index+1} 地址`" type="url" placeholder="https://…/shop/…" autocomplete="off" spellcheck="false" /></label>
              </div>
            </article>
            <div v-if="loaded && !drafts.length" class="shop-empty"><strong>添加你的第一家店铺</strong><p>保存后，桌面会出现“网上小铺”应用。</p><MacButton size="sm" :disabled="saving" @click="add">添加店铺</MacButton></div>
          </fieldset>
          <footer class="shop-settings-actions">
            <span role="status" :class="{ 'has-changes': dirty }">{{ dirty ? '有未保存的修改' : message || (loaded ? `${drafts.length} 家店铺 · 已保存` : '等待读取配置') }}</span>
            <MacButton size="sm" :disabled="saving || loading" @click="requestReload">重新读取</MacButton>
            <MacButton size="sm" variant="primary" :loading="saving" :disabled="!loaded || !dirty || loading" @click="save">保存店铺</MacButton>
          </footer>
        </div>
        <details class="shop-help"><summary>店铺打开方式与兑换说明</summary><p>云猫寄售和 16688 的店铺链接默认在应用内浏览，其他店铺通过外部浏览器打开。付款渠道可能要求跳转；购买后返回“卡券兑换”填写兑换码。</p><p>移除操作只删除本站的店铺入口，保存后生效。</p></details>
      </template>
    <Teleport :to="sheetTarget || 'body'" :disabled="!sheetTarget"><MacAlertSheet :show="confirmReload" title="放弃未保存的店铺修改？" message="重新读取会用已保存的配置替换当前修改。" confirm-text="放弃并重新读取" cancel-text="继续编辑" danger @cancel="confirmReload = false" @confirm="reloadConfirmed" /></Teleport>
  </section>
</template>

<style scoped>
.shop-settings{display:grid;gap:18px;min-width:0;font-size:13px;container-type:inline-size;container-name:shop-settings}
.shop-page-heading{display:flex;align-items:center;gap:12px;min-width:0}.shop-page-heading img{flex:0 0 auto;filter:drop-shadow(0 2px 3px #00000012)}.shop-page-heading>div{flex:1;min-width:0}.shop-page-heading h2{font-size:20px;line-height:1.3;font-weight:650;letter-spacing:-.025em;margin:0 0 5px}.shop-page-heading p{font-size:12px;color:var(--text-secondary);line-height:1.5;margin:0}.add-symbol{font-size:17px;line-height:1;margin-right:4px}
.shop-config-group{background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:12px;box-shadow:0 1px 3px #00000005;overflow:hidden}.shop-settings-fields{display:grid;min-width:0;border:0;padding:0;margin:0}.shop-edit-row{min-width:0;padding:20px 22px;border-bottom:1px solid var(--border-subtle)}.shop-edit-row:last-child{border-bottom:0}.shop-row-heading{display:flex;align-items:center;gap:10px;margin-bottom:16px;min-width:0}.shop-index{display:grid;place-items:center;width:32px;height:32px;border-radius:8px;background:var(--bg-surface-subtle);color:var(--text-secondary);font-size:11px;font-variant-numeric:tabular-nums;border:1px solid var(--border-subtle)}.shop-identity{display:grid;gap:3px;min-width:0;flex:1}.shop-identity strong{font-size:12px;font-weight:600}.shop-identity>span{font-size:11px;color:var(--text-secondary);overflow-wrap:anywhere}.shop-open-mode{font-size:10px;padding:4px 7px;border-radius:5px;white-space:nowrap;background:var(--bg-surface-subtle);color:var(--text-secondary)}.shop-open-mode.embedded{color:var(--accent,#007aff);background:color-mix(in srgb,var(--accent,#007aff) 8%,transparent)}.shop-open-mode.invalid{color:var(--status-danger,#c43731)}.shop-remove{display:grid;place-items:center;width:28px;height:28px;color:var(--text-tertiary);border-radius:6px;flex-shrink:0}.shop-remove:hover:not(:disabled){color:var(--status-danger,#c43731);background:color-mix(in srgb,var(--status-danger,#c43731) 7%,transparent)}
.shop-inputs{display:grid;grid-template-columns:minmax(140px,1fr) minmax(200px,2fr);gap:16px;align-items:start}.shop-inputs label{display:grid;gap:7px;min-width:0}.shop-inputs label>span{font-size:11px;color:var(--text-secondary)}.shop-inputs input{box-sizing:border-box;width:100%;height:34px;min-width:0;padding:6px 10px;border:1px solid var(--border-subtle);border-radius:7px;background:var(--window-bg-solid);color:var(--text-primary);font-size:12px}.shop-inputs input::placeholder{color:var(--text-tertiary)}.shop-settings :is(input,button,summary):focus-visible{outline:2px solid var(--accent,#007aff);outline-offset:3px}.shop-settings :disabled{opacity:.55}
.shop-settings-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;padding:14px 20px;border-top:1px solid var(--border-subtle);background:var(--bg-surface-subtle)}.shop-settings-actions>span{flex:1;min-width:120px;color:var(--text-secondary);font-size:11px;line-height:1.5}.shop-settings-actions .has-changes{color:var(--accent,#007aff)}.shop-feedback{margin:0;padding:12px 14px;border:1px solid var(--border-subtle);border-radius:9px;background:var(--bg-surface);font-size:12px}.shop-settings-error{color:var(--status-danger,#c43731);overflow-wrap:anywhere}.shop-empty{display:grid;justify-items:center;gap:12px;text-align:center;padding:34px 20px}.shop-empty strong{font-size:14px;font-weight:600}.shop-empty p{margin:0;font-size:12px;color:var(--text-secondary)}.shop-help{padding:0 3px;font-size:11px;line-height:1.7;color:var(--text-secondary)}.shop-help summary{cursor:pointer;width:fit-content}.shop-help p{max-width:680px;margin:9px 0 0}
@container shop-settings (max-width:520px){.shop-inputs{grid-template-columns:minmax(0,1fr);gap:12px}.shop-edit-row{padding:16px}.shop-row-heading{gap:8px}.shop-settings-actions{padding:12px 14px}.shop-settings-actions>span{flex-basis:100%}.shop-page-heading{flex-wrap:wrap}.shop-page-heading h2{font-size:18px}.shop-page-heading>button{margin-left:52px}.shop-open-mode{font-size:9px}}
</style>
