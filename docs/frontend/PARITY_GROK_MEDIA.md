# E01-Grok · 媒体生成资格弹层最终报告

日期：2026-09-13。状态：本线实现、专项测试与浏览器核验完成，源码冻结，主任务负责总回归与构建。

## 实际变更

- `packages/sub2-console/src/apps/admin/accounts/GrokMediaEligibilitySheet.vue`：独立 MacSheet，props 仅 `account: Account`；只支持 Grok OAuth。提供 auto/enabled/disabled（自动判断/手动启用/手动禁用）、服务器当前资格、原因、读取/错误/保存状态。
- `packages/sub2-console/src/api/admin/accounts.ts`：新增 `getGrokMediaEligibility(id)` 与 `updateGrokMediaEligibility(id, mode)`，同时加入 `accountsAPI` 导出；复用已有 Grok 类型，其他 API 方法不变。
- `scripts/grok-media-eligibility.test.cjs`：API、组件状态与异步隔离专项。
- `scripts/grok-media-browser-check.cjs`：独立 Vite 开发消费者、真实 MacSheet/按钮/API 适配器的浏览器夹具，不导入 AccountsApp，不执行全局 build。
- 本报告；CN 已有报告补充父任务接线实况与尚需处理的集成点。

官方依据为 `output/upstream-current-20260912/frontend/src/api/admin/accounts.ts`、对应 Grok 类型与 `EditAccountModal.grokMediaEligibility.spec.ts`；响应和写入语义同时只读对照 `backend/internal/handler/admin/grok_media_eligibility_handler.go`。

GET/PUT 路径均为 `/admin/accounts/:id/grok-media-eligibility`（现有客户端添加 `/api/v1`）。PUT 仅发送 `{ mode }`，由官方专用接口修改单一媒体资格覆盖值。响应必须为当前 `account_id`、合法三态 mode、严格 boolean eligible、string reason；不接受字符串 false、缺字段、数组或其他账号的响应。PUT 返回模式不匹配本次选择时不报保存成功。

## 保留与隔离

首次读取成功前不允许保存，不从 `account.extra.grok_media_eligible` 推断远端状态。模式没有变化不发 PUT，pending 状态不允许重复 GET/PUT；保存期间锁定选择与关闭。

读取失败保留已确认资格及未保存模式，标记“上次读取的资格”。保存失败或结果不明确时保留草稿与旧状态，不触发 saved，不重放写请求；用户重新读取后可核对状态并继续保存。如果服务端已经应用但响应丢失，重新读取确认相同模式后自然成为无改动状态，不再发送 PUT。

账号 id/platform/type 变化同步重置本弹层状态；相同账号对象更新不丢草稿或触发重载。每次请求带本地 generation，A→B→A、关闭、卸载、旧响应 resolve/reject/finally 均不能污染当前账号、清掉当前 busy 或发出旧 saved。

读取期间允许关闭，关闭后旧 GET 结果无效。浏览器核验曾发现 MacButton loading 属性会触发共享弹层锁，现将读取按钮改为 disabled，加正文读取状态；只有保存按钮和 Sheet 在写入期间使用 loading。没有修改共享 MacSheet/useModalLayer。

界面直接使用返回的 eligible 展示允许/不允许，不根据 reason 或模式推算。`billing_inconclusive` 在官方后端可能 eligible=true，因此保留实际布尔值；原因翻译为简短中文，原始 reason 放在可展开区域，未知 reason 不报错。

## 父任务接入

```vue
<GrokMediaEligibilitySheet
  v-if="mediaAccount"
  :key="mediaAccount.id"
  :account="mediaAccount"
  @close="mediaAccount = null"
  @saved="fetchData"
/>
```

`saved` 携带验证后的 `GrokMediaEligibilityState`，不是完整 Account，也不是 extra patch；父任务可忽略事件参数并刷新列表。保存成功保持弹层打开，用户能看到服务端资格；父任务若主动卸载，晚返回仍被隔离。

已只读确认父任务 AccountsApp 的行“更多”与移动详情入口只对 Grok OAuth 显示，并使用上述 props/事件。本线没有修改 AccountsApp、PlatformMark、CN helper、认证、types、配置或后端；没有回写或构建账号 extra。

## 最终验证

1. `node --test scripts/grok-media-eligibility.test.cjs scripts/cn-provider.test.cjs`：**98/98 通过**（Grok 40、CN 58），无跳过。只复跑专项，不运行父任务全量测试。
2. `pnpm --filter @sub2-mac/console exec vue-tsc --noEmit -p ../../output/grok-media-final/tsconfig.json`：通过。该临时测试配置仅包含本 Sheet 和 accounts API，继承现有类型规则，显式解析 console 的 vite/client，未改项目 tsconfig。
3. `node scripts/grok-media-browser-check.cjs <playwright模块路径>`：**23/23 通过**。真实组件实例覆盖初始未知/三态/布尔状态、无改动禁写、保存防重入、失败与重读恢复、错误 account_id、迟到 GET、非 Grok OAuth 禁止、读取期间关闭、Escape、浅深主题、1440×900 和 390×844，弹层/底部操作无越界。
4. 所有 API 请求由浏览器 route 夹具拦截：3 次 PUT（其中 1 次预设 503）均只含 mode；无意外 API/外部请求，0 脚本异常。预设 HTTP 503 是失败态测试，不代表真实后端故障。
5. 已查看深色 1440 与浅色 390 截图，文字、状态、下拉框及底部按钮可读；截图与结果位于 `output/grok-media-final`。测试创建的 Vite 和 Chromium 已关闭。

浏览器模块路径：`C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`。结果：`output/grok-media-final/browser-results.json`；截图：`light-1440.png`、`light-390.png`、`dark-1440.png`、`dark-390.png`；冻结文件哈希清单：`output/grok-media-final/frozen-files.json`。

本轮没有运行全局 build、release build、打包、真实账号写入、真实媒体请求或资格探测。旧 CN 83 项独立浏览器证据保持原结论；本次新跑的是 CN 58 项契约测试，不将父任务当前整页接线当作已经过该旧浏览器核验。

## 集成待办与冻结边界

Grok 本线无待实现项，已冻结。主任务继续账号整页回归、最终类型/构建和真实后端验收；如需发布源码核验工具，可把 `scripts/grok-media-browser-check.cjs` 加入打包白名单，专项 `.test.cjs` 与 PARITY 报告已有自动规则。

CN 接线的独立问题已写入 `PARITY_CN_PROVIDER.md` 的“2026-09-13 冻结前集成回读”：当前父任务已经回填完整 CN 详情，但编辑构建仍走缺少 current/initial 的创建路径，并在输出后再合并旧 credentials。退出 adaptive/清空团队 ID 时需要使用报告规定的编辑 builder 与合并顺序，才能保留删除语义。本线按文件独占约定只报告，不修改父任务实现。
