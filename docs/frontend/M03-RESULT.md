# M03 · 认证、账户安全与 Settings

日期：2026-09-11。状态：可集成实现完成；真实后端与浏览器验收待主任务统一进行。

## 范围与依据

已读取 EXECUTION_PLAN.md、DESIGN.md，并使用 ui-ux 质量门。只改下列文件；未修改只读 upstream、全局 types/client/system/App/core、共享样式、Tailwind、SoftwareUpdatePanel、后端、配置或业务数据。未启动服务器、操作浏览器或运行全工作区 build。

官方依据为 output/parallel-20260911/upstream/frontend，用户提供 HEAD 为 98d86915becae9fe9491a91ffc6defd5235c8d2b。核对了 ProfileTotpCard、TotpSetupModal、TotpDisableDialog、ProfileIdentityBindingsSection、ProfilePasswordForm、RegisterView、ForgotPasswordView、ResetPasswordView、LoginView 的 password_reset_enabled 门控与现有 auth/totp/user API 和类型。

## 实际变更文件

- packages/sub2-console/src/apps/user/settings/TotpSecurityPanel.vue（新增）：复用 MacGroupCard/MacSheet/MacButton；独立读取 TOTP 状态和验证方式。状态缺失、请求失败、未知验证方式均不可写并可重试。支持密码/邮箱码身份验证、发送邮箱码、60 秒重发冷却、二维码本地生成、手动密钥/复制、动态码启用、确认停用、凭证倒计时/过期禁写/重新设置、成功后重新读取状态。拒绝 false success，6 位数字校验，busy 防重复提交与关闭。密钥仅在组件内存中，关闭/卸载清理，卸载停止计时器。二维码不请求外部图像服务。
- packages/sub2-console/src/apps/user/SettingsApp.vue：替换无接线 TOTP 按钮；将 Sheet Teleport 到当前设置窗口根节点，避免内容滚动导致弹层离屏。管理邮箱原按钮只切换了未渲染的状态，现接原有 sendEmailBindingCode/bindEmailIdentity：新邮箱验证、当前/新密码、确认更新、失败反馈、成功更新账户、敏感输入清空。修复 MacButton 默认为 button 导致“修改密码”点击无提交。账户资料未知时相关操作显式禁用；用户名未变禁用提交。保留 admin 模块差异提交与原有未知不可写机制。Passkey 未读取时不再宣称“没有任何 Passkey”。
- packages/sub2-console/src/components/MacLockscreen.vue：保留玻璃登录、壁纸、头像和原有样式；支持开启邮箱验证/邀请码的注册，补确认密码、邮箱格式/6 位验证码/至少 6 位密码验证及 verify_code/invitation_code 精确提交。验证码绑定当前邮箱并按服务端 countdown 限制重发；注册完整主按钮放在表单底部。公共注册配置失败可重试。保留验证码供应商/协议能力限制。移除 window 全局 Enter，限定锁屏输入控件，排除输入法组合、重复键和已消费事件；2FA 动态码有可访问名称、数字键盘及严格格式检查。
- packages/sub2-console/src/stores/auth.ts：登录/注册/2FA 防重复调用；新登录清理旧挑战；缺失临时凭证与错误动态码显示明确错误；注册成功清理挑战；本地契约错误不再误报网络故障；不再将完整登录异常对象写入 console。
- docs/frontend/M03-RESULT.md：本独立报告。
- scripts/m03-auth.test.cjs（用户追加授权的专属新文件）：固化此前隔离检查，新增找回密码与重置回调覆盖；可直接运行 `node --test scripts/m03-auth.test.cjs`，也支持 `node scripts/m03-auth.test.cjs`。从项目包解析已有 Vue/TypeScript，无额外依赖安装，不加载真实 API，不访问网络。

## 追加完成：忘记密码与邮件重置

- 登录页“忘记密码？”与 `/forgot-password` 直达：站点 `password_reset_enabled === true` 且无需尚未集成的人机验证时，允许提交现有 `forgotPassword({ email })`。未知/关闭/第三方验证码要求均禁写并显示原因，设置失败可重读。提交后使用不泄漏邮箱存在性的提示；失败可重试，提交中防重入。
- `/reset-password?email=…&token=…` 直达：直接在 MacLockscreen 读取官方参数并显示新密码/确认密码；不修改 App.vue 或全局路由。读取后用 replaceState 从当前地址栏移除 email/token，token 仅存内存，成功、离开或卸载即清空。
- 重置调用原有 `resetPassword({ email, token, new_password })`；至少 6 位、确认一致、缺参数禁提交、INVALID_RESET_TOKEN 显示失效与重新申请入口、网络错误保留可重试状态、busy 防重复请求与模式切换。成功明确返回登录，不自动登录。保存过的会话不会抢先关闭重置表单。
- 保留玻璃卡片、壁纸与现有所有已修认证流程；没有实际发邮件或重置密码。

主任务接线说明：前端不需要 App/路由改动，MacLockscreen 已识别官方两个 pathname。部署入口必须将 `/forgot-password` 和 `/reset-password` 返回本前端 SPA（history fallback），且后端邮件所用前端站点地址须指向 Sub2-Mac；此项未在本轮改配置或线上验证。若邮件仍指向原版独立站点，需主任务确认目标，不应在本前端臆造邮件 URL。地址栏清理后刷新页面会丢失内存 token，用户需重新打开邮件链接，这是当前明确行为。

## 验证与边界

- `pnpm --filter @sub2-mac/console typecheck`：第一轮通过。中间一轮受并行 ChannelsApp.vue:176 的 Object.hasOwn 目标库错误影响，未改他人文件；之后该错误已消失。新增注册按钮导致的局部模板窄化错误已修正，最终复查结果见下方。
- Node 隔离检查已固化至 `scripts/m03-auth.test.cjs`：使用 vue/compiler-sfc 编译三个修改的 Vue 模板，并用 TypeScript 转译实际 script setup、Vue refs/computed 与 VM 注入 API 夹具。
- TOTP 11 组行为通过：状态读取、密码验证及 setup payload、凭证保留与密码清空、非数字拒绝、过期禁写、启用 payload/刷新、停用/刷新、读取失败禁写、未知验证方式禁写、邮箱码与冷却、重复提交/提交中禁止关闭/卸载清理。
- 注册 8 组检查通过：开启邮箱码/邀请码时入口可用、密码不一致拒绝、邀请码缺失拒绝、未验证邮箱拒绝、发送与重发冷却、verify_code/invitation_code payload、第三方验证码能力限制、按钮 Enter/输入法不误触登录。
- 邮箱管理隔离检查通过：未发送当前邮箱验证码时禁提交；提交 email/verify_code/password；成功清空敏感输入并关闭；资料未读成功不能发送或更新。
- 未调用真实登录、注册、邮件发送、TOTP、改密码、账户更新或其他业务接口。上述是前端契约/状态机证据，不等于真实后端验收。
- 未运行浏览器：Tab 循环、最上层 Escape/Enter、焦点恢复依赖已读的共享 MacSheet/useModalLayer，组件 busy/form/焦点接线已检查；尚无本轮键盘、截图、390px 视觉验收证据。

## 剩余关键缺口 / 主任务集成检查

1. 统一执行类型/build 与浅深色、390px 注册长表单和低高度滚动检查；真实 Sheet Tab/Enter/Escape、防重入、设置页滚动后弹层定位需实测。
2. 第三方验证码（Turnstile/Tencent/Aliyun）、登录协议与 OAuth 完整登录/绑定流程未实现；注册仍会保守隐藏需要这些能力的入口，密码找回显示限制并禁写，不绕过官方要求。普通邮件找回/重置已在追加轮完成，邮件目标及 SPA fallback 待集成核验。
3. Passkey CRUD 和第三方身份绑定列表完整读取仍未补齐。现有 LinuxDo/钉钉/OIDC/微信静态绑定展示也尚不能作为真实状态证据；后续应统一对接官方 profile 绑定模型。
4. 通知邮箱增删/验证与备份恢复等其他 Settings 流程不在本次重点闭环，原有代码保留。模块保存机制未重写。
5. 对响应丢失（服务器可能完成但客户端超时）仍需人工重新读取账户/TOTP 状态；没有声称全流程具备后端幂等性。
6. 集成后优先用开发夹具覆盖邮件失败、错误动态码、服务端 countdown、验证方式变化与成功后状态重读失败，再单独授权真实账户测试。

## 最终检查

最终 `pnpm --filter @sub2-mac/console typecheck` 通过（exit 0）。未运行 build，交主任务统一集成。

追加轮：`node --test scripts/m03-auth.test.cjs` 36/36 通过（3 个模板、11 个 TOTP、8 个注册/键盘、3 个邮箱管理、11 个找回/重置场景）；追加功能类型检查通过。测试覆盖邮件请求失败、站点未知/关闭/验证码要求、官方重置参数和 URL 清理、缺失/过期 token、密码规则、重置 payload、busy 防重入及已有会话不得覆盖回调模式。全部是无网络隔离夹具，浏览器与真实后端仍未验收。
