// node --test scripts/parity-113-settings-safety.test.cjs
// 设置区生产安全修复 1.1.3：
// A. 站点类型双字段原子保存（subscription_enabled + payment_balance_disabled 任一变化时一起提交，
//    改完站点类型切 tab 保存不再只带走其中一个）；
// B. 充值奖励新增行默认空、提交时丢弃未完成行（与上游 0.2.20 RechargeBonusTierDraft /
//    sanitizeRechargeBonusTiersForSubmit 同语义；赠金比例上限仍为 1000，不是 100）。
// 全程夹具，不碰真实后端、真实配置。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'packages/sub2-console/src');
const req = createRequire(path.join(root, 'packages/sub2-console/package.json'));
const ts = req('typescript');
const vue = req('vue');
const { parse, compileTemplate } = req('vue/compiler-sfc');
const plain = v => JSON.parse(JSON.stringify(v));

function modules(handler) {
  const calls = [];
  const cache = new Map();
  const apiClient = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, async (url, payload) => {
    calls.push({ method, url, payload: plain(payload ?? null) });
    return { data: await handler(method, url, payload) };
  }]));
  function load(file) {
    file = path.resolve(src, file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const sandbox = {
      module, exports: module.exports, URL, Error, Date, AbortController, console, TextEncoder,
      require(spec) {
        if (spec === '../client') return { apiClient };
        if (spec.endsWith('.json')) {
          const target = path.resolve(path.dirname(file), spec);
          return JSON.parse(fs.readFileSync(target, 'utf8'));
        }
        if (spec.startsWith('@/')) return load(spec.slice(2) + '.ts');
        if (spec.startsWith('.')) return load(path.resolve(path.dirname(file), spec) + '.ts');
        throw new Error(`Forbidden import: ${spec}`);
      }, fetch() { throw new Error('Live network forbidden'); }
    };
    vm.runInNewContext(js, sandbox, { filename: file });
    return module.exports;
  }
  return { load, calls };
}

function component(file, overrides = {}, props = {}) {
  const filename = path.join(src, file);
  const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  assert.deepEqual(errors, []);
  const compiled = compileTemplate({ source: descriptor.template.content, filename, id: 'fixture', compilerOptions: { expressionPlugins: ['typescript'] } });
  assert.deepEqual(compiled.errors, []);
  let source = descriptor.scriptSetup.content;
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = ast.statements.flatMap(n => ts.isVariableStatement(n) ? n.declarationList.declarations.filter(d => ts.isIdentifier(d.name)).map(d => d.name.text) : ts.isFunctionDeclaration(n) && n.name ? [n.name.text] : []);
  for (const n of [...ast.statements].reverse()) if (ts.isImportDeclaration(n)) source = source.slice(0, n.pos) + source.slice(n.end);
  const events = [], mounted = [], unmounted = [];
  const scope = vue.effectScope();
  const auth = vue.reactive({ user: { id: 8, role: 'admin' }, isAdmin: true, sessionRevision: 0 });
  const copied = [];
  const context = {
    ...vue, ...overrides, Error, URL, Date, AbortController, console, TextEncoder,
    useAuthStore: () => auth,
    defineProps: () => props, defineEmits: () => (...args) => events.push(args),
    onMounted: fn => mounted.push(fn), onUnmounted: fn => unmounted.push(fn), onBeforeUnmount: fn => unmounted.push(fn),
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    document: { hidden: false, removeEventListener() {} },
    navigator: { clipboard: { writeText: async text => { copied.push(text); } } },
    fetch() { throw new Error('Live network forbidden'); }
  };
  const js = ts.transpileModule(source + `\nglobalThis.subject={${names.join(',')}};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  scope.run(() => vm.runInNewContext(js, context, { filename }));
  return { s: context.subject, events, mounted, copied, auth, dispose() { unmounted.forEach(fn => fn()); scope.stop(); } };
}

const form = modules(async () => []).load('apps/user/settings/settingsForm.ts');
const { settingsPatch, sanitizeRechargeBonusTiersForSubmit, MAX_RECHARGE_BONUS_TIERS, MAX_RECHARGE_BONUS_PERCENT } = form;

// 支付 tab 全量字段（两边一致，只改被测字段，避免无关字段进入 payload）。
function paymentState(over = {}) {
  return {
    payment_enabled: true, payment_subscription_usd_to_cny_rate: 0, payment_recharge_fee_rate: 0,
    payment_recharge_bonus_tiers: [], payment_recharge_bonus_mode: 'bonus', payment_recharge_bonus_notice: '',
    payment_min_amount: 0, payment_max_amount: 0, payment_daily_limit: 0, payment_order_timeout_minutes: 30,
    payment_max_pending_orders: 3, payment_balance_disabled: false, payment_balance_recharge_multiplier: 1,
    payment_load_balance_strategy: 'round-robin', payment_enabled_types: [],
    payment_product_name_prefix: '', payment_product_name_suffix: '', payment_help_image_url: '', payment_help_text: '',
    payment_cancel_rate_limit_enabled: false, payment_cancel_rate_limit_max: 3, payment_cancel_rate_limit_window: 1,
    payment_cancel_rate_limit_unit: 'hour', payment_cancel_rate_limit_window_mode: 'rolling',
    payment_alipay_force_qrcode: false, payment_alipay_mobile_precreate_deep_link: false,
    subscription_enabled: true, ...over
  };
}
function featuresState(over = {}) {
  return {
    registration_enabled: true, email_verify_enabled: false, promo_code_enabled: false,
    model_plaza_enabled: false, channel_monitor_hide_user_ranking: false,
    subscription_enabled: true, payment_balance_disabled: false, ...over
  };
}

// ── A. 站点类型双字段原子保存 ────────────────────────────────────
test('A1: 功能页改站点类型为仅充值后切到支付页保存，subscription_enabled 必须一起提交', () => {
  const saved = paymentState({ subscription_enabled: true, payment_balance_disabled: false });
  const draft = paymentState({ subscription_enabled: false, payment_balance_disabled: false });
  // 回归：修复前这里是 {}（余额开关没变，订阅开关不在支付 tab 字段表里），改动直接丢了。
  assert.deepEqual(plain(settingsPatch('admin_payment', draft, saved)), { subscription_enabled: false });
});

test('A2: 从仅订阅改仅充值后在支付页保存，两个字段都提交，不会错成充值+订阅', () => {
  const saved = paymentState({ subscription_enabled: true, payment_balance_disabled: true });
  const draft = paymentState({ subscription_enabled: false, payment_balance_disabled: false });
  // 回归：修复前这里只有 { payment_balance_disabled: false }，订阅开关留在 true，模式错成充值+订阅。
  assert.deepEqual(plain(settingsPatch('admin_payment', draft, saved)), { payment_balance_disabled: false, subscription_enabled: false });
});

test('A3: 在功能页保存站点类型改动，两个字段本来就一起提交（行为不变）', () => {
  const saved = featuresState({ subscription_enabled: true, payment_balance_disabled: true });
  const draft = featuresState({ subscription_enabled: false, payment_balance_disabled: false });
  assert.deepEqual(plain(settingsPatch('admin_features', draft, saved)), { subscription_enabled: false, payment_balance_disabled: false });
});

test('A4: 计费开关没变时，支付页保存不带上无关的计费字段', () => {
  const saved = paymentState();
  const draft = paymentState({ payment_min_amount: 5 });
  assert.deepEqual(plain(settingsPatch('admin_payment', draft, saved)), { payment_min_amount: 5 });
});

test('A5: 计费开关变了但后端没返回该字段，保存时报错而不是静默丢字段', () => {
  const saved = paymentState({ subscription_enabled: undefined });
  const draft = paymentState({ subscription_enabled: false });
  assert.throws(() => settingsPatch('admin_payment', draft, saved), /未返回完整模块配置/);
});

// ── B. 充值奖励档位提交清洗 ──────────────────────────────────────
test('B1: sanitize 与上游同语义：空行/半行/非法行丢弃，同阈值留先出现，按阈值升序', () => {
  assert.deepEqual(plain(sanitizeRechargeBonusTiersForSubmit([{ min_amount: null, bonus_percent: null }])), []);
  assert.deepEqual(plain(sanitizeRechargeBonusTiersForSubmit([{ min_amount: 100, bonus_percent: null }])), []);
  assert.deepEqual(plain(sanitizeRechargeBonusTiersForSubmit([{ min_amount: null, bonus_percent: 10 }])), []);
  assert.deepEqual(plain(sanitizeRechargeBonusTiersForSubmit(null)), []);
  assert.deepEqual(plain(sanitizeRechargeBonusTiersForSubmit([{ min_amount: 100, bonus_percent: 10 }, { min_amount: 50, bonus_percent: 5 }])), [
    { min_amount: 50, bonus_percent: 5 }, { min_amount: 100, bonus_percent: 10 }
  ]);
  assert.deepEqual(plain(sanitizeRechargeBonusTiersForSubmit([{ min_amount: 100, bonus_percent: 10 }, { min_amount: 100, bonus_percent: 20 }])), [
    { min_amount: 100, bonus_percent: 10 }
  ]);
  assert.deepEqual(plain(sanitizeRechargeBonusTiersForSubmit([{ min_amount: -1, bonus_percent: 10 }])), []);
  assert.deepEqual(plain(sanitizeRechargeBonusTiersForSubmit([{ min_amount: 100, bonus_percent: 1001 }])), []);
  assert.deepEqual(plain(sanitizeRechargeBonusTiersForSubmit([{ min_amount: 100.005, bonus_percent: 10 }])), []);
});

test('B2: 只新增一个空行后保存，档位字段根本不提交（不再提交 0/0）', () => {
  const saved = paymentState({ payment_recharge_bonus_tiers: [] });
  const draft = paymentState({ payment_recharge_bonus_tiers: [{ min_amount: null, bonus_percent: null }] });
  assert.deepEqual(plain(settingsPatch('admin_payment', draft, saved)), {});
});

test('B3: 已有档位 + 一个空行后保存，档位字段不提交，已有档位不受影响', () => {
  const saved = paymentState({ payment_recharge_bonus_tiers: [{ min_amount: 50, bonus_percent: 5 }] });
  const draft = paymentState({ payment_recharge_bonus_tiers: [{ min_amount: 50, bonus_percent: 5 }, { min_amount: null, bonus_percent: null }] });
  assert.deepEqual(plain(settingsPatch('admin_payment', draft, saved)), {});
});

test('B4: 填好的行 + 空行一起保存，只提交填好的行', () => {
  const saved = paymentState({ payment_recharge_bonus_tiers: [] });
  const draft = paymentState({ payment_recharge_bonus_tiers: [{ min_amount: 100, bonus_percent: 10 }, { min_amount: null, bonus_percent: null }] });
  assert.deepEqual(plain(settingsPatch('admin_payment', draft, saved)), { payment_recharge_bonus_tiers: [{ min_amount: 100, bonus_percent: 10 }] });
});

test('B5: 只填一半的行（金额有、比例空）保存时丢弃，不报错', () => {
  const saved = paymentState({ payment_recharge_bonus_tiers: [] });
  const draft = paymentState({ payment_recharge_bonus_tiers: [{ min_amount: 100, bonus_percent: null }] });
  assert.deepEqual(plain(settingsPatch('admin_payment', draft, saved)), {});
});

test('B6: 明确填出的 0/0 与上游一致照常提交（修的是新增行默认值，不是禁 0/0）', () => {
  const saved = paymentState({ payment_recharge_bonus_tiers: [] });
  const draft = paymentState({ payment_recharge_bonus_tiers: [{ min_amount: 0, bonus_percent: 0 }] });
  assert.deepEqual(plain(settingsPatch('admin_payment', draft, saved)), { payment_recharge_bonus_tiers: [{ min_amount: 0, bonus_percent: 0 }] });
});

test('B7: 填好的非法行仍阻止保存，未完成行不触发这些校验', () => {
  const dup = paymentState({ payment_recharge_bonus_tiers: [{ min_amount: 100, bonus_percent: 10 }, { min_amount: 100, bonus_percent: 20 }] });
  assert.throws(() => settingsPatch('admin_payment', dup, paymentState({ payment_recharge_bonus_tiers: [] })), /金额不能重复/);
  const discountBad = paymentState({ payment_recharge_bonus_mode: 'discount', payment_recharge_bonus_tiers: [{ min_amount: 100, bonus_percent: 100 }] });
  assert.throws(() => settingsPatch('admin_payment', discountBad, paymentState({ payment_recharge_bonus_mode: 'discount', payment_recharge_bonus_tiers: [] })), /小于 100/);
  const discountEmpty = paymentState({ payment_recharge_bonus_mode: 'discount', payment_recharge_bonus_tiers: [{ min_amount: 100, bonus_percent: null }] });
  assert.deepEqual(plain(settingsPatch('admin_payment', discountEmpty, paymentState({ payment_recharge_bonus_mode: 'discount', payment_recharge_bonus_tiers: [] }))), {});
});

test('B8: 充值奖励上限常量不变：档位 20、赠金比例 1000（折扣仍 <100）', () => {
  assert.equal(MAX_RECHARGE_BONUS_TIERS, 20);
  assert.equal(MAX_RECHARGE_BONUS_PERCENT, 1000);
});

// ── C. 面板行为与模板编译 ───────────────────────────────────────
test('C1: 支付面板新增档位是空行（null/null），输入空值回 null、数字进数字', () => {
  const f = component('apps/user/settings/PaymentSettingsPanel.vue',
    { MAX_RECHARGE_BONUS_TIERS: 20, MAX_RECHARGE_BONUS_PERCENT: 1000 },
    { draft: {}, saved: {}, disabled: false });
  const draft = { payment_recharge_bonus_tiers: [] };
  f.s.addBonusTier(draft);
  assert.deepEqual(plain(draft.payment_recharge_bonus_tiers), [{ min_amount: null, bonus_percent: null }]);
  f.s.setTierAmount(draft, 0, { target: { value: '100' } });
  f.s.setTierPercent(draft, 0, { target: { value: '' } });
  assert.deepEqual(plain(draft.payment_recharge_bonus_tiers), [{ min_amount: 100, bonus_percent: null }]);
  f.s.setTierPercent(draft, 0, { target: { value: 'abc' } });
  assert.equal(draft.payment_recharge_bonus_tiers[0].bonus_percent, null);
  f.s.setTierPercent(draft, 0, { target: { value: '10' } });
  assert.equal(draft.payment_recharge_bonus_tiers[0].bonus_percent, 10);
  f.s.removeBonusTier(draft, 0);
  assert.deepEqual(plain(draft.payment_recharge_bonus_tiers), []);
  f.dispose();
});

test('C2: 改动过的面板与设置页模板用真实 SFC 编译器通过', () => {
  for (const name of ['apps/user/settings/PaymentSettingsPanel.vue', 'apps/user/SettingsApp.vue']) {
    const filename = path.join(src, name);
    const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename });
    assert.deepEqual(errors, []);
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: name, compilerOptions: { expressionPlugins: ['typescript'] } }).errors, []);
  }
});
