# PARITY-AUTH · 认证功能对齐任务卡

日期：2026-09-11。状态：本卡前端实现与 31 项隔离测试完成；真实后端、第三方授权、WebAuthn 设备与视觉交互验收未完成。

只读契约来源：`output/parallel-20260911/upstream/frontend`，官方 0.2.4、HEAD `98d86915becae9fe9491a91ffc6defd5235c8d2b`。本地后端按交接为 0.2.1，本卡没有访问或修改其账户、配置、数据库。本卡作为独占任务卡记录，不修改由主任务维护的 EXECUTION_PLAN/UPSTREAM_PARITY 总表。

## 实际实现

| 功能 | 入口与已实现行为 |
| --- | --- |
| Passkey 登录 | 锁屏按 `passkey_enabled === true` 显示；协议与验证码通过后执行 begin → 浏览器 assertion → finish → `/auth/me` → 桌面解锁。拒绝/取消不提交 finish；会话确认失败清除整套 token。 |
| Passkey 管理 | 设置 → 账户安全：列表、添加、重命名、密码确认删除；复用 MacGroupCard/MacSheet/MacButton。列表失败不可写，成功后重新读取列表，名称最长 100 字符。 |
| OAuth 提供商入口 | GitHub、Google、LinuxDo、钉钉、微信、OIDC，逐个公共 feature flag 控制；OIDC 展示配置名称；微信按官方 open/mp 与浏览器能力解析。 |
| OAuth 两代回调 | 通用 `/auth/callback`、`/auth/oauth/callback`，LinuxDo/微信/钉钉/OIDC 专用 callback，以及钉钉 email-completion。支持旧 fragment token/邀请 pending token 和新 HttpOnly pending-session exchange。读入后先清地址栏再执行异步操作，凭证不进 sessionStorage。 |
| GitHub/Google 补全 | 泛型 code/state 回调仅转交已记录提供商的后端 callback；pending registration 显示已确认邮箱、设置/确认密码及按需邀请码；调用提供商 complete-registration，前端不交换授权码或验证 OAuth state。 |
| OAuth 新建/绑定已有账户 | 服务端 choice/create/bind/adoption/2FA 分支、邮箱补全、邮箱验证码及倒计时、邀请补全、显示名/头像的明确采用选择、绑定已有账户密码验证和 TOTP；EMAIL_EXISTS 返回后转为绑定已有账户。 |
| 已登录第三方绑定 | 设置列出服务端绑定状态；通过既有 `bind-token` 与 `bind/start?intent=bind_current_user` 发起绑定；严格依 `can_unbind` 开启解绑并二次确认。GitHub/Google 独立绑定仅在服务端明确 `can_bind=true` 时开放，不能由登录开关推断绑定能力。 |
| 登录协议 | 公共协议标题/全文阅读、checkbox/modal 接受与拒绝；没有正文不放行，修订或正文变化撤销接受状态。使用共享 Sheet，文本转义展示，不执行协议中的 HTML。 |
| 验证码 | Turnstile、腾讯 CN/intl、阿里云 SDK 入口、配置缺失/加载失败/超时提示及重试；官方优先级与 payload；验证码只交由业务 API 在后端验证。SDK 取消、过期、重置和卸载清凭证，旧 SDK 回调不能满足新验证。 |
| 原有流程 | 保留密码登录、注册邮箱码/邀请码、TOTP、密码找回和重置。密码登录、发码、注册和找回密码现在接入验证码；不再因为协议/验证码开启而直接隐藏注册入口。 |

## 关键 API 契约

- 登录 Passkey：`POST /auth/passkey/login/begin`（按需 captcha proof），`POST /auth/passkey/login/finish`（`session_token, credential`）。保留官方 base64url ↔ ArrayBuffer 转换及 assertion/attestation 字段。
- 管理 Passkey：`GET /user/passkeys`；`POST /user/passkeys/register/begin {password}`；`POST /user/passkeys/register/finish {session_token,name,credential}`；`PATCH /user/passkeys/:id {name}`；`DELETE /user/passkeys/:id` 的 body 为 `{password}`。
- OAuth：无验证码采用官方 GET start URL；启用验证码时 `POST /auth/oauth/:provider/start`，proof 在 body、redirect/mode 在 query，消费 `authorize_url`。
- 新回调：`POST /auth/oauth/pending/exchange`；后续 `/auth/oauth/pending/create-account`、`/auth/oauth/pending/bind-login`、`/auth/oauth/pending/send-verify-code`；服务端仍拥有账户规则和所有身份绑定决策。
- 提供商补全：`POST /auth/oauth/:provider/complete-registration`。GitHub/Google 发送 password 及按需 invitation_code；其他提供商发送 invitation_code/资料采用布尔值；旧回调的 pending_oauth_token 仅进入该请求 body。
- 绑定：复用已有 `user.ts` 的 prepare cookie / bind start / unbind 实现，没有修改其契约。新绑定结果无 access_token 的响应按官方语义恢复原登录会话并检查身份；未认证时不解锁。
- 验证码：Turnstile token 与阿里云 `captchaVerifyParam` 使用 `turnstile_token`；腾讯使用 `tencent_captcha_ticket` 和 `tencent_captcha_randstr`。腾讯国际站构造函数包含 DOM 容器参数，与中国站分开处理。

## 取消、失败与敏感状态

- Passkey 设备验证可取消，AbortSignal + generation 阻止取消后的 begin/browser 结果继续提交或采用会话；真正发起管理写请求后禁止重复提交/关闭，完成后回读。组件卸载仍只停止本组件等待，不宣称撤销服务器已经收到的操作。
- 外部会话先替换完整 token 上下文，再用 `/auth/me` 确认身份；失败/中止清 access/refresh/expiry/user，避免沿用另一个账户的 refresh token。管理员仍经现有 App 的合规检查，不新增绕过路径。
- 密码管理表单提交即清可见密码；OAuth 提交成功/失败、取消/卸载均清密码、确认密码、验证码，完成或取消后清 pending/TOTP/token 对象。旧 URL token 在异步设置加载之前删除。
- 协议版本不持久化：返回本站会再次确认当前协议。这是有意更保守的接受范围，不把既往版本默认为本次接受。
- 注册/找回/验证码设置读取失败时停止放行并提供重试；旧后端未提供 Passkey flag 时不显示可用能力。404/失败不会退回演示数据或宣称成功。

## 可重复验证

从任意 cwd 执行：

```powershell
node --test D:\sub2-mac\scripts\parity-auth.test.cjs
```

最终结果：**31/31 通过**。脚本执行实际 TS/Vue script 的状态和 API 调用；API、存储、SDK、计时器及 WebAuthn 对象均为隔离夹具，未启动服务器或访问真实账户。另编译 7 个本卡 Vue 文件的 script/template。

覆盖：提供商 feature flag、微信旧/新能力判断、所有本卡 callback 路径与支付路径排除、OAuth state 分类、exact payload、旧 token 清理、WebAuthn 转换/取消/失败、Passkey CRUD 与确认、防重复/迟到响应、协议修订、注册/发码/恢复/TOTP、外部会话 `/auth/me` 失败、SDK 国内/国际构造差异、验证码一次性消费/过期/取消/超时/卸载及迟到回调隔离、绑定权限与确认。

`pnpm --filter @sub2-mac/console typecheck`：**最终通过，exit 0**。中间一次检查曾被共享工作区并行文件 `src/apps/admin/CommerceApp.vue(1166,93)` 的 TS2339（模板变量 `p`）阻断，本卡未修改 CommerceApp；最后复查该错误已消失。主任务仍需在全部并行修改收口后统一集成验收；本卡未执行全局 build。

## 未完成及兼容边界

1. 未做真实 WebAuthn/Touch ID/Windows Hello、安全密钥注册/登录、真实 OAuth 跳转、验证码供应商校验、邮箱发送或账户修改；不能称为 0.2.1/0.2.4 真实后端验收通过。
2. 未做 1440×900 浅深色、390×844 的实际浏览器截图和 Sheet 键盘走查。新增控件保留玻璃/图标/共享组件；扩展登录卡允许纵向滚动，但编译和状态测试不等于视觉通过。
3. 不包含微信支付授权、独立 `/legal/:documentId` 页面、完整富文本 Markdown 排版，以及官方营销邀请码以外的 promo/referral 归因界面/跨页持久化。协议已可在登录 Sheet 完整阅读；原有注册/邮箱码和找回密码不是本卡遗漏项。
4. 登录完成统一回桌面；不在本卡修改 App/main/manifest 以恢复所有上游子路由。绑定成功会恢复桌面会话，用户可在设置中重新查看绑定结果。
5. 后端缺少 endpoint/feature flag 时明确显示禁用或失败；不猜测 0.2.1 支持新增 OAuth pending 分支。钉钉企业模式对关闭注册的特殊豁免未从公共设置确认，创建账户入口按 `registration_enabled` 保守控制，仍可绑定已有账户。

## 修改文件（独占范围）

现有文件：

- `packages/sub2-console/src/components/MacLockscreen.vue`
- `packages/sub2-console/src/stores/auth.ts`
- `packages/sub2-console/src/apps/user/SettingsApp.vue`
- `packages/sub2-console/src/api/passkey.ts`
- `packages/sub2-console/src/api/auth.ts`

新增文件：

- `packages/sub2-console/src/components/auth/CaptchaGate.vue`
- `packages/sub2-console/src/apps/user/settings/PasskeySecurityPanel.vue`
- `packages/sub2-console/src/apps/user/settings/OAuthBindingsPanel.vue`
- `packages/sub2-console/src/apps/user/settings/OAuthCallbackPanel.vue`
- `packages/sub2-console/src/apps/user/settings/LoginAgreementPanel.vue`
- `scripts/parity-auth.test.cjs`
- `docs/frontend/PARITY_AUTH.md`

未改 SoftwareUpdatePanel、TotpSecurityPanel、settingsForm、server、真实配置、根二进制、App/main/manifest 或 package/lock；未启动本卡临时服务器。依赖由主任务统一维护，本卡不需要新增依赖。
