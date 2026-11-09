// node --test scripts/parity-113-gaps11-12.test.cjs
// 缺口 11：≤600px 窄屏下账号额度列隐藏——Claude 重置次数 / OpenCode 用量加移动端入口。
// 缺口 12：批量订阅选择仅限当前页——改成跨页/跨筛选保留选择 + 全选符合当前筛选条件。
// 只用隔离夹具验证，不调真实生产后端，不用生产 key，不写真实配置。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'packages/sub2-console/src');
const req = createRequire(path.join(root, 'packages/sub2-console/package.json'));
const ts = req('typescript'); const vue = req('vue'); const compiler = req('vue/compiler-sfc');
const read = file => fs.readFileSync(path.join(sourceRoot, file), 'utf8');
function storageMock(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
    _map: map
  };
}
function execute(file, mocks = {}) {
  let source = file.endsWith('.vue') ? compiler.parse(read(file)).descriptor.scriptSetup.content : read(file);
  const ast = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
  const names = ast.statements.flatMap(n => ts.isVariableStatement(n) ? n.declarationList.declarations.filter(d => ts.isIdentifier(d.name)).map(d => d.name.text) : ts.isFunctionDeclaration(n) && n.name ? [n.name.text] : []);
  for (const n of [...ast.statements].reverse()) if (ts.isImportDeclaration(n)) source = source.slice(0, n.pos) + source.slice(n.end);
  const cleanup = [];
  const context = { ...vue, exports: {}, URL, URLSearchParams, AbortController, Date, Intl, console,
    setTimeout, clearTimeout, crypto,
    localStorage: storageMock({ auth_user: JSON.stringify({ id: 7 }) }),
    sessionStorage: storageMock(),
    navigator: {},
    window: { location: { assign: () => {} } },
    watch: () => {}, onMounted: () => {}, onUnmounted: () => {}, onBeforeUnmount: f => cleanup.push(f),
    defineProps: () => ({}), withDefaults: (p, defaults) => ({ ...defaults, ...p }),
    buildApiUrl: p => '/api/v1' + p, buildGatewayUrl: p => 'https://gateway.invalid' + p,
    fetch: () => { throw Error('Network forbidden'); },
    useStepUp: () => ({ visible: { value: false }, blockedReason: { value: '' }, prompt: async () => true, onVerified: () => {}, onCancel: () => {}, run: async (action) => action() }),
    isStepUpCancelled: () => false,
    isStepUpBlocked: () => false,
    stepUpBlockReason: () => '',
    ...mocks };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(source + `\nglobalThis.subject = { ${names.join(',')} };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return { s: context.subject, cleanup, context };
}
const flush = (ms = 10) => new Promise(r => setTimeout(r, ms));

// ==================== 缺口 11：窄屏入口 ====================
const accountsSource = read('apps/admin/AccountsApp.vue');
function mobileDetailsBlock() {
  const start = accountsSource.indexOf('<details class="accounts-mobile-details">');
  assert.notEqual(start, -1, 'mobile details block must exist');
  const end = accountsSource.indexOf('</details>', start);
  assert.notEqual(end, -1);
  return accountsSource.slice(start, end);
}
function quotaCellBlock() {
  const start = accountsSource.indexOf('<td class="account-quota-cell">');
  assert.notEqual(start, -1, 'quota cell must exist');
  const end = accountsSource.indexOf('</td>', start);
  assert.notEqual(end, -1);
  return accountsSource.slice(start, end);
}

test('gap 11: narrow-screen details exposes Claude reset credits and OpenCode usage with the same guards/handlers as the desktop quota cell', () => {
  const mobile = mobileDetailsBlock();
  const quota = quotaCellBlock();
  // 与桌面配额列同一组件、同一平台守卫、同一事件回执：窄屏展开后可查询、可操作。
  for (const block of [mobile, quota]) {
    assert.match(block, /<ClaudeResetCreditsCell v-if="acc\.platform === 'anthropic' && acc\.type === 'oauth'"/);
    assert.match(block, /:account="acc" @redeemed="handleClaudeRedeemed"/);
    assert.match(block, /<OpenCodeGoUsageCell v-else-if="acc\.platform === 'opencode_go'"/);
    assert.match(block, /:account="acc" @updated="handleOpenCodeGoUpdated"/);
  }
  // 两处各挂一个实例（桌面列在 ≤600px 由 CSS 隐藏，移动详情在 >600px 由 CSS 隐藏），不多不少。
  assert.equal((accountsSource.match(/<ClaudeResetCreditsCell v-if=/g) || []).length, 2);
  assert.equal((accountsSource.match(/<OpenCodeGoUsageCell v-else-if=/g) || []).length, 2);
  // 移动详情里两个 cell 放在已有信息之后、操作按钮之前，仍在同一展开区内。
  assert.ok(mobile.indexOf('ClaudeResetCreditsCell') > mobile.indexOf('倍率'));
  assert.ok(mobile.indexOf('accounts-mobile-actions') > mobile.indexOf('OpenCodeGoUsageCell'));
});

test('gap 11: desktop columns and widths unchanged; quota column stays hidden at <=600px and mobile details stays the narrow-only entry', () => {
  // 桌面端：表最小宽 850px、配额列 min-width 140px 均未动。
  assert.match(accountsSource, /\.accounts-table\{min-width:850px/);
  assert.match(accountsSource, /\.account-quota-cell\{min-width:140px\}/);
  // ≤600px 仍隐藏第 4–7 列（含配额列），只留勾选/账号/状态三列。
  assert.match(accountsSource, /\.accounts-table th:nth-child\(n\+4\),\.accounts-table td:nth-child\(n\+4\)\{display:none\}/);
  // 移动详情默认隐藏、仅 ≤600px 显示：入口只在窄屏出现，桌面不占位。
  assert.match(accountsSource, /\.accounts-mobile-details\{display:none\}/);
  const narrow = accountsSource.slice(accountsSource.indexOf('@container accounts (max-width:600px)'));
  assert.match(narrow, /\.accounts-mobile-details\{display:block/);
});

// ==================== 缺口 12：跨页保留选择 ====================
function subsFixture(overrides = {}) {
  const calls = { bulkAction: [], list: [] };
  const api = {
    list: async () => { calls.list.push([1, 20, {}]); return { items: [], total: 0 }; },
    bulkAction: async (req, key) => { calls.bulkAction.push([req, key]); return { success_count: 0, failed_count: 0, results: [] }; },
    ...overrides
  };
  const f = execute('apps/admin/SubscriptionsApp.vue', {
    subsAPI: api, groupsAPI: { getAll: async () => [] }, usersAPI: { list: async () => ({ items: [], total: 0 }) },
    adminError: (err, fallback) => (err && err.message) || fallback,
    collectAdminPages: async () => [], getAppIcon: id => id
  });
  return { ...f, calls, api };
}
const subRow = (id, status, email) => ({ id, user_id: 10 + id, group_id: 1, status, user: { email: email || `u${id}@x` }, group: { name: 'g1' } });

test('gap 12: selection survives page changes and filter reloads; off-page count is exact', async () => {
  const page1 = [subRow(1, 'active'), subRow(2, 'active')];
  const page2 = [subRow(3, 'active'), subRow(4, 'revoked')];
  const f = subsFixture({
    list: async (page) => { f.calls.list.push([page]); return page === 1 ? { items: page1, total: 4 } : { items: page2, total: 4 }; }
  });
  const { s } = f;
  s.subscriptions.value = page1; s.total.value = 4;
  s.toggleSelection(1);
  assert.deepEqual([...s.selectedIds.value], [1]);
  assert.equal(s.selectedSubs.value.get(1).user.email, 'u1@x');
  s.page.value = 2;
  await s.loadSubscriptions();
  assert.deepEqual([...s.selectedIds.value], [1], 'page change must not clear the selection');
  assert.deepEqual([...s.bulkTargets.value.map(x => x.id)], [1], 'off-page selection keeps its snapshot for the bulk dialog');
  assert.equal(s.bulkTargets.value[0].user.email, 'u1@x');
  assert.equal(s.selectedOnPageCount.value, 0);
  assert.equal(s.selectedOffPageCount.value, 1);
  assert.equal(s.bulkApplicable.value.extend, 1, 'applicability counts cover off-page selections');
  s.toggleSelection(3);
  assert.deepEqual([...s.selectedIds.value].sort((a, b) => a - b), [1, 3]);
  assert.equal(s.selectedOffPageCount.value, 1);
  s.page.value = 1;
  await s.loadSubscriptions();
  assert.deepEqual([...s.selectedIds.value].sort((a, b) => a - b), [1, 3]);
  assert.equal(s.selectedOffPageCount.value, 1, 'back on page 1, id 3 is the off-page one now');
  s.clearSelection();
  assert.deepEqual([...s.selectedIds.value], []);
  assert.equal(s.selectedSubs.value.size, 0);
});

test('gap 12: page reload refreshes the snapshot of a selected row (status change is picked up)', async () => {
  const f = subsFixture({
    list: async () => ({ items: [subRow(1, 'revoked')], total: 1 })
  });
  const { s } = f;
  s.subscriptions.value = [subRow(1, 'active')]; s.total.value = 1;
  s.toggleSelection(1);
  assert.equal(s.bulkApplicable.value.revoke, 1);
  await s.loadSubscriptions();
  assert.equal(s.selectedSubs.value.get(1).status, 'revoked');
  assert.equal(s.bulkApplicable.value.revoke, 0);
  assert.equal(s.bulkApplicable.value.restore, 1);
});

test('gap 12: select-all under the filter honours the 100 cap, merges with existing selection, and fetches by pages', async () => {
  const total = 250;
  const calls = [];
  const f = subsFixture({
    list: async (page, size, filters) => {
      calls.push([page, size, filters]);
      // 后端每页最多返回 50 条：验证按页拉取直到凑满上限。
      const start = (page - 1) * 50 + 1;
      const items = Array.from({ length: 50 }, (_, i) => subRow(start + i, 'active'));
      return { items, total };
    }
  });
  const { s } = f;
  assert.equal(s.SELECT_ALL_LIMIT, 100, 'select-all cap aligns with the per-operation cap in validateBulkAction');
  assert.match(s.validateBulkAction(101, 'extend', 30, { daily: true, weekly: true, monthly: true }), /100/);
  s.statusFilter.value = 'active';
  s.total.value = total;
  s.selectedIds.value = [500];
  s.selectedSubs.value.set(500, subRow(500, 'active'));
  s.openSelectAllConfirm();
  assert.equal(s.showSelectAllConfirm.value, true);
  assert.match(s.selectAllConfirmMessage.value, /共 250 条/);
  assert.match(s.selectAllConfirmMessage.value, /上限 100 条/);
  assert.match(s.selectAllConfirmMessage.value, /前 100 条/);
  await s.confirmSelectAllMatching();
  assert.equal(s.showSelectAllConfirm.value, false);
  assert.deepEqual(calls.map(c => c[0]), [1, 2], 'paginates until the cap is reached');
  assert.equal(calls[0][1], 100, 'requests 100 per page');
  assert.equal(calls[0][2].status, 'active', 'uses the current filter');
  assert.equal(s.selectedIds.value.length, 101, '100 new + 1 pre-existing selection');
  assert.ok(s.selectedIds.value.includes(500), 'existing selection is kept');
  assert.equal(s.selectedSubs.value.size, 101);
  assert.equal(s.selectedOffPageCount.value, 101, 'none of the selected rows are on the (empty) current page');
});

test('gap 12: select-all with a small total selects everything; confirm is refused when there is nothing to select; a failed fetch keeps the old selection', async () => {
  const f = subsFixture({
    list: async () => ({ items: [subRow(1, 'active'), subRow(2, 'active'), subRow(3, 'revoked')], total: 3 })
  });
  const { s } = f;
  s.total.value = 3;
  s.openSelectAllConfirm();
  assert.equal(s.showSelectAllConfirm.value, true);
  assert.match(s.selectAllConfirmMessage.value, /将全部选中/);
  assert.doesNotMatch(s.selectAllConfirmMessage.value, /上限/);
  await s.confirmSelectAllMatching();
  assert.deepEqual([...s.selectedIds.value].sort((a, b) => a - b), [1, 2, 3]);

  const empty = subsFixture();
  empty.s.total.value = 0;
  empty.s.openSelectAllConfirm();
  assert.equal(empty.s.showSelectAllConfirm.value, false, 'total 0 must not open the confirm');
  empty.s.total.value = 5;
  empty.s.loadError.value = '列表加载失败';
  empty.s.openSelectAllConfirm();
  assert.equal(empty.s.showSelectAllConfirm.value, false, 'a failed list must not open the confirm');

  let attempts = 0;
  const failing = subsFixture({
    list: async (page) => {
      attempts++;
      if (page === 1) return { items: Array.from({ length: 50 }, (_, i) => subRow(i + 1, 'active')), total: 250 };
      throw new Error('bad gateway');
    }
  });
  failing.s.total.value = 250;
  failing.s.selectedIds.value = [500];
  failing.s.selectedSubs.value.set(500, subRow(500, 'active'));
  await failing.s.confirmSelectAllMatching();
  assert.equal(attempts, 2);
  assert.deepEqual([...failing.s.selectedIds.value], [500], 'failed select-all must not change the selection');
  assert.match(failing.s.actionError.value, /全选失败/);
});

test('gap 12: after a bulk action only the succeeded ids leave the selection; failures stay for retry', async () => {
  const f = subsFixture({
    list: async () => ({ items: [], total: 0 }),
    bulkAction: async (req, key) => {
      f.calls.bulkAction.push([req, key]);
      return { success_count: 1, failed_count: 1, results: [{ subscription_id: 1, success: true }, { subscription_id: 2, success: false, error: 'boom' }] };
    }
  });
  const { s } = f;
  s.subscriptions.value = [subRow(1, 'active'), subRow(2, 'active')];
  s.selectedIds.value = [1, 2];
  s.selectedSubs.value.set(1, subRow(1, 'active'));
  s.selectedSubs.value.set(2, subRow(2, 'active'));
  s.openBulkModal('revoke');
  assert.deepEqual([...s.bulkDialogTargets.value.map(x => x.id)], [1, 2]);
  await s.submitBulk();
  assert.equal(s.bulkResult.value.success_count, 1);
  assert.deepEqual([...s.selectedIds.value], [2], 'failed id stays selected');
  assert.equal(s.selectedSubs.value.has(1), false);
  assert.equal(s.selectedSubs.value.has(2), true);
});

test('gap 12: bulk bar and confirm copy no longer claim current-page-only; the select-all entry is wired', () => {
  const source = read('apps/admin/SubscriptionsApp.vue');
  assert.doesNotMatch(source, /仅对当前页已选订阅生效/);
  assert.doesNotMatch(source, /翻页或筛选后选择将清空/);
  assert.doesNotMatch(source, /仅当前页/);
  assert.match(source, /已选 \{\{ selectedIds\.length \}\} 条<span v-if="selectedOffPageCount > 0">（不在当前页 \{\{ selectedOffPageCount \}\} 条）<\/span>/);
  assert.match(source, /选择跨页保留，翻页或筛选后仍可批量操作/);
  assert.match(source, /全选符合当前筛选条件/);
  assert.match(source, /@click="openSelectAllConfirm"/);
  assert.match(source, /:message="selectAllConfirmMessage"/);
  assert.match(source, /@confirm="confirmSelectAllMatching"/);
  assert.match(source, /loadSubscriptions\(\) \{\s*const version/);
  assert.doesNotMatch(source, /loadError\.value = '';\s*selectedIds\.value = \[\];/);
});
