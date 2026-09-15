# PARITY-PAYMENTS · 支付功能缺口卡

更新：2026-09-12。状态：本线功能与隔离验收完成；真实支付、真实账户、提供商 SDK 和后端 0.2.1 的实际兼容性未验收。主任务已确认使用 `isPaymentRoute(URL)` 接主入口，本线未修改 main/App/manifest/auth/package/lock/server/真实配置，也未运行全局 build。

## 来源与实施边界

只读上游：`output/parallel-20260911/upstream/frontend`，0.2.4 / HEAD 98d86915。逐项核对 PaymentView、StripePaymentView、StripePopupView、AirwallexPaymentView、PaymentQRCodeView、PaymentResultView、auth/WechatPaymentCallbackView、paymentWechatResume、paymentFlow、StripePaymentInline、alipayDeepLink。下单/取消/查询均使用既有 payment API，不复制后端签名、金额计算、授权或入账逻辑。

保持 macOS 图标、玻璃和共享 MacSheet/MacAlertSheet/MacButton。API 类型已具备所需官方字段，`types/payment.ts` 未修改；Stripe/Airwallex 依赖由主任务统一安装。

## 已实现的实际路径

| 分支 | 具体行为 |
| --- | --- |
| 钱包下单 | 固定既有 amount/payment_type/order_type/plan_id 契约，增加 return_url、is_mobile、payment_source；响应缺 payment_type 时保留原选择；订单创建防重入、关闭/换号隔离旧响应。 |
| Stripe | 按需 loadStripe，Payment Element、支付宝、微信支付分支；SDK 成功仅触发后端查询；同源弹窗 READY/INIT 双向 origin/source 校验，15秒初始化超时，弹窗被阻止时有当前页恢复；销毁 SDK element、移除监听。 |
| Airwallex | 按需 init + redirectToCheckout，传 intent_id/client_secret/currency/country_code/successUrl；保持 demo/prod 契约；卸载后不跳转；外部返回 URL 只接受无嵌入凭据的 HTTP(S)。 |
| 微信 OAuth | query/hash 返回，hash优先；wechat_resume_token优先，兼容旧openid与同源redirect中的金额/套餐；显式点击继续才下单，签名token使用amount=0由后端恢复；成功后剥离URL恢复凭据，不改全局身份。 |
| 微信 JSAPI | jsapi/jsapi_payload；两种BridgeReady；区分ok/cancel/失败/空响应/60秒超时；SDK等待时付款按钮禁重复，但允许关闭共享Sheet，卸载中止监听与异步结果。 |
| 结果与二维码 | 服务端PENDING才显示付款入口；PAID/RECHARGING持续入账中，COMPLETED才通知成功；过期/取消/失败/退款隐藏付款入口；限次非并发轮询，旧响应隔离，手动查询可恢复；取消使用共享确认层。 |
| 移动支付下单失败 | 钱包仅对官方已知移动支付错误 reason 暴露“改用二维码支付…”；不会自动再次POST。未返回订单ID时确认层明确提示先核对订单记录，用户再点“新建二维码订单”才提交。 |
| JSAPI/移动支付二维码降级 | SDK取消/失败/超时/不可用或付款信息缺失时提供明确入口。用户确认后先GET原订单，从真实amount/order_type/plan_id建立上下文；PENDING先取消并再次GET，只有确认CANCELLED才新建；已PAID/RECHARGING/COMPLETED/退款处理则停止。原订单已CANCELLED/EXPIRED/FAILED可在同一明确确认下创建新单。 |
| 降级新订单约束 | 白名单payload只含金额、类型、套餐、支付方式、return_url、`is_mobile:false`、`payment_source:'hosted_redirect'`；不重放openid/wechat_resume_token。取消失败、状态竞态、关闭/卸载均停止后续创建；单次提交互斥。创建POST结果不确定后锁定本次重试，即使关闭再打开当前确认层也不再次POST。新单若未返回二维码仍展示该订单，不丢弃或暗中再下单。 |
| 支付宝唤起与回退 | 后端显式启用预创建深链接、支付宝方法和移动端才提供App入口；用户点击后进入launching，普通浏览器2200ms、微信/QQ300ms回退到同一二维码；visibilitychange/pagehide标记切后台并清定时器；返回可见或pageshow只触发后端查询，不把切App判为支付成功；换单/卸载清理事件和计时器。没有自动新建支付宝订单。 |

二维码备用确认使用独立共享Sheet，显示时隐藏原收银Sheet，避免叠层重影及后台继续付款。用户不确认时无取消、无新建请求。

## 跨设备恢复：能做什么，不能做什么

| 实际已有输入 | 可实现路径 | 限制 |
| --- | --- | --- |
| resume_token | 公开resolve查询；提供商落地页未登录时也转为公开结果查询 | 必须后端支持并接受该签名；过期/404不视为成功 |
| out_trade_no | 已登录verify，未登录public verify；保留旧版回跳兼容 | 后端需提供对应接口，交易号本身不提供付款载荷 |
| 仅order_id | 登录后getOrder查询；未登录提示在钱包登录后查询 | 不绕过认证、不触发无认证getOrder造成全局注销 |
| 本浏览器最近订单快照 | 校验orderId/token/trade、24h年龄、金额/字段类型；钱包另按owner隔离；提供商落地先GET订单再用已有付款载荷 | 只有最近一份快照；不跨设备同步，不是多订单凭据仓库 |
| 官方Stripe链接已有client_secret | 登录getOrder后使用既有合法参数进入Stripe；不会从订单ID生成secret | 实际SDK是否接受该secret仍由提供商判断 |
| 官方QR链接已有qr/pay_url | 查询真实订单后使用既有二维码/安全链接 | 不以URL金额或status=success认定成功 |
| 新设备缺Airwallex secret/intent、Stripe secret、JSAPI签名或原二维码 | 显示无法恢复付款信息，保留订单查询；微信/支付宝可以在真实订单上下文及用户确认下取消旧单、新建二维码单 | getOrder当前契约不返回这些凭据；前端无法重建，不发明字段、secret、签名或后端接口 |

公开resolve/verify使用仅限这两个接口的无账户Authorization、无跨域凭据axios请求，解包既有code/data，不触发全局401注销/跳转。只读回跳参数或SDK succeeded均不能产生paid事件。

**不可承诺的防重边界**：已有订单取消并回读可防止界面主动保留两笔待支付订单；创建POST失败后本组件禁止盲重试。但当前契约没有前端可用的创建幂等键或“原订单→备用订单”原子关联。跨设备、刷新清空运行状态、并行标签或网络丢失响应下的全局exactly-once无法由前端保证。提示用户查订单，不能擅造幂等字段或假定取消能追回提供商已发生的付款。迟到的支付通知仍需后端处理。

## 主任务根入口

`packages/sub2-console/src/apps/user/payments/PaymentRoute.vue`，提供Pinia和现有全局样式。匹配函数为同目录 `flow.ts` 的 `isPaymentRoute(new URL(location.href))`，应在强制桌面登录之前匹配：

- `/payment/result`、`/payment/qrcode`、`/payment/stripe`、`/payment/stripe-popup`、`/payment/airwallex`
- `/auth/wechat/payment/callback`
- `/purchase`、旧别名`/payment`仅在query/hash包含wechat_resume=1、wechat_resume_token或openid时匹配

普通/purchase继续桌面钱包；不接管账户/auth/wechat/callback。支持尾斜杠。根组件不需要新Router或额外依赖。生产反代/history fallback与微信后台回调目标仍需主任务部署验收。

## 可复跑验收与结果

1. `node --test scripts/parity-payments.test.cjs`：**46/46通过**。实际TS/Vue脚本执行及5个SFC编译；含状态机、防重、取消竞态、错误、超时、卸载、旧响应隔离、公开接口、跨设备缺凭据、SDK加载失败等。
2. `npx --yes --package=playwright -c "node scripts/parity-payment-browser.js"`：**23组浏览器夹具通过**。也可安装Playwright后直接node执行；可用PLAYWRIGHT_MODULE指定模块，PLAYWRIGHT_CHROME指定浏览器路径。未修改package/lock。
3. `pnpm --filter @sub2-mac/console typecheck`：**本轮通过（exit 0）**。历史CommerceApp等并行错误不代表本轮最终状态。未跑全局build。

浏览器脚本创建独立headless浏览器context、临时Vite缓存和本次本地服务，finally关闭本次browser/server并清理临时缓存。使用真实PaymentRoute/Wallet/Checkout/ProviderPayment/QrFallbackSheet和共享组件，复用isPaymentRoute；测试专用Vite插件替换Stripe/Airwallex动态模块和App导航适配器，不在产品代码内塞测试全局后门。所有API由Playwright拦截，任何外部请求或未声明API都会失败；真实接口调用为0。

覆盖Stripe取消/失败/SDK成功但服务器PENDING、PAID/RECHARGING/COMPLETED、微信取消/失败/用户确认与取消确认、原订单已支付竞态阻止创建、创建响应不确定阻止重试、二维码新单完成、支付宝超时/切后台/返回查询、Airwallex失败及受控返回、钱包下单错误后的显式QR创建、跨设备有无凭据、JSAPI关闭与60秒超时、深色390px不越界。SDK替身仅挂载测试输入元素，**不是第三方真实iframe**；不能把这些检查写成真实Stripe Elements视觉/卡校验通过。

产物：`output/playwright/parity-payments/results.json`（passed=true；23 checks；pageErrors=[]；forbidden=[]）。截图已人工检查：wechat-fallback-confirm-mobile.png、wechat-qr-completed-mobile.png、stripe-dark-mobile.png、stripe-completed.png；另有alipay-return-completed.png。确认层曾发现重影并修复，当前截图只显示一层收银/确认。失败调试文件若存在属于早期排查，最终结果以results.json为准。

## 未验收与真实不可实现边界

- 未操作真实账户/支付/取消/退款/配置/升级；外部SDK、真实微信Bridge/OAuth、支付宝实际App唤起、Webhook入账均未实测。
- 0.2.1后端是否支持上述0.2.4公开查询/OAuth/source字段需要真实集成环境验证；不以类型或HTTP夹具证明兼容。
- 前端无法恢复服务端未返回、浏览器又已丢失的secret/签名；只能查询状态或经用户确认使用真实订单上下文重新下单。
- 未验证真实第三方iframe焦点、支付应用跨进程行为、生产回调域名、跨origin存储/SSO。
- 浏览器夹具通过真实组件专用入口执行，不是主任务main.ts、全桌面应用数量或生产包的集成验收。

## 修改文件

本任务总白名单：

- `packages/sub2-console/src/apps/user/WalletApp.vue`
- `packages/sub2-console/src/apps/user/CheckoutSheet.vue`
- `packages/sub2-console/src/apps/user/payments/flow.ts`
- `packages/sub2-console/src/apps/user/payments/wechat.ts`
- `packages/sub2-console/src/apps/user/payments/usePaymentStatus.ts`
- `packages/sub2-console/src/apps/user/payments/ProviderPayment.vue`
- `packages/sub2-console/src/apps/user/payments/PaymentRoute.vue`
- `packages/sub2-console/src/apps/user/payments/qrFallback.ts`（本轮新）
- `packages/sub2-console/src/apps/user/payments/QrFallbackSheet.vue`（本轮新）
- `packages/sub2-console/src/apps/user/payments/alipayLauncher.ts`（本轮新）
- `packages/sub2-console/src/apps/user/payments/navigation.ts`（本轮新，正常App导航函数，测试仅在Vite插件替换）
- `packages/sub2-console/src/api/payment.ts`（前轮公开请求修订，本轮未改）
- `scripts/parity-payments.test.cjs`
- `scripts/parity-payment-browser.js`（本轮新增、用户明确授权）
- `docs/frontend/PARITY_PAYMENTS.md`

本轮未改flow.ts/wechat.ts/usePaymentStatus.ts及types/payment.ts；仅复用现有实现。按独占约束将状态、验证、未完成项回写本卡，未改共享EXECUTION_PLAN或UPSTREAM_PARITY。
