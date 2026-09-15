import type { AppDefinition } from '@sub2-mac/core';
import { defineAsyncComponent, markRaw, type Component } from 'vue';
import AppLoadingState from '../components/AppLoadingState.vue';
import AppLoadError from '../components/AppLoadError.vue';
import { getAppIcon } from '../assets/appIcons';

function lazyApp(loader: () => Promise<{ default: Component }>) {
  return markRaw(defineAsyncComponent({ loader, loadingComponent: AppLoadingState, errorComponent: AppLoadError, delay: 120, timeout: 20000 }));
}

// User & Foundation Apps
const FinderApp = lazyApp(() => import('./user/FinderApp.vue'));
const DashboardApp = lazyApp(() => import('./user/DashboardApp.vue'));
const SafariApp = lazyApp(() => import('./user/SafariApp.vue'));
const KeyChainApp = lazyApp(() => import('./user/KeyChainApp.vue'));
const ActivityApp = lazyApp(() => import('./user/ActivityApp.vue'));
const AppStoreApp = lazyApp(() => import('./user/AppStoreApp.vue'));
const WalletApp = lazyApp(() => import('./user/WalletApp.vue'));
const VoucherApp = lazyApp(() => import('./user/VoucherApp.vue'));
const NetworkApp = lazyApp(() => import('./user/NetworkApp.vue'));
const SubscriptionsApp = lazyApp(() => import('./user/SubscriptionsApp.vue'));
const SettingsApp = lazyApp(() => import('./user/SettingsApp.vue'));
const TerminalApp = lazyApp(() => import('./user/TerminalApp.vue'));

// Admin Dedicated Apps
const OpsApp = lazyApp(() => import('./admin/OpsApp.vue'));
const UsersApp = lazyApp(() => import('./admin/UsersApp.vue'));
const GroupsApp = lazyApp(() => import('./admin/GroupsApp.vue'));
const ChannelsApp = lazyApp(() => import('./admin/ChannelsApp.vue'));
const AdminSubscriptionsApp = lazyApp(() => import('./admin/SubscriptionsApp.vue'));
const AccountsApp = lazyApp(() => import('./admin/AccountsApp.vue'));
const PluginsApp = lazyApp(() => import('./admin/PluginsApp.vue'));
const AnnouncementsApp = lazyApp(() => import('./admin/AnnouncementsApp.vue'));
const ProxiesApp = lazyApp(() => import('./admin/ProxiesApp.vue'));
const SecurityApp = lazyApp(() => import('./admin/SecurityApp.vue'));
const CommerceApp = lazyApp(() => import('./admin/CommerceApp.vue'));
const AdminUsageApp = lazyApp(() => import('./admin/AdminUsageApp.vue'));
const UserAnnouncementsApp = lazyApp(() => import('./user/UserAnnouncementsApp.vue'));
const BatchImageApp = lazyApp(() => import('./user/BatchImageApp.vue'));
const CardShopApp = lazyApp(() => import('./user/CardShopApp.vue'));

export const ALL_APPS: AppDefinition[] = [
  { id: 'card_shop', name: '小铺', title: '小铺', icon: getAppIcon('card_shop'), defaultW: 1120, defaultH: 760, minW: 540, minH: 440, category: 'user', component: CardShopApp },
  { id: 'batch_image', name: '批量生图', title: '批量生图', icon: getAppIcon('appstore'), defaultW: 1120, defaultH: 720, minW: 640, minH: 420, category: 'user', component: BatchImageApp },
  { id: 'user_announcements', name: '站点公告', title: '站点公告', icon: getAppIcon('announcements'), defaultW: 850, defaultH: 620, minW: 540, minH: 360, category: 'user', component: UserAnnouncementsApp },
  { id: 'admin_usage', name: '全站用量', title: '全站用量', icon: getAppIcon('activity'), defaultW: 1120, defaultH: 720, minW: 720, minH: 460, category: 'admin', component: AdminUsageApp },
  // ==========================================
  // --- 1. macOS Tahoe Native Front ---
  // ==========================================
  {
    id: 'finder',
    name: '访达',
    title: '访达',
    icon: '/assets/finder.png',
    defaultW: 840,
    defaultH: 520,
    minW: 640,
    minH: 380,
    category: 'user',
    component: FinderApp
  },
  {
    id: 'launchpad',
    name: '启动台',
    title: '启动台',
    icon: '/assets/launchpad.png',
    defaultW: 0,
    defaultH: 0,
    category: 'user'
  },

  // ==========================================
  // --- 2. 管理控制台 (Admin Navigation items in authentic Sub2API AppSidebar order) ---
  // ==========================================
  {
    id: 'dashboard',
    name: '仪表盘',
    title: '仪表盘',
    icon: '/assets/dashboard.svg',
    defaultW: 1100,
    defaultH: 760,
    minW: 800,
    minH: 500,
    category: 'user',
    component: DashboardApp
  },
  {
    id: 'ops',
    name: '运维监控',
    title: '运维监控',
    icon: '/assets/activity.png',
    defaultW: 940,
    defaultH: 580,
    minW: 740,
    minH: 420,
    category: 'admin',
    component: OpsApp
  },
  {
    id: 'users',
    name: '用户管理',
    title: '用户管理',
    icon: '/assets/users.svg',
    defaultW: 980,
    defaultH: 560,
    minW: 700,
    minH: 420,
    category: 'admin',
    component: UsersApp
  },
  {
    id: 'groups',
    name: '分组管理',
    title: '分组管理',
    icon: '/assets/shortcuts.png',
    defaultW: 980,
    defaultH: 600,
    minW: 740,
    minH: 440,
    category: 'admin',
    component: GroupsApp
  },
  {
    id: 'channels',
    name: '渠道管理',
    title: '渠道管理',
    icon: '/assets/apps.png',
    defaultW: 920,
    defaultH: 580,
    minW: 700,
    minH: 420,
    category: 'admin',
    component: ChannelsApp
  },
  {
    id: 'admin_subscriptions',
    name: '订阅管理',
    title: '订阅管理',
    icon: '/assets/calendar.png',
    defaultW: 980,
    defaultH: 580,
    minW: 720,
    minH: 420,
    category: 'admin',
    component: AdminSubscriptionsApp
  },
  {
    id: 'accounts',
    name: '账号管理',
    title: '账号管理',
    icon: '/assets/accounts.svg',
    defaultW: 960,
    defaultH: 600,
    minW: 760,
    minH: 440,
    category: 'admin',
    component: AccountsApp
  },
  {
    id: 'plugins',
    name: '插件管理',
    title: '插件管理',
    icon: '/assets/developer.png',
    defaultW: 880,
    defaultH: 560,
    minW: 680,
    minH: 420,
    category: 'admin',
    component: PluginsApp
  },
  {
    id: 'announcements',
    name: '公告管理',
    title: '公告管理',
    icon: '/assets/reminders.png',
    defaultW: 880,
    defaultH: 540,
    minW: 680,
    minH: 400,
    category: 'admin',
    component: AnnouncementsApp
  },
  {
    id: 'proxies',
    name: 'IP管理',
    title: 'IP管理',
    icon: '/assets/proxies.svg',
    defaultW: 920,
    defaultH: 560,
    minW: 720,
    minH: 400,
    category: 'admin',
    component: ProxiesApp
  },
  {
    id: 'security',
    name: '风控中心',
    title: '风控中心',
    icon: '/assets/security.svg',
    defaultW: 1040,
    defaultH: 640,
    minW: 760,
    minH: 460,
    category: 'admin',
    component: SecurityApp
  },
  {
    id: 'commerce',
    name: '订单管理',
    title: '订单管理',
    icon: '/assets/numbers.png',
    defaultW: 920,
    defaultH: 580,
    minW: 720,
    minH: 440,
    category: 'admin',
    component: CommerceApp
  },

  // ==========================================
  // --- 3. 个人中心 / 用户服务 (Personal Navigation items in authentic Sub2API AppSidebar order) ---
  // ==========================================
  {
    id: 'keychain',
    name: 'API 密钥',
    title: 'API 密钥',
    icon: '/assets/passwords.png',
    defaultW: 1060,
    defaultH: 620,
    minW: 780,
    minH: 440,
    category: 'user',
    component: KeyChainApp
  },
  {
    id: 'safari',
    name: 'Safari 浏览器',
    title: 'Safari 浏览器',
    icon: '/assets/safari.png',
    defaultW: 940,
    defaultH: 580,
    minW: 680,
    minH: 400,
    category: 'user',
    component: SafariApp
  },
  {
    id: 'activity',
    name: '使用记录',
    title: '使用记录',
    icon: '/assets/activity.png',
    defaultW: 1080,
    defaultH: 680,
    minW: 820,
    minH: 500,
    category: 'user',
    component: ActivityApp
  },
  {
    id: 'network',
    name: '可用渠道',
    title: '可用渠道',
    icon: '/assets/network.svg',
    defaultW: 1040,
    defaultH: 640,
    minW: 760,
    minH: 450,
    category: 'user',
    component: NetworkApp
  },
  {
    id: 'subscriptions',
    name: '我的订阅',
    title: '我的订阅',
    icon: '/assets/calendar.png',
    defaultW: 840,
    defaultH: 540,
    minW: 640,
    minH: 400,
    category: 'user',
    component: SubscriptionsApp
  },
  {
    id: 'wallet',
    name: '购买与充值',
    title: '购买与充值',
    icon: '/assets/wallet.png',
    defaultW: 800,
    defaultH: 540,
    minW: 620,
    minH: 420,
    category: 'user',
    component: WalletApp
  },
  {
    id: 'voucher',
    name: '卡券兑换',
    title: '卡券兑换',
    icon: '/assets/voucher.png',
    defaultW: 840,
    defaultH: 640,
    minW: 640,
    minH: 450,
    category: 'user',
    component: VoucherApp
  },
  {
    id: 'appstore',
    name: '模型广场',
    title: '模型广场',
    icon: '/assets/appstore.png',
    defaultW: 1040,
    defaultH: 640,
    minW: 760,
    minH: 450,
    category: 'user',
    component: AppStoreApp
  },

  // ==========================================
  // --- 4. 实用工具与系统设置 (System Utilities & Settings) ---
  // ==========================================
  {
    id: 'terminal',
    name: '终端',
    title: '终端',
    icon: '/assets/terminal.png',
    defaultW: 740,
    defaultH: 460,
    minW: 540,
    minH: 320,
    category: 'user',
    component: TerminalApp
  },
  {
    id: 'settings',
    name: '系统设置',
    title: '系统设置',
    icon: '/assets/settings.png',
    defaultW: 980,
    defaultH: 680,
    minW: 780,
    minH: 480,
    category: 'user',
    component: SettingsApp
  }
];

// Every desktop surface resolves the same optical-size-normalized artwork.
for (const app of ALL_APPS) app.icon = getAppIcon(app.id === 'admin_usage' ? 'activity' : app.id === 'user_announcements' ? 'announcements' : app.id === 'batch_image' ? 'appstore' : app.id === 'card_shop' ? 'card_shop' : app.id);
