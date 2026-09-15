<script setup lang="ts">
import { getAppIcon } from '@/assets/appIcons';
import { extraWallpapers, wallpaperPreview } from '@/assets/wallpapers';
import CardShopSettingsPanel from './settings/CardShopSettingsPanel.vue';
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import type { WindowInstance } from '@sub2-mac/core';
import {
  MacIconBadge,
  MacAppIcon,
  MacSearchField,
  MacGroupCard,
  MacSidebarItem,
  MacToggle,
  MacButton,
  MacAlertSheet,
  MacSheet,
  MacDraftGuard,
  type BadgeColor,
  type BadgeIcon
} from '@sub2-mac/core';
import { useSystemStore, type WallpaperName } from '../../stores/system';
import { useAuthStore } from '../../stores/auth';
import { captureUserSession, isUserSessionCurrent, publishUserProfile } from '../../stores/userSession';
import {
  settingsAPI,
  type OverloadCooldownSettings,
  type RateLimit429CooldownSettings,
  type StreamTimeoutSettings,
  type RectifierSettings,
  type PanelRateLimitSettings,
  type AdminApiKeyStatus,
  normalizeAccountSchedulingThresholdsMap,
  SCHEDULING_THRESHOLD_PLATFORMS,
  normalizePlatformQuotasMap,
  type DefaultPlatformQuotasMap,
  type AccountSchedulingThresholdsMap
} from '../../api/admin/settings';
import { userAPI } from '../../api/user';
import TotpSecurityPanel from './settings/TotpSecurityPanel.vue';
import PasskeySecurityPanel from './settings/PasskeySecurityPanel.vue';
import OAuthBindingsPanel from './settings/OAuthBindingsPanel.vue';
import { getPublicSettings } from '../../api/auth';
import SoftwareUpdatePanel from './settings/SoftwareUpdatePanel.vue';
import PolicyRulesPanel from './settings/PolicyRulesPanel.vue';
import PaymentSettingsPanel from './settings/PaymentSettingsPanel.vue';
import PaymentProvidersPanel from './settings/PaymentProvidersPanel.vue';
import { copySettings, settingsPatch, settingsSecretPatch, emptySettingsSecrets, settingsWriteUnknown, smtpTestPayload, confirmedSettingsResponse, isSettingsTab, type SettingsForm } from './settings/settingsForm';
import * as backupAPI from '../../api/admin/backup';
import type { PublicSettings, NotifyEmailEntry, CustomEndpoint } from '@/types';

const props = defineProps<{
  win?: WindowInstance;
}>();

const systemStore = useSystemStore();
const authStore = useAuthStore();
const settingsRoot = ref<HTMLElement | null>(null);

// Navigation & Search State
const activeTab = ref((props.win as any)?.customData?.tab || (props.win as any)?.props?.tab || 'appearance');
const searchQuery = ref('');
const sidebarOpen = ref(false);
const shopVisited = ref(activeTab.value === 'admin_cardshop');
const policiesVisited = ref(activeTab.value === 'admin_policies');
const adminSettingsReady = ref(false);
const adminSettingsLoading = ref(false);
const adminSettingsError = ref('');
const isSaving = ref(false);
const saveToast = ref<string | null>(null);
const moduleError = ref('');
const moduleErrorTab = ref('');
const settingsSecrets = ref(emptySettingsSecrets());
let settingsGeneration = 0;
const settingsOwner = () => `${authStore.user?.id ?? ''}:${authStore.sessionRevision ?? 0}:${authStore.isAdmin}`;
function settingsCurrent(generation: number, owner: string) { return !disposed && generation === settingsGeneration && settingsOwner() === owner && authStore.isAdmin; }
let disposed = false;
onUnmounted(() => { disposed = true; settingsGeneration++; settingsSecrets.value = emptySettingsSecrets(); });

function triggerToast(msg: string) {
  saveToast.value = msg;
  setTimeout(() => {
    if (saveToast.value === msg) saveToast.value = null;
  }, 2500);
}

// ==========================================
// 1. User Profile & Account State
// ==========================================
const profileReady = ref(false);
const profileError = ref('');
const publicSettings = ref<PublicSettings | null>(null);

// Profile Edit & Avatar State
const usernameDraft = ref('');
const avatarDraft = ref('');
const isUpdatingProfile = ref(false);
const isSavingAvatar = ref(false);

// Change Password State
const passwordForm = ref({
  old_password: '',
  new_password: '',
  confirm_password: ''
});
const isChangingPassword = ref(false);
const passwordMsg = ref<{ type: 'success' | 'error'; text: string } | null>(null);

// Low Balance Notification State
const balanceNotifyEnabled = ref(false);
const balanceNotifyThreshold = ref<number | null>(null);
const extraEmails = ref<NotifyEmailEntry[]>([]);
const newNotifyEmail = ref('');
const isSavingBalanceNotify = ref(false);

// Email verification in notification
const verifyCodeInput = ref('');
const verifyingEmail = ref('');
const isSendingCode = ref(false);
const isVerifyingCode = ref(false);
const countdownTimer = ref(0);

// Email binding toggle in identity section
const showEmailBindingForm = ref(false);
const emailBindingInput = ref('');
const emailBindingCode = ref('');
const emailBindingPassword = ref('');
const isBindingEmail = ref(false);
const emailBindingSending = ref(false);
const emailBindingError = ref('');
const emailBindingNotice = ref('');
const emailBindingSentTo = ref('');
const emailBindingBusy = computed(() => isBindingEmail.value || emailBindingSending.value);
const emailIsBound = computed(() => {
  const user = authStore.user;
  const binding = user?.auth_bindings?.email ?? user?.identity_bindings?.email;
  return typeof binding === 'boolean' ? binding : binding?.bound ?? user?.email_bound ?? Boolean(user?.email);
});
watch(emailBindingInput, () => { emailBindingCode.value = ''; emailBindingSentTo.value = ''; emailBindingNotice.value = ''; });
function closeEmailBinding() {
  if (emailBindingBusy.value) return;
  showEmailBindingForm.value = false;
  emailBindingPassword.value = ''; emailBindingCode.value = '';
}
function openEmailBinding() {
  if (!profileReady.value) return;
  emailBindingInput.value = ''; emailBindingCode.value = ''; emailBindingPassword.value = '';
  emailBindingError.value = ''; emailBindingNotice.value = ''; emailBindingSentTo.value = '';
  showEmailBindingForm.value = true;
}
async function sendEmailBindingCode() {
  if (!profileReady.value || emailBindingBusy.value) return;
  const email = emailBindingInput.value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { emailBindingError.value = '请输入有效邮箱'; return; }
  emailBindingSending.value = true; emailBindingError.value = '';
  try {
    await userAPI.sendEmailBindingCode(email);
    emailBindingSentTo.value = email;
    emailBindingNotice.value = '验证码已发送，请查收新邮箱。';
  } catch (err) { emailBindingError.value = (err as { message?: string }).message || '发送失败，请重试'; }
  finally { emailBindingSending.value = false; }
}
async function submitEmailBinding() {
  if (!profileReady.value || emailBindingBusy.value) return;
  const email = emailBindingInput.value.trim();
  if (email !== emailBindingSentTo.value || !/^\d{6}$/.test(emailBindingCode.value)) { emailBindingError.value = '请先发送并填写新邮箱的 6 位验证码'; return; }
  if (!emailBindingPassword.value || (!emailIsBound.value && emailBindingPassword.value.length < 6)) { emailBindingError.value = emailIsBound.value ? '请输入当前密码' : '请设置至少 6 位登录密码'; return; }
  const session = captureUserSession(authStore);
  if (!session) return;
  isBindingEmail.value = true; emailBindingError.value = '';
  try {
    const user = await userAPI.bindEmailIdentity({ email, verify_code: emailBindingCode.value, password: emailBindingPassword.value });
    if (!user || typeof user.id !== 'number') throw new Error('邮箱操作已提交，但账户资料无法确认，请重新读取。');
    if (disposed || !publishUserProfile(authStore, session, user)) return;
    emailBindingPassword.value = ''; emailBindingCode.value = ''; showEmailBindingForm.value = false;
    triggerToast('账户邮箱已更新');
  } catch (err) { emailBindingError.value = (err as { message?: string }).message || '邮箱更新失败，请重试'; }
  finally { isBindingEmail.value = false; }
}

const displayName = computed(() => authStore.user?.username?.trim() || authStore.user?.email?.trim() || '用户');
const avatarInitial = computed(() => displayName.value.charAt(0).toUpperCase() || 'U');
const avatarPreviewUrl = computed(() => avatarDraft.value.trim() || authStore.user?.avatar_url?.trim() || '');

const memberSinceLabel = computed(() => {
  const raw = authStore.user?.created_at?.trim();
  if (!raw) return '-';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long'
  }).format(date);
});

let profileGeneration = 0;
async function loadUserProfileData() {
  const session = captureUserSession(authStore), generation = ++profileGeneration;
  if (!session) return;
  const current = () => !disposed && generation === profileGeneration && isUserSessionCurrent(authStore, session);
  const draft = { username: usernameDraft.value, threshold: balanceNotifyThreshold.value, enabled: balanceNotifyEnabled.value };
  try {
    const profile = await userAPI.getProfile();
    if (!current()) return;
    if (!profile || typeof profile.id !== 'number') throw new Error('账户资料响应无效');
    if (!publishUserProfile(authStore, session, profile)) throw new Error('账户资料所属用户不匹配');
    profileReady.value = true;
    profileError.value = '';
    if (authStore.user) {
      if (usernameDraft.value === draft.username) usernameDraft.value = authStore.user.username || '';
      if (balanceNotifyEnabled.value === draft.enabled) balanceNotifyEnabled.value = authStore.user.balance_notify_enabled ?? false;
      if (balanceNotifyThreshold.value === draft.threshold) balanceNotifyThreshold.value = authStore.user.balance_notify_threshold ?? null;
      extraEmails.value = authStore.user.balance_notify_extra_emails ? [...authStore.user.balance_notify_extra_emails] : [];
    }
  } catch (err) {
    if (!current()) return;
    profileReady.value = false;
    profileError.value = '账户资料读取失败，请重试后再修改。';
  }

  try {
    const pub = await getPublicSettings();
    if (!current()) return;
    if (pub) {
      publicSettings.value = pub;
    }
  } catch (err) {
    if (!current()) return;
    publicSettings.value = null;
    profileError.value = '站点设置读取失败，请重试以确认安全功能。';
    console.error('Failed to load public settings:', err);
  }


}

// Avatar handling & compression
async function handleAvatarFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    triggerToast('请选择有效的图片文件');
    return;
  }

  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = reader.result as string;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxDim = 256;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, w, h);
        avatarDraft.value = canvas.toDataURL('image/webp', 0.85);
        triggerToast('头像预览已就绪，请点击“保存”生效');
      }
    };
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
}

async function saveAvatar() {
  if (!profileReady.value || isSavingAvatar.value) return;
  if (!avatarDraft.value) return;
  const session = captureUserSession(authStore);
  if (!session) return;
  isSavingAvatar.value = true;
  try {
    const updated = await userAPI.updateProfile({ avatar_url: avatarDraft.value });
    if (disposed || !publishUserProfile(authStore, session, updated)) return;
    avatarDraft.value = '';
    triggerToast('头像更新成功');
  } catch (err: any) {
    triggerToast(err.message || err.response?.data?.detail || '保存头像失败');
  } finally {
    isSavingAvatar.value = false;
  }
}

async function deleteAvatar() {
  if (!profileReady.value || isSavingAvatar.value) return;
  const session = captureUserSession(authStore);
  if (!session) return;
  isSavingAvatar.value = true;
  try {
    const updated = await userAPI.updateProfile({ avatar_url: '' });
    if (disposed || !publishUserProfile(authStore, session, updated)) return;
    avatarDraft.value = '';
    triggerToast('头像已删除');
  } catch (err: any) {
    triggerToast(err.message || err.response?.data?.detail || '删除头像失败');
  } finally {
    isSavingAvatar.value = false;
  }
}

async function updateUsername() {
  if (!profileReady.value || isUpdatingProfile.value) return;
  if (!usernameDraft.value.trim()) {
    triggerToast('用户名不能为空');
    return;
  }
  const session = captureUserSession(authStore);
  if (!session) return;
  isUpdatingProfile.value = true;
  try {
    const updated = await userAPI.updateProfile({ username: usernameDraft.value.trim() });
    if (disposed || !publishUserProfile(authStore, session, updated)) return;
    triggerToast('个人资料更新成功');
  } catch (err: any) {
    triggerToast(err.message || err.response?.data?.detail || '更新用户名失败');
  } finally {
    isUpdatingProfile.value = false;
  }
}

async function handleChangePassword() {
  if (!profileReady.value || isChangingPassword.value) return;
  passwordMsg.value = null;
  if (!passwordForm.value.old_password) {
    passwordMsg.value = { type: 'error', text: '请输入当前密码' };
    return;
  }
  if (passwordForm.value.new_password.length < 8) {
    passwordMsg.value = { type: 'error', text: '密码至少需要 8 个字符' };
    return;
  }
  if (passwordForm.value.new_password !== passwordForm.value.confirm_password) {
    passwordMsg.value = { type: 'error', text: '新密码两次输入不一致' };
    return;
  }

  isChangingPassword.value = true;
  try {
    await userAPI.changePassword(passwordForm.value.old_password, passwordForm.value.new_password);
    passwordMsg.value = { type: 'success', text: '密码修改成功' };
    passwordForm.value = { old_password: '', new_password: '', confirm_password: '' };
    triggerToast('密码修改成功');
  } catch (err: any) {
    passwordMsg.value = { type: 'error', text: err.message || err.response?.data?.detail || '密码修改失败' };
  } finally {
    isChangingPassword.value = false;
  }
}

async function handleToggleBalanceNotify() {
  if (!profileReady.value) return;
  const session = captureUserSession(authStore);
  if (!session) return;
  try {
    const updated = await userAPI.updateProfile({ balance_notify_enabled: balanceNotifyEnabled.value });
    if (disposed || !publishUserProfile(authStore, session, updated)) return;
    triggerToast(balanceNotifyEnabled.value ? '已启用余额不足提醒' : '已关闭余额不足提醒');
  } catch (err: any) {
    balanceNotifyEnabled.value = !balanceNotifyEnabled.value;
    triggerToast(err.message || err.response?.data?.detail || '更新设置失败');
  }
}

async function saveBalanceNotifyThreshold() {
  if (!profileReady.value || isSavingBalanceNotify.value) return;
  const session = captureUserSession(authStore);
  if (!session) return;
  isSavingBalanceNotify.value = true;
  try {
    const updated = await userAPI.updateProfile({
      balance_notify_threshold: balanceNotifyThreshold.value && balanceNotifyThreshold.value > 0 ? balanceNotifyThreshold.value : 0
    });
    if (disposed || !publishUserProfile(authStore, session, updated)) return;
    triggerToast('预警阈值已保存');
  } catch (err: any) {
    triggerToast(err.message || err.response?.data?.detail || '保存阈值失败');
  } finally {
    isSavingBalanceNotify.value = false;
  }
}

async function addExtraNotifyEmail() {
  const email = newNotifyEmail.value.trim();
  if (!email) return;
  if (extraEmails.value.some(e => e.email.toLowerCase() === email.toLowerCase())) {
    triggerToast('该邮箱已在列表中');
    return;
  }
  try {
    await userAPI.sendNotifyEmailCode(email);
    verifyingEmail.value = email;
    triggerToast(`已向 ${email} 发送验证码`);
    newNotifyEmail.value = '';
  } catch (err: any) {
    triggerToast(err.message || err.response?.data?.detail || '发送验证码失败');
  }
}

async function verifyExtraNotifyEmail() {
  if (!profileReady.value || isVerifyingCode.value) return;
  if (!verifyingEmail.value || !verifyCodeInput.value || verifyCodeInput.value.length !== 6) return;
  const session = captureUserSession(authStore);
  if (!session) return;
  isVerifyingCode.value = true;
  try {
    await userAPI.verifyNotifyEmail(verifyingEmail.value, verifyCodeInput.value);
    if (disposed || !isUserSessionCurrent(authStore, session)) return;
    triggerToast('通知邮箱验证绑定成功');
    verifyingEmail.value = '';
    verifyCodeInput.value = '';
    const updated = await userAPI.getProfile();
    if (disposed || !publishUserProfile(authStore, session, updated)) return;
    extraEmails.value = updated.balance_notify_extra_emails ? [...updated.balance_notify_extra_emails] : [];
  } catch (err: any) {
    triggerToast(err.message || err.response?.data?.detail || '验证码错误或已过期');
  } finally {
    isVerifyingCode.value = false;
  }
}

async function removeExtraNotifyEmail(email: string) {
  const session = captureUserSession(authStore);
  if (!session) return;
  try {
    await userAPI.removeNotifyEmail(email);
    if (disposed || !isUserSessionCurrent(authStore, session)) return;
    triggerToast('已移除通知邮箱');
    const updated = await userAPI.getProfile();
    if (disposed || !publishUserProfile(authStore, session, updated)) return;
    extraEmails.value = updated.balance_notify_extra_emails ? [...updated.balance_notify_extra_emails] : [];
  } catch (err: any) {
    triggerToast(err.message || err.response?.data?.detail || '移除邮箱失败');
  }
}

// ==========================================
// 2. Sub2API Admin Settings Data State
// ==========================================
const adminSettings = ref<SettingsForm>({
  backend_mode_enabled: false, site_name: '', site_subtitle: '', api_base_url: '', custom_endpoints: [],
  login_agreement_enabled: false, login_agreement_mode: 'modal', login_agreement_documents: [],
  registration_enabled: false, email_verify_enabled: false, promo_code_enabled: false, model_plaza_enabled: false,
  turnstile_enabled: false, turnstile_site_key: '', linuxdo_connect_enabled: false, wechat_connect_enabled: false,
  default_balance: 0, default_concurrency: 1, default_user_rpm_limit: 0,
  account_scheduling_thresholds: normalizeAccountSchedulingThresholdsMap(),
  payment_enabled: false, payment_subscription_usd_to_cny_rate: 0, payment_recharge_fee_rate: 0,
  payment_min_amount: 0, payment_max_amount: 0, payment_daily_limit: 0, payment_order_timeout_minutes: 30, payment_max_pending_orders: 3,
  payment_balance_disabled: false, payment_balance_recharge_multiplier: 1, payment_load_balance_strategy: 'round-robin', payment_enabled_types: [],
  payment_product_name_prefix: '', payment_product_name_suffix: '', payment_help_image_url: '', payment_help_text: '',
  payment_cancel_rate_limit_enabled: false, payment_cancel_rate_limit_max: 3, payment_cancel_rate_limit_window: 1, payment_cancel_rate_limit_unit: 'hour', payment_cancel_rate_limit_window_mode: 'rolling',
  smtp_host: '', smtp_port: 587, smtp_username: '', smtp_from_email: '', smtp_from_name: '', smtp_use_tls: false
});
const savedSettings = ref<Partial<SettingsForm>>({});
const moduleDraftBaselines = ref<Record<string, string>>({});
function moduleDrafts(): Record<string, unknown> {
  return { overload: overloadCooldownForm.value, rate429: rateLimit429CooldownForm.value, stream: streamTimeoutForm.value,
    rectifier: rectifierForm.value, panel: panelRateLimitForm.value, s3: s3Config.value, image: imageStorageConfig.value, schedule: backupSchedule.value };
}
function rememberModule(name: string) { moduleDraftBaselines.value[name] = JSON.stringify(moduleDrafts()[name]); }
function moduleDirty(name: string) { return moduleDraftBaselines.value[name] !== undefined && JSON.stringify(moduleDrafts()[name]) !== moduleDraftBaselines.value[name]; }

function thresholdAvailable(platform: keyof AccountSchedulingThresholdsMap): boolean {
  const value = savedSettings.value.account_scheduling_thresholds?.[platform];
  return adminSettingsReady.value && Number.isInteger(value) && value! >= 1 && value! <= 100;
}
function editSchedulingThreshold(platform: keyof AccountSchedulingThresholdsMap, event: Event) {
  if (!thresholdAvailable(platform) || isSaving.value || adminSettingsLoading.value) return;
  const value = (event.target as HTMLInputElement).value;
  adminSettings.value.account_scheduling_thresholds = { ...adminSettings.value.account_scheduling_thresholds, [platform]: value.trim() ? Number(value) : NaN };
}

// ==========================================
// 2.1 Gateway Subsystems State (100% Real Sub2API Backend)
// ==========================================
// 1. 529 过载冷却
const overloadCooldownForm = ref<OverloadCooldownSettings>({
  enabled: true,
  cooldown_minutes: 30
});
const overloadCooldownLoading = ref(false);
const overloadCooldownSaving = ref(false);

// 2. 429 默认回避
const rateLimit429CooldownForm = ref<RateLimit429CooldownSettings>({
  enabled: true,
  cooldown_seconds: 60
});
const rateLimit429CooldownLoading = ref(false);
const rateLimit429CooldownSaving = ref(false);

// 3. 流超时处理
const streamTimeoutForm = ref<StreamTimeoutSettings>({
  enabled: false,
  action: 'temp_unsched',
  temp_unsched_minutes: 5,
  threshold_count: 3,
  threshold_window_minutes: 10
});
const streamTimeoutLoading = ref(false);
const streamTimeoutSaving = ref(false);

// 4. 请求整流器
const rectifierForm = ref<RectifierSettings>({
  enabled: true,
  thinking_signature_enabled: true,
  thinking_budget_enabled: true,
  apikey_signature_enabled: false,
  apikey_signature_patterns: []
});
const rectifierLoading = ref(false);
const rectifierSaving = ref(false);

// ==========================================
// 2.2 Security: Admin API Key & Panel Rate Limit State
// ==========================================
const adminApiKeyStatus = ref<AdminApiKeyStatus>({ exists: false, masked_key: '' });
const adminApiKeyLoading = ref(false);
const adminApiKeyOperating = ref(false);
const newlyGeneratedAdminApiKey = ref<string | null>(null);

const panelRateLimitForm = ref<PanelRateLimitSettings>({
  enabled: true,
  user_rpm: 240,
  heavy_rpm: 60,
  exempt_admin: true,
  public_ip_rpm: 300
});
const panelRateLimitLoading = ref(false);
const panelRateLimitSaving = ref(false);

// ==========================================
// 2.3 Email Test State
// ==========================================
const testEmailAddress = ref('');
const isTestingEmail = ref(false);
const isTestingSmtp = ref(false);

// ==========================================
// 2.4 Load & Save Handlers
// ==========================================
async function loadAdminSettings() {
  if (!authStore.isAdmin || adminSettingsLoading.value || isSaving.value || isTestingEmail.value || isTestingSmtp.value) return;
  const generation = ++settingsGeneration, owner = settingsOwner();
  adminSettingsReady.value = false;
  adminSettingsLoading.value = true;
  adminSettingsError.value = '';
  try {
    const data = await settingsAPI.getSettings();
    if (!settingsCurrent(generation, owner)) return;
    const values = copySettings(data || {});
    if (!Object.keys(values).length) throw new Error('配置响应为空');
    Object.assign(adminSettings.value, values);
    savedSettings.value = copySettings(values);
    settingsSecrets.value = emptySettingsSecrets();
    adminSettingsReady.value = true;
  } catch {
    if (settingsCurrent(generation, owner)) adminSettingsError.value = '配置暂时无法加载，请重试';
  } finally { if (settingsCurrent(generation, owner)) adminSettingsLoading.value = false; }
}

const moduleReady = ref<Record<string, boolean>>({});

function requireModule(name: string): boolean {
  if (authStore.isAdmin && moduleReady.value[name]) return true;
  triggerToast('该模块配置尚未读取成功，请重新进入本页重试');
  return false;
}

async function loadGatewaySettings() {
  if (!authStore.isAdmin || overloadCooldownLoading.value) return;
  moduleError.value = '';
  for (const name of ['overload', 'rate429', 'stream', 'rectifier']) moduleReady.value[name] = false;
  overloadCooldownLoading.value = true;
  rateLimit429CooldownLoading.value = true;
  streamTimeoutLoading.value = true;
  rectifierLoading.value = true;
  try {
    const [ov, rl, st, rec] = await Promise.allSettled([
      settingsAPI.getOverloadCooldownSettings(),
      settingsAPI.getRateLimit429CooldownSettings(),
      settingsAPI.getStreamTimeoutSettings(),
      settingsAPI.getRectifierSettings()
    ]);
    if (disposed) return;
    for (const [name, result] of [['overload', ov], ['rate429', rl], ['stream', st], ['rectifier', rec]] as const) {
      moduleReady.value[name] = result.status === 'fulfilled' && Boolean(result.value);
    }
    if ([ov, rl, st, rec].some(result => result.status === 'rejected')) { moduleErrorTab.value = 'admin_gateway'; moduleError.value = '部分网关配置加载失败，对应模块暂不可保存。'; }
    if (ov.status === 'fulfilled' && ov.value) Object.assign(overloadCooldownForm.value, ov.value);
    if (rl.status === 'fulfilled' && rl.value) Object.assign(rateLimit429CooldownForm.value, rl.value);
    if (st.status === 'fulfilled' && st.value) Object.assign(streamTimeoutForm.value, st.value);
    if (rec.status === 'fulfilled' && rec.value) {
      Object.assign(rectifierForm.value, rec.value);
      if (!Array.isArray(rectifierForm.value.apikey_signature_patterns)) {
        rectifierForm.value.apikey_signature_patterns = [];
      }
    }
    for (const name of ['overload', 'rate429', 'stream', 'rectifier']) if (moduleReady.value[name]) rememberModule(name);
  } catch (err) {
    console.error('Failed to load gateway settings', err);
  } finally {
    overloadCooldownLoading.value = false;
    rateLimit429CooldownLoading.value = false;
    streamTimeoutLoading.value = false;
    rectifierLoading.value = false;
  }
}

async function saveOverloadCooldown() {
  if (overloadCooldownSaving.value || !requireModule('overload')) return false;
  overloadCooldownSaving.value = true;
  try {
    const updated = await settingsAPI.updateOverloadCooldownSettings({
      enabled: overloadCooldownForm.value.enabled,
      cooldown_minutes: Number(overloadCooldownForm.value.cooldown_minutes) || 30
    });
    Object.assign(overloadCooldownForm.value, updated);
    rememberModule('overload');
    triggerToast('529 过载冷却设置已保存');
    return true;
  } catch (err: any) {
    triggerToast(err.message || err.response?.data?.detail || '保存 529 冷却设置失败');
  } finally {
    overloadCooldownSaving.value = false;
  }
}

async function saveRateLimit429Cooldown() {
  if (rateLimit429CooldownSaving.value || !requireModule('rate429')) return false;
  rateLimit429CooldownSaving.value = true;
  try {
    const updated = await settingsAPI.updateRateLimit429CooldownSettings({
      enabled: rateLimit429CooldownForm.value.enabled,
      cooldown_seconds: Number(rateLimit429CooldownForm.value.cooldown_seconds) || 60
    });
    Object.assign(rateLimit429CooldownForm.value, updated);
    rememberModule('rate429');
    triggerToast('429 默认回避设置已保存');
    return true;
  } catch (err: any) {
    triggerToast(err.message || err.response?.data?.detail || '保存 429 默认回避设置失败');
  } finally {
    rateLimit429CooldownSaving.value = false;
  }
}

async function saveStreamTimeout() {
  if (streamTimeoutSaving.value || !requireModule('stream')) return false;
  streamTimeoutSaving.value = true;
  try {
    const updated = await settingsAPI.updateStreamTimeoutSettings({
      enabled: streamTimeoutForm.value.enabled,
      action: streamTimeoutForm.value.action,
      temp_unsched_minutes: Number(streamTimeoutForm.value.temp_unsched_minutes) || 5,
      threshold_count: Number(streamTimeoutForm.value.threshold_count) || 3,
      threshold_window_minutes: Number(streamTimeoutForm.value.threshold_window_minutes) || 10
    });
    Object.assign(streamTimeoutForm.value, updated);
    rememberModule('stream');
    triggerToast('流超时设置已保存');
    return true;
  } catch (err: any) {
    triggerToast(err.message || err.response?.data?.detail || '保存流超时设置失败');
  } finally {
    streamTimeoutSaving.value = false;
  }
}

async function saveRectifier() {
  if (rectifierSaving.value || !requireModule('rectifier')) return false;
  rectifierSaving.value = true;
  try {
    const patterns = (rectifierForm.value.apikey_signature_patterns || [])
      .map(p => p.trim())
      .filter(Boolean);
    const updated = await settingsAPI.updateRectifierSettings({
      enabled: rectifierForm.value.enabled,
      thinking_signature_enabled: rectifierForm.value.thinking_signature_enabled,
      thinking_budget_enabled: rectifierForm.value.thinking_budget_enabled,
      apikey_signature_enabled: rectifierForm.value.apikey_signature_enabled,
      apikey_signature_patterns: patterns
    });
    Object.assign(rectifierForm.value, updated);
    if (!Array.isArray(rectifierForm.value.apikey_signature_patterns)) {
      rectifierForm.value.apikey_signature_patterns = [];
    }
    rememberModule('rectifier');
    triggerToast('请求整流器设置已保存');
    return true;
  } catch (err: any) {
    triggerToast(err.message || err.response?.data?.detail || '保存整流器设置失败');
  } finally {
    rectifierSaving.value = false;
  }
}

function addRectifierPattern() {
  if (!Array.isArray(rectifierForm.value.apikey_signature_patterns)) {
    rectifierForm.value.apikey_signature_patterns = [];
  }
  rectifierForm.value.apikey_signature_patterns.push('');
}

function removeRectifierPattern(idx: number) {
  rectifierForm.value.apikey_signature_patterns.splice(idx, 1);
}

// Security: Admin API Key Methods
async function loadAdminApiKey() {
  if (!authStore.isAdmin) return;
  adminApiKeyLoading.value = true;
  try {
    const res = await settingsAPI.getAdminApiKey();
    adminApiKeyStatus.value = res;
  } catch {
    // fallback
  } finally {
    adminApiKeyLoading.value = false;
  }
}

async function handleRegenerateAdminApiKey() {
  if (adminApiKeyOperating.value) return;
  adminApiKeyOperating.value = true;
  try {
    const res = await settingsAPI.regenerateAdminApiKey();
    newlyGeneratedAdminApiKey.value = res.key;
    await loadAdminApiKey();
    triggerToast('管理员密钥已重新生成');
  } catch (err: any) {
    triggerToast(err.message || err.response?.data?.detail || '重新生成密钥失败');
  } finally {
    adminApiKeyOperating.value = false;
  }
}

async function handleDeleteAdminApiKey() {
  if (adminApiKeyOperating.value) return;
  adminApiKeyOperating.value = true;
  try {
    await settingsAPI.deleteAdminApiKey();
    adminApiKeyStatus.value = { exists: false, masked_key: '' };
    newlyGeneratedAdminApiKey.value = null;
    triggerToast('管理员密钥已删除');
  } catch (err: any) {
    triggerToast(err.message || err.response?.data?.detail || '删除密钥失败');
  } finally {
    adminApiKeyOperating.value = false;
  }
}

function copyNewAdminKey() {
  if (!newlyGeneratedAdminApiKey.value) return;
  navigator.clipboard.writeText(newlyGeneratedAdminApiKey.value);
  triggerToast('密钥已复制到剪贴板');
}

// Security: Panel Rate Limit Methods
async function loadPanelRateLimit() {
  if (!authStore.isAdmin || panelRateLimitLoading.value) return;
  moduleReady.value.panel = false;
  panelRateLimitLoading.value = true;
  try {
    const res = await settingsAPI.getPanelRateLimitSettings();
    Object.assign(panelRateLimitForm.value, res);
    moduleReady.value.panel = Boolean(res);
    if (res) rememberModule('panel');
  } catch {
    moduleErrorTab.value = 'admin_security'; moduleError.value = '面板限流配置无法读取，请重试。';
  } finally {
    panelRateLimitLoading.value = false;
  }
}

async function savePanelRateLimit() {
  if (panelRateLimitSaving.value || !requireModule('panel')) return false;
  panelRateLimitSaving.value = true;
  try {
    const updated = await settingsAPI.updatePanelRateLimitSettings({
      enabled: panelRateLimitForm.value.enabled,
      user_rpm: Number(panelRateLimitForm.value.user_rpm) || 240,
      heavy_rpm: Number(panelRateLimitForm.value.heavy_rpm) || 60,
      exempt_admin: panelRateLimitForm.value.exempt_admin,
      public_ip_rpm: Number(panelRateLimitForm.value.public_ip_rpm) || 300
    });
    Object.assign(panelRateLimitForm.value, updated);
    rememberModule('panel');
    triggerToast('面板请求频率限制已保存');
    return true;
  } catch (err: any) {
    triggerToast(err.message || err.response?.data?.detail || '保存频率限制失败');
  } finally {
    panelRateLimitSaving.value = false;
  }
}

// Email tests use the unsaved password when entered; empty asks the backend to use its stored password.
async function runSmtpTest(sendEmail: boolean) {
  if (!authStore.isAdmin || !adminSettingsReady.value || adminSettingsLoading.value || isSaving.value || isTestingEmail.value || isTestingSmtp.value) return;
  let smtp;
  const recipient = testEmailAddress.value.trim();
  try {
    smtp = smtpTestPayload(adminSettings.value, settingsSecrets.value, savedSettings.value);
    if (sendEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error('请输入有效的测试收件邮箱。');
  } catch (e) { triggerToast((e as Error).message); return; }
  const generation = settingsGeneration, owner = settingsOwner();
  const busy = sendEmail ? isTestingEmail : isTestingSmtp;
  busy.value = true;
  try {
    if (sendEmail) await settingsAPI.sendTestEmail({ ...smtp, email: recipient, smtp_from_email: adminSettings.value.smtp_from_email, smtp_from_name: adminSettings.value.smtp_from_name });
    else await settingsAPI.testSmtpConnection(smtp);
    if (settingsCurrent(generation, owner)) triggerToast(sendEmail ? `测试邮件发送请求已完成：${recipient}` : 'SMTP 连接与认证测试成功。');
  } catch (e) {
    if (!settingsCurrent(generation, owner)) return;
    if (settingsWriteUnknown(e)) {
      adminSettingsReady.value = false;
      adminSettingsError.value = sendEmail ? '测试邮件发送结果尚未确认，请先查收邮件并重新读取配置，避免重复发送。' : 'SMTP 测试结果尚未确认，请重新读取配置后重试。';
    }
    triggerToast('邮件测试未完成，请检查主机、端口、凭据和服务器连接。');
  } finally { if (settingsCurrent(generation, owner)) busy.value = false; }
}
async function handleSendTestEmail() { await runSmtpTest(true); }
async function handleTestSmtpConnection() { await runSmtpTest(false); }

async function saveAdminSettings() {
  if (!authStore.isAdmin || disposed || isSaving.value || adminSettingsLoading.value || isTestingEmail.value || isTestingSmtp.value || (!adminSettingsReady.value && activeTab.value !== 'admin_gateway')) return;
  if (activeTab.value === 'admin_gateway') {
    isSaving.value = true;
    try {
      const results = await Promise.all([
        saveOverloadCooldown(),
        saveRateLimit429Cooldown(),
        saveStreamTimeout(),
        saveRectifier()
      ]);
      triggerToast(results.every(result => result === true) ? '网关设置已全部保存' : '部分网关设置未保存，请检查各模块后重试');
    } catch {
      triggerToast('部分网关设置保存失败');
    } finally {
      isSaving.value = false;
    }
    return;
  }

  const generation = settingsGeneration, owner = settingsOwner();
  isSaving.value = true;
  let dispatched = false, responded = false;
  try {
    const tab = activeTab.value;
    if (!isSettingsTab(tab)) return;
    const payload = { ...settingsPatch(tab, adminSettings.value, savedSettings.value), ...settingsSecretPatch(tab, settingsSecrets.value, savedSettings.value) };
    if (Object.keys(payload).length) {
      dispatched = true;
      const response = await settingsAPI.updateSettings(payload);
      responded = true;
      if (!settingsCurrent(generation, owner)) return;
      const updated = confirmedSettingsResponse(payload, response);
      // Only reconcile submitted fields; preserve other tabs and edits made while saving.
      for (const [field, sent] of Object.entries(payload)) {
        if (field === 'smtp_password' || field === 'turnstile_secret_key') {
          if (settingsSecrets.value[field] === sent) settingsSecrets.value[field] = '';
          const configured = `${field}_configured` as const;
          Object.assign(savedSettings.value, { [configured]: updated[configured] });
          Object.assign(adminSettings.value, { [configured]: updated[configured] });
          continue;
        }
        const key = field as keyof SettingsForm, value = updated[key];
        if (JSON.stringify(adminSettings.value[key]) === JSON.stringify(sent)) Object.assign(adminSettings.value, { [key]: value });
        Object.assign(savedSettings.value, { [key]: value });
      }
    }
    if (tab === 'admin_security' && moduleReady.value.panel) {
      const saved = await savePanelRateLimit();
      if (!settingsCurrent(generation, owner)) return;
      if (!saved) { triggerToast('基本设置已保存，面板频率限制未保存，请重试'); return; }
    }
    triggerToast(Object.keys(payload).length ? '本模块设置已保存' : '本模块没有未保存的更改');
  } catch (err) {
    if (!settingsCurrent(generation, owner)) return;
    if (dispatched && (responded || settingsWriteUnknown(err))) {
      adminSettingsReady.value = false;
      adminSettingsError.value = '保存结果尚未确认，请重新读取配置核对，避免重复提交。';
      triggerToast(adminSettingsError.value);
    } else triggerToast(dispatched ? '保存被拒绝，请核对本模块配置后重试。' : (err as Error).message || '保存设置失败');
  } finally { if (settingsCurrent(generation, owner)) isSaving.value = false; }
}

function addAgreementDocument() { adminSettings.value.login_agreement_documents.push({ id: crypto.randomUUID(), title: '新文档', content_md: '' }); }

function addCustomEndpoint() {
  adminSettings.value.custom_endpoints.push({ name: '新端点', endpoint: 'https://', description: '' });
}

function removeCustomEndpoint(idx: number) {
  adminSettings.value.custom_endpoints.splice(idx, 1);
}

const alertSheet = ref({
  show: false,
  title: '',
  message: '',
  confirmText: '',
  danger: true,
  loading: false,
  action: null as (() => Promise<void>) | null
});

function confirmAdminKeyAction(remove: boolean) {
  alertSheet.value = { show: true, title: remove ? '删除管理员密钥' : '重新生成管理员密钥', message: '现有密钥将失效，使用该密钥的管理工具需要重新配置。', confirmText: '确认执行', danger: true, loading: false, action: async () => { await (remove ? handleDeleteAdminApiKey() : handleRegenerateAdminApiKey()); alertSheet.value.show = false; } };
}

async function handleAlertConfirm() {
  if (!alertSheet.value.action || alertSheet.value.loading) return;
  alertSheet.value.loading = true;
  try { await alertSheet.value.action(); } finally { alertSheet.value.loading = false; }
}

// ==========================================
// 2.9. Data Backup & Storage (数据备份与存储)
// ==========================================
const s3Config = ref<backupAPI.BackupS3Config>({
  endpoint: '',
  region: 'auto',
  bucket: '',
  access_key_id: '',
  secret_access_key: '',
  prefix: 'backups/',
  force_path_style: false
});
const s3SecretConfigured = ref(false);
const s3Loading = ref(false);
const s3Saving = ref(false);
const s3Testing = ref(false);

const imageStorageConfig = ref<backupAPI.ImageStorageConfig>({
  enabled: false,
  reuse_backup_s3: true,
  bucket: '',
  prefix: 'images/',
  public_base_url: '',
  presign_expiry_hours: 24,
  max_download_bytes: 10485760,
  endpoint: '',
  region: 'auto',
  access_key_id: '',
  secret_access_key: '',
  force_path_style: false
});
const imageStorageSecretConfigured = ref(false);
const imageStorageLoading = ref(false);
const imageStorageSaving = ref(false);
const imageStorageTesting = ref(false);

const backupSchedule = ref<backupAPI.BackupScheduleConfig>({
  enabled: false,
  cron_expr: '0 3 * * *',
  retain_days: 7,
  retain_count: 5
});
const scheduleLoading = ref(false);
const scheduleSaving = ref(false);

const backupRecords = ref<backupAPI.BackupRecord[]>([]);
const backupsLoading = ref(false);
const creatingManualBackup = ref(false);
const showRestoreModal = ref(false);
const targetRestoreRecord = ref<backupAPI.BackupRecord | null>(null);
const restorePassword = ref('');
const isRestoring = ref(false);

async function loadBackupData() {
  if (!authStore.isAdmin) return;
  for (const name of ['s3', 'image', 'schedule']) moduleReady.value[name] = false;
  s3Loading.value = true;
  imageStorageLoading.value = true;
  scheduleLoading.value = true;
  backupsLoading.value = true;
  try {
    const [s3Res, imgRes, schedRes, listRes] = await Promise.allSettled([
      backupAPI.getS3Config(),
      backupAPI.getImageStorageConfig(),
      backupAPI.getSchedule(),
      backupAPI.listBackups()
    ]);
    if (disposed) return;
    if (s3Res.status === 'fulfilled' && s3Res.value) {
      moduleReady.value.s3 = true;
      Object.assign(s3Config.value, s3Res.value);
      if (s3Res.value.secret_access_key) s3SecretConfigured.value = true;
      rememberModule('s3');
    }
    if (imgRes.status === 'fulfilled' && imgRes.value) {
      moduleReady.value.image = true;
      const resp = imgRes.value;
      if (resp.config) {
        Object.assign(imageStorageConfig.value, resp.config);
        imageStorageSecretConfigured.value = resp.secret_configured ?? false;
      } else {
        Object.assign(imageStorageConfig.value, resp);
      }
      rememberModule('image');
    }
    if (schedRes.status === 'fulfilled' && schedRes.value) {
      moduleReady.value.schedule = true;
      Object.assign(backupSchedule.value, schedRes.value);
      rememberModule('schedule');
    }
    if (listRes.status === 'fulfilled' && listRes.value) {
      backupRecords.value = listRes.value.items || [];
    }
    if ([s3Res, imgRes, schedRes, listRes].some(result => result.status === 'rejected')) { moduleErrorTab.value = 'admin_backup'; moduleError.value = '部分备份配置或记录加载失败，请重试。'; }
  } catch (err) {
    console.error('Failed to load backup data', err);
  } finally {
    s3Loading.value = false;
    imageStorageLoading.value = false;
    scheduleLoading.value = false;
    backupsLoading.value = false;
  }
}

async function testS3Config() {
  s3Testing.value = true;
  try {
    const res = await backupAPI.testS3Connection(s3Config.value);
    if (res.ok) {
      triggerToast('S3 存储桶连接与权限验证成功');
    } else {
      triggerToast(res.message || 'S3 连接测试失败');
    }
  } catch (err: any) {
    triggerToast(err.message || err.response?.data?.detail || err.response?.data?.message || 'S3 连接测试失败');
  } finally {
    s3Testing.value = false;
  }
}

async function saveS3Config() {
  if (s3Saving.value || !requireModule('s3')) return;
  s3Saving.value = true;
  try {
    const res = await backupAPI.updateS3Config(s3Config.value);
    Object.assign(s3Config.value, res);
    rememberModule('s3');
    triggerToast('S3 备份存储配置已保存');
  } catch (err: any) {
    triggerToast(err.message || err.response?.data?.detail || err.response?.data?.message || '保存 S3 配置失败');
  } finally {
    s3Saving.value = false;
  }
}

async function testImageStorage() {
  imageStorageTesting.value = true;
  try {
    const res = await backupAPI.testImageStorageConnection(imageStorageConfig.value);
    if (res.ok) {
      triggerToast('图片对象存储连接成功');
    } else {
      triggerToast(res.message || '图片存储连接失败');
    }
  } catch (err: any) {
    triggerToast(err.message || err.response?.data?.detail || err.response?.data?.message || '图片存储连接失败');
  } finally {
    imageStorageTesting.value = false;
  }
}

async function saveImageStorage() {
  if (imageStorageSaving.value || !requireModule('image')) return;
  imageStorageSaving.value = true;
  try {
    const res = await backupAPI.updateImageStorageConfig(imageStorageConfig.value);
    Object.assign(imageStorageConfig.value, res);
    rememberModule('image');
    triggerToast('图片对象存储配置已保存');
  } catch (err: any) {
    triggerToast(err.message || err.response?.data?.detail || err.response?.data?.message || '保存图片存储配置失败');
  } finally {
    imageStorageSaving.value = false;
  }
}

async function saveBackupSchedule() {
  if (scheduleSaving.value || !requireModule('schedule')) return;
  scheduleSaving.value = true;
  try {
    const res = await backupAPI.updateSchedule(backupSchedule.value);
    Object.assign(backupSchedule.value, res);
    rememberModule('schedule');
    triggerToast('定时备份策略已保存');
  } catch (err: any) {
    triggerToast(err.message || err.response?.data?.detail || err.response?.data?.message || '保存备份策略失败');
  } finally {
    scheduleSaving.value = false;
  }
}

async function handleCreateBackup() {
  creatingManualBackup.value = true;
  try {
    const res = await backupAPI.createBackup({ expire_days: backupSchedule.value.retain_days });
    triggerToast(`备份任务已发起: ${res.file_name || res.id}`);
    await backupAPI.listBackups().then(r => { backupRecords.value = r.items || []; });
  } catch (err: any) {
    triggerToast(err.message || err.response?.data?.detail || err.response?.data?.message || '创建备份失败');
  } finally {
    creatingManualBackup.value = false;
  }
}

async function handleDownloadBackup(id: string) {
  try {
    const res = await backupAPI.getDownloadURL(id);
    if (res.url) {
      window.open(res.url, '_blank');
      triggerToast('下载链接已在新标签页打开');
    } else if (res.parts && res.parts.length > 0) {
      res.parts.forEach(p => window.open(p.url, '_blank'));
      triggerToast(`已触发 ${res.parts.length} 个分卷下载`);
    }
  } catch (err: any) {
    triggerToast(err.message || err.response?.data?.detail || err.response?.data?.message || '获取下载链接失败');
  }
}

function openRestoreModal(record: backupAPI.BackupRecord) {
  targetRestoreRecord.value = record;
  restorePassword.value = '';
  showRestoreModal.value = true;
}

async function submitRestoreBackup() {
  if (isRestoring.value) return;
  if (!targetRestoreRecord.value) return;
  if (!restorePassword.value.trim()) {
    triggerToast('请输入管理员密码以确认恢复');
    return;
  }
  isRestoring.value = true;
  try {
    const res = await backupAPI.restoreBackup(targetRestoreRecord.value.id, restorePassword.value);
    triggerToast(res.restore_status ? `恢复状态: ${res.restore_status}` : '备份恢复流程已发起');
    showRestoreModal.value = false;
    await backupAPI.listBackups().then(r => { backupRecords.value = r.items || []; });
  } catch (err: any) {
    triggerToast(err.message || err.response?.data?.detail || err.response?.data?.message || '恢复备份失败');
  } finally {
    isRestoring.value = false;
  }
}

function promptDeleteBackup(id: string) {
  const record = backupRecords.value.find(r => r.id === id);
  const name = record?.file_name || id;
  alertSheet.value = {
    show: true,
    title: '确定要永久删除此份备份吗？',
    message: `备份文件: ${name}。此操作无法撤销。`,
    confirmText: '删除备份',
    danger: true,
    loading: false,
    action: async () => {
      alertSheet.value.loading = true;
      try {
        await backupAPI.deleteBackup(id);
        triggerToast('备份已成功删除');
        backupRecords.value = backupRecords.value.filter(r => r.id !== id);
        alertSheet.value.show = false;
      } catch (err: any) {
        triggerToast(err.message || err.response?.data?.detail || err.response?.data?.message || '删除备份失败');
      } finally {
        alertSheet.value.loading = false;
      }
    }
  };
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ==========================================
// 3. Navigation Items Definition
// ==========================================
interface NavItem {
  id: string;
  name: string;
  icon: BadgeIcon;
  color: BadgeColor;
  group: 'personal' | 'admin';
}

const allNavItems = computed<NavItem[]>(() => {
  const list: NavItem[] = [
    // 个人偏好与账户
    { id: 'profile', name: '个人设置', icon: 'users', color: 'blue', group: 'personal' },
    { id: 'appearance', name: '外观与主题', icon: 'appearance', color: 'indigo', group: 'personal' },
    { id: 'desktop', name: '桌面与壁纸', icon: 'wallpaper', color: 'teal', group: 'personal' },
    { id: 'sound', name: '声音与反馈', icon: 'sound', color: 'pink', group: 'personal' }
  ];

  if (authStore.isAdmin) {
    list.push(
      // Sub2API 平台管理专区 (100% 对齐原版 9 大设置模块)
      { id: 'admin_general', name: '通用设置', icon: 'gear', color: 'blue', group: 'admin' },
      { id: 'admin_terms', name: '登录条款', icon: 'shield', color: 'teal', group: 'admin' },
      { id: 'admin_features', name: '功能开关', icon: 'sliders', color: 'purple', group: 'admin' },
      { id: 'admin_security', name: '安全与认证', icon: 'lock', color: 'green', group: 'admin' },
      { id: 'admin_defaults', name: '用户默认值', icon: 'users', color: 'indigo', group: 'admin' },
      { id: 'admin_gateway', name: '网关设置', icon: 'wifi', color: 'blue', group: 'admin' },
      { id: 'admin_policies', name: '请求策略', icon: 'sliders', color: 'indigo', group: 'admin' },
      { id: 'admin_payment', name: '支付设置', icon: 'key', color: 'orange', group: 'admin' },
      { id: 'admin_cardshop', name: '小铺与兑换', icon: 'key', color: 'teal', group: 'admin' },
      { id: 'admin_email', name: '邮件设置', icon: 'bell', color: 'pink', group: 'admin' },
      { id: 'admin_backup', name: '数据备份', icon: 'cloud', color: 'gray', group: 'admin' },
      { id: 'admin_update', name: '软件更新', icon: 'sparkles', color: 'orange', group: 'admin' }
    );
  }

  return list;
});

const filteredNavItems = computed(() => {
  if (!searchQuery.value.trim()) return allNavItems.value;
  const q = searchQuery.value.toLowerCase().trim();
  return allNavItems.value.filter(item => item.name.toLowerCase().includes(q));
});

const groupedNavItems = computed(() => {
  const groups: { key: string; label: string; items: NavItem[] }[] = [
    { key: 'personal', label: '个人偏好', items: [] }
  ];

  if (authStore.isAdmin) {
    groups.push({ key: 'admin', label: 'Sub2API 平台管理', items: [] });
  }

  filteredNavItems.value.forEach(item => {
    const g = groups.find(x => x.key === item.group);
    if (g) g.items.push(item);
  });

  return groups.filter(g => g.items.length > 0);
});

// Wallpapers
const wallpapers: { id: WallpaperName; name: string; tag: string }[] = [
  ...extraWallpapers as { id: WallpaperName; name: string; tag: string }[],
  { id: 'tahoe', name: '潮汐', tag: '原创壁纸' },
  { id: 'tahoe-night', name: '潮汐 · 夜', tag: '原创壁纸' },
  { id: 'sequoia', name: '林间', tag: '原创壁纸' },
  { id: 'sonoma', name: '暮色', tag: '原创壁纸' },
  { id: 'monterey', name: '远山', tag: '原创壁纸' },
  { id: 'ventura', name: '暖沙', tag: '原创壁纸' }
];

// Accent Colors
const accentColors = [
  { id: 'multicolor', label: '多色', class: 'bg-gradient-to-tr from-[#007aff] via-[#ff2d55] to-[#ff9500]' },
  { id: 'blue', label: '系统蓝', class: 'bg-[#007aff]' },
  { id: 'purple', label: '紫', class: 'bg-[#af52de]' },
  { id: 'pink', label: '粉红', class: 'bg-[#ff2d55]' },
  { id: 'red', label: '红', class: 'bg-[#ff3b30]' },
  { id: 'orange', label: '橙', class: 'bg-[#ff9500]' },
  { id: 'yellow', label: '黄', class: 'bg-[#ffcc00]' },
  { id: 'green', label: '绿', class: 'bg-[#34c759]' },
  { id: 'graphite', label: '石墨灰', class: 'bg-[#8e8e93]' }
];
const selectedAccent = computed({ get: () => systemStore.accentColor, set: value => { systemStore.accentColor = value; } });

const settingsDirty = computed(() => {
  const generalChanged = Object.entries(savedSettings.value).some(([field,value]) => JSON.stringify(adminSettings.value[field as keyof SettingsForm]) !== JSON.stringify(value));
  const profileChanged = profileReady.value && (
    usernameDraft.value.trim() !== (authStore.user?.username || '').trim() ||
    !!avatarDraft.value || (balanceNotifyThreshold.value ?? 0) !== (authStore.user?.balance_notify_threshold ?? 0));
  return generalChanged || Object.values(settingsSecrets.value).some(value => !!value) ||
    Object.keys(moduleDraftBaselines.value).some(moduleDirty) || !!profileChanged ||
    Object.values(passwordForm.value).some(value => !!value) || !!newNotifyEmail.value || !!verifyCodeInput.value ||
    (showEmailBindingForm.value && !!(emailBindingInput.value || emailBindingCode.value || emailBindingPassword.value));
});
const settingsBusy = computed(() => isSaving.value || isUpdatingProfile.value || isSavingAvatar.value || isChangingPassword.value ||
  isSavingBalanceNotify.value || emailBindingBusy.value || isVerifyingCode.value || isTestingEmail.value || isTestingSmtp.value ||
  overloadCooldownSaving.value || rateLimit429CooldownSaving.value || streamTimeoutSaving.value || rectifierSaving.value ||
  panelRateLimitSaving.value || adminApiKeyOperating.value || s3Saving.value || s3Testing.value || imageStorageSaving.value ||
  imageStorageTesting.value || scheduleSaving.value || creatingManualBackup.value || isRestoring.value);
const pendingSettingsReload = ref<(() => void) | null>(null);
function requestProfileReload() {
  if (settingsBusy.value) return;
  const reload = () => { void loadUserProfileData(); };
  if (settingsDirty.value) pendingSettingsReload.value = reload;
  else reload();
}
function requestSettingsReload(module = false) {
  if (settingsBusy.value || adminSettingsLoading.value) return;
  const tab = activeTab.value;
  const reload = () => { if (!module) void loadAdminSettings(); else if (tab === 'admin_gateway') void loadGatewaySettings(); else if (tab === 'admin_backup') void loadBackupData(); else void loadPanelRateLimit(); };
  if (settingsDirty.value) pendingSettingsReload.value = reload;
  else reload();
}
function confirmSettingsReload() {
  if (settingsBusy.value) return;
  const reload = pendingSettingsReload.value; pendingSettingsReload.value = null; reload?.();
}

watch(settingsOwner, () => {
  settingsGeneration++; settingsSecrets.value = emptySettingsSecrets(); savedSettings.value = {};
  moduleDraftBaselines.value = {};
  pendingSettingsReload.value = null;
  adminSettingsReady.value = false; adminSettingsLoading.value = false; isSaving.value = false;
  isTestingEmail.value = false; isTestingSmtp.value = false; adminSettingsError.value = ''; saveToast.value = null;
  if (authStore.isAdmin) void loadAdminSettings();
}, { flush: 'sync' });

watch(() => authStore.isAdmin, (isAdmin) => {
  if (!isAdmin && activeTab.value.startsWith('admin_')) {
    activeTab.value = 'profile';
  }
});

watch(() => (props.win as any)?.customData?.tab ?? (props.win as any)?.props?.tab, (tab) => {
  const known = ['profile', 'appearance', 'desktop', 'sound', 'admin_general', 'admin_terms', 'admin_features', 'admin_security', 'admin_defaults', 'admin_gateway', 'admin_policies', 'admin_payment', 'admin_cardshop', 'admin_email', 'admin_backup', 'admin_update'];
  if (typeof tab !== 'string' || !known.includes(tab)) return;
  activeTab.value = tab.startsWith('admin_') && !authStore.isAdmin ? 'profile' : tab;
});

watch(activeTab, (tab) => {
  sidebarOpen.value = false;
  moduleError.value = '';
  if (tab === 'admin_cardshop') shopVisited.value = true;
  if (tab === 'admin_policies') policiesVisited.value = true;
  if (tab === 'admin_gateway') {
    if (!['overload', 'rate429', 'stream', 'rectifier'].some(moduleDirty)) loadGatewaySettings();
  } else if (tab === 'admin_security') {
    loadAdminApiKey();
    if (!moduleDirty('panel')) loadPanelRateLimit();

  } else if (tab === 'admin_backup') {
    if (!['s3', 'image', 'schedule'].some(moduleDirty)) loadBackupData();
  }
});

onMounted(() => {
  if (!authStore.isAdmin && activeTab.value.startsWith('admin_')) {
    activeTab.value = 'profile';
  }
  loadUserProfileData();
  if (authStore.isAdmin) {
    loadAdminSettings();
    loadGatewaySettings();
    loadAdminApiKey();
    loadPanelRateLimit();
    if (activeTab.value === 'admin_backup') {
      loadBackupData();
    }
  }
});
</script>

<template>
  <div ref="settingsRoot" class="settings-app relative flex-1 flex h-full bg-[var(--bg-canvas)] text-[var(--text-primary)] select-none">
    <MacDraftGuard :dirty="settingsDirty" :busy="settingsBusy" />
    <!-- Left Category Sidebar (macOS Tahoe native sidebar) -->
    <div :class="{ 'is-open': sidebarOpen }" class="settings-sidebar w-60 h-full border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)] backdrop-blur-xl flex flex-col shrink-0">
      <!-- Search Field -->
      <div class="p-3 pb-2">
        <MacSearchField
          v-model="searchQuery"
          placeholder="搜索设置项"
          @clear="searchQuery = ''"
        />
      </div>

      <!-- Account Mini Card (Apple ID style) -->
      <div class="px-3 pb-2">
        <div
          class="h-12 px-2.5 rounded-[8px] flex items-center gap-2.5 cursor-pointer transition-colors"
          :class="activeTab === 'profile' ? 'bg-[#007aff] text-white' : 'hover:bg-black/5 dark:hover:bg-white/5'"
          @click="activeTab = 'profile'"
        >
          <div class="w-8 h-8 rounded-full overflow-hidden border border-white/60 dark:border-white/20 shadow-xs shrink-0 bg-[#007aff] text-white font-bold flex items-center justify-center text-sm">
            <img v-if="avatarPreviewUrl" :src="avatarPreviewUrl" class="w-full h-full object-cover" alt="" />
            <span v-else>{{ avatarInitial }}</span>
          </div>
          <div class="flex-1 min-w-0">
            <div
              class="text-[12.5px] font-semibold truncate leading-tight"
              :class="activeTab === 'profile' ? 'text-white' : 'text-[var(--text-primary)]'"
            >
              {{ displayName }}
            </div>
            <div
              class="text-[10.5px] truncate"
              :class="activeTab === 'profile' ? 'text-white/80' : 'text-[var(--text-secondary)]'"
            >
              {{ authStore.isAdmin ? '平台管理员' : '普通用户' }}
            </div>
          </div>
        </div>
      </div>

      <!-- Nav Items Scroll Area -->
      <div class="flex-1 overflow-y-auto px-2 space-y-4 pb-4">
        <div v-for="group in groupedNavItems" :key="group.key" class="space-y-0.5">
          <div class="px-3 py-1 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
            {{ group.label }}
          </div>
          <MacSidebarItem
            v-for="item in group.items"
            :key="item.id"
            :title="item.name"
            :active="activeTab === item.id"
            @click="activeTab = item.id"
          >
            <template #icon>
              <img v-if="item.id === 'admin_cardshop'" :src="getAppIcon('card_shop')" class="w-5 h-5" alt="" />
              <MacIconBadge v-else :icon="item.icon" :color="item.color" :size="20" />
            </template>
          </MacSidebarItem>
        </div>
      </div>
    </div>

    <!-- Right Content Pane -->
    <div :aria-busy="adminSettingsLoading" class="settings-content flex-1 min-w-0 h-full overflow-y-auto bg-[var(--bg-surface)] p-6 relative">
      <div class="settings-mobile-nav"><button type="button" @click="sidebarOpen = !sidebarOpen" :aria-expanded="sidebarOpen">{{ sidebarOpen ? '关闭分类' : '设置分类' }}</button></div>
      <!-- Top Right Floating Save Button for Admin Tabs -->
      <div 
        v-if="activeTab.startsWith('admin_') && activeTab !== 'admin_update' && activeTab !== 'admin_backup' && activeTab !== 'admin_cardshop' && activeTab !== 'admin_policies'" 
        class="sticky -top-6 -mx-6 px-6 pt-4 pb-3 z-20 mb-4 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/95 backdrop-blur-xl shadow-xs"
      >
        <div class="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
          <span>{{ adminSettingsLoading ? '正在读取配置…' : adminSettingsError || '配置编辑' }}</span>
          <button v-if="adminSettingsError" type="button" class="text-blue-500" @click="requestSettingsReload()">重试</button>
        </div>
        <div class="flex items-center gap-2">
          <span v-if="saveToast" role="status" class="text-xs text-[var(--text-primary)] font-medium animate-fade-in">
            {{ saveToast }}
          </span>
          <MacButton
            size="sm"
            variant="primary"
            :loading="isSaving"
            :disabled="adminSettingsLoading || isTestingEmail || isTestingSmtp || (!adminSettingsReady && activeTab !== 'admin_gateway')"
            @click="saveAdminSettings"
          >
            保存配置
          </MacButton>
        </div>
      </div>

      <div v-if="activeTab === 'profile' && profileError" class="settings-notice" role="alert"><span>{{ profileError }}</span><MacButton @click="requestProfileReload">重新读取</MacButton></div>
      <div v-if="moduleError && moduleErrorTab === activeTab" class="settings-notice" role="alert"><span>{{ moduleError }}</span><MacButton @click="requestSettingsReload(true)">重试读取</MacButton></div>
      <div class="max-w-3xl mx-auto space-y-6">

        <!-- ========================================== -->
        <!-- 0. Sub2API 个人账户与安全 -->
        <!-- ========================================== -->
        <template v-if="activeTab === 'profile'">
          <div>
            <h2 class="text-[20px] font-semibold tracking-tight mb-1 text-[var(--text-primary)]">个人设置</h2>
            <p class="text-[12px] text-[var(--text-secondary)]">管理您的账户信息和设置</p>
          </div>

          <!-- Section 1: macOS Tahoe Apple ID Profile Card -->
          <div class="rounded-2xl border border-black/[0.06] dark:border-white/[0.08] bg-white/70 dark:bg-[#252527]/70 backdrop-blur-xl p-5 shadow-xs">
            <div class="flex flex-col sm:flex-row items-start gap-4.5">
              <!-- Squircle Avatar -->
              <div class="w-16 h-16 rounded-2xl overflow-hidden bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-2xl flex items-center justify-center shrink-0 shadow-sm">
                <img v-if="avatarPreviewUrl" :src="avatarPreviewUrl" class="w-full h-full object-cover" alt="" />
                <span v-else>{{ avatarInitial }}</span>
              </div>

              <!-- Info & Metrics -->
              <div class="flex-1 min-w-0 space-y-3.5">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div class="flex items-center gap-2">
                      <h3 class="text-lg font-bold text-black/90 dark:text-white/90 truncate">{{ displayName }}</h3>
                      <span
                        class="px-2 py-0.5 rounded-full text-[11px] font-medium"
                        :class="authStore.isAdmin ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20' : 'bg-black/5 dark:bg-white/10 text-black/60 dark:text-white/60'"
                      >
                        {{ authStore.isAdmin ? '平台管理员' : '普通用户' }}
                      </span>
                      <span
                        class="px-2 py-0.5 rounded-full text-[11px] font-medium"
                        :class="authStore.user?.status === 'active' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'"
                      >
                        {{ authStore.user?.status === 'active' ? '正常启用' : '已停用' }}
                      </span>
                    </div>
                    <p class="text-xs text-black/45 dark:text-white/45 mt-0.5 font-mono">
                      {{ authStore.user?.email || '无关联主邮箱' }}
                    </p>
                  </div>

                  <button
                    type="button"
                    class="h-7 px-3 rounded-lg text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors border border-rose-200 dark:border-rose-900/40"
                    @click="authStore.logout"
                  >
                    退出登录
                  </button>
                </div>

                <!-- 3 Metrics Blocks -->
                <div class="grid grid-cols-3 gap-3">
                  <div class="p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.04] dark:border-white/[0.06]">
                    <div class="text-[10px] font-medium uppercase tracking-wider text-black/45 dark:text-white/45">账户余额</div>
                    <div class="text-base font-bold text-emerald-600 dark:text-emerald-400 mt-0.5 font-mono">
                      ${{ (authStore.user?.balance || 0).toFixed(2) }}
                    </div>
                  </div>
                  <div class="p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.04] dark:border-white/[0.06]">
                    <div class="text-[10px] font-medium uppercase tracking-wider text-black/45 dark:text-white/45">并发限制</div>
                    <div class="text-base font-bold text-black/85 dark:text-white/85 mt-0.5 font-mono">
                      {{ authStore.user?.concurrency || 0 }}
                    </div>
                  </div>
                  <div class="p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.04] dark:border-white/[0.06]">
                    <div class="text-[10px] font-medium uppercase tracking-wider text-black/45 dark:text-white/45">注册时间</div>
                    <div class="text-base font-bold text-black/85 dark:text-white/85 mt-0.5">
                      {{ memberSinceLabel }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Contact Support Notice (if enabled) -->
          <div v-if="publicSettings?.contact_info" class="p-3.5 rounded-xl border border-black/[0.06] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.02] flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div>
              <div class="text-xs font-semibold text-black/85 dark:text-white/85">联系客服支持</div>
              <div class="text-[11px] text-black/50 dark:text-white/50 mt-0.5">{{ publicSettings.contact_info }}</div>
            </div>
          </div>

          <!-- Section 2: 资料与头像 (Basics) -->
          <MacGroupCard title="资料与头像">
            <div class="px-4 pt-3 pb-1 text-[11px] text-[var(--text-secondary)]">
              维护公开展示信息，并保持头像与昵称风格一致。
            </div>
            <div class="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <!-- Avatar Card -->
              <div class="p-4 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-[var(--border-subtle)] space-y-3">
                <div class="text-xs font-semibold text-[var(--text-primary)]">资料头像</div>
                <div class="flex items-center gap-3">
                  <div class="w-14 h-14 rounded-2xl overflow-hidden bg-emerald-600 text-white font-bold text-xl flex items-center justify-center shrink-0 shadow-sm">
                    <img v-if="avatarPreviewUrl" :src="avatarPreviewUrl" class="w-full h-full object-cover" alt="" />
                    <span v-else>{{ avatarInitial }}</span>
                  </div>
                  <div class="flex-1 min-w-0 text-[11px] text-[var(--text-secondary)] leading-tight">
                    上传图片时会自动压缩静态图片到 20KB 以内，GIF 需自行控制在 20KB 以内
                  </div>
                </div>
                <div class="flex items-center gap-2 pt-1">
                  <label class="px-3 py-1.5 rounded-lg text-xs font-medium bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 cursor-pointer transition-colors">
                    <input type="file" accept="image/*" class="hidden" @change="handleAvatarFileChange" />
                    上传图片
                  </label>
                  <MacButton
                    size="sm"
                    variant="primary"
                    :disabled="!profileReady || !avatarDraft || isSavingAvatar"
                    :loading="isSavingAvatar"
                    @click="saveAvatar"
                  >
                    保存
                  </MacButton>
                  <button
                    type="button"
                    class="px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                    :disabled="!profileReady || isSavingAvatar || (!avatarDraft && !authStore.user?.avatar_url)"
                    @click="deleteAvatar"
                  >
                    删除
                  </button>
                </div>
              </div>

              <!-- Username Card -->
              <div class="p-4 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-[var(--border-subtle)] space-y-3 flex flex-col justify-between">
                <div class="space-y-2">
                  <div class="text-xs font-semibold text-[var(--text-primary)]">编辑个人资料</div>
                  <div>
                    <label class="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">用户名</label>
                    <input
                      v-model="usernameDraft"
                      placeholder="输入用户名"
                      class="w-full h-8 px-3 text-xs rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none focus:ring-1 focus:ring-[#007aff]"
                    />
                  </div>
                </div>
                <div class="flex justify-end pt-2">
                  <MacButton
                    size="sm"
                    variant="primary"
                    :disabled="!profileReady || !usernameDraft.trim() || usernameDraft.trim() === authStore.user?.username || isUpdatingProfile"
                    :loading="isUpdatingProfile"
                    @click="updateUsername"
                  >
                    更新资料
                  </MacButton>
                </div>
              </div>
            </div>
          </MacGroupCard>

          <!-- Section 3: 登录方式绑定 (Identity Bindings) -->
          <MacGroupCard title="登录方式绑定">
            <div class="px-4 pt-3 pb-1 text-[11px] text-[var(--text-secondary)]">
              查看当前绑定状态，并将更多第三方登录方式关联到这个账号。
            </div>
            <div class="divide-y divide-[var(--border-subtle)] text-xs">
              <!-- Email -->
              <div class="p-4 flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div class="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
                    <svg class="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                  </div>
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="font-semibold text-[var(--text-primary)]">电子邮箱</span>
                      <span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        {{ profileReady ? (emailIsBound ? '已绑定' : '未绑定') : '状态待确认' }}
                      </span>
                    </div>
                    <div class="text-[11px] text-[var(--text-secondary)] mt-0.5">
                      {{ authStore.user?.email || '尚未绑定电子邮箱' }} · 登录与安全通知主邮箱
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  class="px-2.5 py-1 text-xs rounded-lg border border-[var(--border-subtle)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                  :disabled="!profileReady"
                  @click="openEmailBinding"
                >
                  管理邮箱
                </button>
              </div>

              <!-- LinuxDo -->
              <div class="p-4 flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div class="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                    <svg class="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="4 17 10 11 4 5" />
                      <line x1="12" y1="19" x2="20" y2="19" />
                    </svg>
                  </div>
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="font-semibold text-[var(--text-primary)]">LinuxDo</span>
                      <span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-black/5 dark:bg-white/10 text-black/50 dark:text-white/50">
                        未绑定
                      </span>
                    </div>
                    <div class="text-[11px] text-[var(--text-secondary)] mt-0.5">LinuxDo 开发者社区一键快捷登录</div>
                  </div>
                </div>
              </div>

              <!-- DingTalk -->
              <div class="p-4 flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div class="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                    <svg class="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                  </div>
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="font-semibold text-[var(--text-primary)]">钉钉企业登录</span>
                      <span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-black/5 dark:bg-white/10 text-black/50 dark:text-white/50">
                        未绑定
                      </span>
                    </div>
                    <div class="text-[11px] text-[var(--text-secondary)] mt-0.5">钉钉移动扫码与组织架构单点登录</div>
                  </div>
                </div>
              </div>

              <!-- OIDC -->
              <div class="p-4 flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div class="w-9 h-9 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                    <svg class="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.93V18a1 1 0 0 1-2 0v-1.07A4 4 0 0 1 8 13a1 1 0 0 1 2 0 2 2 0 0 0 4 0 2 2 0 0 0-2-2 1 1 0 0 1-1-1 4 4 0 0 1 4-4 1 1 0 0 1 0 2 2 2 0 0 0-2 2 2 2 0 0 0 2 2 4 4 0 0 1-2 2.93z" />
                    </svg>
                  </div>
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="font-semibold text-[var(--text-primary)]">OIDC 单点认证</span>
                      <span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-black/5 dark:bg-white/10 text-black/50 dark:text-white/50">
                        未绑定
                      </span>
                    </div>
                    <div class="text-[11px] text-[var(--text-secondary)] mt-0.5">通用 OpenID Connect 企业身份集成</div>
                  </div>
                </div>
              </div>

              <!-- WeChat -->
              <div class="p-4 flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div class="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                    <svg class="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                    </svg>
                  </div>
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="font-semibold text-[var(--text-primary)]">微信服务号</span>
                      <span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-black/5 dark:bg-white/10 text-black/50 dark:text-white/50">
                        未绑定
                      </span>
                    </div>
                    <div class="text-[11px] text-[var(--text-secondary)] mt-0.5">微信扫码登录与验证码安全绑定</div>
                  </div>
                </div>
              </div>
            </div>
          </MacGroupCard>

          <!-- Section 4: 修改密码 -->
          <MacGroupCard title="修改密码">
            <form @submit.prevent="handleChangePassword" class="p-4 space-y-3 text-xs">
              <div v-if="passwordMsg" class="p-2.5 rounded-lg text-xs" :class="passwordMsg.type === 'success' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 border border-red-200 dark:border-red-800'">
                {{ passwordMsg.text }}
              </div>

              <div>
                <label class="block font-medium text-[var(--text-secondary)] mb-1">当前密码</label>
                <input
                  type="password"
                  v-model="passwordForm.old_password"
                  autocomplete="current-password"
                  class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none focus:ring-1 focus:ring-[#007aff]"
                />
              </div>

              <div>
                <label class="block font-medium text-[var(--text-secondary)] mb-1">新密码</label>
                <input
                  type="password"
                  v-model="passwordForm.new_password"
                  autocomplete="new-password"
                  class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none focus:ring-1 focus:ring-[#007aff]"
                />
                <span class="text-[10px] text-[var(--text-tertiary)] mt-1 block">密码至少需要 8 个字符</span>
              </div>

              <div>
                <label class="block font-medium text-[var(--text-secondary)] mb-1">确认新密码</label>
                <input
                  type="password"
                  v-model="passwordForm.confirm_password"
                  autocomplete="new-password"
                  class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none focus:ring-1 focus:ring-[#007aff]"
                />
              </div>

              <div class="flex justify-end pt-2">
                <MacButton
                  size="sm"
                  variant="primary"
                  :loading="isChangingPassword"
                  :disabled="!profileReady"
                  @click="handleChangePassword"
                >
                  修改密码
                </MacButton>
              </div>
            </form>
          </MacGroupCard>

          <!-- Section 5: 双因素认证 (2FA) -->
          <TotpSecurityPanel :sheet-target="settingsRoot" />

          <PasskeySecurityPanel :enabled="publicSettings?.passkey_enabled" :ready="profileReady" :sheet-target="settingsRoot" />
          <OAuthBindingsPanel :settings="publicSettings" :ready="profileReady" :sheet-target="settingsRoot" />
        </template>

        <!-- ========================================== -->
        <!-- Appearance Tab -->
        <!-- ========================================== -->
        <template v-else-if="activeTab === 'appearance'">
          <div>
            <h2 class="text-[20px] font-semibold tracking-tight mb-1 text-[var(--text-primary)]">外观</h2>
            <p class="text-[12px] text-[var(--text-secondary)]">选择适合你的外观、图标与强调色。</p>
          </div>

          <MacGroupCard title="外观模式">
            <div class="appearance-options">
              <button v-for="mode in (['light', 'dark', 'system'] as const)" :key="mode" type="button"
                :aria-pressed="systemStore.appearance === mode" @click="systemStore.setAppearance(mode)">
                <img :src="mode === 'dark' ? '/assets/tahoe-night.jpg' : '/assets/tahoe.jpg'" alt="" :class="{ automatic: mode === 'system' }" />
                <span>{{ mode === 'light' ? '浅色' : mode === 'dark' ? '深色' : '跟随系统' }}</span>
              </button>
            </div>
          </MacGroupCard>
          <MacGroupCard title="图标外观" description="应用于 Dock 和桌面图标">
            <div class="icon-appearance-options">
              <button v-for="mode in (['default', 'dark', 'transparent', 'tinted'] as const)" :key="mode" type="button" :aria-pressed="systemStore.dockIconTheme === mode" @click="systemStore.dockIconTheme = mode">
                <MacAppIcon :src="getAppIcon('finder')" :size="52" :appearance="mode" />
                <span>{{ { default: '原色', dark: '深色底', transparent: '通透', tinted: '强调色底' }[mode] }}</span>
              </button>
            </div>
          </MacGroupCard>

          <MacGroupCard title="强调色">
            <div class="p-4 flex items-center gap-3">
              <button
                v-for="c in accentColors"
                :key="c.id"
                :aria-label="c.label" :aria-pressed="selectedAccent === c.id" :title="c.label"
                class="w-6 h-6 rounded-full transition-transform hover:scale-110 active:scale-95 flex items-center justify-center relative"
                :class="[c.class, selectedAccent === c.id ? 'ring-2 ring-offset-2 ring-[#007aff]' : '']"
                @click="selectedAccent = c.id"
              ></button>
            </div>
          </MacGroupCard>
        </template>

        <!-- ========================================== -->
        <!-- Desktop Wallpaper Tab -->
        <!-- ========================================== -->
        <template v-else-if="activeTab === 'desktop'">
          <div>
            <h2 class="text-[20px] font-semibold tracking-tight mb-1 text-[var(--text-primary)]">桌面与壁纸</h2>
            <p class="text-[12px] text-[var(--text-secondary)]">为当前桌面选择壁纸，偏好会自动保存。</p>
          </div>

          <MacGroupCard title="桌面壁纸">
            <div class="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
              <button type="button"
                v-for="wp in wallpapers"
                :key="wp.id"
                :aria-label="wp.name" :aria-pressed="systemStore.wallpaper === wp.id"
                class="group relative aspect-[16/10] rounded-[10px] overflow-hidden border cursor-pointer transition-all shadow-xs"
                :class="systemStore.wallpaper === wp.id ? 'border-[#007aff] ring-2 ring-[#007aff]/30' : 'border-[var(--border-subtle)] hover:opacity-90'"
                @click="systemStore.setWallpaper(wp.id)"
              >
                <img :src="wallpaperPreview(wp.id)" class="w-full h-full object-cover" alt="" loading="lazy" :title="wp.tag" />
                <div class="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex items-center justify-between text-white">
                  <span class="text-[11px] font-medium truncate">{{ wp.name }}</span>
                  <span v-if="systemStore.wallpaper === wp.id" class="w-2 h-2 rounded-full bg-[#30d158] shadow-[0_0_6px_#30d158]"></span>
                </div>
              </button>
            </div>
          </MacGroupCard>
        </template>

        <!-- ========================================== -->
        <!-- Sound Tab -->
        <!-- ========================================== -->
        <template v-else-if="activeTab === 'sound'">
          <div>
            <h2 class="text-[20px] font-semibold tracking-tight mb-1 text-[var(--text-primary)]">声音</h2>
            <p class="text-[12px] text-[var(--text-secondary)]">调节系统提示音量与高保真交互音效反馈。</p>
          </div>

          <MacGroupCard title="音效引擎">
            <div class="px-4 py-3 flex items-center justify-between">
              <div>
                <div class="text-[13px] font-medium">音频驱动</div>
                <div class="text-[11px] text-[var(--text-secondary)]">Web Audio API 真实立体声音频管线</div>
              </div>
              <span class="text-[12px] text-[#007aff] font-medium">系统合成引擎</span>
            </div>
            <div class="px-4 py-3 flex items-center justify-between">
              <div>
                <div class="text-[13px] font-medium">界面交互音效</div>
                <div class="text-[11px] text-[var(--text-secondary)]">窗口操作、滑块拖动与按键音效</div>
              </div>
              <span class="text-[12px] font-medium text-[#34c759]">已就绪</span>
            </div>
          </MacGroupCard>
        </template>

        <!-- ========================================== -->
        <!-- ADMIN 1: 通用设置 -->
        <!-- ========================================== -->
        <template v-else-if="activeTab === 'admin_general'">
          <div>
            <h2 class="text-[20px] font-semibold tracking-tight mb-1 text-[var(--text-primary)]">通用设置</h2>
            <p class="text-[12px] text-[var(--text-secondary)]">配置平台站点名称、端点地址与运营模式。</p>
          </div>

          <!-- Backend 模式警示卡片 (100% 对齐原版) -->
          <div class="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between">
            <div>
              <div class="text-xs font-bold text-amber-900 dark:text-amber-200">Backend 模式</div>
              <div class="text-[11px] text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                禁用用户注册、公开页面和充值服务功能。仅管理员可以登录和管理平台。
              </div>
            </div>
            <MacToggle v-model="adminSettings.backend_mode_enabled" />
          </div>

          <MacGroupCard title="站点基本信息">
            <div class="p-4 space-y-4 text-xs">
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block font-medium text-[var(--text-secondary)] mb-1">站点名称</label>
                  <input
                    v-model="adminSettings.site_name"
                    class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none focus:ring-1 focus:ring-[#007aff]"
                  />
                  <span class="text-[10px] text-[var(--text-tertiary)] mt-1 block">显示在浏览器标签与平台标题</span>
                </div>
                <div>
                  <label class="block font-medium text-[var(--text-secondary)] mb-1">站点副标题</label>
                  <input
                    v-model="adminSettings.site_subtitle"
                    class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none focus:ring-1 focus:ring-[#007aff]"
                  />
                  <span class="text-[10px] text-[var(--text-tertiary)] mt-1 block">显示在登录与欢迎横幅</span>
                </div>
              </div>

              <div>
                <label class="block font-medium text-[var(--text-secondary)] mb-1">API 端点地址</label>
                <input
                  v-model="adminSettings.api_base_url"
                  class="w-full h-8 px-3 font-mono rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none focus:ring-1 focus:ring-[#007aff]"
                />
                <span class="text-[10px] text-[var(--text-tertiary)] mt-1 block">用于使用指南与客户端配置。留空则自动检测当前域名</span>
              </div>
            </div>
          </MacGroupCard>

          <MacGroupCard title="自定义端点列表">
            <div class="p-4 space-y-3 text-xs">
              <div class="flex items-center justify-between mb-1">
                <span class="text-[11px] text-[var(--text-secondary)]">可供开发者快速切换并复制的专用中继节点</span>
                <button
                  type="button"
                  class="text-xs text-[#007aff] hover:underline font-medium"
                  @click="addCustomEndpoint"
                >
                  + 添加节点
                </button>
              </div>
              <div v-for="(ep, idx) in adminSettings.custom_endpoints" :key="idx" class="flex items-center gap-2">
                <input v-model="ep.name" placeholder="名称" class="w-28 h-8 px-2.5 rounded bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]" />
                <input v-model="ep.endpoint" placeholder="https://" class="flex-1 h-8 px-2.5 font-mono rounded bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]" />
                <button type="button" class="text-xs text-red-500 hover:text-red-600 px-2" @click="removeCustomEndpoint(idx)">删除</button>
              </div>
            </div>
          </MacGroupCard>
        </template>

        <!-- ========================================== -->
        <!-- ADMIN 2: 登录条款 -->
        <!-- ========================================== -->
        <template v-else-if="activeTab === 'admin_terms'">
          <div>
            <h2 class="text-[20px] font-semibold tracking-tight mb-1 text-[var(--text-primary)]">登录条款</h2>
            <p class="text-[12px] text-[var(--text-secondary)]">服务条款、隐私保护声明与强制同意策略。</p>
          </div>

          <MacGroupCard title="合规策略">
            <div class="px-4 py-3 flex items-center justify-between">
              <div>
                <div class="text-[13px] font-medium">强制勾选同意</div>
                <div class="text-[11px] text-[var(--text-secondary)]">用户注册或首次登录时必须同意条款后方可进入</div>
              </div>
              <MacToggle v-model="adminSettings.login_agreement_enabled" />
            </div>
          </MacGroupCard>

          <MacGroupCard title="确认方式">
            <select v-model="adminSettings.login_agreement_mode" aria-label="条款确认方式" class="m-4 p-2 rounded-lg bg-[var(--bg-surface-subtle)]"><option value="modal">弹窗确认</option><option value="checkbox">勾选确认</option></select>
          </MacGroupCard>
          <MacGroupCard v-for="doc in adminSettings.login_agreement_documents" :key="doc.id" :title="doc.title || '条款文档'">
            <div class="p-4 space-y-3"><input v-model="doc.title" aria-label="文档标题" class="w-full p-2 rounded-lg bg-[var(--bg-surface-subtle)]" /><textarea v-model="doc.content_md" aria-label="条款内容" rows="6" class="w-full p-3 rounded-lg bg-[var(--bg-surface-subtle)] font-mono text-xs" /></div>
          </MacGroupCard>
          <MacButton @click="addAgreementDocument">添加条款文档</MacButton>
        </template>

        <!-- ========================================== -->
        <!-- ADMIN 3: 功能开关 -->
        <!-- ========================================== -->
        <template v-else-if="activeTab === 'admin_features'">
          <div>
            <h2 class="text-[20px] font-semibold tracking-tight mb-1 text-[var(--text-primary)]">功能开关</h2>
            <p class="text-[12px] text-[var(--text-secondary)]">全局开启或关闭注册、激活、充值与模型广场模块。</p>
          </div>

          <MacGroupCard title="用户与注册">
            <div class="px-4 py-3 flex items-center justify-between border-b border-[var(--border-subtle)]">
              <div>
                <div class="text-[13px] font-medium">开放用户注册</div>
                <div class="text-[11px] text-[var(--text-secondary)]">关闭后新用户将无法通过前台注册账号</div>
              </div>
              <MacToggle v-model="adminSettings.registration_enabled" />
            </div>

            <div class="px-4 py-3 flex items-center justify-between border-b border-[var(--border-subtle)]">
              <div>
                <div class="text-[13px] font-medium">邮箱验证激活</div>
                <div class="text-[11px] text-[var(--text-secondary)]">注册后需验证邮箱真实性方可激活使用</div>
              </div>
              <MacToggle v-model="adminSettings.email_verify_enabled" />
            </div>

            <div class="px-4 py-3 flex items-center justify-between border-b border-[var(--border-subtle)]">
              <div>
                <div class="text-[13px] font-medium">礼品卡券兑换</div>
                <div class="text-[11px] text-[var(--text-secondary)]">允许用户在客户端通过 16 位卡密兑换额度</div>
              </div>
              <MacToggle v-model="adminSettings.promo_code_enabled" />
            </div>

            <div class="px-4 py-3 flex items-center justify-between">
              <div>
                <div class="text-[13px] font-medium">模型广场与 Playground 体验台</div>
                <div class="text-[11px] text-[var(--text-secondary)]">允许用户在客户端查看可用模型与在线调试</div>
              </div>
              <MacToggle v-model="adminSettings.model_plaza_enabled" />
            </div>
          </MacGroupCard>
          <MacGroupCard title="渠道监控">
            <div class="px-4 py-3 flex items-center justify-between gap-3">
              <div><div class="text-[13px] font-medium">隐藏用户排行</div><p class="text-[11px] text-[var(--text-secondary)]">普通用户不再显示用户排行，管理员仍可查看。</p><p v-if="typeof savedSettings.channel_monitor_hide_user_ranking !== 'boolean'" class="text-[11px] text-[var(--text-secondary)]">暂未读取到此设置，重新读取后再编辑。</p></div>
              <MacToggle :model-value="adminSettings.channel_monitor_hide_user_ranking === true" role="switch" :aria-checked="adminSettings.channel_monitor_hide_user_ranking === true" aria-label="隐藏用户排行" :aria-disabled="isSaving || adminSettingsLoading || typeof savedSettings.channel_monitor_hide_user_ranking !== 'boolean'" :disabled="isSaving || adminSettingsLoading || typeof savedSettings.channel_monitor_hide_user_ranking !== 'boolean'" @update:model-value="adminSettings.channel_monitor_hide_user_ranking = $event" />
            </div>
          </MacGroupCard>
        </template>

        <!-- ========================================== -->
        <!-- ADMIN 4: 安全与认证 -->
        <!-- ========================================== -->
        <template v-else-if="activeTab === 'admin_security'">
          <div>
            <h2 class="text-[20px] font-semibold tracking-tight mb-1 text-[var(--text-primary)]">安全与认证</h2>
            <p class="text-[12px] text-[var(--text-secondary)]">配置系统管理员凭据、API 频率限制与 OAuth 联合认证。</p>
          </div>

          <!-- Card 1: 管理员 API Key -->
          <MacGroupCard title="管理员 API Key">
            <div class="px-4 pt-3 pb-1 text-[11px] text-[var(--text-secondary)]">
              此密钥拥有完整的系统管理权限，可用于调用全部 Admin API 接口。
            </div>
            
            <div v-if="newlyGeneratedAdminApiKey" class="m-4 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2">
              <div class="flex items-center justify-between text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                <span>新生成的 API Key（仅显示一次，请妥善保存）</span>
                <button type="button" class="text-xs underline font-medium text-emerald-600 dark:text-emerald-400" @click="copyNewAdminKey">
                  复制密钥
                </button>
              </div>
              <div class="p-2 font-mono text-xs select-all break-all rounded bg-white/70 dark:bg-black/30 border border-emerald-500/20 text-[var(--text-primary)]">
                {{ newlyGeneratedAdminApiKey }}
              </div>
            </div>

            <div class="p-4 flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="w-9 h-9 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] flex items-center justify-center text-xs font-mono font-bold text-[var(--text-secondary)]">
                  KEY
                </div>
                <div>
                  <div class="text-xs font-semibold text-[var(--text-primary)]">
                    {{ adminApiKeyStatus.exists ? '当前密钥已就绪' : '尚未配置管理员密钥' }}
                  </div>
                  <div class="text-[11px] text-[var(--text-secondary)] mt-0.5 font-mono">
                    {{ adminApiKeyStatus.exists ? adminApiKeyStatus.masked_key : '通过 Header: x-api-key: <token> 鉴权' }}
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <MacButton
                  size="sm"
                  variant="primary"
                  :loading="adminApiKeyOperating"
                  @click="confirmAdminKeyAction(false)"
                >
                  {{ adminApiKeyStatus.exists ? '重新生成' : '生成密钥' }}
                </MacButton>
                <MacButton
                  v-if="adminApiKeyStatus.exists"
                  size="sm"
                  variant="default"
                  :loading="adminApiKeyOperating"
                  @click="confirmAdminKeyAction(true)"
                >
                  删除
                </MacButton>
              </div>
            </div>
          </MacGroupCard>

          <!-- Card 2: 面板请求频率限制 -->
          <MacGroupCard title="面板请求频率限制 (Panel Rate Limit)">
            <div class="px-4 py-3 flex items-center justify-between border-b border-[var(--border-subtle)]">
              <div>
                <div class="text-[13px] font-medium">启用面板 API 限流</div>
                <div class="text-[11px] text-[var(--text-secondary)]">对控制台内部接口进行 RPM 限速，有效防范暴力扫描与高频滥用</div>
              </div>
              <MacToggle v-model="panelRateLimitForm.enabled" />
            </div>

            <div v-if="panelRateLimitForm.enabled" class="p-4 space-y-4 border-b border-[var(--border-subtle)] text-xs">
              <div class="grid grid-cols-3 gap-3">
                <div>
                  <label class="block font-medium text-[var(--text-secondary)] mb-1">登录用户 RPM</label>
                  <input
                    type="number"
                    min="1"
                    max="6000"
                    v-model.number="panelRateLimitForm.user_rpm"
                    class="w-full h-8 px-3 font-mono rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]"
                  />
                  <span class="text-[10px] text-[var(--text-tertiary)] mt-0.5 block">普通用户接口上限</span>
                </div>
                <div>
                  <label class="block font-medium text-[var(--text-secondary)] mb-1">高消耗接口 RPM</label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    v-model.number="panelRateLimitForm.heavy_rpm"
                    class="w-full h-8 px-3 font-mono rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]"
                  />
                  <span class="text-[10px] text-[var(--text-tertiary)] mt-0.5 block">日志与统计接口</span>
                </div>
                <div>
                  <label class="block font-medium text-[var(--text-secondary)] mb-1">未认证 IP RPM</label>
                  <input
                    type="number"
                    min="1"
                    max="6000"
                    v-model.number="panelRateLimitForm.public_ip_rpm"
                    class="w-full h-8 px-3 font-mono rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]"
                  />
                  <span class="text-[10px] text-[var(--text-tertiary)] mt-0.5 block">公开免登录接口</span>
                </div>
              </div>

              <div class="flex items-center justify-between pt-1">
                <div>
                  <div class="text-[12.5px] font-medium text-[var(--text-primary)]">豁免管理员账户</div>
                  <div class="text-[11px] text-[var(--text-secondary)]">管理员角色不受上述 RPM 限速策略约束</div>
                </div>
                <MacToggle v-model="panelRateLimitForm.exempt_admin" />
              </div>
            </div>

            <div class="px-4 py-2.5 flex justify-end bg-black/[0.02] dark:bg-white/[0.02]">
              <MacButton
                size="sm"
                variant="primary"
                :loading="panelRateLimitSaving" :disabled="!moduleReady.panel"
                @click="savePanelRateLimit"
              >
                保存限流配置
              </MacButton>
            </div>
          </MacGroupCard>

          <!-- Card 3: 人机验证 (Turnstile) -->
          <MacGroupCard title="人机验证 (Cloudflare Turnstile)">
            <div class="px-4 py-3 flex items-center justify-between border-b border-[var(--border-subtle)]">
              <div>
                <div class="text-[13px] font-medium">启用 Turnstile 人机防护</div>
                <div class="text-[11px] text-[var(--text-secondary)]">有效防范恶意脚本批量注册与暴力撞库</div>
              </div>
              <MacToggle v-model="adminSettings.turnstile_enabled" />
            </div>
            <div class="p-4">
              <label class="block text-xs font-medium text-[var(--text-secondary)] mb-1">Site Key</label>
              <input
                v-model="adminSettings.turnstile_site_key"
                class="w-full h-8 px-3 text-xs font-mono rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]"
                placeholder="0x4AAAAAA..."
              />
            </div>
            <label class="block p-4 pt-0 text-xs">Turnstile Secret Key
              <input v-model="settingsSecrets.turnstile_secret_key" type="password" autocomplete="new-password" :spellcheck="false" :disabled="!adminSettingsReady || isSaving || typeof savedSettings.turnstile_secret_key_configured !== 'boolean'" placeholder="留空保留已有值" class="w-full h-8 px-3 mt-1 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]" />
              <span class="block mt-1 text-[var(--text-secondary)]">{{ savedSettings.turnstile_secret_key_configured === true ? '已配置；填写新值可替换。' : savedSettings.turnstile_secret_key_configured === false ? '尚未配置。' : '凭据状态尚未读取。' }}</span>
            </label>
          </MacGroupCard>

          <!-- Card 4: OAuth 社交登录 -->
          <MacGroupCard title="OAuth 社交登录">
            <div class="px-4 py-3 flex items-center justify-between border-b border-[var(--border-subtle)]">
              <div>
                <div class="text-[13px] font-medium">LinuxDo Connect 快捷登录</div>
                <div class="text-[11px] text-[var(--text-secondary)]">支持社区成员一键快捷授权</div>
              </div>
              <MacToggle v-model="adminSettings.linuxdo_connect_enabled" />
            </div>
            <div class="px-4 py-3 flex items-center justify-between">
              <div>
                <div class="text-[13px] font-medium">微信扫码登录</div>
                <div class="text-[11px] text-[var(--text-secondary)]">微信开放平台网页授权</div>
              </div>
              <MacToggle v-model="adminSettings.wechat_connect_enabled" />
            </div>
          </MacGroupCard>
        </template>

        <!-- ========================================== -->
        <!-- ADMIN 5: 用户默认值 -->
        <!-- ========================================== -->
        <template v-else-if="activeTab === 'admin_defaults'">
          <div>
            <h2 class="text-[20px] font-semibold tracking-tight mb-1 text-[var(--text-primary)]">用户默认值</h2>
            <p class="text-[12px] text-[var(--text-secondary)]">为新注册用户预设的赠送额度、并发限制与每日配额。</p>
          </div>

          <MacGroupCard title="新用户初始配置">
            <div class="p-4 grid grid-cols-3 gap-4 text-xs">
              <div>
                <label class="block font-medium text-[var(--text-secondary)] mb-1">初始赠送额度 (USD)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  v-model.number="adminSettings.default_balance"
                  class="w-full h-8 px-3 font-mono rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]"
                />
                <span class="text-[10px] text-[var(--text-tertiary)] mt-1 block">新注册账户即刻可用额度</span>
              </div>
              <div>
                <label class="block font-medium text-[var(--text-secondary)] mb-1">默认最大并发线程</label>
                <input
                  type="number"
                  min="1"
                  v-model.number="adminSettings.default_concurrency"
                  class="w-full h-8 px-3 font-mono rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]"
                />
                <span class="text-[10px] text-[var(--text-tertiary)] mt-1 block">同时处理的最大请求数</span>
              </div>
              <div>
                <label class="block font-medium text-[var(--text-secondary)] mb-1">默认用户 RPM 限制</label>
                <input
                  type="number"
                  min="0"
                  v-model.number="adminSettings.default_user_rpm_limit"
                  class="w-full h-8 px-3 font-mono rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]"
                />
                <span class="text-[10px] text-[var(--text-tertiary)] mt-1 block">0 为无限制</span>
              </div>
            </div>
          </MacGroupCard>

          <MacGroupCard title="上游平台调度暂停阈值 (%)">
            <div class="px-4 pt-3 pb-1 text-[11px] text-[var(--text-secondary)]">
              当渠道或上游账号达到以下使用量阈值百分比时，系统将自动暂停分配新请求。
            </div>
            <div class="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              <div v-for="plat in SCHEDULING_THRESHOLD_PLATFORMS" :key="plat">
                <label :for="`threshold-${plat}`" class="block font-medium text-[var(--text-secondary)] mb-1 uppercase tracking-wider text-[11px]">{{ plat === 'minimax' ? 'MiniMax' : plat }}</label>
                <input
                  :id="`threshold-${plat}`"
                  :aria-label="`${plat === 'minimax' ? 'MiniMax' : plat} 暂停阈值`"
                  :disabled="isSaving || adminSettingsLoading || !thresholdAvailable(plat)"
                  :placeholder="!thresholdAvailable(plat) ? '暂不可用' : ''"
                  type="number"
                  min="1"
                  max="100"
                  :value="thresholdAvailable(plat) ? adminSettings.account_scheduling_thresholds?.[plat] : ''"
                  @input="editSchedulingThreshold(plat, $event)"
                  class="w-full h-8 px-2.5 text-center font-mono rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]"
                />
              </div>
            </div>
          </MacGroupCard>
        </template>

        <!-- ========================================== -->
        <!-- ADMIN 6: 网关设置 (100% 对齐原版 Sub2API 4 大核心模块) -->
        <!-- ========================================== -->
        <template v-else-if="activeTab === 'admin_gateway'">
          <div>
            <h2 class="text-[20px] font-semibold tracking-tight mb-1 text-[var(--text-primary)]">网关设置</h2>
            <p class="text-[12px] text-[var(--text-secondary)]">配置上游过载熔断、限流冷却、流式传输监控与请求整流容灾策略。</p>
          </div>

          <!-- Card 1: 529 过载冷却 -->
          <MacGroupCard title="529 过载冷却">
            <div class="px-4 pt-3 pb-1 text-[11px] text-[var(--text-secondary)]">
              配置上游返回 529（过载）时的账号调度暂停策略
            </div>

            <div class="px-4 py-3 flex items-center justify-between border-b border-[var(--border-subtle)]">
              <div>
                <div class="text-[13px] font-medium text-[var(--text-primary)]">启用过载冷却</div>
                <div class="text-[11px] text-[var(--text-secondary)] mt-0.5">收到 529 错误时暂停该账号的调度，冷却后自动恢复</div>
              </div>
              <MacToggle v-model="overloadCooldownForm.enabled" />
            </div>

            <div v-if="overloadCooldownForm.enabled" class="p-4 border-b border-[var(--border-subtle)] text-xs">
              <label class="block font-medium text-[var(--text-secondary)] mb-1.5">冷却时长（分钟）</label>
              <div class="flex items-center gap-3">
                <input
                  type="number"
                  min="1"
                  max="120"
                  v-model.number="overloadCooldownForm.cooldown_minutes"
                  class="w-32 h-8 px-3 font-mono rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none focus:ring-1 focus:ring-[#007aff]"
                />
                <span class="text-[11px] text-[var(--text-tertiary)]">账号暂停调度的持续时间（1-120 分钟）</span>
              </div>
            </div>

            <div class="px-4 py-2.5 flex justify-end bg-black/[0.02] dark:bg-white/[0.02]">
              <MacButton
                size="sm"
                variant="primary"
                :loading="overloadCooldownSaving" :disabled="!moduleReady.overload"
                @click="saveOverloadCooldown"
              >
                保存 529 冷却配置
              </MacButton>
            </div>
          </MacGroupCard>

          <!-- Card 2: 429 默认回避 -->
          <MacGroupCard title="429 默认回避">
            <div class="px-4 pt-3 pb-1 text-[11px] text-[var(--text-secondary)]">
              配置上游返回 429 且没有明确重置时间时的默认账号回避策略
            </div>

            <div class="px-4 py-3 flex items-center justify-between border-b border-[var(--border-subtle)]">
              <div>
                <div class="text-[13px] font-medium text-[var(--text-primary)]">启用 429 默认回避</div>
                <div class="text-[11px] text-[var(--text-secondary)] mt-0.5">收到无重置时间的 429 时暂停该账号调度，冷却后自动恢复</div>
              </div>
              <MacToggle v-model="rateLimit429CooldownForm.enabled" />
            </div>

            <div v-if="rateLimit429CooldownForm.enabled" class="p-4 border-b border-[var(--border-subtle)] text-xs">
              <label class="block font-medium text-[var(--text-secondary)] mb-1.5">回避时长（秒）</label>
              <div class="flex items-center gap-3">
                <input
                  type="number"
                  min="1"
                  max="7200"
                  v-model.number="rateLimit429CooldownForm.cooldown_seconds"
                  class="w-32 h-8 px-3 font-mono rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none focus:ring-1 focus:ring-[#007aff]"
                />
                <span class="text-[11px] text-[var(--text-tertiary)]">默认回避持续时间（1-7200 秒）；上游返回明确 reset 时仍优先使用上游时间</span>
              </div>
            </div>

            <div class="px-4 py-2.5 flex justify-end bg-black/[0.02] dark:bg-white/[0.02]">
              <MacButton
                size="sm"
                variant="primary"
                :loading="rateLimit429CooldownSaving" :disabled="!moduleReady.rate429"
                @click="saveRateLimit429Cooldown"
              >
                保存 429 回避配置
              </MacButton>
            </div>
          </MacGroupCard>

          <!-- Card 3: 流超时处理 -->
          <MacGroupCard title="流超时处理">
            <div class="px-4 pt-3 pb-1 text-[11px] text-[var(--text-secondary)]">
              配置上游响应超时时的账户处理策略，避免问题账户持续被选中
            </div>

            <div class="px-4 py-3 flex items-center justify-between border-b border-[var(--border-subtle)]">
              <div>
                <div class="text-[13px] font-medium text-[var(--text-primary)]">启用流超时处理</div>
                <div class="text-[11px] text-[var(--text-secondary)] mt-0.5">当上游响应超时时，自动处理问题账户</div>
              </div>
              <MacToggle v-model="streamTimeoutForm.enabled" />
            </div>

            <div v-if="streamTimeoutForm.enabled" class="p-4 space-y-4 border-b border-[var(--border-subtle)] text-xs">
              <div>
                <label class="block font-medium text-[var(--text-secondary)] mb-1.5">处理方式</label>
                <select
                  v-model="streamTimeoutForm.action"
                  class="w-64 h-8 px-2.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] text-xs focus:outline-none focus:ring-1 focus:ring-[#007aff]"
                >
                  <option value="temp_unsched">临时不可调度</option>
                  <option value="error">标记为错误状态</option>
                  <option value="none">不处理</option>
                </select>
                <span class="text-[10px] text-[var(--text-tertiary)] mt-1 block">超时后对账户执行的操作</span>
              </div>

              <div v-if="streamTimeoutForm.action === 'temp_unsched'">
                <label class="block font-medium text-[var(--text-secondary)] mb-1.5">暂停时长（分钟）</label>
                <div class="flex items-center gap-3">
                  <input
                    type="number"
                    min="1"
                    max="60"
                    v-model.number="streamTimeoutForm.temp_unsched_minutes"
                    class="w-32 h-8 px-3 font-mono rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]"
                  />
                  <span class="text-[11px] text-[var(--text-tertiary)]">临时不可调度的持续时间（1-60分钟）</span>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block font-medium text-[var(--text-secondary)] mb-1.5">触发阈值（次数）</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    v-model.number="streamTimeoutForm.threshold_count"
                    class="w-full h-8 px-3 font-mono rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]"
                  />
                  <span class="text-[10px] text-[var(--text-tertiary)] mt-1 block">累计超时多少次后触发处理（1-10次）</span>
                </div>
                <div>
                  <label class="block font-medium text-[var(--text-secondary)] mb-1.5">阈值窗口（分钟）</label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    v-model.number="streamTimeoutForm.threshold_window_minutes"
                    class="w-full h-8 px-3 font-mono rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]"
                  />
                  <span class="text-[10px] text-[var(--text-tertiary)] mt-1 block">超时计数的时间窗口（1-60分钟）</span>
                </div>
              </div>
            </div>

            <div class="px-4 py-2.5 flex justify-end bg-black/[0.02] dark:bg-white/[0.02]">
              <MacButton
                size="sm"
                variant="primary"
                :loading="streamTimeoutSaving" :disabled="!moduleReady.stream"
                @click="saveStreamTimeout"
              >
                保存流超时配置
              </MacButton>
            </div>
          </MacGroupCard>

          <!-- Card 4: 请求整流器 -->
          <MacGroupCard title="请求整流器">
            <div class="px-4 pt-3 pb-1 text-[11px] text-[var(--text-secondary)]">
              当上游返回特定错误时，自动修正请求参数并重试，提高请求成功率
            </div>

            <div class="px-4 py-3 flex items-center justify-between border-b border-[var(--border-subtle)]">
              <div>
                <div class="text-[13px] font-medium text-[var(--text-primary)]">启用请求整流器</div>
                <div class="text-[11px] text-[var(--text-secondary)] mt-0.5">总开关，关闭后所有整流功能均不生效</div>
              </div>
              <MacToggle v-model="rectifierForm.enabled" />
            </div>

            <div v-if="rectifierForm.enabled" class="space-y-0 border-b border-[var(--border-subtle)]">
              <!-- Thinking Signature -->
              <div class="px-4 py-3 flex items-center justify-between border-b border-[var(--border-subtle)]">
                <div>
                  <div class="text-[12.5px] font-medium text-[var(--text-primary)]">Thinking 签名整流</div>
                  <div class="text-[11px] text-[var(--text-secondary)] mt-0.5">当上游返回 thinking block 签名校验错误时，自动去除签名并重试</div>
                </div>
                <MacToggle v-model="rectifierForm.thinking_signature_enabled" />
              </div>

              <!-- Thinking Budget -->
              <div class="px-4 py-3 flex items-center justify-between border-b border-[var(--border-subtle)]">
                <div>
                  <div class="text-[12.5px] font-medium text-[var(--text-primary)]">Thinking Budget 整流</div>
                  <div class="text-[11px] text-[var(--text-secondary)] mt-0.5">当上游返回 budget_tokens 约束错误（≥1024）时，自动将 budget 设为 32000 并重试</div>
                </div>
                <MacToggle v-model="rectifierForm.thinking_budget_enabled" />
              </div>

              <!-- API Key Signature -->
              <div class="px-4 py-3 flex items-center justify-between border-b border-[var(--border-subtle)]">
                <div>
                  <div class="text-[12.5px] font-medium text-[var(--text-primary)]">API Key 签名整流</div>
                  <div class="text-[11px] text-[var(--text-secondary)] mt-0.5">当 API Key 账号的上游返回签名相关错误时，自动去除签名并重试（内置规则始终生效）</div>
                </div>
                <MacToggle v-model="rectifierForm.apikey_signature_enabled" />
              </div>

              <!-- Patterns -->
              <div v-if="rectifierForm.apikey_signature_enabled" class="p-4 bg-black/[0.015] dark:bg-white/[0.015] space-y-2.5">
                <div class="flex items-center justify-between">
                  <div>
                    <label class="block text-xs font-medium text-[var(--text-primary)]">自定义匹配关键词</label>
                    <span class="text-[10.5px] text-[var(--text-tertiary)] block">额外的关键词，匹配响应体中的内容（不区分大小写）。内置规则始终生效。</span>
                  </div>
                  <button
                    type="button"
                    class="text-xs text-[#007aff] hover:underline font-medium"
                    @click="addRectifierPattern"
                  >
                    + 添加关键词
                  </button>
                </div>

                <div v-if="rectifierForm.apikey_signature_patterns.length === 0" class="p-3 rounded-lg border border-dashed border-[var(--border-subtle)] text-center text-xs text-[var(--text-tertiary)]">
                  暂无自定义匹配关键词，使用内置整流规则
                </div>

                <div v-for="(_, index) in rectifierForm.apikey_signature_patterns" :key="index" class="flex items-center gap-2">
                  <input
                    v-model="rectifierForm.apikey_signature_patterns[index]"
                    type="text"
                    placeholder="例如：thinking_error 或 签名无效"
                    class="flex-1 h-8 px-3 text-xs font-mono rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]"
                  />
                  <button
                    type="button"
                    class="text-xs text-red-500 hover:text-red-600 px-2.5 h-8 flex items-center justify-center rounded hover:bg-red-500/10"
                    @click="removeRectifierPattern(index)"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>

            <div class="px-4 py-2.5 flex justify-end bg-black/[0.02] dark:bg-white/[0.02]">
              <MacButton
                size="sm"
                variant="primary"
                :loading="rectifierSaving" :disabled="!moduleReady.rectifier"
                @click="saveRectifier"
              >
                保存整流器配置
              </MacButton>
            </div>
          </MacGroupCard>
        </template>

        <!-- ========================================== -->
        <!-- ADMIN 7: 支付设置 -->
        <!-- ========================================== -->
        <template v-else-if="activeTab === 'admin_payment'">
          <div>
            <h2 class="text-[20px] font-semibold tracking-tight mb-1 text-[var(--text-primary)]">支付设置</h2>
            <p class="text-[12px] text-[var(--text-secondary)]">货币结算汇率与收银台支付通道接入。</p>
          </div>

          <PaymentSettingsPanel :draft="adminSettings" :saved="savedSettings" :disabled="!adminSettingsReady || adminSettingsLoading || isSaving" />
        </template>

        <!-- ========================================== -->
        <!-- ADMIN 8: 邮件设置 -->
        <!-- ========================================== -->
        <template v-else-if="activeTab === 'admin_email'">
          <div>
            <h2 class="text-[20px] font-semibold tracking-tight mb-1 text-[var(--text-primary)]">邮件设置</h2>
            <p class="text-[12px] text-[var(--text-secondary)]">SMTP 验证码邮件服务器参数与凭据测试。</p>
          </div>

          <MacGroupCard title="SMTP 服务器配置">
            <div class="p-4 grid grid-cols-2 gap-4 text-xs">
              <div>
                <label class="block font-medium text-[var(--text-secondary)] mb-1">SMTP 主机</label>
                <input
                  v-model="adminSettings.smtp_host"
                  placeholder="smtp.example.com"
                  class="w-full h-8 px-3 font-mono rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]"
                />
              </div>
              <div>
                <label class="block font-medium text-[var(--text-secondary)] mb-1">SMTP 端口</label>
                <input
                  type="number"
                  v-model.number="adminSettings.smtp_port"
                  placeholder="587"
                  class="w-full h-8 px-3 font-mono rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]"
                />
              </div>
              <div>
                <label class="block font-medium text-[var(--text-secondary)] mb-1">SMTP 用户名</label>
                <input
                  v-model="adminSettings.smtp_username"
                  class="w-full h-8 px-3 font-mono rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]"
                />
              </div>
              <div>
                <label class="block font-medium text-[var(--text-secondary)] mb-1">SMTP 发件人邮箱</label>
                <input
                  v-model="adminSettings.smtp_from_email"
                  class="w-full h-8 px-3 font-mono rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]"
                />
              </div>
            </div>

            <label class="block px-4 pb-4 text-xs">SMTP 密码
              <input v-model="settingsSecrets.smtp_password" type="password" autocomplete="new-password" :spellcheck="false" :disabled="!adminSettingsReady || isSaving || isTestingEmail || isTestingSmtp || typeof savedSettings.smtp_password_configured !== 'boolean'" placeholder="留空保留已有值" class="w-full h-8 px-3 mt-1 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]" />
              <span class="block mt-1 text-[var(--text-secondary)]">{{ savedSettings.smtp_password_configured === true ? '已配置；留空时测试使用已存密码。' : savedSettings.smtp_password_configured === false ? '尚未配置；测试使用当前填写的密码。' : '凭据状态尚未读取。' }}</span>
            </label>
            <label class="block px-4 pb-4 text-xs">发件人名称<input v-model="adminSettings.smtp_from_name" class="w-full h-8 px-3 mt-1 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]" /></label>
            <div class="px-4 py-3 flex items-center justify-between border-t border-[var(--border-subtle)]">
              <div>
                <div class="text-[13px] font-medium text-[var(--text-primary)]">使用 SSL/TLS 加密</div>
                <div class="text-[11px] text-[var(--text-secondary)] mt-0.5">建议端口 465 开启 TLS，587 走 STARTTLS</div>
              </div>
              <MacToggle v-model="adminSettings.smtp_use_tls" />
            </div>
          </MacGroupCard>

          <MacGroupCard title="服务测试与验证">
            <div class="p-4 space-y-3">
              <div class="flex items-center gap-2">
                <input
                  v-model="testEmailAddress"
                  type="email"
                  placeholder="输入测试收件人邮箱 (例如 user@example.com)"
                  class="flex-1 h-8 px-3 text-xs rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]"
                />
                <MacButton
                  size="sm"
                  variant="primary"
                  :loading="isTestingEmail"
                  @click="handleSendTestEmail"
                >
                  发送测试邮件
                </MacButton>
                <MacButton
                  size="sm"
                  variant="default"
                  :loading="isTestingSmtp"
                  @click="handleTestSmtpConnection"
                >
                  测试握手
                </MacButton>
              </div>
            </div>
          </MacGroupCard>
        </template>

        <!-- ========================================== -->
        <!-- ADMIN 9: 数据备份 (Data Backup & Storage) -->
        <!-- ========================================== -->
        <template v-else-if="activeTab === 'admin_backup'">
          <div>
            <h2 class="text-[20px] font-semibold tracking-tight mb-1 text-[var(--text-primary)]">数据备份与对象存储</h2>
            <p class="text-[12px] text-[var(--text-secondary)]">配置 S3 / Cloudflare R2 存储桶，管理全量数据自动备份与异步图片对象存储。</p>
          </div>

          <!-- 1. S3 Backup Storage Card -->
          <MacGroupCard title="S3 数据备份存储配置">
            <div class="p-5 space-y-4 text-xs">
              <div class="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                备份文件将加密打包并自动推送至兼容 S3 API 的对象存储（如 Cloudflare R2、AWS S3、MinIO 等）。
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label class="block font-medium text-[var(--text-secondary)] mb-1">端点地址 (Endpoint)</label>
                  <input
                    v-model="s3Config.endpoint"
                    type="text"
                    placeholder="https://<account_id>.r2.cloudflarestorage.com"
                    class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none"
                  />
                </div>
                <div>
                  <label class="block font-medium text-[var(--text-secondary)] mb-1">区域 (Region)</label>
                  <input
                    v-model="s3Config.region"
                    type="text"
                    placeholder="auto 或 us-east-1"
                    class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none"
                  />
                </div>
                <div>
                  <label class="block font-medium text-[var(--text-secondary)] mb-1">存储桶 (Bucket)</label>
                  <input
                    v-model="s3Config.bucket"
                    type="text"
                    placeholder="sub2api-backups"
                    class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none"
                  />
                </div>
                <div>
                  <label class="block font-medium text-[var(--text-secondary)] mb-1">存储前缀 (Prefix)</label>
                  <input
                    v-model="s3Config.prefix"
                    type="text"
                    placeholder="backups/"
                    class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none"
                  />
                </div>
                <div>
                  <label class="block font-medium text-[var(--text-secondary)] mb-1">Access Key ID</label>
                  <input
                    v-model="s3Config.access_key_id"
                    type="text"
                    placeholder="S3 访问密钥 ID"
                    class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none"
                  />
                </div>
                <div>
                  <label class="block font-medium text-[var(--text-secondary)] mb-1">Secret Access Key</label>
                  <input
                    v-model="s3Config.secret_access_key"
                    type="password"
                    :placeholder="s3SecretConfigured ? '已配置 (输入以覆盖更新)' : 'S3 访问密钥 Secret'"
                    class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none"
                  />
                </div>
              </div>

              <div class="flex items-center justify-between pt-2 border-t border-[var(--border-subtle)]">
                <label class="flex items-center gap-2 cursor-pointer text-xs">
                  <input type="checkbox" v-model="s3Config.force_path_style" class="rounded" />
                  <span class="text-[var(--text-secondary)]">强制 Path-style 寻址 (MinIO / 自建对象存储需勾选)</span>
                </label>

                <div class="flex items-center gap-2">
                  <MacButton
                    size="sm"
                    variant="default"
                    :loading="s3Testing"
                    @click="testS3Config"
                  >
                    测试连接
                  </MacButton>
                  <MacButton
                    size="sm"
                    variant="primary"
                    :loading="s3Saving" :disabled="!moduleReady.s3"
                    @click="saveS3Config"
                  >
                    保存 S3 配置
                  </MacButton>
                </div>
              </div>
            </div>
          </MacGroupCard>

          <!-- 2. Image Object Storage Card -->
          <MacGroupCard title="异步图片对象存储">
            <div class="p-5 space-y-4 text-xs">
              <div class="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)]">
                <div>
                  <div class="font-medium text-[var(--text-primary)]">启用图片对象存储</div>
                  <div class="text-[11px] text-[var(--text-secondary)] mt-0.5">将客户端请求与返回的多模态图片异步持久化至对象存储以加速缓存与审计。</div>
                </div>
                <MacToggle v-model="imageStorageConfig.enabled" />
              </div>

              <div v-if="imageStorageConfig.enabled" class="space-y-4 pt-1">
                <div class="flex items-center justify-between">
                  <span class="text-[var(--text-secondary)]">复用备份 S3 存储凭据</span>
                  <MacToggle v-model="imageStorageConfig.reuse_backup_s3" />
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label class="block font-medium text-[var(--text-secondary)] mb-1">图片存储桶 (Bucket)</label>
                    <input
                      v-model="imageStorageConfig.bucket"
                      type="text"
                      :placeholder="imageStorageConfig.reuse_backup_s3 ? (s3Config.bucket || '与备份同桶') : '图片独立存储桶'"
                      class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label class="block font-medium text-[var(--text-secondary)] mb-1">路径前缀 (Prefix)</label>
                    <input
                      v-model="imageStorageConfig.prefix"
                      type="text"
                      placeholder="images/"
                      class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label class="block font-medium text-[var(--text-secondary)] mb-1">公网加速基础 URL</label>
                    <input
                      v-model="imageStorageConfig.public_base_url"
                      type="text"
                      placeholder="https://cdn.example.com (可选)"
                      class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label class="block font-medium text-[var(--text-secondary)] mb-1">预签名链接有效时长 (小时)</label>
                    <input
                      v-model.number="imageStorageConfig.presign_expiry_hours"
                      type="number"
                      class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none"
                    />
                  </div>
                </div>

                <div v-if="!imageStorageConfig.reuse_backup_s3" class="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-[var(--border-subtle)]">
                  <div>
                    <label class="block font-medium text-[var(--text-secondary)] mb-1">独立端点地址</label>
                    <input
                      v-model="imageStorageConfig.endpoint"
                      type="text"
                      class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]"
                    />
                  </div>
                  <div>
                    <label class="block font-medium text-[var(--text-secondary)] mb-1">区域 (Region)</label>
                    <input
                      v-model="imageStorageConfig.region"
                      type="text"
                      class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]"
                    />
                  </div>
                  <div>
                    <label class="block font-medium text-[var(--text-secondary)] mb-1">独立 Access Key ID</label>
                    <input
                      v-model="imageStorageConfig.access_key_id"
                      type="text"
                      class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]"
                    />
                  </div>
                  <div>
                    <label class="block font-medium text-[var(--text-secondary)] mb-1">独立 Secret Access Key</label>
                    <input
                      v-model="imageStorageConfig.secret_access_key"
                      type="password"
                      :placeholder="imageStorageSecretConfigured ? '已配置 (输入以覆盖更新)' : ''"
                      class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)]"
                    />
                  </div>
                </div>

                <div class="flex items-center justify-end gap-2 pt-2">
                  <MacButton
                    size="sm"
                    variant="default"
                    :loading="imageStorageTesting"
                    @click="testImageStorage"
                  >
                    测试连接
                  </MacButton>
                  <MacButton
                    size="sm"
                    variant="primary"
                    :loading="imageStorageSaving" :disabled="!moduleReady.image"
                    @click="saveImageStorage"
                  >
                    保存图片存储配置
                  </MacButton>
                </div>
              </div>
            </div>
          </MacGroupCard>

          <!-- 3. Automated Backup Schedule Card -->
          <MacGroupCard title="定时自动备份策略">
            <div class="p-5 space-y-4 text-xs">
              <div class="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)]">
                <div>
                  <div class="font-medium text-[var(--text-primary)]">开启定时备份</div>
                  <div class="text-[11px] text-[var(--text-secondary)] mt-0.5">按照 Cron 调度周期自动导出数据库并推送到远程对象存储。</div>
                </div>
                <MacToggle v-model="backupSchedule.enabled" />
              </div>

              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label class="block font-medium text-[var(--text-secondary)] mb-1">Cron 表达式</label>
                  <input
                    v-model="backupSchedule.cron_expr"
                    type="text"
                    placeholder="0 3 * * * (每天凌晨3点)"
                    class="w-full h-8 px-3 font-mono rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none"
                  />
                </div>
                <div>
                  <label class="block font-medium text-[var(--text-secondary)] mb-1">保留天数 (天)</label>
                  <input
                    v-model.number="backupSchedule.retain_days"
                    type="number"
                    min="1"
                    class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none"
                  />
                </div>
                <div>
                  <label class="block font-medium text-[var(--text-secondary)] mb-1">最大保留份数</label>
                  <input
                    v-model.number="backupSchedule.retain_count"
                    type="number"
                    min="1"
                    class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none"
                  />
                </div>
              </div>

              <div class="flex items-center justify-between pt-2 border-t border-[var(--border-subtle)]">
                <span class="text-[11px] text-[var(--text-secondary)]">超过保留期或最大份数的历史备份将自动在 S3 中清理回收。</span>
                <div class="flex items-center gap-2">
                  <MacButton
                    size="sm"
                    variant="primary"
                    :loading="scheduleSaving" :disabled="!moduleReady.schedule"
                    @click="saveBackupSchedule"
                  >
                    保存备份策略
                  </MacButton>
                </div>
              </div>
            </div>
          </MacGroupCard>

          <!-- 4. Backup History & Manual Operation Card -->
          <MacGroupCard title="备份记录与恢复管理">
            <div class="p-5 space-y-4 text-xs">
              <div class="flex items-center justify-between">
                <div>
                  <div class="font-medium text-[var(--text-primary)]">历史备份副本</div>
                  <div class="text-[11px] text-[var(--text-secondary)] mt-0.5">支持在线下载备份压缩卷、一键还原至指定时间点，或随时发起手动备份。</div>
                </div>
                <div class="flex items-center gap-2">
                  <MacButton
                    size="sm"
                    variant="default"
                    :loading="backupsLoading"
                    @click="loadBackupData"
                  >
                    刷新列表
                  </MacButton>
                  <MacButton
                    size="sm"
                    variant="primary"
                    class="!bg-emerald-600 hover:!bg-emerald-700 text-white"
                    :loading="creatingManualBackup"
                    @click="handleCreateBackup"
                  >
                    立即创建备份
                  </MacButton>
                </div>
              </div>

              <!-- Records Table -->
              <div class="rounded-xl border border-[var(--border-subtle)] overflow-hidden bg-black/[0.01] dark:bg-white/[0.01]">
                <table class="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr class="border-b border-[var(--border-subtle)] bg-black/[0.03] dark:bg-white/[0.03] text-[var(--text-tertiary)] font-medium">
                      <th class="p-2.5">文件名 / 标识</th>
                      <th class="p-2.5">类型</th>
                      <th class="p-2.5">大小</th>
                      <th class="p-2.5">创建时间</th>
                      <th class="p-2.5">状态</th>
                      <th class="p-2.5 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody v-if="backupRecords.length === 0">
                    <tr>
                      <td colspan="6" class="p-8 text-center text-[var(--text-secondary)]">
                        暂无备份记录，点击上方「立即创建备份」发起首个备份
                      </td>
                    </tr>
                  </tbody>
                  <tbody v-else class="divide-y divide-[var(--border-subtle)]">
                    <tr v-for="rec in backupRecords" :key="rec.id" class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                      <td class="p-2.5 font-mono text-[11px] text-[var(--text-primary)]">
                        <div class="font-semibold">{{ rec.file_name || rec.id }}</div>
                        <div class="text-[10px] text-[var(--text-tertiary)]">{{ rec.s3_key }}</div>
                      </td>
                      <td class="p-2.5">
                        <span class="px-2 py-0.5 rounded-md text-[10px] bg-black/5 dark:bg-white/5 uppercase">
                          {{ rec.backup_type || 'full' }}
                        </span>
                      </td>
                      <td class="p-2.5 font-mono text-[11px]">{{ formatBytes(rec.size_bytes) }}</td>
                      <td class="p-2.5 text-[var(--text-secondary)]">{{ new Date(rec.started_at).toLocaleString('zh-CN') }}</td>
                      <td class="p-2.5">
                        <span
                          class="px-2 py-0.5 rounded-full text-[10px] font-medium"
                          :class="rec.status === 'completed' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : rec.status === 'running' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'bg-red-500/10 text-red-600'"
                        >
                          {{ rec.status === 'completed' ? '已完成' : rec.status === 'running' ? '进行中' : rec.status === 'failed' ? '失败' : rec.status }}
                        </span>
                      </td>
                      <td class="p-2.5 text-right space-x-2">
                        <button
                          type="button"
                          class="text-xs text-[#007aff] hover:underline"
                          @click="handleDownloadBackup(rec.id)"
                        >
                          下载
                        </button>
                        <button
                          type="button"
                          class="text-xs text-amber-600 dark:text-amber-400 hover:underline"
                          @click="openRestoreModal(rec)"
                        >
                          恢复
                        </button>
                        <button
                          type="button"
                          class="text-xs text-red-500 hover:underline"
                          @click="promptDeleteBackup(rec.id)"
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </MacGroupCard>
        </template>

        <!-- ========================================== -->
        <!-- ADMIN 10: 软件更新 (Software Update) -->
        <!-- ========================================== -->
        <SoftwareUpdatePanel v-else-if="activeTab === 'admin_update'" />

        <div v-if="authStore.isAdmin && policiesVisited" v-show="activeTab === 'admin_policies'" class="space-y-5">
          <div><h2 class="text-[20px] font-semibold tracking-tight mb-1 text-[var(--text-primary)]">请求策略</h2><p class="text-[12px] text-[var(--text-secondary)]">管理功能标记与服务档位的透传、过滤和拒绝规则。</p></div>
          <PolicyRulesPanel kind="beta" />
          <PolicyRulesPanel kind="fast" />
        </div>
        <CardShopSettingsPanel v-if="authStore.isAdmin && shopVisited" v-show="activeTab === 'admin_cardshop'" :sheet-target="settingsRoot" />
        <PaymentProvidersPanel v-if="authStore.isAdmin" v-show="activeTab === 'admin_payment'" :sheet-target="settingsRoot" />

      </div>
    </div>

    <MacSheet :show="showRestoreModal" title="恢复数据备份" :loading="isRestoring" :dirty="!!restorePassword" @close="showRestoreModal = false; restorePassword = ''">
      <p class="text-sm leading-6">从 {{ targetRestoreRecord?.file_name || targetRestoreRecord?.id }} 恢复将覆盖当前数据。请确认已有可用备份。</p>
      <label class="block mt-4 text-xs">管理员密码<input v-model="restorePassword" type="password" autocomplete="current-password" class="w-full mt-2 p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]" /></label>
      <template #footer="{close}"><MacButton :disabled="isRestoring" @click="close">取消</MacButton><MacButton variant="destructive" :loading="isRestoring" @click="submitRestoreBackup">确认恢复备份</MacButton></template>
    </MacSheet>
    <div v-if="saveToast && (!activeTab.startsWith('admin_') || activeTab === 'admin_backup')" role="status" class="settings-toast">{{ saveToast }}</div>
    <MacSheet :show="showEmailBindingForm" title="管理账户邮箱" :loading="emailBindingBusy" :dirty="!!(emailBindingInput || emailBindingCode || emailBindingPassword)" @close="closeEmailBinding">
      <form class="space-y-4 text-xs" @submit.prevent="submitEmailBinding">
        <p>验证新邮箱后，{{ emailIsBound ? '使用当前密码确认更换登录邮箱。' : '设置密码以启用邮箱登录。' }}</p>
        <p v-if="emailBindingError" role="alert" class="text-red-600 dark:text-red-300">{{ emailBindingError }}</p>
        <p v-if="emailBindingNotice" role="status">{{ emailBindingNotice }}</p>
        <label class="block">新邮箱<input v-model="emailBindingInput" type="email" autocomplete="email" :disabled="emailBindingBusy" class="w-full mt-2 p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]" /></label>
        <MacButton :disabled="emailBindingBusy" @click="sendEmailBindingCode">{{ emailBindingSending ? '正在发送…' : '发送验证码' }}</MacButton>
        <label class="block">邮箱验证码<input v-model="emailBindingCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" :disabled="emailBindingBusy" class="w-full mt-2 p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]" /></label>
        <label class="block">{{ emailIsBound ? '当前密码' : '设置登录密码' }}<input v-model="emailBindingPassword" type="password" :autocomplete="emailIsBound ? 'current-password' : 'new-password'" :disabled="emailBindingBusy" class="w-full mt-2 p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]" /></label>
        <button type="submit" hidden :disabled="emailBindingBusy" tabindex="-1">确认更新邮箱</button>
      </form>
      <template #footer="{close}"><MacButton :disabled="emailBindingBusy" @click="close">取消</MacButton><MacButton variant="primary" :loading="emailBindingBusy" :disabled="!profileReady" @click="submitEmailBinding">确认更新邮箱</MacButton></template>
    </MacSheet>

    <MacAlertSheet :show="!!pendingSettingsReload" title="放弃未保存的配置修改？" message="重新读取会用服务器已保存的配置替换对应表单的内容。" danger confirm-text="放弃并重新读取" cancel-text="继续编辑" :loading="settingsBusy" @cancel="pendingSettingsReload = null" @confirm="confirmSettingsReload" />
    <!-- MacAlertSheet for Confirmation -->
    <MacAlertSheet
      :show="alertSheet.show"
      :title="alertSheet.title"
      :message="alertSheet.message"
      :confirm-text="alertSheet.confirmText"
      cancel-text="取消"
      :danger="alertSheet.danger"
      :loading="alertSheet.loading"
      @confirm="handleAlertConfirm"
      @cancel="alertSheet.show = false"
    />
  </div>
</template>

<style scoped>
.settings-toast { position:absolute;bottom:16px;left:50%;transform:translateX(-50%);max-width:calc(100% - 32px);z-index:80;padding:12px 16px;border-radius:10px;background:var(--material-dropdown);box-shadow:var(--shadow-overlay);border:1px solid var(--border-subtle);font-size:12px; }
.settings-notice { display:flex; flex-wrap:wrap; gap:10px; justify-content:space-between; align-items:center; padding:12px; margin-bottom:18px; border:1px solid var(--border-subtle); border-radius:9px; color:var(--text-primary); font-size:12px; }
.settings-content :is(input,textarea,select):focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.settings-content { overflow-wrap:anywhere; }

.settings-app { min-height:0;min-width:0;position:relative; }
.settings-sidebar { width:224px;background:var(--sidebar-bg); }
.settings-content { padding:26px 30px 36px;background:var(--bg-canvas); }
.settings-content :deep(.space-y-6) { max-width:680px; }
.settings-content :deep(input:not([type="checkbox"]):not([type="range"])),.settings-content :deep(select),.settings-content :deep(textarea) { border-radius:8px;min-width:0; }
.settings-mobile-nav { display:none; }
.appearance-options { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:18px; }
.appearance-options button { display:flex;flex-direction:column;align-items:center;gap:10px;min-width:0;font-size:12px; }
.appearance-options img { width:100%;height:75px;object-fit:cover;border-radius:9px;box-shadow:0 0 0 1px var(--border-subtle); }
.appearance-options button[aria-pressed="true"] img { outline:3px solid var(--accent);outline-offset:3px; }
.appearance-options button[aria-pressed="true"] span { color:var(--accent);font-weight:600; }
.appearance-options .automatic { filter:saturate(.7); }
.icon-appearance-options { display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding:14px; }
.icon-appearance-options button { display:flex;flex-direction:column;align-items:center;gap:5px;font-size:11px;border:1px solid transparent;border-radius:10px;padding:4px 0 8px; }
.icon-appearance-options button[aria-pressed="true"] { border-color:var(--accent);background:color-mix(in srgb,var(--accent) 6%,transparent); }
@container app-window (max-width:760px) { .settings-sidebar { width:190px; }.settings-content { padding:20px; }.appearance-options { gap:10px;padding:15px; }.appearance-options img { height:60px; } }
@container app-window (max-width:600px) { .settings-sidebar { display:none; }.settings-sidebar.is-open { display:flex;position:absolute;inset:38px auto 0 0;width:240px;z-index:40;background:var(--material-panel);box-shadow:var(--shadow-overlay); }.settings-content { padding:12px 16px 24px; }.settings-mobile-nav { display:flex;position:sticky;top:-12px;z-index:45;margin:-12px -16px 18px;padding:10px 16px;background:var(--window-bg-solid);border-bottom:1px solid var(--border-subtle);font-size:12px;color:var(--accent); }.settings-content :deep(.grid-cols-2) { grid-template-columns:minmax(0,1fr); }.settings-content :deep(.flex.items-center.gap-3) { flex-wrap:wrap; } }
</style>
