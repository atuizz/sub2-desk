<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { MacButton, MacGroupCard, MacSheet } from '@sub2-mac/core';
import { desktopOAuthProviders } from '@/api/auth';
import { buildOAuthBindingStartURL, startOAuthBinding, unbindAuthIdentity } from '@/api/user';
import { useAuthStore } from '@/stores/auth';
import type { OAuthLoginProvider } from '@/api/auth';
import type { PublicSettings, UserAuthBindingStatus } from '@/types';
const props = defineProps<{ settings: PublicSettings | null; ready: boolean; sheetTarget: HTMLElement | null }>();
const auth = useAuthStore();
const labels: Record<OAuthLoginProvider, string> = { github: 'GitHub', google: 'Google', linuxdo: 'LinuxDo', dingtalk: '钉钉', wechat: '微信', oidc: 'OIDC' };
const all = Object.keys(labels) as OAuthLoginProvider[];
const enabled = computed(() => desktopOAuthProviders(props.settings));
const busy = ref(false), error = ref(''), notice = ref('');
const selected = ref<OAuthLoginProvider | null>(null);
let alive = true;
let identityGeneration = 0;
watch(() => auth.user?.id, () => { identityGeneration++; selected.value = null; busy.value = false; error.value = ''; notice.value = ''; }, { flush: 'sync' });
function details(provider: OAuthLoginProvider): UserAuthBindingStatus | null {
  const user = auth.user;
  const raw = user?.auth_bindings?.[provider] ?? user?.identity_bindings?.[provider];
  if (typeof raw === 'object' && raw) return raw;
  if (typeof raw === 'boolean') return { bound: raw };
  const legacy = (user as unknown as Record<string, unknown> | null)?.[`${provider}_bound`];
  return typeof legacy === 'boolean' ? { bound: legacy } : null;
}
const providers = computed(() => all.filter(p => enabled.value.includes(p) || details(p)?.bound));
function canBind(provider: OAuthLoginProvider) {
  const status = details(provider);
  // Upstream exposes GitHub/Google as email login providers; only offer their
  // separate binding action when this backend explicitly advertises support.
  const capability = provider === 'github' || provider === 'google' ? status?.can_bind === true : status?.can_bind !== false;
  return props.ready && enabled.value.includes(provider) && capability && !status?.bound;
}
async function bind(provider: OAuthLoginProvider) {
  if (busy.value || !canBind(provider)) return;
  busy.value = true; error.value = '';
  const current = identityGeneration;
  try {
    const options = { redirectTo: '/profile', wechatOAuthSettings: props.settings };
    if (!buildOAuthBindingStartURL(provider, options)) throw new Error('当前浏览器或站点设置不支持此绑定方式。');
    await startOAuthBinding(provider, options);
  } catch (e) { if (alive && current === identityGeneration) error.value = (e as Error).message || '绑定启动失败，请重试。'; }
  finally { if (alive && current === identityGeneration) busy.value = false; }
}
async function unbind() {
  const provider = selected.value;
  if (!provider || busy.value || !props.ready || !details(provider)?.can_unbind) return;
  const current = identityGeneration, owner = auth.user?.id;
  busy.value = true; error.value = '';
  try { const user = await unbindAuthIdentity(provider); if (alive && current === identityGeneration && owner === auth.user?.id) { if (user.id !== owner) throw new Error('返回账户与当前登录不匹配，请刷新。'); auth.user = user; selected.value = null; notice.value = '已解除绑定。'; } }
  catch (e) { if (alive && current === identityGeneration) error.value = (e as Error).message || '解绑失败，请重试。'; }
  finally { if (alive && current === identityGeneration) busy.value = false; }
}
onUnmounted(() => { alive = false; selected.value = null; });
</script>
<template>
  <MacGroupCard title="第三方账户">
    <div class="p-4 text-xs space-y-3">
      <p v-if="!ready || !settings">等待账户和站点设置确认。</p><p v-else-if="!providers.length">管理员尚未开放第三方登录。</p>
      <p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
      <div v-for="provider in providers" :key="provider" class="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-3">
        <div><strong>{{ provider === 'oidc' ? settings?.oidc_oauth_provider_name || 'OIDC' : labels[provider] }}</strong><p>{{ details(provider)?.bound ? '已绑定' : details(provider) ? '未绑定' : '绑定状态待确认' }}</p><p class="break-all">{{ details(provider)?.display_name || details(provider)?.subject_hint }}</p></div>
        <MacButton v-if="details(provider)?.bound" :disabled="busy || !ready || !details(provider)?.can_unbind" @click="selected = provider">解除绑定</MacButton>
        <MacButton v-else :disabled="busy || !canBind(provider)" @click="bind(provider)">绑定</MacButton>
      </div>
    </div>
  </MacGroupCard>
  <Teleport v-if="sheetTarget" :to="sheetTarget"><MacSheet :show="selected !== null" title="解除第三方绑定" :loading="busy" @close="selected = null">
    <p>确认解除 {{ selected ? labels[selected] : '' }} 绑定？请保留其他可用登录方式。</p><p v-if="error" role="alert">{{ error }}</p>
    <template #footer><MacButton :disabled="busy" @click="selected = null">取消</MacButton><MacButton variant="destructive" :loading="busy" @click="unbind">确认解除</MacButton></template>
  </MacSheet></Teleport>
</template>
