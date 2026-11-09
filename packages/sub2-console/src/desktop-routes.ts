export interface DesktopTarget { app: string; data?: { tab?: string; subtab?: string; mcp_authorize?: Record<string, string> } }
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
  // MCP OAuth 授权深链：query 由 desktopTarget() 动态解析进 data.mcp_authorize（见下方），此处仅登记路径以便 main.ts 挂载桌面。
  '/oauth/mcp/authorize': route('mcp'),
};

/** 上游 /oauth/mcp/authorize 的 query 白名单（MCPOAuthAuthorizeView.parseAuthorization 同款）；非法键丢弃，缺失/非法值由 MCPApp 校验后报错，不在此处编造。 */
const MCP_AUTHORIZE_PARAMS = ['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'code_challenge', 'code_challenge_method', 'resource'] as const;
function mcpAuthorizeQuery(url: URL): Record<string, string> {
  const query: Record<string, string> = {};
  for (const key of MCP_AUTHORIZE_PARAMS) {
    const value = url.searchParams.get(key);
    if (value !== null) query[key] = value;
  }
  return query;
}

export function desktopTarget(url: URL): DesktopTarget | undefined {
  let path = url.pathname.replace(/\/$/, '') || '/';
  let effective = url;
  if (['/', '/login', '/register'].includes(path)) {
    const raw = url.searchParams.get('redirect');
    if (raw?.startsWith('/') && !raw.startsWith('//')) {
      try { const next = new URL(raw, url.origin); if (next.origin === url.origin) { path = next.pathname.replace(/\/$/, '') || '/'; effective = next; } } catch { /* Ignore malformed return paths. */ }
    }
  }
  if (path === '/oauth/mcp/authorize') {
    return { app: 'mcp', data: { mcp_authorize: mcpAuthorizeQuery(effective) } };
  }
  return DESKTOP_ROUTES[path];
}
