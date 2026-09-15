# PARITY-ACCOUNTS · 官方账号功能补齐

更新：2026-09-12。任务状态：**授权主流程、Grok 授权、模型/配额/RPM 控件及 OpenAI/Anthropic 批量授权已落盘；完整官方对齐与真实后端验收仍未完成。** 本文覆盖累计实施事实，替代此前只有21项测试的旧状态。

## 续作子卡（2026-09-12）

| 子卡 | 实际结果 |
| --- | --- |
| A02 Grok OAuth | 已落盘并验证：授权码、RT、SSO Cookie、邮箱密码；密码必须经 capabilities 明确启用；创建/重新授权共用组件。只保存 OAuth 字段，清理密码/SSO；不是访问令牌直录 |
| A03 模型与配额/RPM | 已落盘并验证：同名白名单、模型映射、OpenAI Compact 映射、Antigravity 默认映射追加、账号池/重试、总/日/周配额和重置时区、预警阈值、Anthropic 5h窗口/会话/RPM/UMQ。表单新建/编辑共用 |
| A04 OpenAI 批量授权 | 已实现：普通 RT、Mobile RT、Codex Session JSON/JSONL/数组、Agent Identity、PAT。逐条结果、重复输入去重、只重试明确失败项、未知写入不重放 |
| A05 Anthropic Cookie 批量 | 已实现 OAuth 与 Setup Token 两类 Cookie 兑换后创建，继承当前账号高级字段；不回写原 Cookie |
| A06 Session Token | **固定官方源码已移除实现**：CreateAccountModal 的 `show-session-token-option=false`，`handleValidateSessionToken` 仅注释 `Session token validation removed`。无已核实兑换契约，故未添加假按钮或虚构 endpoint |

进入路径：账号管理 → 添加账号 → 选择 OpenAI OAuth 或 Anthropic OAuth/Setup Token → 填写名称、分组与高级字段 → “批量授权 / 导入 Codex 凭据”或“Cookie 批量授权”。批量 Sheet 冻结当前设置，支持一条或多条输入；单条也是完整分支，无需先完成普通授权。

Grok/模型/配额/RPM 在前次中断前已落盘，主任务修复的测试 `policyForm` 导入已保留，本轮没有覆盖。另修复同次编辑“替换凭据 + 修改模型策略”时旧凭据可能盖过新凭据的合并顺序，并加入回归测试。

### 批量接口与精确契约

| 分支 | 固定官方契约 |
| --- | --- |
| OpenAI RT | POST `/admin/openai/refresh-token`：refresh_token、可选 proxy_id；转换官方字段后 POST `/admin/accounts` |
| Mobile RT | 同 RT 接口，额外 client_id=`app_LlGpXReQgckcGGUo2JrYvtJK`，该 client_id 同时写入最终凭据 |
| Codex Session / Agent Identity | POST `/admin/accounts/import/codex-session`：content、名称/备注/代理/分组/并发/负载/优先级/倍率/到期、credential_extras、extra、update_existing。前端按 JSON 对象拆分串行提交，不解析 JWT 或复制后端身份逻辑 |
| PAT | POST `/admin/openai/create-from-codex-pat`：access_token、同类账号字段、credential_extras、extra；不再调用通用创建接口 |
| Anthropic Cookie | POST `/admin/accounts/cookie-auth`；Setup Token 使用 `/admin/accounts/setup-token-cookie-auth`。payload 为 session_id 空字符串、code=该条 Cookie、可选 proxy_id。兑换成功后 POST `/admin/accounts` |

参考位置：固定 `CreateAccountModal.vue` 5771–5783（RT分流/Session Token移除）、6223–6531（Mobile Client ID、Codex/Agent Identity/PAT/RT）、6851起（Cookie）；`OAuthAuthorizationFlow.vue` 375起（Codex输入）、454起（PAT输入）。另只读官方 [v0.2.1 admin.go](https://github.com/Wei-Shaw/sub2api/blob/v0.2.1/backend/internal/server/routes/admin.go) 确认本卡上述所有实际使用接口已注册。未访问本机受保护账号接口，不能据此声明运行二进制成功兼容。

### 防重与敏感数据边界

- RT/Cookie 每条经历兑换→保存；失败保存可复用本批内存中的已兑换结果，不再次兑换已旋转 RT；成功、跳过、未知结果项不重试。
- PAT/Codex 导入是直接写入端点。HTTP超时、5xx或无效成功响应归类为“保存结果未知”，必须先核对账号；不会自动再次创建。明确4xx拒绝或 Codex 返回 failed 项才允许重试。
- Codex 默认 update_existing=true，与官方一致，UI可关闭；已更新/已跳过各自计数，不当作新建。服务端返回额外警告则显示核对提示，不展示可能含凭据的原始文本。
- 初次提交后清空文本框，队列只在当前组件内存持有待处理输入。成功/未知项清除输入与兑换令牌；卸载清空所有待重试值，并阻断后续队列写入。已在服务端执行中的请求无法由前端回滚。
- 批量结果 UI仅显示序号、状态和账号ID；不显示令牌、Cookie、密码、导入正文或原始 provider 错误。credential_extras 白名单仅接受模型/Compact/临时不可调度/预热字段，不接受旧 access_token/refresh_token 回写。
- 批量设置不接收单账号 OAuth 组件已兑换的凭据。重复文本记录在同一批去重；后台跨会话幂等性仍由官方接口决定。

### 策略字段契约

白名单转换为 `credentials.model_mapping` 中同名映射；映射允许来源末尾单个 `*`，目标禁止通配符。两个视图内容合并，显式映射优先；空行/重复来源报错。OpenAI 开启透传时普通映射禁止编辑；Compact 映射独立。Antigravity 仅映射模式，支持读取默认值并追加，不覆盖已有行；旧 model_whitelist 修改后迁移。

`credentials.pool_mode/pool_mode_retry_count/pool_mode_retry_status_codes` 对 API Key/Bedrock 提供，重试范围0–10，空状态码保留官方默认。配额 `extra.quota_limit/quota_daily_limit/quota_weekly_limit`，固定重置 `quota_daily_reset_mode/hour`、`quota_weekly_reset_mode/day/hour`、`quota_reset_timezone`；关闭日/周额度时依官方删除对应 used/start 窗口字段。预警按日/周/总使用 `quota_notify_<dim>_enabled/threshold/threshold_type`，只有全局开关读取为开启才显示编辑器，读取失败不清空原字段。

Anthropic OAuth/Setup Token 使用 `extra.window_cost_limit/window_cost_sticky_reserve`、`max_sessions/session_idle_timeout_minutes`、`base_rpm/rpm_strategy/rpm_sticky_buffer`；默认基础RPM15，tiered/sticky_exempt 两策略。`user_msg_queue_mode` 独立于RPM，可空/throttle/serialize，修改时移除旧 user_msg_queue_enabled。未改变的控件不提交对应策略；保存前重新读取最新账号后合并，仅移除本次关闭字段，保留无关运行态。通用 PUT 没有客户端可用的原子 extra patch/ETag 契约，读取与写入之间并发更新仍有竞态，未声称前端可消除该后端限制。

本线遵守 `EXECUTION_PLAN.md`、`DESIGN.md`、`UPSTREAM_PARITY.md`。用户指定独占文件，因此在本文记录任务卡，不修改共享执行计划与其他管理页面。保留既有 macOS 图标、玻璃和共享 MacSheet/MacAlertSheet/MacButton；未使用 frontend-skill。

## 本卡目标与结果

原行为：Anthropic OAuth/Setup Token 仅录入访问令牌；其他供应商 OAuth 无创建入口；账号页没有计划测试；表单只提供名称、凭据、并发、优先级和分组。

现行为：

- Anthropic OAuth、Anthropic Setup Token、OpenAI OAuth、Gemini OAuth、Antigravity OAuth 均可生成链接、打开供应商授权页、提交授权码/回调地址、兑换凭据、保存账号。未完成兑换不能创建 OAuth 账号。令牌不显示在 UI，不写入浏览器持久存储。
- 独立重新授权 Sheet：先读取该账号详情获取平台、代理、Gemini 授权类型/项目/层级，再兑换并调用专用凭据应用接口。通用编辑不再提供 OAuth 令牌替换。
- 服务端应用新凭据后若仍返回 error，单独清错；清错失败明确提示“凭据已保存”，重试仅清错，不重复兑换或再次应用凭据。
- 计划测试：读取、添加、编辑、启停、删除确认、保留结果数、成功自动恢复开关、最近20条结果、模型加载与手动输入、cron 常用周期/自定义、上次与下次执行时间。不捏造立即执行接口。
- 调度高级字段：备注、代理、调度负载、计费倍率、到期时间、到期自动暂停，以及编辑已有账号时的允许调度。编辑仅发送发生变化的高级字段。
- 加载失败可重试；计划读取失败禁止写入；已写入但列表刷新失败单独提示并禁止重复创建；结果请求以代次阻断乱序覆盖。授权参数改变或组件卸载会失效旧请求并清除当前授权数据；请求中防止重复提交。

## 官方来源和版本边界

主参考是只读目录 `output/parallel-20260911/upstream/frontend`（用户指定 0.2.4 / HEAD 98d86915），核对：

- `src/components/account/CreateAccountModal.vue`
- `src/components/account/EditAccountModal.vue`
- `src/components/account/OAuthAuthorizationFlow.vue`
- `src/components/admin/account/ReAuthAccountModal.vue`（当前专用凭据应用路径）
- `src/components/account/ReAuthAccountModal.vue`（另一旧入口，使用 update/clear-error，不能据此认定新接口不可用）
- `src/components/admin/account/ScheduledTestsPanel.vue`
- `src/composables/useAccountOAuth.ts`、`useOpenAIOAuth.ts`、`useGeminiOAuth.ts`、`useAntigravityOAuth.ts`
- 现有本地 `api/admin/accounts.ts`、`gemini.ts`、`antigravity.ts`、`scheduledTests.ts`、`types/index.ts`

为核实本地报告的 0.2.1 兼容性，本次只读取得官方 v0.2.1 源码：

- [admin.go 路由](https://github.com/Wei-Shaw/sub2api/blob/v0.2.1/backend/internal/server/routes/admin.go)：包含 `POST /accounts/:id/apply-oauth-credentials` 和计划测试路由。
- [account_handler.go](https://github.com/Wei-Shaw/sub2api/blob/v0.2.1/backend/internal/handler/admin/account_handler.go)：`ApplyOAuthCredentials` 接收 type/credentials/extra，服务端处理 extra 合并、清错、令牌缓存失效。
- [scheduled_test_handler.go](https://github.com/Wei-Shaw/sub2api/blob/v0.2.1/backend/internal/handler/admin/scheduled_test_handler.go)：计划创建/更新字段与本地适配器一致。

这是**官方标签源码契约证据**，不是本机正在运行二进制的 commit/路由验收。未调用本机受保护接口，未操作真实账户、支付、配置或升级。没有把 404 自动降级到另一条写入接口，没有复制服务端令牌刷新或调度算法。

## 使用的接口

路径均相对于既有 `/api/v1` 基址。

| 功能 | 接口与数据 |
| --- | --- |
| Anthropic OAuth | POST `/admin/accounts/generate-auth-url` → POST `/admin/accounts/exchange-code`；session_id、code、可选 proxy_id |
| Anthropic Setup Token | POST `/admin/accounts/generate-setup-token-url` → POST `/admin/accounts/exchange-setup-token-code`；同上 |
| OpenAI OAuth | POST `/admin/openai/generate-auth-url` → POST `/admin/openai/exchange-code`；session_id、code、state、可选 proxy_id |
| Gemini OAuth | POST `/admin/gemini/oauth/auth-url` → POST `/admin/gemini/oauth/exchange-code`；保留 oauth_type/tier_id，project_id 仅传入生成链接；state 必填 |
| Antigravity OAuth | POST `/admin/antigravity/oauth/auth-url` → POST `/admin/antigravity/oauth/exchange-code`；session_id、code、state、可选 proxy_id |
| 创建/编辑 | POST `/admin/accounts`；PUT `/admin/accounts/:id`；不修改已有全局类型 |
| 重新授权 | GET `/admin/accounts/:id` → POST `/admin/accounts/:id/apply-oauth-credentials`；仅在返回 error 时追加既有 clear-error |
| 计划列表 | GET `/admin/accounts/:id/scheduled-test-plans` |
| 计划新增/编辑/删除 | POST `/admin/scheduled-test-plans`；PUT/DELETE `/admin/scheduled-test-plans/:id` |
| 计划结果 | GET `/admin/scheduled-test-plans/:id/results?limit=20` |
| 模型/代理 | 复用 accountsAPI.getAvailableModels 与 proxiesAPI.getAll，只读 |

供应商结果显式映射：OpenAI 保留 client_id/ID Token/ChatGPT 标识/订阅与到期信息；Gemini 和 Antigravity 的 expires_at 按官方转换为秒数字符串，保留项目/层级和供应商附加信息。不以 expires_in 推算或伪造服务端到期时间。空 refresh_token 不覆盖有效值。完整回调地址的 state 必须匹配当前会话；仅授权码录入沿用本次服务端会话的 state。

到期时间表单显示本地时间，提交 Unix 秒；清空已有到期发送 0，清空已有负载发送 0。创建时相应空值为 null；计费倍率 0 是合法免费值。计划仅做五字段形状和正整数校验，cron 的合法性及执行时区交给服务端。

## 完整对照：已实现与仍缺失

按官方 Create/Edit/OAuth 对话框的功能分区列出，不能把下面的“部分”理解为全量对齐。

| 官方功能分区 | 本轮覆盖 | 仍未完成 |
| --- | --- | --- |
| 基本账号信息、平台/认证类型、并发、优先级、分组 | 保留原能力，新增备注/代理/负载/倍率/到期/调度 | 官方全部平台的特殊认证组合；混合渠道风险确认引导 |
| Anthropic OAuth/Setup Token | 手动交互式授权、重新授权、专用保存、Cookie 批量授权 | 在重授权中切换 OAuth/Setup Token 类型 |
| OpenAI OAuth | 手动交互式授权/重授权；RT/mobile RT/Codex Session/Agent Identity/PAT批量创建导入 | Session Token因固定官方移除而未实现；重新授权Sheet仍为授权码流程，未接RT导入到已有账号 |
| Gemini OAuth | Code Assist、Google One 创建；保留现有账号 OAuth 类型/项目/层级后重授权 | AI Studio 新建与能力探测、自定义 OAuth Client、官方层级选择器/帮助流程；手动 RT 分支 |
| Antigravity OAuth/上游 | OAuth 创建/重授权、API Key上游输入、模型映射与默认映射追加 | 混合调度、上游倍率自动探测等高级流程 |
| Grok OAuth | 手动授权码/RT/SSO Cookie/邮箱密码，创建与重新授权；能力开关 | 客户端工具缓存、媒体生成资格、OAuth自定义上游；Grok批量SSO/密码导入 |
| Kimi/Zhipu/DeepSeek | 保留既有 API Key 输入 | 按量/Coding Plan、协议选择、智谱组织/项目字段 |
| Bedrock/Vertex/Service Account | 保留既有基础凭据表单，本轮未重新实现 | Bedrock Force Global、预设映射、池模式、Vertex 更多官方选项 |
| 模型控制 | 账号白名单/映射/池、OpenAI/Grok OAuth映射、OpenAI Compact映射；计划模型读取/手输 | 非Antigravity供应商预设快捷列表和在线模型自动同步预览未接；已有模型可手动完整编辑 |
| 错误与请求设置 | 重授权清错闭环 | 自定义错误码、Header Override、临时不可调度规则、预热拦截 |
| 配额/亲和/窗口费用/会话/RPM | 总/日/周配额、重置时区/日期、预警；5h费用/粘性预留、会话数/超时、RPM策略/缓冲、UMQ | 上述字段真实调度生效未验收；没有复制服务端亲和/限速算法 |
| 指纹/转发/缓存 | 保留未编辑字段，不新增入口 | TLS 指纹、Session ID Masking、Cache TTL、自定义 Base URL 中继 |
| OpenAI 专有开关 | 无新增 | 自动透传、namespace工具摊平、WS模式、Responses能力、图片回填/桥接、长上下文计费、Compact能力、订阅层级覆盖、指纹收敛 |
| Anthropic API Key 专有开关 | 无新增 | 自动透传、Web Search Emulation |
| 计划测试 | 增删改、启停、模型、cron、保留条数、自动恢复、最近结果与重试 | 与真实后端的定时执行/恢复行为验收；完整原版结果视觉细节 |

## 验证与复现

仓库已安装依赖后，从 `D:\sub2-mac` 运行：

```powershell
node --test scripts/parity-accounts.test.cjs
```

当前结果：见下方续作最终验证。历史优先闭环21项不再代表当前总数。

- 五种授权流程的实际 TypeScript API 适配器与 exact payload 路由测试。
- state 不匹配、拒绝授权、空授权码、非法 URL、缺失 state/凭据、过期错误反馈；失败不发送兑换请求。
- 平台元数据映射、到期类型、空 refresh_token 保护。
- 实际 OAuth Vue setup 的防重入、参数变更/卸载失效、敏感值清理、重试。
- 专用重授权接口；部分成功只重试清错。
- 实际计划 Vue setup 的增改删、启停 payload、错误读屏障、输入校验、防重入、写后刷新失败和结果乱序保护。
- 实际 AccountsApp setup：未授权不能创建，已授权创建提交 provider metadata 和高级字段。
- 所有本线 Vue 模板经真实 SFC compiler 编译；独立 vue-tsc 通过。本测试临时生成入口，仅导出**真实** MacSheet/MacAlertSheet/MacButton 与 core types，避免通过 core 总导出检查其他并行线页面；未替换组件类型为 any。

类型检查临时文件位于系统临时目录，脚本 finally 清理。HTTP 全部由 fixture 拦截/替代，不联网、不登录、不保存真实数据。未运行全局 build。

未完成的验证：浏览器实际点击与 1440×900 浅深色/390×844 截图、真实供应商授权、真实 0.2.1 写入/定时测试/恢复调度。共享 Sheet 的焦点与 Escape/Enter 行为沿用现有实现，本轮未新增浏览器视觉证据；模板编译与 setup 测试不能替代这部分验收。

一次直接使用 core 总导出的局部类型检查曾牵入 MacDock/MacMenubar 的模板隐式 any；本线没有改这些文件。独立入口排除无关页面，账号页内部模板回调改放进类型明确的 script 函数后通过。工作区无 Git 元数据，未执行提交或覆盖式恢复。

## 累计修改文件（14个）

1. `packages/sub2-console/src/apps/admin/AccountsApp.vue`
2. `packages/sub2-console/src/apps/admin/accounts/oauth.ts`（新增）
3. `packages/sub2-console/src/apps/admin/accounts/OAuthAuthorization.vue`（新增）
4. `packages/sub2-console/src/apps/admin/accounts/ReauthorizeSheet.vue`（新增）
5. `packages/sub2-console/src/apps/admin/accounts/ScheduledTestsSheet.vue`（新增）
6. `packages/sub2-console/src/apps/admin/accounts/advanced.ts`（新增）
7. `packages/sub2-console/src/apps/admin/accounts/AccountAdvancedFields.vue`（新增）
8. `packages/sub2-console/src/api/admin/scheduledTests.ts`
9. `scripts/parity-accounts.test.cjs`（新增）
10. `docs/frontend/PARITY_ACCOUNTS.md`（新增，本任务卡）
11. `packages/sub2-console/src/apps/admin/accounts/policies.ts`（A03新增）
12. `packages/sub2-console/src/apps/admin/accounts/AccountPolicies.vue`（A03新增）
13. `packages/sub2-console/src/apps/admin/accounts/batchAuthorization.ts`（A04/A05新增）
14. `packages/sub2-console/src/apps/admin/accounts/BatchAuthorizationSheet.vue`（A04/A05新增）

`api/admin/accounts.ts` 与供应商 API 已有正确接口，复用而未改动。未编辑全局 types、其他管理页面、server、真实配置、根目录二进制、旧原型或官方参考目录。

## 续作最终验证（2026-09-12）

执行 `node --test scripts/parity-accounts.test.cjs`：**40项，40通过，0失败，0跳过**。包括原22项、Grok密码/SSO/RT契约、6个批量分支、双击防重、部分失败只重试失败项、保存重试不重复兑换、未知写入不重放、卸载后不续写、JSON/Agent Identity校验、旧凭据不回写、Cookie/密码/原始错误不出现在保存payload或结果UI、策略及账号页接线回归。内含本线所有Vue及真实共享Sheet/Button依赖的独立vue-tsc，已通过。

本轮新增2个文件（batchAuthorization.ts、BatchAuthorizationSheet.vue），修改3个文件（AccountsApp.vue、parity-accounts.test.cjs、本文）；之前已落盘的Grok/policies保持，追加测试与准确报告。本轮未启动浏览器、未运行全局build、未发真实授权或账号写请求。主任务此前全局类型/浏览器结果属于另一集成快照，不将其当成本轮新增批量Sheet的视觉验收。

后续主任务可用上述同一命令重复测试，并在隔离浏览器夹具验证批量Sheet的浅深色、小屏、Tab/Escape与部分失败结果。真实后端授权和导入必须单独验收；Session Token不应列为已实现或以虚构请求补齐。
