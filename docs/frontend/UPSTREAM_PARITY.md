# 官方功能对照与更新兼容（M04）

## 2026-09-12 当前增量（优先于下方历史表）

下方路由表为早期审计快照，不能据其中“缺失”直接判定当前代码。当前增量以PARITY_SETUP、PARITY_BATCH_IMAGE、PARITY_POLICIES、PARITY_OPERATIONS、PARITY_ACCOUNTS、PARITY_AUTH、PARITY_PAYMENTS、PARITY_PUBLIC各卡为准，整体未标记完整官方验收。

- `/setup`已实现四步首次安装流程与专用代理，7项隔离测试/7项浏览器场景通过；未对真实后端安装。
- `/batch-image`及`/docs/batch-image`已接`batch_image`桌面应用，包含任务操作及完整Agent使用说明；不再以Safari静态假定模型列表代替。
- public/支付独立入口、官方桌面深链接、登录后目标恢复、用户公告启动弹窗已接入；26个应用主页面浅/深/390px巡检通过。
- 渠道features_config、用户属性筛选/批量/创建联动、分组多媒体定价与Codex manifest已新增，接口/差异payload见PARITY_POLICIES。
- 运维邮件告警/运行参数、审核密钥池及解封、分布与实时统计已新增，后续高级项见PARITY_OPERATIONS。
- Grok授权及账号模型/配额/RPM策略已有代码实现，旧账号报告部分行尚未计入；特殊批量授权仍在继续补齐。
- 当前所有“已实现”仍不代表本机后端0.2.1支持0.2.4全部能力，不代表支付/写入/升级业务验收成功。

核验日：2026-09-11（Asia/Shanghai）。本文件是源码覆盖与只读 HTTP 核验，不是业务验收。已增量合入 M01-RESULT.md、M03-RESULT.md 的交付事实，并只读核对主任务官方入口接线。M01/M03 的静态/夹具通过不等于真实后端或浏览器验收；M02 后续结果仍需增量复核。

## 结论与口径

- 桌面是独立 Vue 3/Pinia 应用：`src/main.ts` 仅挂载 App，`apps/manifest.ts` 注册窗口，不导入官方 router/views。保留 23 个应用不能证明官方全部功能覆盖。API 文件存在也不代表 UI 消费了它。
- 已实现 = 表中限定操作有真实 API 调用与可见入口；部分 = 有功能但缺字段/流程/独立路由，或尚未完成全部操作核对；缺失 = 当前源码未发现对应视图/流程。三者都不代表真实业务数据测试通过。
- 上游只读参考 `output/parallel-20260911/upstream/frontend`，HEAD `98d86915becae9fe9491a91ffc6defd5235c8d2b`，本地 refs 为 `main/origin/main`，提交标题 `chore: sync VERSION to 0.2.4 [skip ci]`。没有把 main 的版本当作运行二进制或 GitHub 最新发行版。
- `http://127.0.0.1:8000/api/v1/settings/public` 实测 HTTP 200，业务 code=0，version=`0.2.1`。控制台 package.json 的 `1.0.0` 是独立前端版本。运行二进制的构建 commit / 签名 / build_type 未通过公共接口确定。

## 全部上游路由逐项对照

证据根：U = `output/parallel-20260911/upstream/frontend/src/`；L = `packages/sub2-console/src/`。每条 U 行号为 `router/index.ts` 定义；视图来自同一配置段。L 为可审阅文件，关键操作在下一节展开。

| 官方路径 / 路由证据 | 上游视图或重定向 | 状态 | 本地入口/证据 L | 实际覆盖与缺口 |
| --- | --- | --- | --- | --- |
| `/setup` · U router:23 | views/setup/SetupWizardView.vue | 缺失 | — | 首次安装向导未移植；不应让桌面接管官方安装入口 |
| `/home` · U router:34 | views/HomeView.vue | 缺失 | — | 自定义首页/紧凑首页不是桌面壁纸 |
| `/login` · U router:43 | views/auth/LoginView.vue | 部分 | components/MacLockscreen.vue | 邮箱/密码、TOTP；第三方、Passkey、验证码和条款流程未齐 |
| `/register` · U router:53 | views/auth/RegisterView.vue | 部分 | components/MacLockscreen.vue | M03 已支持邮箱验证码/邀请码、确认密码、重发倒计时与精确payload；第三方验证码/协议仍限制入口 |
| `/email-verify` · U router:63 | views/auth/EmailVerifyView.vue | 部分 | components/MacLockscreen.vue | M03 锁屏注册内已消费邮箱验证码；官方独立 email-verify 路由/落地恢复未移植 |
| `/auth/callback` · U router:72 | views/auth/OAuthCallbackView.vue | 缺失 | — | 通用 OAuth 回调没有路由消费者 |
| `/auth/linuxdo/callback` · U router:83 | views/auth/LinuxDoCallbackView.vue | 缺失 | — | LinuxDo 回调未接 |
| `/auth/wechat/callback` · U router:93 | views/auth/WechatCallbackView.vue | 缺失 | — | 微信登录回调未接 |
| `/auth/wechat/payment/callback` · U router:103 | views/auth/WechatPaymentCallbackView.vue | 缺失 | — | 微信支付授权回调未接 |
| `/auth/dingtalk/callback` · U router:113 | views/auth/DingTalkCallbackView.vue | 缺失 | — | 钉钉回调未接 |
| `/auth/dingtalk/email-completion` · U router:123 | views/auth/DingTalkEmailCompletionView.vue | 缺失 | — | 钉钉补邮箱流程未接 |
| `/auth/oidc/callback` · U router:132 | views/auth/OidcCallbackView.vue | 缺失 | — | OIDC 回调未接 |
| `/forgot-password` · U router:142 | views/auth/ForgotPasswordView.vue | 缺失 | — | 忘记密码入口/邮件流程未接 |
| `/reset-password` · U router:152 | views/auth/ResetPasswordView.vue | 缺失 | — | 邮件 token 落地页未接 |
| `/key-usage` · U router:161 | views/KeyUsageView.vue | 缺失 | — | 匿名密钥用量查询不等于登录后的使用记录 |
| `/legal/:documentId` · U router:170 | views/public/LegalDocumentView.vue | 缺失 | — | 管理员编辑条款不等于公开法律文档阅读页 |
| `/model-plaza` · U router:179 | views/ModelPlazaView.vue | 部分 | apps/user/AppStoreApp.vue | M01 新增分组筛选与共享定价Sheet，区分Token/按次/图片倍率；匿名入口、完整官方阶梯对比及扩展字段未齐 |
| `/` · U router:191 | redirect /home | 部分 | App.vue | 官方按身份重定向；本地为桌面入口 |
| `/dashboard` · U router:195 | views/user/DashboardView.vue | 部分 | apps/user/DashboardApp.vue | 用户汇总、趋势、最近记录/配额；不以图表数量证明全量指标一致 |
| `/keys` · U router:207 | views/user/KeysView.vue | 部分 | apps/user/KeyChainApp.vue | CRUD、分组、状态、期限/额度、完整加载；细分限制字段仍需逐项比对 |
| `/batch-image` · U router:219 | views/user/BatchImageGuideView.vue | 部分 | apps/user/SafariApp.vue | 存在静态批量生图说明；不是官方 BatchImageGuideView 完整内容同步 |
| `/usage` · U router:232 | views/user/UsageView.vue | 部分 | apps/user/ActivityApp.vue | 筛选、明细、分页 CSV、错误详情已接；不含管理用量能力 |
| `/redeem` · U router:244 | views/user/RedeemView.vue | 已实现 | apps/user/VoucherApp.vue | 兑换提交、余额/订阅结果和兑换历史；仅源码实现证据 |
| `/affiliate` · U router:256 | views/user/AffiliateView.vue | 部分 | apps/user/WalletApp.vue | 返佣信息、邀请链接、额度转入已接；并非缺失模块 |
| `/available-channels` · U router:268 | views/user/AvailableChannelsView.vue | 部分 | apps/user/NetworkApp.vue | M01 接共享定价Sheet，倍率读取失败明确提示；功能开关及公开入口仍需核对 |
| `/profile` · U router:280 | views/user/ProfileView.vue | 部分 | apps/user/SettingsApp.vue | M03 接TOTP启停/凭证过期、账户邮箱绑定，修复密码提交；Passkey、第三方绑定列表/流程未齐 |
| `/subscriptions` · U router:292 | views/user/SubscriptionsView.vue | 部分 | apps/user/SubscriptionsApp.vue | M01 改为列表/详情分栏，搜索筛选及暂停/到期/单次额度语义；购买定位Wallet套餐页，不是自动续费 |
| `/purchase` · U router:304 | views/user/PaymentView.vue | 部分 | apps/user/WalletApp.vue | 充值与订阅下单、通用收银 Sheet；不含各支付 SDK 完整流程 |
| `/orders` · U router:317 | views/user/UserOrdersView.vue | 部分 | apps/user/WalletApp.vue | M01 新增25条服务端分页、状态筛选、乱序保护与失效页回退；独立订单路由与回跳未接 |
| `/payment/qrcode` · U router:329 | views/user/PaymentQRCodeView.vue | 部分 | apps/user/CheckoutSheet.vue | M01 隔离换单后的旧二维码/查询响应，非待支付状态隐藏付款入口；独立路由恢复未接 |
| `/payment/result` · U router:341 | views/user/PaymentResultView.vue | 部分 | apps/user/CheckoutSheet.vue | M01 完成通知去重，入账中/失败/退款等状态不再保留旧付款码；独立支付结果地址未接 |
| `/payment/stripe` · U router:353 | views/user/StripePaymentView.vue | 缺失 | — | StripePaymentView/SDK 专用收银页未移植 |
| `/payment/airwallex` · U router:365 | views/user/AirwallexPaymentView.vue | 缺失 | — | AirwallexPaymentView/SDK 专用收银页未移植 |
| `/payment/stripe-popup` · U router:377 | views/user/StripePopupView.vue | 缺失 | — | Stripe 弹窗返回协议未移植 |
| `/custom/:id` · U router:388 | views/user/CustomPageView.vue | 缺失 | — | 无按 custom_menu_items 动态解析的页面 |
| `/admin` · U router:401 | redirect /admin/dashboard | 部分 | App.vue | 官方重定向；本地角色策略加载桌面 |
| `/admin/dashboard` · U router:405 | views/admin/DashboardView.vue | 部分 | apps/user/DashboardApp.vue | 管理员汇总/趋势/平台视图；字段和交互未全量核对 |
| `/admin/ops` · U router:417 | views/admin/ops/OpsDashboard.vue | 部分 | apps/admin/OpsApp.vue | 只接运行概览；告警规则/通知/错误重试/日志等不等价 |
| `/admin/audit-logs` · U router:429 | views/admin/AuditLogView.vue | 部分 | apps/admin/SecurityApp.vue | 日志筛选、分页、详情和 TOTP 清理已接，非缺失 |
| `/admin/users` · U router:441 | views/admin/UsersView.vue | 部分 | apps/admin/UsersApp.vue | 基本 CRUD、余额、密钥和允许分组；平台额度/自定义属性/批量编辑未齐 |
| `/admin/groups` · U router:453 | views/admin/GroupsView.vue | 部分 | apps/admin/GroupsApp.vue | CRUD/复制/倍率/RPM；推理策略、模型定价、用户覆盖未齐 |
| `/admin/channels` · U router:465 | redirect /admin/channels/pricing | 部分 | apps/admin/ChannelsApp.vue | 对应渠道标签，官方重定向到 pricing |
| `/admin/channels/pricing` · U router:469 | views/admin/ChannelsView.vue | 部分 | apps/admin/ChannelsApp.vue | 基础渠道表单；平台模型定价、映射、账单规则未齐 |
| `/admin/channels/monitor` · U router:481 | views/admin/ChannelMonitorView.vue | 部分 | apps/admin/ChannelsApp.vue | 监控列表/CRUD/启停/手动检测；高级提供商与调度字段待验 |
| `/monitor` · U router:493 | views/user/ChannelStatusView.vue | 部分 | apps/user/NetworkApp.vue | M01 接节点详情、7/15/30天可用率与当前/平均延迟，修复0–100百分数；时间轴/轮询/匿名路由未齐 |
| `/admin/subscriptions` · U router:504 | views/admin/SubscriptionsView.vue | 部分 | apps/admin/SubscriptionsApp.vue | 分配/延期/撤销/恢复/配额重置；批量和用户选择完整性待验 |
| `/admin/accounts` · U router:516 | views/admin/AccountsView.vue | 部分 | apps/admin/AccountsApp.vue | CRUD/测试/批量/导入导出/CRS；OAuth 重授权/定时测试/TLS 等未齐 |
| `/admin/plugins` · U router:528 | views/admin/PluginsView.vue | 部分 | apps/admin/PluginsApp.vue | 列表/上传/启停/卸载；需插件详情、权限等逐项验证 |
| `/admin/announcements` · U router:540 | views/admin/AnnouncementsView.vue | 部分 | apps/admin/AnnouncementsApp.vue | 创建/编辑/删除、状态、通知方式；用户端阅读闭环仍待核验 |
| `/admin/proxies` · U router:552 | views/admin/ProxiesView.vue | 部分 | apps/admin/ProxiesApp.vue | 创建/批量导入删除/测试/质量/关联账号/启停；编辑能力未齐 |
| `/admin/redeem` · U router:564 | views/admin/RedeemView.vue | 部分 | apps/admin/CommerceApp.vue | 生成/列表/导出；批量与兑换详情未全量移植 |
| `/admin/promo-codes` · U router:576 | views/admin/PromoCodesView.vue | 部分 | apps/admin/CommerceApp.vue | 列表/创建；上游编辑/删除/使用记录未齐 |
| `/admin/settings` · U router:588 | views/admin/SettingsView.vue | 部分 | apps/user/SettingsApp.vue | 多模块设置、备份、网关、更新已接；不能等同官方全部配置字段 |
| `/admin/risk-control` · U router:600 | views/admin/RiskControlView.vue | 部分 | apps/admin/SecurityApp.vue | 配置/状态/日志；日志只取前20条等缺口 |
| `/admin/prompt-audit` · U router:613 | features/prompt-audit/PromptAuditView.vue | 部分 | apps/admin/SecurityApp.vue | 事件筛选/分页、配置；完整 Endpoint 草稿/检查流程待验 |
| `/admin/usage` · U router:626 | views/admin/UsageView.vue | 缺失 | apps/user/ActivityApp.vue | 现有 Activity 调 user usage API，未见独立 admin usage 界面消费者 |
| `/admin/affiliates` · U router:638 | redirect /admin/affiliates/invites | 部分 | apps/admin/CommerceApp.vue | 对应返利标签；官方父路径重定向 |
| `/admin/affiliates/invites` · U router:642 | views/admin/affiliates/AdminAffiliateInvitesView.vue | 部分 | apps/admin/CommerceApp.vue | 邀请记录分页/搜索已接 |
| `/admin/affiliates/rebates` · U router:654 | views/admin/affiliates/AdminAffiliateRebatesView.vue | 部分 | apps/admin/CommerceApp.vue | 返利记录分页/搜索已接 |
| `/admin/affiliates/transfers` · U router:666 | views/admin/affiliates/AdminAffiliateTransfersView.vue | 部分 | apps/admin/CommerceApp.vue | 转入记录分页/搜索已接；另有用户专属返利设置 |
| `/admin/orders/dashboard` · U router:681 | views/admin/orders/AdminPaymentDashboardView.vue | 部分 | apps/admin/CommerceApp.vue | 交易汇总已接；趋势、筛选和分币种完整性待验 |
| `/admin/orders` · U router:693 | views/admin/orders/AdminOrdersView.vue | 部分 | apps/admin/CommerceApp.vue | 详情、退款、取消、重试充值已接；完整运营筛选待验 |
| `/admin/orders/plans` · U router:705 | views/admin/orders/AdminPaymentPlansView.vue | 部分 | apps/admin/CommerceApp.vue | 套餐 CRUD/上下架已接；全部字段/排序待验 |
| `/:pathMatch(.*)*` · U router:719 | views/NotFoundView.vue | 缺失 | — | 无 Vue Router 404，未知路径可能仍渲染桌面 |

已逐项覆盖上游配置中的 64 条路径（包括重定向和 catch-all），不是按桌面应用数推算完成率。

## 页面内部操作对照（避免“同名页面=完整实现”）

以下按具体操作判断；证据使用源文件 + 函数/组件名，避免并行改动造成行号漂移。U/L 根沿用上表。已实现仅针对这一行，不上推到整页。

| 功能/操作 | 状态 | 上游证据 U | 本地证据 L / 缺口 |
| --- | --- | --- | --- |
| 用户密码登录、TOTP 第二步 | 已实现 | views/auth/LoginView.vue | components/MacLockscreen.vue `handleAction` → stores/auth；高级登录策略不在本行 |
| 简单邮箱密码注册 | 已实现 | views/auth/RegisterView.vue | MacLockscreen `basicRegistration`/`handleAction`；M03 另已支持邮箱验证码与邀请码，不再将这两项视作不支持 |
| 邮箱验证码/邀请码注册 | 已实现 | auth/RegisterView、EmailVerifyView | M03 MacLockscreen 校验邮箱/确认密码/6位验证码，按开关提交 verify_code/invitation_code，按countdown重发；8组隔离检查通过，未真实发邮件/注册 |
| 第三方验证码与登录/注册协议 | 缺失 | auth/LoginView、RegisterView | Turnstile/Tencent/Aliyun与协议流程仍缺；保守限制注册入口，不绕过要求 |
| Passkey 注册/登录/删除 | 缺失 | views/user/ProfileView.vue → components/user/profile/ProfilePasskeyCard.vue | SettingsApp 无 Passkey 卡；登录端亦无 WebAuthn 消费者 |
| 第三方登录/绑定/邮箱补全 | 缺失 | auth/*CallbackView、DingTalkEmailCompletionView；user/ProfileView | API 存在不能替代回调路由和绑定 UI |
| 管理员合规确认 | 已实现 | 官方管理鉴权/合规流程 | App.vue `checkAdminCompliance`、components/AdminComplianceSheet.vue；仅源码接线 |
| 密钥创建/编辑/删除/禁用/切组 | 已实现 | views/user/KeysView.vue | KeyChainApp `keysAPI.create/update/delete/toggleStatus` |
| 密钥列表全量页加载、保留未改字段 | 已实现 | views/user/KeysView.vue | KeyChainApp 分页 `keysAPI.list`；更新 payload 构造；N02 历史夹具非本轮业务验收 |
| 密钥所有限制策略和导入工具 | 部分 | views/user/KeysView.vue 及其组件 | 不能由 CRUD 推断 IP/模型等每项限制、CCS 工具全部一致，待字段级补表 |
| 用户用量筛选/明细/CSV 分页导出 | 已实现 | views/user/UsageView.vue | ActivityApp `usageAPI.query/getStats`、导出循环查询 |
| 用户失败请求列表/详情 | 已实现 | views/user/UsageView.vue | ActivityApp `listMyErrorRequests/getMyErrorDetail`；受后端开关控制 |
| 管理员全用户用量/清理工作流 | 缺失 | views/admin/UsageView.vue | ActivityApp 使用 user usage API；未发现 admin usage 视图消费者 |
| 兑换余额/订阅及历史 | 已实现 | views/user/RedeemView.vue | VoucherApp `handleRedeem/loadHistory` → redeemAPI |
| 模型广场/可用渠道价格 | 部分 | ModelPlazaView、user/AvailableChannelsView | M01 AppStore分组筛选 + 两页共用ModelPricingSheet：Token/按次/图片、缓存、阶梯/分时提示；公开入口、完整官方阶梯对比、Markdown说明和新增视频/缓存倍率字段未齐 |
| 用户订阅额度/期限/重置时间 | 已实现 | views/user/SubscriptionsView.vue | SubscriptionsApp `loadSubscriptions/getProgressWidth/formatResetCountdown`；M01 补暂停/未开始/到期区分、24h内单次日额度与每分钟计时；列表/详情分栏、搜索筛选已实现 |
| 充值/套餐下单、订单取消/退款申请 | 已实现 | PaymentView、UserOrdersView | Wallet `handleCreateRechargeOrder/createSubscription/confirmCancelOrder/handleRefundRequest`；无真实交易 |
| 二维码/支付链接、完成与入账中区分 | 已实现 | PaymentQRCodeView、PaymentResultView | CheckoutSheet `refresh` 区分 COMPLETED 与 PAID/RECHARGING；M01 generation 隔离换单旧成功/失败/busy，paid只通知一次并隐藏失效付款入口；无真实支付 |
| Stripe / Airwallex SDK、弹窗和返回落地 | 缺失 | StripePaymentView、StripePopupView、AirwallexPaymentView | CheckoutSheet 只有 QR/pay_url 与手动查询，明确提示原版收银台；SDK payload 不能当作通用链接 |
| 用户订单分页/筛选与响应隔离 | 已实现 | views/user/UserOrdersView.vue | M01 Wallet使用getMyOrders({page,page_size:25,status})；筛选回第一页、页数缩小回退、旧请求隔离、失败保留已有行；隔离逻辑通过 |
| 节点监控详情 | 部分 | components/user/MonitorDetailDialog.vue、composables/useChannelMonitorFormat.ts | M01 Network消费status(id)，展示7/15/30天可用率、当前/平均延迟；关闭/切换隔离旧响应；缺时间轴、模式切换、自动轮询 |
| 用户返佣详情/邀请复制/额度转入 | 已实现 | views/user/AffiliateView.vue | Wallet `loadAffiliateDetail/copyText/handleTransferQuota` |
| 头像/用户名/密码/通知邮箱 | 已实现 | user/ProfileView 及 profile 组件 | SettingsApp `saveAvatar/updateUsername/handleChangePassword/addExtraNotifyEmail/verifyExtraNotifyEmail`；M03 修复密码按钮提交，补账户邮箱 sendEmailBindingCode/bindEmailIdentity、资料未知禁写和敏感输入清理；通知邮箱其他流程未重新验收 |
| TOTP 设置 | 已实现 | components/user/profile/ProfileTotpCard.vue | M03 TotpSecurityPanel 已接状态/验证方式、密码或邮箱码验证、setup/二维码/手动密钥、启停、凭证过期禁写、状态重读及卸载清理；11组隔离行为通过，真实账户/键盘/视觉未验 |
| 用户基本 CRUD/余额/允许组/密钥查看 | 已实现 | admin/UsersView → UserCreate/Edit/Balance/AllowedGroups/ApiKeysModal | UsersApp `submitCreate/submitEdit/submitDeposit/saveAllowedGroups/openApiKeys` |
| 用户平台额度、自定义属性、批量编辑、余额历史 | 缺失 | UsersView 导入 UserPlatformQuotaModal、UserAttributesConfigModal、BulkEditUserModal、UserBalanceHistoryModal | UsersApp 未见对应完整弹层/操作链；M02 后续结果需增量复核 |
| 分组 CRUD/复制/基础倍率/RPM | 已实现 | admin/GroupsView | GroupsApp `submitCreate/submitEdit/handleDuplicate/saveQuickRate/saveQuickRpm` |
| 分组用户倍率/RPM 覆盖、推理策略、模型定价 | 缺失 | GroupsView → GroupRateMultipliersModal、GroupRPMOverridesModal、ReasoningEffortPolicyFields、PricingEntryCard | 简单倍率/RPM 字段不能替代这些策略配置 |
| 渠道基本 CRUD/状态/组关联 | 已实现 | admin/ChannelsView | ChannelsApp `saveChannel/handleToggleStatus/deleteChannelItem` |
| 渠道平台定价、模型映射、时间/区间价、账单规则 | 缺失 | ChannelsView `formToAPI/addPricingEntry/addMappingEntry/accountStatsRulesToAPI` | ChannelsApp 基础表单未接这些编辑器；已有后端字段不能假定可编辑 |
| 渠道监控 CRUD/启停/手动检查 | 已实现 | admin/ChannelMonitorView | ChannelsApp `saveMonitor/handleToggleMonitorEnabled/handleTriggerCheck` |
| 运维指标概览和周期刷新 | 已实现 | admin/ops/OpsDashboard | OpsApp `opsAPI.getDashboardOverview`，60 秒刷新 |
| 运维并发、趋势、告警规则/事件、系统日志、请求细节 | 缺失 | OpsDashboard 导入 OpsConcurrencyCard、OpsAlertRulesCard、OpsAlertEventsCard、OpsSystemLogTable、OpsRequestDetailsModal | OpsApp 只消费 overview，无这些独立运维交互 |
| 账号基本 CRUD、批量修改/删除/清错 | 已实现 | admin/AccountsView | AccountsApp `handleSaveAccount/handleBulkUpdateSubmit/confirmBatchDelete/handleBatchClearErrorSubmit` |
| 账号手动探测、导入导出、CRS 同步 | 已实现 | admin/AccountsView 及 ImportDataModal、SyncFromCrsModal | AccountsApp `handleProbeAccount/handleImportSubmit/handleExportData/handleSyncCrsSubmit`；不代表全平台 OAuth 创建 |
| 账号重授权、计划测试、TLS 指纹/错误透传规则 | 缺失 | AccountsView → ReAuthAccountModal、ScheduledTestsPanel、TLSFingerprintProfilesModal、ErrorPassthroughRulesModal | 当前 AccountsApp 无对应完整 UI；API 封装不能替代 |
| 管理订阅分配/延期/撤销/恢复/重置 | 已实现 | admin/SubscriptionsView | admin/SubscriptionsApp `subsAPI.assign/extend/revoke/restore/resetQuota` |
| 管理订阅用户选择完整性 | 部分 | admin/SubscriptionsView | admin/SubscriptionsApp 读取 `usersAPI.list(1,100)`；超过100用户选择可达性需修，不算后端问题 |
| 插件上传/启停/卸载 | 已实现 | admin/PluginsView | PluginsApp `handleFileSelected/togglePlugin/handleUninstall` |
| 公告 CRUD/通知参数 | 已实现 | admin/AnnouncementsView | AnnouncementsApp `handleSave/handleDelete`；用户阅读确认另验 |
| 代理创建/批量/测试/质量/关联账号 | 已实现 | admin/ProxiesView | ProxiesApp `batchCreate/batchDelete/testProxy/checkProxyQuality/getProxyAccounts` |
| 代理既有记录编辑 | 缺失 | admin/ProxiesView | 本地未见 `proxiesAPI.update` 消费者，创建不等于可编辑 |
| 操作审计筛选/详情/TOTP 清理 | 已实现 | admin/AuditLogView | SecurityApp `loadAuditLogs/viewLogDetail/handleClearLogs` |
| 内容审核配置/状态/历史分页 | 部分 | admin/RiskControlView | Security `getConfig/getStatus/updateConfig` 已接；listLogs 固定 page=1,page_size=20 |
| 提示词审计事件筛选/配置 | 部分 | features/prompt-audit/PromptAuditView.vue | Security `promptAuditAPI` 消费者已接；全部 endpoint 编辑/探测及事件操作未验 |
| 兑换码生成/列表/CSV | 已实现 | admin/RedeemView | Commerce `loadRedeem/submitGenerate/exportCSV`；全量导出范围另验 |
| 优惠码完整管理 | 部分 | admin/PromoCodesView `handleCreate/handleUpdate/handleDelete/handleViewUsages` | Commerce `loadPromo/submitCreatePromo`；缺编辑/删除/使用明细闭环 |
| 返佣邀请/返利/转入分页及专属用户设置 | 已实现 | admin/affiliates 三视图 | Commerce `loadAffiliateData/viewUserAffOverview/submitSaveAffSettings`，不是只有一个占位页 |
| 运营订单退款/取消/重试充值、套餐 CRUD | 已实现 | admin/orders 三视图 | Commerce `handleConfirmRefund/promptCancelOrder/handleRetryRecharge/submitSavePlan/promptDeletePlan`；真实写入未执行 |
| 系统全量配置、支付提供商和 OAuth 配置 | 部分 | admin/SettingsView → PaymentProviderList/PaymentProviderDialog | SettingsApp 的分模块映射是子集；保留未知字段并不等于提供了所有设置入口 |
| 系统版本/在线更新/回滚/重启调用 | 部分 | components/common/VersionBadge.vue、api/admin/system.ts | SoftwareUpdatePanel → 同路径 system API；本轮修源码构建门禁及独立版本读取；源连通/安装未验 |

## 本机真实只读证据

检查时间：2026-09-11 06:18 左右（Asia/Shanghai；响应 Date 为 2026-09-10 22:18 UTC）。仅 HTTP GET，无登录、浏览器操作、真实业务记录、升级、配置修改。

| 请求 | 结果 | 能证明/不能证明 |
| --- | --- | --- |
| `/api/v1/settings/public` | 200 JSON，code=0，version=0.2.1，site_name=Sub2API | 证明当前公共接口运行版本；不证明安装来源、main commit 或最新发行版 |
| `/` | 200 text/html，title=Sub2API - AI API Gateway，app 容器，官方 hashed entry | 官方风格 SPA 入口确实保留；未经浏览器登录及功能执行 |
| `/admin/dashboard` | 200 text/html，与根页同入口脚本 | 深链接回退可用；不证明管理员 API 权限或内容加载成功 |
| `/assets/index-DRJ4VTpa.js` | 200 text/javascript，181663 bytes | 实际脚本而非 HTML fallback |
| `/assets/vendor-vue-Dzwqm9Y9.js` | 200 text/javascript，109962 bytes | Vue 依赖资源可取 |
| `/assets/vendor-i18n-BuoWFzps.js` | 200 text/javascript，63323 bytes | i18n 依赖资源可取 |
| `/assets/vendor-misc-B-nM3tYW.js` | 200 text/javascript，273645 bytes | 其他依赖资源可取 |
| `/assets/vendor-misc-DB0Q8XAf.css` | 200 text/css，3938 bytes | 样式资源可取 |
| `/assets/index-Bm_JXDJf.css` | 200 text/css，265998 bytes | 主样式资源可取 |
| `/assets/` | 200 text/html | 这是 SPA fallback，单独看200会误判；不能当资源目录成功 |

根页响应：`X-Frame-Options: DENY`；CSP 含 `frame-ancestors 'none'`、`base-uri 'self'`。因此在不改当前安全响应的条件下，**同源与跨源 iframe 都不能嵌入**。没有移除这些头，也没有试图绕过。

公共接口当前关闭 registration、password_reset、totp、passkey、payment、affiliate、risk_control、plugin_management、model_plaza、available_channels 等开关，开启 channel_monitor。关闭只说明本机配置，不代表官方没有这些功能。根 HTML 的 `window.__APP_CONFIG__.version` 为空，而公共接口 version 是 0.2.1；判断运行版本以实际公共接口为准。

未调用受保护的更新检查/升级/回滚/重启接口，未读取登录凭据。**目前不能判断后端是否能访问 GitHub，也不能断言已有网络故障已修复。** warning 显示修复、浏览器能开 GitHub、官方 HTML 可取，都不能替代后端 `check-updates?force=true` 无 warning 的有效响应与发行源身份核对。

## 保持官方全部功能与更新的集成路径

### 首选：保留官方完整站点，桌面作为独立增强前端

1. 官方后端根站点继续完整承载 `/home`、`/auth/*`、`/payment/*`、`/admin/*`、`/assets/*`；新域名/独立端口部署桌面，不覆盖原版嵌入资产。当前本机 8000 与桌面开发端口的分离已能承载这一方向，生产反代尚未配置。
2. 桌面只将既有 `/api/v1`、网关 `/v1` 等请求反代到同一个原版后端（当前 vite.config.ts 的 dev proxy 已有 `/api`、`/v1`、`/health`；这不等于生产已配置）。未原生化功能使用明确的“打开官方控制台”顶层页面/新标签链接，保留完整官方 URL。不是 iframe，也不是 Safari 静态说明页。
3. 不把本机 `127.0.0.1:8000` 硬编码给远端用户：远端浏览器的 localhost 指向用户自己。官方入口应使用管理员提供的对外 origin。主任务已完成菜单“原版完整控制台 ↗”新标签接线：vite.config.ts 开发默认使用目标后端，生产构建须显式提供 VITE_OFFICIAL_CONSOLE_URL；App.vue仅接受无内嵌凭据的http(s) URL，无有效URL则隐藏菜单链接。MacMenubar 使用 target=_blank 与 rel=noopener noreferrer。M04仅只读核对，未编辑这些文件；生产配置值和真实新标签跳转仍待主任务验收。
4. 不承诺无感 SSO：官方与桌面都用 `auth_token` localStorage，但不同 origin 不共享；同名 key 不等于共享会话。允许在官方页独立登录；后续若设计统一身份，需核对 refresh-cookie、登录状态同步、退出、权限和回调协议；不得把 token 放入 URL。
5. 后端升级由官方发行机制维护原版二进制/随发行包提供的资产；桌面独立版本发布。每次升级前固定待验后端版本与 API 契约，检查字段增删、错误响应、权限/合规、分页、SSE/WS、支付回跳、Feature flags；保持可回退的旧前端。官方功能完整性由保留的官方站点提供，桌面原生覆盖仍按本表逐卡追踪。

### 其他方案与约束

| 方案 | 可行性 | 约束 |
| --- | --- | --- |
| 同域 `/desktop/` 增强入口、官方占根路径 | 可行但未实施 | 桌面 Vite base、绝对 `/assets` 图标/壁纸路径、history fallback/缓存规则要一起验；不能让桌面 assets 覆盖官方 hashed assets；认证同源共享仍需测试 |
| 官方站点整体挪到 `/official/` | 不可直接搬运 | 当前官方 HTML 的 `/assets/...` 和 router 路径为根绝对地址，OAuth/支付回调也需配套；仅 proxy rewrite 不足以证明完整可用 |
| 官方页面 iframe 嵌入桌面 | 当前不可用 | 已实测 DENY / frame-ancestors none；本轮不修改安全策略 |
| 导入官方全部 views，再套 Mac 外壳 | 可研发但不是低成本自动同步 | 官方 router、auth/app stores、i18n、Tailwind、布局/组件和绝对路由耦合；要进行持续上游合并/契约测试；不得直接编辑只读参考目录 |
| 用桌面独立实现替换全部官方 UI | 当前不满足完整覆盖 | 64 路由和内部操作有明确缺口；23应用验收、typecheck/build 通过不能替代 parity |

## 更新面板兼容说明

- API 路径与官方 `src/api/admin/system.ts` 一致：GET version/check-updates/rollback-versions，POST update/rollback/restart。现有客户端解包 `{code,message,data}`；update/rollback 保留15分钟超时，本轮未修改API契约。
- 当前版本 GET 与更新检查并行独立；更新源异常不再妨碍显示后端版本。请求关闭后用 AbortSignal/卸载状态阻止陈旧结果写入。
- warning/空版本仍显示“未能确认最新版本”，不启用安装；缓存返回明确称“缓存记录”；源码或未知 build_type 不提供在线安装。与官方 VersionBadge 的 `isReleaseBuild` 条件对齐。
- 报错文案不再把401/423/超时/响应异常一律归因为“更新源不可用”。详细原因仍可展开。
- 安装/回滚/重启仍需要用户二次确认；没有执行任何维护操作。重启成功响应只证明命令已发送，仍需版本和业务恢复检查。现有回滚候选/重启后恢复流程、真实构建能力、GitHub release/source 可达性未验。

## M01 / M03 增量证据边界

- 来源：[M01-RESULT.md](M01-RESULT.md)、[M03-RESULT.md](M03-RESULT.md)。M04 已只读核对共享 ModelPricingSheet 接线、Network 的 status(id)、Checkout 的 generation、锁屏注册 payload、Settings 邮箱绑定和官方菜单入口源码；没有重跑其他线测试，也没有编辑其他线代码。
- M01 报告6个SFC/模板编译与13组隔离行为检查，共19项通过，最终控制台 vue-tsc exit 0。新增定价Sheet、监控详情、订阅分栏、订单分页、换单隔离均据此更新为已实现或部分；完整模型广场扩展能力、监控时间轴/模式切换/轮询仍缺。
- M03 报告3个Vue模板编译、TOTP 11组、注册8组及邮箱管理隔离检查通过，最终控制台typecheck exit 0。TOTP由“并行实现待报告”更新为限定范围源码实现完成；邮箱码/邀请码注册不再标为缺失，独立email-verify路由仍未迁移。Passkey未知状态文案改善不等于Passkey CRUD已接通，静态第三方绑定展示也不是真实绑定状态。
- 两线均未运行真实浏览器或真实业务写入。这些结论不补写为真实邮件、TOTP、注册、支付、生产配置或视觉验收通过。当前本机功能关闭状态仍沿用06:18实测快照，本次未重新请求公共接口。

## 主任务：受保护版本检查的最少只读步骤（待执行）

使用**已有管理员会话的本地桌面标签**，让现有 apiClient 自动携带认证和管理UI请求头；无需复制token或手写请求。不要用无认证的新标签直接打开受保护API来判断源是否连通。下列只做GET检查，force可能刷新后端更新检查缓存，不执行版本替换或业务写入。

1. 打开浏览器开发者工具 Network，按 `system/` 过滤并清空旧记录；在当前桌面进入“系统设置 → 软件更新”。面板自动发出 `GET /api/v1/admin/system/version` 和不带force的 `GET /api/v1/admin/system/check-updates`。记录 version 请求的HTTP状态、业务code和 `data.version`，与此前公共接口0.2.1对照。若无管理员会话或返回401/403/423，记录认证/权限/合规阻断，本次检查停止；不要把它归因于GitHub，也不要为完成此只读检查提交登录/合规确认。
2. 自动检查完成后，点击一次“检查后端更新”。只观察 `GET /api/v1/admin/system/check-updates?force=true`（可能附加timezone参数），等响应或客户端报错。不要点击“安装更新”“执行回滚”“重启服务”。已有有效的force响应时无需重复请求。
3. 仅摘录下面的响应白名单及面板状态，交回主任务记录。不导出含Authorization/Cookie的完整HAR，不复制存储凭据。Network应没有 update/rollback/restart 的POST。若版本GET与更新响应的current_version不一致，记录不一致，不用任一值覆盖另一值来宣布成功。

| 最少记录 | 用途 |
| --- | --- |
| 检查时间、桌面origin、脱敏后的目标后端origin；两个GET的HTTP状态/业务code | 确认检查了哪个后端，区分运输层与业务响应 |
| version 的 `data.version` | 当前安装版本独立证据 |
| force检查的 `current_version`、`latest_version`、`has_update`、`cached`、`build_type`、`warning` | 区分最新/有更新/缓存/未知与源码或发行构建 |
| 若存在：`release_info.html_url`、`published_at`；错误message仅保留脱敏原因 | 核对发行来源是否为预期 `github.com/Wei-Shaw/sub2api/releases/...`，不以本地main提交代替发行源 |
| 面板显示文案、安装按钮是否符合build_type与warning条件 | 验证前端状态与实际响应一致，无需点安装 |

判读：HTTP200且业务code=0、有效版本字段、无warning、`cached=false`，才可记录“本次强制更新检查成功、响应未标记缓存”；若同时能核对发行URL，可注明返回的官方发行来源。`cached=true`仅证明缓存可读；warning/超时/无效字段保持“更新源状态未确认”；401/403/423属于会话/权限/合规阻断。即使强制检查通过，也只证明该次发行元数据检查成功，不能证明二进制下载、签名/权限、在线替换、重启恢复或桌面自动更新可用。本文件尚未记录该真实受保护检查通过。


## 主任务真实更新查询补充

主任务已在5173现有管理员会话打开Settings→软件更新：当前运行0.2.1，成功发现0.2.4，显示完整发行说明与安装更新按钮。由主任务提供的真实浏览器证据确认本次更新查询成功；此前“未验证更新源”的结论已被该次查询证据更新。未执行安装/重启；升级执行、二进制下载替换、回滚与恢复仍未验收。未提供原始cached/build_type/warning响应，本文不补造这些字段。本节取代前文历史时点“未确认/未检查”的当前状态判断，保留历史只读过程。
