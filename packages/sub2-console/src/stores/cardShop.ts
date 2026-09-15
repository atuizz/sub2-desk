import { defineStore } from 'pinia';
import { ref, watch, onScopeDispose } from 'vue';
import { getPublicSettings } from '@/api/auth';
import { useAuthStore } from './auth';
import { configuredShops, type CardShop } from '@/utils/cardShop';

export const useCardShopStore = defineStore('cardShop', () => {
  const auth = useAuthStore();
  const loaded = ref(false), loading = ref(false), error = ref('');
  const shops = ref<CardShop[]>([]);
  let generation = 0, disposed = false;

  async function load(force = false): Promise<void> {
    if (disposed || (!force && (loading.value || loaded.value))) return;
    const current = ++generation;
    // Retain the last known same-identity configuration while refreshing. App
    // registration depends on shops.length; clearing it would close its window.
    loading.value = true; error.value = '';
    try {
      const settings = await getPublicSettings();
      if (current !== generation) return;
      shops.value = configuredShops(settings);
      loaded.value = true;
    } catch (failure) {
      if (current === generation) error.value = (failure as { message?: string })?.message || '无法读取小铺配置，请重试';
    } finally {
      if (current === generation) loading.value = false;
    }
  }

  watch([() => auth.user?.id, () => auth.user?.role], () => {
    // Discard old account content synchronously, including responses still in flight.
    generation++; loaded.value = false; loading.value = false; shops.value = []; error.value = '';
    void load(true);
  }, { flush: 'sync' });
  onScopeDispose(() => { disposed = true; generation++; shops.value = []; loaded.value = false; loading.value = false; });

  return { loaded, loading, error, shops, load, reload: () => load(true) };
});
