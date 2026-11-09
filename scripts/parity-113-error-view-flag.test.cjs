// node --test scripts/parity-113-error-view-flag.test.cjs
// 1.1.3 错误请求查看门控修复：
// A. 使用记录 → 错误请求标签页由服务端公开设置 allow_user_view_error_requests 门控；
//    未开启时不展示该标签页（后端 GET /usage/errors 会 403），避免用户看到“加载失败”。
// B. loadErrors 捕获到 403 时显示“错误请求查看未开启，请联系管理员开启。”，
//    而不是通用的“错误请求列表加载失败。”（403 是功能关闭，非真故障）。
// 上游依据：后端 fail-closed（usage_handler.go:271-276，403 "Error requests view is disabled"），
// 公开设置 allow_user_view_error_requests 默认 false（domain_constants.go:763）。
// 全部用夹具，不触真实网络与真实后端。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const req = require('node:module').createRequire(path.join(root, 'packages/sub2-console/package.json'));
const ts = req('typescript');
const vue = req('vue');
const sfc = req('vue/compiler-sfc');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const compile = s => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function extract(file, names) {
  const source = sfc.parse(read('packages/sub2-console/src/apps/' + file)).descriptor.scriptSetup.content;
  const ast = ts.createSourceFile('actual.ts', source, ts.ScriptTarget.Latest, true);
  return ast.statements.filter(n => ts.isFunctionDeclaration(n) ? names.includes(n.name?.text) : ts.isVariableStatement(n) && n.declarationList.declarations.some(d => names.includes(d.name.text))).map(n => n.getText(ast)).join('\n');
}
function run(file, names, extra) {
  const ctx = { ...vue, Error, ...extra };
  vm.runInNewContext(compile(extract(file, names) + '\nglobalThis.subject={' + names.join(',') + '}'), ctx);
  return ctx.subject;
}

const activitySrc = read('packages/sub2-console/src/apps/user/ActivityApp.vue');

// ---------- A. 403 状态识别（httpStatusOf） ----------

test('error-view flag: httpStatusOf reads 403 from both axios and rejected-object shapes', () => {
  const { httpStatusOf } = run('user/ActivityApp.vue', ['httpStatusOf']);
  // axios 错误形态：error.response.status
  assert.equal(httpStatusOf({ response: { status: 403 } }), 403);
  assert.equal(httpStatusOf({ response: { status: 500 } }), 500);
  // 拦截器 reject 的对象形态：error.status
  assert.equal(httpStatusOf({ status: 403 }), 403);
  assert.equal(httpStatusOf({ status: 404 }), 404);
  // response.status 优先于顶层 status
  assert.equal(httpStatusOf({ response: { status: 403 }, status: 500 }), 403);
  // 非数字 / 缺失 / 非对象一律 undefined，不误判
  assert.equal(httpStatusOf({ response: {} }), undefined);
  assert.equal(httpStatusOf({}), undefined);
  assert.equal(httpStatusOf(null), undefined);
  assert.equal(httpStatusOf(undefined), undefined);
  assert.equal(httpStatusOf('403'), undefined);
  assert.equal(httpStatusOf({ response: { status: '403' } }), undefined);
});

// ---------- B. 标签页门控（源码断言） ----------

test('error-view flag: errors tab is gated by allow_user_view_error_requests', () => {
  // 从公开设置读取该开关（与 MCP 的 mcp_enabled 同一模式，见 api/auth getPublicSettings）。
  assert.match(activitySrc, /getPublicSettings\(\)/);
  assert.match(activitySrc, /allow_user_view_error_requests === true/);
  // 开关为 false 时错误请求标签不进入 tabOptions；为 true 时才加入。
  assert.match(activitySrc, /errorViewEnabled/);
  assert.match(activitySrc, /if \(errorViewEnabled\.value\) options\.push\(\{ label: '错误请求', value: 'errors' \}\)/);
  // 开关关着时若当前正停在 errors 页，切回用量页，避免停留在已隐藏的标签上。
  assert.match(activitySrc, /if \(!errorViewEnabled\.value && activeTab\.value === 'errors'\) activeTab\.value = 'usage'/);
  // 公开设置读不到时保持默认展示，不改变现有行为。
  assert.match(activitySrc, /公开设置读不到时保持默认展示/);
  // 类型定义里该字段存在（PublicSettings）。
  const types = read('packages/sub2-console/src/types/index.ts');
  assert.match(types, /allow_user_view_error_requests\?: boolean/);
});

test('error-view flag: 403 shows the disabled message, other errors keep the generic one', () => {
  // loadErrors 的 catch 按 httpStatusOf === 403 区分两条文案。
  assert.match(activitySrc, /httpStatusOf\(err\) === 403 \? '错误请求查看未开启，请联系管理员开启。' : '错误请求列表加载失败。'/);
  // 403 文案只在 loadErrors 的 catch 里出现一次，不污染用量明细等其他加载失败文案。
  assert.equal(activitySrc.split('错误请求查看未开启，请联系管理员开启。').length - 1, 1);
  assert.equal(activitySrc.split('错误请求列表加载失败。').length - 1, 1);
});
