# 五项发布收口 · 非账号功能线（2026-09-13）

## RF02 续卡 · 已完成本次授权收口

范围扩展仅UsersApp余额历史入口、ModelPricingSheet复用对比、SafeContent滚动高亮及本线既有文件；不改其他用户业务、账号分屏或共享core。沿用ui-ux检查，继续只用夹具。**本轮未执行全局build，也未覆盖上一轮独立构建目录。**

### 本轮完成

- **零用量用户入口**：UsersApp余额列新增“历史”，只传id/email给已有UsageBalanceHistory；原充值、编辑、属性、批量及状态操作无修改。浏览器从无用量用户行打开同一历史组件。
- **模型下钻**：复用既有分布Sheet与getUserBreakdown，传选中model及requested/upstream/mapping来源，保留已应用用户/组/时间/请求类型；关闭、换筛选和旧响应继续隔离。
- **真实概况**：getById(id,true)读取含软删除用户的email/username/balance/created_at/notes/deleted_at，保留零余额与删除标记，失败可重试。消费用/admin/usage/stats，仅限定user_id、注册日至今天及浏览器时区，显示total_actual_cost为“记录内累计消费”，明确仍保留记录的统计口径。概况和历史独立加载；统计失败保留概况、消费显示未知，切用户/关闭/卸载隔离在途结果。
- **审计跳转**：桌面内打开既有security应用的audit页；独立宿主使用/admin/audit-logs链接。目标页已接GET /admin/audit-logs，不修改SecurityApp。官方actor_user_id表示操作人，不是被操作用户，故没有伪造按该用户过滤；按钮明确为“打开操作审计”。
- **Markdown滚动高亮**：按最近可滚动父容器确定当前标题，捕获scroll、resize及内容图片load，用requestAnimationFrame合并更新；aria-current=location与可见高亮一致。重复标题以元素引用定位；换文档、关闭tools和卸载清理监听/帧，保留目录点击、焦点和复制行为。
- **共享价格对比**：核查AppStoreApp传完整ModelPlazaGroup后，ModelPricingSheet直接使用已有PlazaComparison，限定为当前选中模型；保留真实用户倍率、独立官方阶梯、服务端实付阶梯及分时价格，未复制价格引擎。弹层复用时隐藏对比组件重复的模型标题/复制按钮，保留单一页脚操作。PlazaComparison补局部表格/滚动样式，使桌面宿主不依赖公共页全局CSS。NetworkApp和available-channels仅提供渠道基础价，无完整分组/官方目录，因此继续显示基础价说明，不伪造分组或额外请求无关价格。

### 已确认的契约限制（不是新增待办）

1. 固定官方backend/internal/service/admin_user.go:GetUserUsageStats仍为“Return mock data for now”，返回固定零。本次没有使用/admin/users/:id/usage，也不将其零值当消费事实。注册日至今/admin/usage/stats真实聚合无法恢复已清理记录，所以不称永久账本总消费。
2. 渠道基础定价DTO UserSupportedModel没有official_pricing，未携带具体分组时无法给出可信实付/官方完整对比；有完整Plaza数据的桌面模型广场现已完成复用。
3. 审计接口没有被操作用户target_user_id过滤；不把actor_user_id套给用户。跳转打开现有审计页，用户可按该页真实支持的条件筛选。

### 本轮验证与主任务状态

- 最终启用`PARITY_PUBLIC_BROWSER=1`运行`node --test scripts/parity-admin-usage.test.cjs scripts/parity-public.test.cjs scripts/parity-policies.test.cjs`：150/150通过、0跳过、0失败。新增模型来源/冻结筛选、include_deleted/真实日期统计、错误ID/统计失败、概况竞态、审计动作、共享价格数据保持等7项。最终日志output/release-features-tests-rf02-final.txt；此前默认执行日志output/release-features-tests-rf02.txt。
- `PARITY_PUBLIC_BROWSER=1 node --test scripts/parity-public.test.cjs`：32/32通过，包含原公共页浏览器行为；日志output/release-features-public-browser-rf02.txt。
- `node scripts/release-features-browser.cjs`：19组通过，47个GET全部本地夹具，0pageerror/真实请求/写入。新增零用量用户入口、模型下钻、概况/审计链接、桌面价格对比、重复标题/滚动高亮/换文档；已有监控/用量/历史分页/403/键盘/390px保留。output/release-features/browser.json；pricing-mobile.png和balance-mobile.png等已逐图查看。该脚本直接挂载真实SFC，不是最终包验收。
- `pnpm --filter @sub2-mac/console typecheck`通过，output/release-features-typecheck-rf02.txt。无本轮全局build。
- 用户同步：主任务官方v0.2.4真实API已完成用户/组/账号创建、导入、配置及API key，正在ledger验证。本线记录此进展为主任务提供，未冒称亲自复验，也不重复列为“完全未做”。

此前明确的Users入口、模型下钻、概况/审计、目录高亮、带分组桌面定价差异已闭环。下面RF01保留为历史证据，不作为当前重复待办清单。

## RF01 历史任务卡：指定差异实现完成，总发布准入仍由主任务判定

范围：MonitorV2.vue、monitorTimeline.ts、AdminUsageApp.vue、新增UsageBalanceHistory.vue、专项测试和本文。顺序为监控→用量分布→历史弹层→只读全路由汇总，仅此卡。保留账号分屏与并行改动，不改accounts/auth/client/settings/deploy、server、真实配置或根二进制。未升级/重启当前服务，未创建临时服务器，浏览器全为route.fulfill夹具，关闭本次context/browser。

先读EXECUTION_PLAN、DESIGN、RELEASE_READINESS_20260913与PARITY系列。固定官方参考output/upstream-current-20260912（v0.2.4/5de5e2be，本次未查在线发行）。本文为当前增量，不删除历史报告，不宣称五项总发布完成。

### 实际变更与契约

- 监控：恢复官方range/platform/group/model/group_by/health_mode/trend_view/tab；CSV及重复键数组、正整数ID/枚举校验、隐藏排行降级。变化时replaceState保留无关query/hash，popstate恢复。滚轮在30/60/120格间缩放，以指针位置为锚、夹紧两端；达到界限允许页面滚动，保留选择器及更早/更晚供键盘/触屏。现有请求竞态/卸载隔离保留，未改API重复键参数契约。
- 分组：既有GET /admin/dashboard/groups，服务端聚合，展示请求/Token/用户与标准费用及图表。GroupStatsParams不接收model，主动剔除并提示统计范围，不从分页列表累计。独立错误/清空/重试与请求序号。
- 端点：既有GET /admin/usage/stats中的endpoints、upstream_endpoints、endpoint_paths，无虚构/dashboard/endpoints。切换入站/上游/路径，缺失/畸形显示未提供，与空数组/零费用区别处理；只在用量tab展示，错误tab不误查用量统计。
- 分组/端点下钻：既有GET /admin/dashboard/user-breakdown，冻结已应用条件及group_id或endpoint+endpoint_type；前50名按官方默认用户费用排序，非全用户清单。分组下钻也排除model。Sheet刷新/关闭及筛选/卸载隔离，支持再打开余额历史。
- 余额与权益历史：GET /admin/users/:id/balance-history，官方admin路由组AdminAuth门禁；15条分页、6类筛选、total_recharged保留零。展示充值/返佣/管理员调整、并发、订阅天数，不冒充逐次调用扣费流水或余额时间序列。复用现有users API，不新增路径/真实请求；入口为用量行、排名、分布下钻。MacSheet支持Tab/Escape，失败不报空成功，关闭/换用户/卸载清理旧结果。不展示兑换码code。
- 窄屏：筛选区限高滚动，表格保留最小操作高度；分布表局部紧凑布局不继承780px最小宽；未改共享core。

官方证据：backend/internal/server/routes/admin.go中的AdminAuth、/dashboard/groups及/:id/balance-history；handler/admin/user_handler.go:GetBalanceHistory返回items/total/page/page_size/pages/total_recharged。frontend/components/charts/EndpointDistributionChart.vue消费统计三数组；components/admin/user/UserBalanceHistoryModal.vue定义6类及不同单位。API均已存在，无需新接口。

### 验证

- `node --test scripts/parity-public.test.cjs scripts/parity-admin-usage.test.cjs`：90项，89通过、1个既有可选public浏览器跳过、0失败。新增11项覆盖query、缩放、分组/端点/下钻、历史分页/零值/权限失败/重试/竞态和卸载。output/release-features-tests.txt。
- `pnpm --filter @sub2-mac/console typecheck`：通过，output/release-features-typecheck.txt。
- `pnpm --filter @sub2-mac/console exec vite build --outDir ../../output/release-features/build`：通过，output/release-features-build.txt。独立构建不覆盖默认dist，不生成最终包；并行修改下不声明全仓冻结。
- `node scripts/release-features-browser.cjs`：12组Chromium操作通过，27个GET全部夹具，0 pageerror/真实请求/写入。URL首次/刷新/popstate、mouse.wheel、三端点/用户下钻、历史页码/类型单位、403重试、Tab/Escape、390px宽度与按钮可达。output/release-features/browser.json及6张截图。直接挂实际SFC与真实MacSheet/Chart.js，加载现有style.css/组件样式，基础布局工具类由测试壳提供，非全桌面/最终包验收。
- 初次检查纠正新Sheet的open/show属性、负金额符号顺序；浏览器发现窄屏筛选挤压，已修。截图避开Sheet及主题过渡帧后重拍，不把首次失败写成始终通过。

### RF01遗留项续卡结果

UsersApp入口、模型下钻、概况及审计、Markdown高亮和带分组共享价格对比已由RF02完成，以上最新记录取代本节原清单。渠道基础DTO与审计/统计口径限制已在RF02具体说明，不再笼统列为功能未做。

## RF01时点的64条官方路由历史核对（RF02更新明确差异）

提取固定官方router/index.ts路由配置中的64条path（含别名/重定向/404），对照当前main、desktop-routes、manifest、公共/支付入口、对应SFC/API与PARITY追加记录。下表动作是源码/既有分卡证据，仅RF01新增功能在本轮执行专项。**64/64有记录不等于64/64功能完整或真实后端/生产验收。** 不同URL共用App仍逐行记录；此表不是官方全部按钮穷举。

| # | 官方路径 | 当前消费者 | 已有主要动作 | 差异/尚需验收 |
| --- | --- | --- | --- | --- |
| 1 | `/setup` | SetupWizard | 状态门禁、连接测试/四步安装 | 真实安装/重启未执行 |
| 2 | `/home` | PublicPages | 净化主页内容和站点链接 | URL内容明确外链，不承诺任意网站内嵌 |
| 3 | `/login` | MacLockscreen / auth / OAuthCallbackPanel | 注册/邮箱码/密码恢复或身份回调及绑定 | 真实身份验证未验；钉钉注册特例及推广归因仍有审计边界 |
| 4 | `/register` | MacLockscreen / auth / OAuthCallbackPanel | 注册/邮箱码/密码恢复或身份回调及绑定 | 真实身份验证未验；钉钉注册特例及推广归因仍有审计边界 |
| 5 | `/email-verify` | MacLockscreen / auth / OAuthCallbackPanel | 注册/邮箱码/密码恢复或身份回调及绑定 | 真实身份验证未验；钉钉注册特例及推广归因仍有审计边界 |
| 6 | `/auth/callback` | MacLockscreen / auth / OAuthCallbackPanel | 注册/邮箱码/密码恢复或身份回调及绑定 | 真实身份验证未验；钉钉注册特例及推广归因仍有审计边界 |
| 7 | `/auth/linuxdo/callback` | MacLockscreen / auth / OAuthCallbackPanel | 注册/邮箱码/密码恢复或身份回调及绑定 | 真实身份验证未验；钉钉注册特例及推广归因仍有审计边界 |
| 8 | `/auth/wechat/callback` | MacLockscreen / auth / OAuthCallbackPanel | 注册/邮箱码/密码恢复或身份回调及绑定 | 真实身份验证未验；钉钉注册特例及推广归因仍有审计边界 |
| 9 | `/auth/wechat/payment/callback` | PaymentRoute / ProviderPayment | 订单上下文、QR/结果/Stripe/Airwallex及微信支付授权回调 | 真实SDK/Webhook/跨站cookie/弹窗依赖配置，非本线实测 |
| 10 | `/auth/dingtalk/callback` | MacLockscreen / auth / OAuthCallbackPanel | 注册/邮箱码/密码恢复或身份回调及绑定 | 真实身份验证未验；钉钉注册特例及推广归因仍有审计边界 |
| 11 | `/auth/dingtalk/email-completion` | MacLockscreen / auth / OAuthCallbackPanel | 注册/邮箱码/密码恢复或身份回调及绑定 | 真实身份验证未验；钉钉注册特例及推广归因仍有审计边界 |
| 12 | `/auth/oidc/callback` | MacLockscreen / auth / OAuthCallbackPanel | 注册/邮箱码/密码恢复或身份回调及绑定 | 真实身份验证未验；钉钉注册特例及推广归因仍有审计边界 |
| 13 | `/forgot-password` | MacLockscreen / auth / OAuthCallbackPanel | 注册/邮箱码/密码恢复或身份回调及绑定 | 真实身份验证未验；钉钉注册特例及推广归因仍有审计边界 |
| 14 | `/reset-password` | MacLockscreen / auth / OAuthCallbackPanel | 注册/邮箱码/密码恢复或身份回调及绑定 | 真实身份验证未验；钉钉注册特例及推广归因仍有审计边界 |
| 15 | `/key-usage` | KeyUsagePage | 密钥查询、日/模型统计、额度/订阅/限流 | 真实密钥响应未验 |
| 16 | `/legal/:documentId` | PublicPages / SafeContent | 协议正文、中英文内置合规文本 | 管理员条款没有翻译字段，不伪造译文 |
| 17 | `/model-plaza` | PublicCatalog / PlazaComparison | 平台/倍率/模型筛选、官方/实付阶梯与时段价 | RF02桌面带分组模型已复用同一完整对比 |
| 18 | `/` | App / 桌面 | 默认入口、角色及窗口导航 | 区别于官方重定向，为桌面适配 |
| 19 | `/dashboard` | DashboardApp | 用户/管理员统计、日期范围与趋势 | 真实统计金额/时区待验 |
| 20 | `/keys` | KeyChainApp | 密钥分页、CRUD、详情和额度 | 真实调用与扣费待主任务；不能由CRUD推定限制生效 |
| 21 | `/batch-image` | BatchImageApp / useBatchImages | 任务创建/分页/详情、取消/删除、图像预览 | 实际生成/账单与上传边界待验 |
| 22 | `/usage` | ActivityApp | 用量/错误筛选、详情、完整CSV分页 | 管理员新增分布不代表用户用量页有同等聚合图表 |
| 23 | `/redeem` | VoucherApp | 兑换余额/订阅、历史 | 真实兑换待验 |
| 24 | `/affiliate` | WalletApp / CheckoutSheet | 充值/购买/订单分页、取消/退款申请、返佣/转入 | 实际支付/入账/退款/返佣待验 |
| 25 | `/available-channels` | PublicCatalog / ModelPricingSheet | 渠道/组/模型、专属倍率、共享定价 | 渠道基础DTO无官方价/分组，按基础价显示；完整Plaza数据已复用 |
| 26 | `/profile` | SettingsApp / settings子组件 | 资料/安全、分模块管理配置、软件更新 | 全部配置字段及外部身份验证由对应线核验 |
| 27 | `/subscriptions` | user/SubscriptionsApp | 列表/详情、额度进度、暂停/未开始/到期 | 真实配额重置与扣费未验 |
| 28 | `/purchase` | WalletApp / CheckoutSheet | 充值/购买/订单分页、取消/退款申请、返佣/转入 | 实际支付/入账/退款/返佣待验 |
| 29 | `/orders` | WalletApp / CheckoutSheet | 充值/购买/订单分页、取消/退款申请、返佣/转入 | 实际支付/入账/退款/返佣待验 |
| 30 | `/payment/qrcode` | PaymentRoute / ProviderPayment | 订单上下文、QR/结果/Stripe/Airwallex及微信支付授权回调 | 真实SDK/Webhook/跨站cookie/弹窗依赖配置，非本线实测 |
| 31 | `/payment/result` | PaymentRoute / ProviderPayment | 订单上下文、QR/结果/Stripe/Airwallex及微信支付授权回调 | 真实SDK/Webhook/跨站cookie/弹窗依赖配置，非本线实测 |
| 32 | `/payment/stripe` | PaymentRoute / ProviderPayment | 订单上下文、QR/结果/Stripe/Airwallex及微信支付授权回调 | 真实SDK/Webhook/跨站cookie/弹窗依赖配置，非本线实测 |
| 33 | `/payment/airwallex` | PaymentRoute / ProviderPayment | 订单上下文、QR/结果/Stripe/Airwallex及微信支付授权回调 | 真实SDK/Webhook/跨站cookie/弹窗依赖配置，非本线实测 |
| 34 | `/payment/stripe-popup` | PaymentRoute / ProviderPayment | 订单上下文、QR/结果/Stripe/Airwallex及微信支付授权回调 | 真实SDK/Webhook/跨站cookie/弹窗依赖配置，非本线实测 |
| 35 | `/custom/:id` | PublicPages / SafeContent | 权限、净化Markdown、目录/复制/定位 | RF02滚动高亮已验证 |
| 36 | `/admin` | DashboardApp | 用户/管理员统计、日期范围与趋势 | 真实统计金额/时区待验 |
| 37 | `/admin/dashboard` | DashboardApp | 用户/管理员统计、日期范围与趋势 | 真实统计金额/时区待验 |
| 38 | `/admin/ops` | OpsApp / operations | 概览/趋势/错误/并发、告警、日志、容量、WS/轮询 | 更细筛选/图表组合未全量审计；真实WS/告警未验 |
| 39 | `/admin/audit-logs` | SecurityApp / operations | 操作审计、审核配置/日志、密钥池/解封/hash缓存、提示词审计 | 各子功能权限及真实解封/清理/事件操作未验 |
| 40 | `/admin/users` | UsersApp / policies | CRUD、余额调整、允许组/密钥、平台额度/属性/批量 | RF02已接历史入口；主任务报告真实用户创建通过 |
| 41 | `/admin/groups` | GroupsApp / GroupPolicyEditor | CRUD/复制、倍率/RPM、推理/路由/定价及媒体策略 | 实际策略生效未验；保留未知字段不等于编辑入口 |
| 42 | `/admin/channels` | ChannelsApp / policies | 平台定价/映射/时段阶梯/账单规则、监控CRUD/手动检查 | 真实检查与价格生效未验；pricing/monitor不同子页 |
| 43 | `/admin/channels/pricing` | ChannelsApp / policies | 平台定价/映射/时段阶梯/账单规则、监控CRUD/手动检查 | 真实检查与价格生效未验；pricing/monitor不同子页 |
| 44 | `/admin/channels/monitor` | ChannelsApp / policies | 平台定价/映射/时段阶梯/账单规则、监控CRUD/手动检查 | 真实检查与价格生效未验；pricing/monitor不同子页 |
| 45 | `/monitor` | MonitorV2 / monitorTimeline / PublicCatalog | V1/V2、筛选/矩阵/趋势/排行、URL恢复/滚轮缩放 | GET轮询非SSE；缩放时间格视窗非后端分桶 |
| 46 | `/admin/subscriptions` | admin/SubscriptionsApp | 分配/延期/撤销/恢复/重置、用户选项分页 | 旧“只取100用户”已过时：现collectAdminPages；真实操作未验 |
| 47 | `/admin/accounts` | AccountsApp（其他agent独占） | 分屏新增、导入/编辑/授权及平台策略 | 以账号线最终报告为准；本线不触碰/验收并行结果 |
| 48 | `/admin/plugins` | PluginsApp | 上传/启停/卸载 | 真实插件加载与上传限制未验 |
| 49 | `/admin/announcements` | AnnouncementsApp / UserAnnouncementsApp | 公告CRUD及用户未读/阅读确认 | 实际发布/已读写入未验 |
| 50 | `/admin/proxies` | ProxiesApp | 创建/编辑/批量/测试/质量/关联账号 | 旧“没有编辑”已过时：现proxiesAPI.update；真实代理未验 |
| 51 | `/admin/redeem` | CommerceApp / PromoInspector | 兑换码/优惠码、邀请返利转入、订单/套餐 | 实际退款/重试充值/套餐生效未验；不同subtab不合并为一个操作 |
| 52 | `/admin/promo-codes` | CommerceApp / PromoInspector | 兑换码/优惠码、邀请返利转入、订单/套餐 | 实际退款/重试充值/套餐生效未验；不同subtab不合并为一个操作 |
| 53 | `/admin/settings` | SettingsApp / settings子组件 | 资料/安全、分模块管理配置、软件更新 | 全部配置字段及外部身份验证由对应线核验 |
| 54 | `/admin/risk-control` | SecurityApp / operations | 操作审计、审核配置/日志、密钥池/解封/hash缓存、提示词审计 | 各子功能权限及真实解封/清理/事件操作未验 |
| 55 | `/admin/prompt-audit` | SecurityApp / operations | 操作审计、审核配置/日志、密钥池/解封/hash缓存、提示词审计 | 各子功能权限及真实解封/清理/事件操作未验 |
| 56 | `/admin/usage` | AdminUsageApp / UsageBalanceHistory | 用量/错误、导出/清理、趋势/模型/排名、分组/端点/用户下钻、历史 | RF02模型下钻/概况审计已补；复杂单元格非逐项复刻 |
| 57 | `/admin/affiliates` | CommerceApp / PromoInspector | 兑换码/优惠码、邀请返利转入、订单/套餐 | 实际退款/重试充值/套餐生效未验；不同subtab不合并为一个操作 |
| 58 | `/admin/affiliates/invites` | CommerceApp / PromoInspector | 兑换码/优惠码、邀请返利转入、订单/套餐 | 实际退款/重试充值/套餐生效未验；不同subtab不合并为一个操作 |
| 59 | `/admin/affiliates/rebates` | CommerceApp / PromoInspector | 兑换码/优惠码、邀请返利转入、订单/套餐 | 实际退款/重试充值/套餐生效未验；不同subtab不合并为一个操作 |
| 60 | `/admin/affiliates/transfers` | CommerceApp / PromoInspector | 兑换码/优惠码、邀请返利转入、订单/套餐 | 实际退款/重试充值/套餐生效未验；不同subtab不合并为一个操作 |
| 61 | `/admin/orders/dashboard` | CommerceApp / PromoInspector | 兑换码/优惠码、邀请返利转入、订单/套餐 | 实际退款/重试充值/套餐生效未验；不同subtab不合并为一个操作 |
| 62 | `/admin/orders` | CommerceApp / PromoInspector | 兑换码/优惠码、邀请返利转入、订单/套餐 | 实际退款/重试充值/套餐生效未验；不同subtab不合并为一个操作 |
| 63 | `/admin/orders/plans` | CommerceApp / PromoInspector | 兑换码/优惠码、邀请返利转入、订单/套餐 | 实际退款/重试充值/套餐生效未验；不同subtab不合并为一个操作 |
| 64 | `/:pathMatch(.*)*` | PageNotFound / main | 未知路径404 | 服务端fallback由nginx线验收 |
