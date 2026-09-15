# 认证、支付与公共页独立复核 · 2026-09-12

主任务最终增量：下文X1、X2已收口。WalletApp未知下单锁定及wallet-unknown-order.test.cjs已纳入默认全测；client.ts会话快照与parity-client.test.cjs六项通过。标准全测475通过1跳过，干净目录同样通过；默认core与console类型、运维窄入口类型均通过。早期“待主任务”及类型阻断仅保留为阶段记录，最终边界见REVIEW_FULL_20260912.md。

结论：本线发现并修复认证会话竞态、登录响应不完整、TOTP校验、OAuth取消、解绑跨账号回写、支付回调重试及恢复归属问题。**原复核默认测试63/63通过；scripts全部专项443项，442通过、1可选浏览器跳过、0失败。续作X1已获授权修复，钱包专项及原支付回归66/66通过；X2仍由主任务独立处理，本报告未确认其修复，不能标记完整安全验收通过。**

已先读 `EXECUTION_PLAN.md`、`DESIGN.md`。本线负责源码复核、局部修复、新旧隔离测试；全局类型检查、构建、浏览器、桌面core和打包由主任务执行。本轮未新增业务功能，未登录、授权、下单、支付或修改真实账号。所有业务调用测试均为内存夹具。

## 已修复的确定问题

| 编号 | 优先级 | 触发与原行为 | 修复与证据 |
| --- | --- | --- | --- |
| A1 | P1 | 登录、恢复、外部会话的旧请求在退出或新登录后返回，可覆盖user/token；旧外部登录失败也可能清除新会话 | store加入会话代次；迟到响应不能发布或清除状态；退出先同步清理，再等待旧refresh token撤销。新增pending login→logout、旧external失败→新会话、旧logout→新登录测试 |
| A2 | P1 | 密码登录/注册直接接受access_token；响应缺少token或user时仍可能成功，保留上一账号的user/管理员角色 | 先清理旧身份；必须有有效token；没有user时调用auth/me验证，不能沿用旧user。提交成功后同步auth_user快照，保持refresh模块身份核验依据 |
| A3 | P1 | store原六位TOTP正则包含重复反斜杠，不能正确接受六位数字；旧测试只覆盖TOTP设置面板，未覆盖登录store | 改为六位数字正则；真实store测试验证abcdef不发请求、123456走/login/2fa并完成身份更新 |
| A4 | P1 | OAuth callback组件卸载后，内部auth/me仍可能完成登录；callback的2FA API在组件代次判断前就写localStorage | callback使用AbortController传给外部会话采纳；卸载/取消中止采纳。API login/login2FA/register增加可选persist=false，store/callback延后到当前代次确认后落盘；默认调用行为兼容 |
| A5 | P1 | 第三方解绑返回时只判断组件alive，若组件仍挂载而账号改变，旧响应直接赋值auth.user | 增加用户ID代次、响应user.id核验；换号清理选择/反馈；旧解绑结果不写回新账号 |
| P1 | P1 | 微信回调“继续支付”createOrder超时/5xx后恢复按钮可用，重复点击可能创建第二笔订单 | creationStarted锁定不确定写入；明确400/401/403/404/405/422/429拒绝才开放重试；错误提示要求先查订单。测试验证503/无状态只发1次、422可重试 |
| P2 | P1 | PaymentRoute读取恢复缓存只核对订单ID，未传当前owner；换账号时仍保留旧订单/请求/支付secret，迟到创建可能按新owner保存 | readRecovery必须匹配owner；换号清空checkout/lookup/回调请求，取消读取并清理握手；迟到响应不展示或保存。测试覆盖另一owner缓存、late getOrder、late createOrder |

`api/auth.ts`的变更是A1/A4所必需：若API适配层先写localStorage，仅在store内加代次无法阻止迟到响应污染存储。接口路径、请求body、认证协议未变；只有可选的客户端持久化控制参数与缺少token校验。默认logout也会比对调用时的access token再清理，避免其完成时误清新登录。

## 跨边界问题与授权续作

### X1 · P1 · WalletApp首次下单未知失败后可重复创建（授权续作已修复）

位置：`packages/sub2-console/src/apps/user/WalletApp.vue`，`submitPayment`、`handleCreateRechargeOrder`、`createSubscription`。初次复核只读交接，用户随后明确授权本线编辑WalletApp并新增专项；本次已完成修复。

确定调用链：createOrder已到服务端但返回超时/503 → submitPayment重新抛错 →充值/订阅外层finally把submitting设false → 下一次点击重新createOrder。现有代次仅防止跨账号展示，未解决未知提交重放。

修复：共享submitPayment在POST前建立防重标记；超时/网络错误/5xx/无有效订单响应均保持未知状态，充值、订阅与二维码降级不能绕过。明确400/401/403/404/405/422/429拒绝允许重试；有效订单成功或官方oauth_required响应恢复正常流程。

恢复：界面持续提示核对订单；仅成功读取当前账号的未筛选第一页订单后，才能打开独立确认框，由用户明确确认允许重新下单。读取失败、无效响应、过滤列表和单纯刷新均不会自动解锁；前端不根据空列表断言服务端没有订单。账号专属sessionStorage只保存一个布尔标记，不保存金额、令牌或支付凭据，可防止同一标签关闭重开钱包/刷新后重放；存储不可用时仍保留当前组件内存防重。用户清除浏览器存储、新标签或跨设备不构成服务端幂等保证。

账号切换同步失效旧创建与订单读取；旧catch/finally不能清除新账号的提交锁或未知标记。若旧账号请求在切换后才返回，其标记保守保留，重新进入旧账号需核对。

本次仅修改WalletApp、增加`scripts/wallet-unknown-order.test.cjs`、更新本文X1及对应结论。执行：

```powershell
node --test scripts/wallet-unknown-order.test.cjs scripts/parity-payments.test.cjs
```

**66/66通过、0失败、0跳过**：钱包专项16项，原支付回归50项。覆盖充值/订阅三类未知失败、明确拒绝、二维码绕过防护、无效成功响应、合法OAuth响应、直接并发调用、关闭重开/owner隔离、读失败禁解锁、人工确认、换号后迟到响应。实际运行Wallet setup及真实payment helper，网络和存储均隔离夹具；Vue真实SFC脚本/模板编译通过。未新增真实下单、全局构建或浏览器验收。**X1文件已冻结，X2未触碰也未标为已修。**

#### X1最终交接与打包收口

2026-09-12主任务反馈（本线未重新执行）：发现`wallet-unknown-order.test.cjs`不符合parity命名，原打包白名单漏带；主任务已将默认测试入口改为`test-parity --all`收集全部测试，并使源码包包含全部`*.test.cjs`。本线保留专项原名，无需改名或重复增加测试文件。

主任务报告的当前结果：全部测试含core与wallet为**475通过、1跳过**；干净源码包内parity为**396通过、1跳过**。两组统计范围不同，后者不作为钱包专项再次执行的证据。本线钱包专项及原支付回归仍以实际执行的**66/66通过**为依据。主任务反馈时干净源码构建仍在进行，本文不将其写为构建成功。

**X1已完成代码、专项测试、报告及打包交接，现正式冻结。** 本次仅补写本段报告，不修改WalletApp、测试、测试入口或打包配置。X2由主任务另行修复验证，不属于本线X1修复成果。

### X2 · P1 · 共享HTTP客户端部分401分支仍可清除新会话

位置：`packages/sub2-console/src/api/client.ts`，401处理中的“No refresh token or is auth endpoint”分支（当前约223行以后），与上方已保护的refresh失败分支不同。本线未编辑共享客户端。

确定调用链：旧账号请求仍在途 → 用户已换号/新会话已保存 → 旧请求401进入无refresh或auth endpoint分支 → 无条件removeItem(auth_token/refresh_token/auth_user/token_expires_at)，可使新会话消失并跳转登录。此分支只计算sentAuth是否存在，没有核对发起请求的Authorization与当前token是否一致。上方refresh分支已有snapshot比较，并不能覆盖这个分支。

主任务需在清理/重定向前核对请求身份与当前会话；旧请求仅拒绝自身，不清理或跳转新会话。添加真实interceptor隔离用例（A请求401晚于B登录）。**本线API适配器测试替代HTTP传输，不会自动覆盖共享interceptor，因此A1修复不能当作X2已解决。**

## 只读复核中未发现新确定bug的部分

- 公开数据：`api/public.ts`使用独立fetch，credentials=omit、redirect=error、cache=no-store、referrerPolicy=no-referrer；输入API Key仅在Authorization头，不在URL/持久存储；不使用管理员认证拦截器。
- 公开页面：PublicPages/PublicCatalog的身份/路由改变会清理内容并作废旧请求；自定义菜单按身份与visibility筛选；KeyUsage清除/换key作废旧结果。
- 富文本：content.ts先DOMPurify再重建白名单；剥离脚本、表单、iframe、事件与远程媒体；外链拒绝危险scheme、反斜杠/控制字符及URL凭据，并设置noopener/noreferrer；图片限制当前slug下的固定API目录。
- 回调：safeAuthRedirect限制同源相对路径并拒绝协议相对、编码反斜杠/控制字符；登录callback只认确切认证路径，支付callback不作为登录callback；清除地址中的一次性凭证后再异步恢复。OAuth state交换仍由官方后端验证，未在前端伪造兑换。
- 支付结果：仅后端COMPLETED触发完成，URL的status=success不可信；PAID/RECHARGING继续查询；Stripe握手同时验证origin和source；SDK成功仅触发后端查询。
- 现有二维码降级：显式确认→读取原订单→取消→再次确认CANCELLED→新建；不重放微信openid/resume token；未知新建结果已阻断重试。
- 安全设置：Passkey/TOTP原有流程对读取失败禁写、提交防重、密码/设置secret清理已有测试。跨账号全窗口销毁的实际浏览器顺序仍需主任务验证；本轮没有重构这些未发现确定缺陷的组件。

以上是前端源码和隔离测试结论，不是后端权限/数据脱敏审计或真实资金验收；没有实际浏览器渲染新证据。

## 旧认证测试修复

用户给出的基线：`output/review-20260912/baseline-tests.txt`，safeAuthRedirect未定义。

`scripts/m03-auth.test.cjs`的VM剥离imports，旧Lockscreen夹具未补新auth依赖。现加载并执行真实`api/auth.ts`（仅替代存储/网络边界），向Lockscreen注入真实safeAuthRedirect、callback和其他认证helper；没有以空函数替代安全逻辑。

同时修正两处过时测试假设：验证码现已支持第三方组件，改为验证缺少证明时不发注册/验证码请求，而非断言功能永远禁用；DOM input夹具实现closest，键盘事件按真实元素行为执行。OAuthBindings旧夹具补上实际应存在的user.id，与响应ID核验匹配，未删除权限/确认断言。

## 验证结果与复现

1. `pnpm test`：**63/63通过，0跳过**。包括默认旧M03、M04、settings-form以及已有core窗口测试；未改core文件。
2. `scripts`全部`*.test.cjs`：**443项，442通过，0失败，1跳过**。包含全部parity与旧测试，不是只跑parity。跳过的是可选public真实浏览器测试，由主任务安排browser。

```powershell
pnpm test
$reviewTests = @(Get-ChildItem -LiteralPath scripts -Filter '*.test.cjs' | ForEach-Object { $_.FullName })
node --test @reviewTests
```

新增12项review回归：8项认证（缺token、缺user、TOTP、logout/login竞争、external竞争、延迟撤销、callback取消/延后持久化、解绑跨账号），4项支付（未知POST防重、恢复owner、换号晚创建、换号晚读取）。实际执行生产函数/API适配器/Vue setup；不连接真实业务网络。

本线未运行全局vue-tsc/build、真实浏览器或重新打包，交由主任务。建议主任务浏览器重点复核：A登录请求在途→退出→B登录；OAuth callback完成前关闭；TOTP六位登录；微信回调createOrder超时后按钮不可重复下单；切换账号时支付secret和恢复入口消失。

## 本轮准确修改文件（9个）

1. `packages/sub2-console/src/stores/auth.ts`
2. `packages/sub2-console/src/api/auth.ts`
3. `packages/sub2-console/src/apps/user/settings/OAuthCallbackPanel.vue`
4. `packages/sub2-console/src/apps/user/settings/OAuthBindingsPanel.vue`
5. `packages/sub2-console/src/apps/user/payments/PaymentRoute.vue`
6. `scripts/m03-auth.test.cjs`
7. `scripts/parity-auth.test.cjs`
8. `scripts/parity-payments.test.cjs`
9. `docs/frontend/REVIEW_AUTH_PAYMENT_20260912.md`

保留所有Accounts、core、main、package及其他并行修改。公共页完成只读复核和现有测试复跑，无无依据修改。
