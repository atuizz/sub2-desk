import type { CustomMenuItem } from '@/types';

export const CARD_SHOP_PREFIX = 'sub2mac-shop-';
// Static, self-contained SVG. Never render administrator-supplied markup.
export const CARD_SHOP_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 9h16l-2-5H6L4 9Zm1 0v11h14V9M9 20v-7h6v7"/></svg>';
export interface CardShop { id: string; name: string; url: string; domain: string }
export interface CardShopDraft { id: string; name: string; url: string }

export function isCardShopItem(item: unknown): item is CustomMenuItem {
  return !!item && typeof item === 'object' && typeof (item as CustomMenuItem).id === 'string'
    && (item as CustomMenuItem).id.startsWith(CARD_SHOP_PREFIX);
}

export function safeShopURL(value: string): string {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim()) || /[\u0000-\u0020\u007f\\]/.test(value.trim())) {
    throw new Error('店铺地址须为完整的 HTTP(S) URL，不能含空格或控制字符');
  }
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || /^https?:\/\/[^/]*@/i.test(value.trim().split(/[?#]/)[0])) {
    throw new Error('店铺地址只能使用无用户名和密码的 HTTP(S) URL');
  }
  return url.href;
}

export function readMenuItems(settings: unknown): CustomMenuItem[] {
  const items = (settings as { custom_menu_items?: unknown } | null)?.custom_menu_items;
  if (!Array.isArray(items) || !items.every(item => item && typeof item === 'object' && typeof item.id === 'string')) {
    throw new Error('站点菜单配置无法确认，请重新读取');
  }
  return items;
}

export function shopDrafts(items: CustomMenuItem[]): CardShopDraft[] {
  return items.filter(isCardShopItem).map(item => ({ id: item.id, name: typeof item.label === 'string' ? item.label : '', url: typeof item.url === 'string' ? item.url : '' }));
}

export function validateShopDrafts(drafts: CardShopDraft[]): CardShop[] {
  const ids = new Set<string>();
  return drafts.map((draft, index) => {
    if (!draft.id.startsWith(CARD_SHOP_PREFIX) || draft.id.length <= CARD_SHOP_PREFIX.length || draft.id.length > 32 || ids.has(draft.id)) {
      throw new Error(`第 ${index + 1} 家店铺标识无效或重复，请移除后重新添加`);
    }
    ids.add(draft.id);
    const name = draft.name.trim();
    if (!name) throw new Error(`请填写第 ${index + 1} 家店铺名称`);
    const url = safeShopURL(draft.url);
    return { id: draft.id, name, url, domain: new URL(url).host };
  });
}

export function configuredShops(settings: unknown): CardShop[] {
  const owned = readMenuItems(settings).filter(isCardShopItem);
  // Only user-visible reserved entries are public shop configuration.
  return validateShopDrafts(shopDrafts(owned.filter(item => item.visibility === 'user')));
}

export function shopFingerprint(items: CustomMenuItem[]): string {
  // JSON field order may change in a server round trip; compare actual values.
  return JSON.stringify(items.filter(isCardShopItem).map(item => Object.fromEntries(
    Object.entries(item).sort(([a], [b]) => a.localeCompare(b))
  )));
}

export function mergeShopItems(latest: CustomMenuItem[], drafts: CardShopDraft[], expectedFingerprint: string): CustomMenuItem[] {
  if (shopFingerprint(latest) !== expectedFingerprint) {
    throw new Error('小铺配置已被其他管理员修改，请重新读取后再保存');
  }
  const shops = validateShopDrafts(drafts);
  const owned = shops.map((shop, index): CustomMenuItem => ({ id: shop.id, label: shop.name, url: shop.url,
    icon_svg: CARD_SHOP_ICON, visibility: 'user', sort_order: index }));
  // Preserve every unrelated item, including its unknown fields, SVG and order.
  return [...latest.filter(item => !isCardShopItem(item)), ...owned];
}

export function supportsShopEmbed(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['catfk.com', 'www.catfk.com', '16688.com.cn', 'www.16688.com.cn'].includes(url.hostname) &&
      /^\/shop\/[^/]+\/?$/.test(url.pathname);
  } catch { return false; }
}
export function frameRestriction(url: string, hostOrigin: string): string {
  const shop = new URL(url), host = new URL(hostOrigin);
  if (shop.origin === host.origin) return '此店铺与控制台使用相同来源，请在外部浏览器打开。';
  return host.protocol === 'https:' && shop.protocol === 'http:'
    ? '此店铺使用 HTTP，请在外部浏览器打开。'
    : supportsShopEmbed(url) ? '' : '此店铺使用外部浏览器访问，点击下方按钮即可前往购买。';
}
