/**
 * Default appearance uses the existing public/assets macOS-style artwork.
 * Only --mode release selects original artwork from public-release/assets.
 */
export const APP_ICON_SOURCES = {
  finder: '/assets/finder.png',
  launchpad: '/assets/launchpad.png',
  dashboard: '/assets/semantic/dashboard.svg',
  ops: '/assets/activity.png',
  users: '/assets/users.svg',
  groups: '/assets/semantic/groups.svg',
  channels: '/assets/semantic/channels.svg',
  admin_subscriptions: '/assets/calendar.png',
  accounts: '/assets/semantic/accounts.svg',
  plugins: '/assets/semantic/plugins.svg',
  announcements: '/assets/semantic/announcements.svg',
  proxies: '/assets/proxies.svg',
  security: '/assets/semantic/security.svg',
  commerce: '/assets/semantic/commerce.svg',
  keychain: '/assets/passwords.png',
  safari: '/assets/safari.png',
  activity: '/assets/notes.png',
  network: '/assets/semantic/network.svg',
  subscriptions: '/assets/semantic/subscriptions.svg',
  wallet: '/assets/wallet.png',
  card_shop: '/assets/semantic/card_shop.svg',
  voucher: '/assets/voucher.png',
  appstore: '/assets/semantic/appstore.svg',
  terminal: '/assets/terminal.png',
  settings: '/assets/settings.png',
} as const;

export type AppIconId = keyof typeof APP_ICON_SOURCES;
export const APP_ICON_CANVAS_SIZE = 256;

/** 256 px RGBA canvas; the visible silhouette occupies approximately 82%. */
export const APP_ICONS: Readonly<Record<AppIconId, string>> = Object.freeze({
  finder: '/assets/app-icons/finder.png?v=icons-20260911-r2',
  launchpad: '/assets/app-icons/launchpad.png?v=icons-20260911-r2',
  dashboard: '/assets/app-icons/dashboard.png?v=icons-20260911-r2',
  ops: '/assets/app-icons/ops.png?v=icons-20260911-r2',
  users: '/assets/app-icons/users.png?v=icons-20260911-r2',
  groups: '/assets/app-icons/groups.png?v=icons-20260911-r2',
  channels: '/assets/app-icons/channels.png?v=icons-20260911-r2',
  admin_subscriptions: '/assets/app-icons/admin_subscriptions.png?v=icons-20260911-r2',
  accounts: '/assets/app-icons/accounts.png?v=icons-20260911-r2',
  plugins: '/assets/app-icons/plugins.png?v=icons-20260911-r2',
  announcements: '/assets/app-icons/announcements.png?v=icons-20260911-r2',
  proxies: '/assets/app-icons/proxies.png?v=icons-20260911-r2',
  security: '/assets/app-icons/security.png?v=icons-20260911-r2',
  commerce: '/assets/app-icons/commerce.png?v=icons-20260911-r2',
  keychain: '/assets/app-icons/keychain.png?v=icons-20260911-r2',
  safari: '/assets/app-icons/safari.png?v=icons-20260911-r2',
  activity: '/assets/app-icons/activity.png?v=icons-20260911-r2',
  network: '/assets/app-icons/network.png?v=icons-20260911-r2',
  subscriptions: '/assets/app-icons/subscriptions.png?v=icons-20260911-r2',
  wallet: '/assets/app-icons/wallet.png?v=icons-20260911-r2',
  card_shop: '/assets/app-icons/card_shop.png?v=shop-20260912-r1',
  voucher: '/assets/app-icons/voucher.png?v=icons-20260911-r2',
  appstore: '/assets/app-icons/appstore.png?v=icons-20260911-r2',
  terminal: '/assets/app-icons/terminal.png?v=icons-20260911-r2',
  settings: '/assets/app-icons/settings.png?v=icons-20260911-r2',
});

/** Runtime-safe lookup for string IDs from AppDefinition; unknown IDs use the app grid. */
export function getAppIcon(id: string): string {
  return Object.prototype.hasOwnProperty.call(APP_ICONS, id)
    ? APP_ICONS[id as AppIconId]
    : APP_ICONS.channels;
}
