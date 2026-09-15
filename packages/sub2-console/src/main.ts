import { createApp } from 'vue';
import { createPinia } from 'pinia';
import './style.css';
import { useAuthStore } from './stores/auth';
import { isPaymentRoute } from './apps/user/payments/flow';
import { DESKTOP_ROUTES } from './desktop-routes';

async function mount() {
  // The isolated component lab and its example data are excluded from production.
  const pathname = location.pathname.replace(/\/$/, '') || '/';
  const publicPage = /^\/(home|key-usage|model-plaza|monitor|available-channels)$/.test(pathname) || /^\/(legal|custom)\//.test(pathname);
  const paymentPage = isPaymentRoute(new URL(location.href));
  const desktopPage = pathname === '/' || Object.prototype.hasOwnProperty.call(DESKTOP_ROUTES, pathname) ||
    /^\/(login|register|email-verify|forgot-password|reset-password)$/.test(pathname) ||
    /^\/auth\/(callback|oauth\/callback|linuxdo\/callback|wechat\/callback|dingtalk\/(callback|email-completion)|oidc\/callback)$/.test(pathname);
  const root = import.meta.env.DEV && new URLSearchParams(location.search).has('ui-lab')
    ? await import('./dev/CorePlayground.vue')
    : pathname === '/setup' ? await import('./setup/SetupWizard.vue')
    : publicPage ? await import('./public/PublicPages.vue')
    : paymentPage ? await import('./apps/user/payments/PaymentRoute.vue')
    : desktopPage ? await import('./App.vue') : await import('./components/PageNotFound.vue');
  const app = createApp(root.default, publicPage ? { path: pathname } : undefined);
  const pinia = createPinia();
  app.use(pinia);
  // Standalone roots have no lock screen to verify the saved identity. Resolve
  // it before payment recovery mounts; anonymous signed returns remain usable.
  if (publicPage || paymentPage) await useAuthStore(pinia).initAuth({ redirectOnFailure: false });
  app.mount('#app');
}

void mount();
