export interface DesktopTarget { app: string; data?: { tab?: string; subtab?: string } }
const route = (app: string, tab?: string, subtab?: string): DesktopTarget => ({ app, data: tab ? { tab, ...(subtab ? { subtab } : {}) } : undefined });
export const DESKTOP_ROUTES: Record<string, DesktopTarget> = {
  '/dashboard': route('dashboard'), '/keys': route('keychain'), '/usage': route('activity'),
  '/batch-image': route('batch_image'), '/docs/batch-image': route('batch_image'),
  '/shop': route('card_shop'),
  '/redeem': route('voucher'), '/affiliate': route('wallet', 'affiliate'),
  '/profile': route('settings', 'profile'), '/subscriptions': route('subscriptions'),
  '/purchase': route('wallet', 'subscription'), '/orders': route('wallet', 'orders'),
  '/announcements': route('user_announcements'),
  '/admin': route('dashboard'), '/admin/dashboard': route('dashboard'), '/admin/ops': route('ops'),
  '/admin/audit-logs': route('security', 'audit'), '/admin/users': route('users'),
  '/admin/groups': route('groups'), '/admin/channels': route('channels', 'pricing'),
  '/admin/channels/pricing': route('channels', 'pricing'), '/admin/channels/monitor': route('channels', 'monitor'),
  '/admin/subscriptions': route('admin_subscriptions'), '/admin/accounts': route('accounts'),
  '/admin/plugins': route('plugins'), '/admin/announcements': route('announcements'), '/admin/proxies': route('proxies'),
  '/admin/redeem': route('commerce', 'redeem'), '/admin/promo-codes': route('commerce', 'promo'),
  '/admin/settings': route('settings', 'admin_general'), '/admin/risk-control': route('security', 'risk'),
  '/admin/prompt-audit': route('security', 'prompt'), '/admin/usage': route('admin_usage'),
  '/admin/affiliates': route('commerce', 'affiliates', 'invites'),
  '/admin/affiliates/invites': route('commerce', 'affiliates', 'invites'),
  '/admin/affiliates/rebates': route('commerce', 'affiliates', 'rebates'),
  '/admin/affiliates/transfers': route('commerce', 'affiliates', 'transfers'),
  '/admin/orders': route('commerce', 'orders'), '/admin/orders/dashboard': route('commerce', 'dashboard'),
  '/admin/orders/plans': route('commerce', 'plans'),
};

export function desktopTarget(url: URL): DesktopTarget | undefined {
  let path = url.pathname.replace(/\/$/, '') || '/';
  if (['/', '/login', '/register'].includes(path)) {
    const raw = url.searchParams.get('redirect');
    if (raw?.startsWith('/') && !raw.startsWith('//')) {
      try { const next = new URL(raw, url.origin); if (next.origin === url.origin) path = next.pathname.replace(/\/$/, '') || '/'; } catch { /* Ignore malformed return paths. */ }
    }
  }
  return DESKTOP_ROUTES[path];
}
