# RELEASE-ACCOUNTS · 2026-09-13

本卡负责 RELEASE_READINESS_20260913 第 1 项中的账号缺口。账号范围已完成并冻结。用户已确认官方 v0.2.4 隔离真实核心 API 和前端创建验收通过；本卡采纳主任务验收结果，不重复执行真实账号操作。外部 OAuth/支付无沙箱，按用户确认列为未验收，不作为新增核心缺口。

## 实施与边界

改动前已读取 docs/frontend/RELEASE_READINESS_20260913.md、EXECUTION_PLAN.md、DESIGN.md。沿用 Vue/Pinia/API 契约、三屏新建向导、编辑单屏、分组与高级折叠、JSON 拖入、授权代次隔离和差异更新。

独占改动：

- packages/sub2-console/src/apps/admin/AccountsApp.vue
- accounts/AccountPolicies.vue、policies.ts、OAuthAuthorization.vue、oauth.ts
- 新增 accounts/PlatformControls.vue、platform-controls.ts、header-overrides.ts
- scripts/release-accounts.test.cjs、scripts/release-accounts-browser.js
- 本报告与 output/release-accounts 验证产物

没有改动 server、根目录二进制、真实配置、deploy、main、store、auth/client、公共 types 或其他子任务文件。新增类型仅在账号子目录。已有 accounts、gemini、TLS profile API 已具备所需契约，无需复制接口。

## 已实现

| 功能 | 实際行为与契约 |
| --- | --- |
| Gemini AI Studio 新建 | 三屏向导可选 AI Studio；能力查询失败或 ai_studio_oauth_enabled=false 时禁生成链接，可重试；启用后走官方 auth-url/exchange-code，创建凭据保留 oauth_type、tier_id 与 extra；显示 required_redirect_uris。原有 Code Assist/Google One 保留。 |
| 自定义 OAuth client | 使用官方服务端配置的 client；不在账号请求中虚构 client_id/client_secret 字段。官方 handler 的 auth URL 和兑换请求不接受这两个字段。部署方设置 GEMINI_OAUTH_CLIENT_ID、GEMINI_OAUTH_CLIENT_SECRET（或 gemini.oauth.client_id/client_secret），能力接口才放行 AI Studio。账号界面显示配置缺失及回调地址，不保存或显示 secret。 |
| 混合渠道风险 | Anthropic/Antigravity 新建、编辑及批量分组变更调用 check-mixed-channel；失败禁写，取消保留草稿，确认才携带 confirm_mixed_channel_risk。批量 Cookie 授权入口也先确认，并把标记冻结进批次。服务器保存返回明确 409 mixed_channel_warning 时重新询问，最多在确认后重发一次；不自动重试超时或其他错误。 |
| 请求头覆写 | 按官方平台/类型资格开放，逐行添加删除，密码式值输入，空值表示移除头；credentials.header_override_enabled/header_overrides。禁止认证、会话隔离及传输头，校验大小写重复、控制字符、64项/名称200字符/值8192 UTF-8字节。校验器依据官方 credentialsBuilder.ts。 |
| TLS、Session ID、缓存 TTL | Anthropic OAuth/setup-token 高级折叠内控制；读取官方 TLS 配置列表，保留不存在/读取失败的当前配置，支持默认/随机/指定；TTL 5m/1h。extra 字段对齐官方，支持后端顶层派生字段回显，关闭清除关联配置。 |
| Anthropic 专有项 | 预热请求拦截、自定义 OAuth 服务地址；API Key 透传、X-API-Key/Authorization Bearer、联网搜索模拟。 |
| OpenAI 专有项 | 透传、长上下文计费、工具 namespace 展平、仅 Codex CLI/App Server、Codex 指纹、Compact、Responses/Chat Completions、按账号类型的 WebSocket 模式及旧键清理、图片 URL 转 Base64、文本/embeddings 端点能力、Codex 生图桥接/移除显式工具。增加配额自动暂停/自动消耗重置次数开关和阈值。 |
| Antigravity / Gemini | 混合调度、允许超额、项目 ID；Gemini API Key AI Studio 免费/付费层级。 |
| 错误控制 | API Key 自定义 HTTP 错误码；逐行编辑临时暂停调度规则（状态码、关键词、分钟、说明），无效规则阻止保存。 |
| 差异与竞态 | 保存前重新读账号；只修改用户变更项，保留最新未知 credentials/extra。平台/类型不适用字段不写。关闭或卸载解除挂起确认并隔离迟到响应；保存防重入。透传与同时修改模型映射冲突时阻止保存。 |

## 官方证据

参考目录固定为 output/upstream-current-20260912（v0.2.4，既有核对 commit 5de5e2be；本卡未重新查询发行版本）。

- frontend/src/components/account/CreateAccountModal.vue / EditAccountModal.vue：平台资格、extra/credentials 序列化、风险确认、TLS/TTL、OpenAI 控制。
- frontend/src/components/account/credentialsBuilder.ts：请求头资格、禁止列表、大小与 UTF-8 校验。
- backend/internal/handler/admin/gemini_oauth_handler.go：能力、生成/兑换请求字段。
- backend/internal/service/gemini_oauth_service.go：GetOAuthConfig 只有已配置非内置 client ID 与 secret 才启用 AI Studio。
- backend/internal/config/config.go：GEMINI_OAUTH_CLIENT_ID / GEMINI_OAUTH_CLIENT_SECRET 与配置键。

## 验证

- `node --test scripts/release-accounts.test.cjs scripts/parity-accounts.test.cjs scripts/desktop-accounts.test.cjs`：87/87 通过，包含独占文件与实际 Sheet/Button 依赖的独立 vue-tsc。日志 output/release-accounts/tests.txt。
- `pnpm --filter @sub2-mac/console typecheck`：通过。日志 output/release-accounts/typecheck.txt。早期曾遇到其他并行文件 UsageBalanceHistory 的类型错误，没有越界修改；最终检查已通过。
- `pnpm --filter @sub2-mac/console exec vite build --outDir ../../output/release-accounts/dist`：通过，634 模块；日志 output/release-accounts/build.txt。此目录是验证构建，不是主任务冻结发布包。
- Playwright 普通 Chrome 实际 DOM 夹具：TLS/TTL/masking 编辑→取消风险→再保存→确认，检查最终 extra/确认标记及未知字段；Gemini 能力未开禁用→重试→生成→兑换→三屏确认创建。6 次写请求全部在浏览器拦截，真实写入 0。结果 output/release-accounts/browser.json；脚本 scripts/release-accounts-browser.js 使用独立 5208。
- 1440×900 浅深色、390×844 截图 controls-light.png、controls-dark.png、controls-mobile.png；已查看截图，小屏内部滚动及固定保存操作可达。
- 现有 JSON 导入22项回归通过，包含拖入解析、取消/代次、部分失败、防重复和未知结果不重放。
- `scripts/test-parity.cjs --all` 会自动发现新增 release-accounts.test.cjs；不带 --all 的 parity-only 模式不会包含它，主任务集成须使用 --all 或显式执行上述命令。

## 主任务接手与验收界限

账号清单上述入口已实现，主任务隔离真实核心 API 与前端创建已获用户确认通过。本账号子任务始终未操作当前 8000，也未启动或修改后端。真实核心验收状态来自用户明确确认；本卡自己的记录仍区分夹具、源码和真实环境。

本报告作为本独占任务卡的实际变更和验证回写；主任务据此合并 EXECUTION_PLAN/总收口清单及冻结包，避免并行覆盖公共文档。冻结范围为本报告列明的账号功能，不扩展成官方所有运营细节的新一轮穷举。


## 定向复核与冻结（用户确认核心验收后）

结论：本次指定范围未发现新的明确核心功能缺口或无关 UI 遗失。保留三屏向导、折叠/分组、JSON 导入及已有账号控制。仅修复一处保存错误的泄漏风险：后端拒绝保存时可能回显请求头/凭据，现首次保存与 409 二次确认后的失败均只展示固定中文提示及 HTTP 状态，不呈现后端错误正文。未知写入结果提示先核对列表，不自动重试。

定向补验：

- 所有适用平台/类型新字段默认不变、切换后恢复初值均无新增 credentials/extra 写入。
- TTL 单字段变更保留最新缓存运行态及未知指纹字节数据；不发送无变更 credentials。TLS 控件仅选择 profile ID，不呈现原始指纹字节。
- 请求头 UTF-8 恰好 8192 字节接受，8193 字节拒绝；验证错误不带内容。请求头值继续使用 password 输入，禁止列表、大小写重复、控制字符检查保留。
- 二次确认前不写、取消保留草稿、显式确认最多重发一次；首次/确认后保存失败均不泄漏回显 headers 或字节内容。
- 账号三组专项共 91/91 通过（含独占文件独立 vue-tsc），日志 output/release-accounts/freeze-tests.txt。本轮只改保存错误处理及定向测试，没有改动布局和其他任务文件。

需要外部条件的未验收项目仅列为：

1. 外部 OAuth 提供商真实 consent、回调和刷新；Gemini AI Studio 需可用自定义 client 与回调配置。
2. 真实供应商数据路径上的 TLS 握手、请求头覆写效果、缓存计费/配额耗尽与恢复，需对应供应商凭据及允许消耗的测试账号。
3. 支付供应商沙箱/回调/退款（非本账号范围），用户已确认无沙箱并列未验收。

冻结后不继续扩充功能或重复核心验收；仅在发现明确回归时解冻相关单项。冻结指纹记录 output/release-accounts/freeze-sha256.json。
