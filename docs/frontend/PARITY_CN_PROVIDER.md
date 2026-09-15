# E01-CN · 国产供应商 API Key 表单与纯 helper

日期：2026-09-13。状态：独立组件与契约实现完成并冻结，父任务已接入口及详情回填，编辑提交剩余集成点见文末。本卡只新增文件，没有修改 AccountsApp、现有账号组件、API 类型、配置或后端。

## 依据与实现范围

固定参考：`output/upstream-current-20260912/frontend/src/components/account/credentialsBuilder.ts` 的 CN 类型、25 个地址预设、`defaultCNBaseUrl`、`defaultCNAdaptiveBaseUrls`；创建逻辑参考 `CreateAccountModal.vue`，编辑回填/协议切换/团队信息/密钥脱敏逻辑参考 `EditAccountModal.vue` 及对应官方测试。

端点数据与官方表完全相同，运行时不依赖 output 中的官方源码。参考中的旧注释遗漏 MiniMax，实际函数与测试已支持其原生 Responses；本实现以函数和契约为准。未调用真实服务，不以参考文件存在代替当前线上版本核验。

| 平台/模式 | Chat Completions 基础地址 | Anthropic 基础地址 | 原生 Responses 基础地址 |
| --- | --- | --- | --- |
| Kimi 按量 | https://api.moonshot.cn/v1 | https://api.moonshot.cn/anthropic | 同 Chat Completions |
| Kimi Coding Plan | https://api.kimi.com/coding/v1 | https://api.kimi.com/coding | 同 Chat Completions |
| Zhipu 按量 | https://open.bigmodel.cn/api/paas/v4 | https://open.bigmodel.cn/api/anthropic | 无原生端点 |
| Zhipu Coding Plan | https://open.bigmodel.cn/api/coding/paas/v4 | https://open.bigmodel.cn/api/anthropic | 无原生端点 |
| DeepSeek 按量 | https://api.deepseek.com | https://api.deepseek.com/anthropic | 同 Chat Completions |
| MiniMax 国内按量/Coding Plan | https://api.minimaxi.com/v1 | https://api.minimaxi.com/anthropic | 同 Chat Completions |
| MiniMax 国际按量/Coding Plan（预设） | https://api.minimax.io/v1 | https://api.minimax.io/anthropic | 同 Chat Completions |

DeepSeek 不提供 Coding Plan 选项。Zhipu 不提供原生 Responses 选项。所有平台均支持自适应、Chat Completions、Anthropic；MiniMax/Kimi/DeepSeek 另支持原生 Responses。默认新建为 `payg` + `adaptive`，MiniMax 默认国内地址。上表均为 base URL，不擅自补 `/messages`、`/responses`、`/chat/completions` 等完整请求路径。

自适应写入 `credentials.api_base_urls`（不是 `protocol_base_urls`），仅为新建账号生成该平台支持的协议键，同时将 `base_url` 设为 `api_base_urls.chat_completions`。固定协议只写对应 `base_url`，从自适应切换出来时移除旧 `api_base_urls`。

## 新增文件

1. `packages/sub2-console/src/apps/admin/accounts/cn-provider.ts`：官方端点表、类型、表单初始化/切换、校验、局部差异、完整 credentials 构建。
2. `packages/sub2-console/src/apps/admin/accounts/CNProviderFields.vue`：受控表单，“必填配置”与“选填设置”，使用当前 CSS 变量，支持浅/深主题、390px、禁用和字段错误。
3. `scripts/cn-provider.test.cjs`：58 项契约/纯函数/组件编译检查。
4. `scripts/cn-provider-browser-check.cjs`：独立生产构建和真实组件浏览器夹具，不导入 AccountsApp，不请求 API。
5. `docs/frontend/PARITY_CN_PROVIDER.md`：本任务卡与集成说明。

`output/cn-provider-final` 保存独立夹具源码、构建、截图和浏览器结果。浏览器脚本仅管理自己创建的随机端口服务器和 Chromium 实例，结束时关闭；不改共享 dist。

## 组件接口

```vue
<CNProviderFields
  v-if="isCNProviderPlatform(accountForm.platform) && accountForm.type === 'apikey'"
  v-model="cnForm"
  :platform="accountForm.platform"
  :editing="isEditing"
  :has-existing-api-key="cnHasExistingApiKey(currentAccount)"
  :disabled="isSubmitting || (isEditing && !policyReady)"
  :errors="cnErrors"
/>
```

`platform` 接受 string，类型守卫由 helper 提供；`v-model` 类型为 `CNProviderForm`，字段为 `platform`、`account_mode`、`api_protocol`、`base_url`、`api_base_urls`、`api_key`、`zhipu_organization`、`zhipu_project`。`editing/hasExistingApiKey/disabled/errors` 可选，默认 false/false/false/空错误。唯一事件是 `update:modelValue`，每次发出新对象及新地址 map，不直接修改 props。

组件不保存、不请求、不探测、不访问 store 或 storage。没有初始化 watcher，不会在父任务回填编辑状态时覆盖自定义端点；platform 与草稿不符时隐藏可编辑字段并提示重新读取。父任务选择新平台时应调用 `cnProviderForm(newPlatform)` 丢弃上一平台草稿和新密钥。Mini 图标由父任务自行接入 PlatformMark。

新建/缺少已有密钥时 API Key 必填，输入为 password。编辑且已有密钥时显示“更换 API Key（选填）”，不回填旧密钥。上游地址选填，实际默认值在输入框下方可读；可选择当前固定协议的官方预设，预设同时切换计费方式。自适应允许分别填写各协议地址。Zhipu Coding Plan 提供组织/项目 ID，清空组织会移除两个团队字段。

## helper 接入顺序

```ts
import CNProviderFields from './accounts/CNProviderFields.vue'
import {
  isCNProviderPlatform, cnProviderForm, cloneCNProviderForm,
  cnHasExistingApiKey, validateCNProviderForm, buildCNProviderCredentials,
  type CNProviderForm, type CNProviderErrors
} from './accounts/cn-provider'

const cnForm = ref<CNProviderForm>(cnProviderForm('minimax'))
const cnErrors = ref<CNProviderErrors>({})
let cnInitial: CNProviderForm | undefined

// 新建/主动切换平台：父任务同时将 accountForm.type 设为 apikey。
function resetCNCreate(platform: string) {
  cnForm.value = cnProviderForm(platform)
  cnInitial = undefined
  cnErrors.value = {}
}

// 编辑：完整账号 getById 成功、通过父任务的迟到响应/身份隔离后回填。
function hydrateCNEdit(account: Account) {
  cnForm.value = cnProviderForm(account.platform, account)
  cnInitial = cloneCNProviderForm(cnForm.value)
  cnErrors.value = {}
}

// 新建。不传 current/initial；API Key 使用 cnForm.api_key 这一份状态。
cnErrors.value = validateCNProviderForm(accountForm.platform, cnForm.value)
if (Object.keys(cnErrors.value).length) return
const credentials = buildCNProviderCredentials(accountForm.platform, cnForm.value)!
// 父任务再组合 name/platform/type:'apikey'/groups/策略等，显式提交一次。

// 编辑。必须同时传完整 current 和独立 initial；只传其中一个会报错。
const options = { current: currentAccount, initial: cnInitial! }
cnErrors.value = validateCNProviderForm(accountForm.platform, cnForm.value, options)
if (Object.keys(cnErrors.value).length) return
const cnCredentials = buildCNProviderCredentials(accountForm.platform, cnForm.value, options)
// undefined 表示 CN 凭据没有变化，payload 省略 credentials 字段。
```

CN 表单应在编辑时始终可见，不放到通用 `replaceCredentials` 条件内部：计费方式/协议/端点本身可单独编辑，密钥由组件按是否存在决定必填。CN 分支应替换通用 API Key/上游端点字段，避免两个密钥状态来源、重复必填校验和覆盖默认端点。编辑时不要只在“替换密钥”开启后才调用 helper。

与现有策略 helper 的组合顺序：

```ts
const cnCredentials = buildCNProviderCredentials(currentAccount.platform, cnForm.value, {
  current: currentAccount, initial: cnInitial!
})
const policyUpdates = applyPolicies(policies.value, policiesInitial, {
  ...currentAccount,
  credentials: cnCredentials ?? currentAccount.credentials
}, true)
const finalCredentials = policyUpdates.credentials ?? cnCredentials
const payload = {
  ...basicAndAdvancedPatch,
  ...(policyUpdates.extra ? { extra: policyUpdates.extra } : {}),
  ...(finalCredentials ? { credentials: finalCredentials } : {})
}
```

**完整构建结果之后不要再次展开旧 credentials。** `cnCredentials` 已保留 current 中的非本卡字段；`{...current.credentials,...cnCredentials}` 会把删除的 `api_base_urls`/团队 ID 加回来。策略 helper 应以 CN 构建结果为输入继续构建，而不是在另一个旧副本上构建再随意合并。

`buildCNProviderPatch` 返回 `{set, remove}`，只供本地审阅/组合差异，不是 API payload。官方后端 `MergePreservingSensitiveCreds` 只保留未传入的敏感键，其他 credentials 键按传入对象整体替换，**不能仅发送 patch.set**。推荐直接用 `buildCNProviderCredentials`，返回完整对象或 undefined。

## 编辑保留与差异规则

- 已有账号的缺省协议按官方兼容规则显示为 Chat Completions；不因打开表单将老账号自动改为 adaptive。无修改时返回 undefined，保留原字段是否存在、原值、未知协议元数据及原地址字符串。
- 固定协议的自定义 URL 回填保持；切换到 adaptive 时带入原协议地址，切回时取对应地址。仅主动从固定协议切换另一个固定协议、或更改固定协议计费方式，才按官方行为重设默认 URL。
- adaptive 改模式时，空值/旧默认地址更新到新默认，自定义地址保留。构建时 trim 选中地址，留空补官方默认，不改变自定义 path/query/trailing slash。
- 仅替换 API Key 时局部差异只有 api_key，不重置 mode/protocol/base_url/api_base_urls，也不填入原本不存在的默认字段。现有模型映射、pool、额度及未知字段保留；adaptive map 的未知扩展键也保留。
- 密钥存在性先读取 `credentials_status.has_api_key`，无该字段才兼容旧 `credentials.api_key`；显式 false 优先于旧值。旧秘密不填入 UI，留空时不产生 api_key 更新。表单/API Key 不写日志、storage 或用户可见 JSON。
- Zhipu 团队字段仅在用户修改时增删，未修改的历史组织/项目字段保留，包括暂时切到 payg 的情况。新建项目但缺组织会提示错误，避免静默丢弃项目；用户清空已有组织时按官方行为删除组织与项目。
- 所有 helpers 不修改传入草稿、initial 或 current。跨平台、非 apikey、缺少编辑基线会拒绝构建。父任务仍负责账号 ID、身份、读取失败、并发更新、异步返回、重复提交与关闭清理隔离。

## 验证与边界

- `pnpm --filter @sub2-mac/console typecheck`：通过。
- `node --test scripts/cn-provider.test.cjs`：58/58 通过，包含所有平台模式/原生协议组合、25 项官方预设表直接比对、编辑保留、删除语义、旧后端密钥兼容、跨平台隔离和 SFC 编译。当前官方 checkout 存在，因此对照测试实际执行；在源码包无该目录时仅这项参考对照跳过，固定契约测试仍执行。
- `node scripts/cn-provider-browser-check.cjs <playwright模块路径>`：新组件及 helper 独立生产构建通过，**83/83 浏览器检查通过**；结果详见 `output/cn-provider-final/browser-results.json`。覆盖四个平台浅深主题、模式/协议/国际预设、默认值与自定义值切换、编辑 no-op/仅换密钥、禁用、错误、团队字段删除、1440×900 和 390×844，窄屏无横向溢出且底部操作可达。
- 浏览器无 API/外部请求，无脚本错误。截图为 `output/cn-provider-final/{platform}-{light|dark}-{desktop|390}.png`；已检查组件浅色、深色和窄屏布局。
- 本机 Playwright 模块：`C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`。浏览器脚本使用 Chromium 独立上下文，全部夹具留在 output，不进入 App 或正式业务 API。
- `scripts/cn-provider.test.cjs` 会被现有 `pnpm test`（`--all`）自动发现；`test:parity` 仅扫描 `parity-` 前缀，运行该窄集合时需另跑本专项。

未完成项限父任务：AccountsApp 的 platform/type/创建/读取后回填/提交/策略组合接线、MiniMax 的 PlatformMark，以及账号整页和真实后端验收。本卡的独立构建与夹具成功不代表这些集成项或真实 API Key 请求成功。无真实创建账号、编辑账号、额度探测、支付或配置写入。

源码打包：现有白名单会自动包含 `PARITY_CN_PROVIDER.md`、`cn-provider.test.cjs` 和整个 src。若需附带独立浏览器核验工具，父任务在 `scripts/package-release.cjs` 的 selected 中增加 `scripts/cn-provider-browser-check.cjs`；本卡不改打包脚本或共享 EXECUTION_PLAN，父任务可将本卡状态归并入 E01。

## 2026-09-13 冻结前集成回读

本次与 Grok 专项一起重跑：CN 58 + Grok 40，合计 98/98 通过。CN 两个源码文件未再改动，旧独立浏览器 83 项证据不代表新 AccountsApp 接线已验收。

已只读确认父任务新增 cnProvider 状态、平台重置、buildCredentials 分支及 CNProviderFields 模板，并在 loadAccountPolicies 完整详情返回后使用 cnProviderForm 回填，保持已有 protocol/base_url；创建与“替换凭据”入口已接入。没有修改父任务文件。

**编辑删除语义仍需父任务处理：** 当前 AccountsApp 的 CN buildCredentials 分支仍调用 `buildCNProviderCredentials(platform, cnProvider.value)`，未传入 `{ current, initial }`；提交时又做 `{ ...current.credentials, ...credentials, ...policyUpdates.credentials }`。这走的是创建逻辑：当旧账号有 api_base_urls、用户改成固定协议，输出中不再带 map，但旧 map 会被后面的 spread 加回来；清空 Zhipu 团队 ID 也无法真正移除旧字段。

父任务应保留独立 `cnInitial`，编辑时在取得 current 后调用带 current/initial 的 builder，然后把返回的完整 credentials 作为 applyPolicies 输入，并采用 `policyUpdates.credentials ?? cnCredentials`，不要在最终结果之后再 spread 旧 credentials。上文已有完整示例。当前替换凭据入口要求新 API Key 是父任务行为；若要允许不换密钥单独编辑 CN 模式/端点，应另传 editing/hasExistingApiKey 并移出 replaceCredentials 门槛。

上述为当前源码集成回读，不是线上问题或已执行真实账号更新。本线 helper/组件已冻结，总回归与全局构建由父任务继续。
