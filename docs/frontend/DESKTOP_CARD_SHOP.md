# 网上小铺应用与配置面板

日期：2026-09-12。范围：本卡新增文件；没有修改 main/App/manifest/SettingsApp、全局类型、API client、后端或其他任务文件。未真实保存设置、发送订单或支付。

## 新增文件

- `packages/sub2-console/src/utils/cardShop.ts`：纯配置解析、URL验证、保留前缀判断、配置指纹与合并、iframe origin门禁。
- `packages/sub2-console/src/stores/cardShop.ts`：公共配置 store，使用原有 getPublicSettings。
- `packages/sub2-console/src/apps/user/CardShopApp.vue`：店铺切换、域名地址栏、网页刷新、始终可见的外部打开、兑换卡密按钮和 iframe。
- `packages/sub2-console/src/apps/user/settings/CardShopSettingsPanel.vue`：管理员多店铺草稿与保存面板，复用 MacGroupCard/MacButton。
- `scripts/desktop-card-shop.test.cjs`：45项无网络隔离测试，使用 desktop-* 命名前缀。
- 本报告。

## 配置契约与保存行为

复用原版 `settings.custom_menu_items`，不添加后端字段。归属条件为 ID 以 `sub2mac-shop-` 开头。写入字段为 `id`、`label`（店名）、`url`、`visibility: user`、静态安全 `icon_svg`、`sort_order`；新增 ID 使用 crypto.randomUUID。

URL只接受完整 HTTP(S)，拒绝凭据、非HTTP协议、反斜线、空格及控制字符。展示名称走Vue文本插值，不渲染管理员SVG；写入的icon为代码内固定自包含SVG。公共读取只接收保留前缀且 visibility=user 的条目，严格区分空列表和无效响应。

面板先读取，成功前禁写。添加/移除只改本地草稿，保存才提交。保存前重新 GET 最新 settings；与初次读取比较归属前缀条目的指纹，别人已修改小铺时停止保存并要求重新读取。其他前缀条目使用最新GET结果原样保留，包括额外字段，PUT payload仅有 custom_menu_items。空店铺列表表示删除本卡所有归属条目，其他菜单不变。

同一JSON对象字段顺序不影响指纹比较。PUT返回后检查归属条目是否匹配，确认成功才标记保存完成并刷新公共store。请求已发出但结果未知/不一致时禁用继续保存，要求重新读取确认。身份ID/角色变化清空草稿，旧异步请求不得继续写入或覆盖新身份。

原版设置接口没有原子 compare-and-swap / ETag 条件更新，因此“最后一次GET之后、PUT之前”的其他管理员并发修改仍存在窗口；本前端不能在不改后端契约的情况下提供全局原子合并保证。当前实现保护正常长时间编辑冲突并使用最新的其他菜单内容。

## Store 接口与主任务集成

导出 `useCardShopStore()`，store ID `cardShop`。

- `shops: CardShop[]`，每项 `{ id, name, url, domain }`。
- `loaded`：本身份是否已经成功读取过配置。
- `loading`、`error`：当前刷新状态及失败信息。
- `load(force = false)`：普通调用复用已加载数据/在途请求；force为true时发起新一代读取。
- `reload()`：等价于 load(true)。

同身份刷新保留原shops与loaded，失败保留上次配置并显示错误，不会短暂变成0店铺导致主任务条件注册关闭窗口。只有成功返回空配置才清空同身份列表。监听源为用户ID和角色的独立getter：token轮换、同ID/角色资料对象刷新均不清空/重载。真实ID/角色变化立即清空并重新加载，旧响应失效。

主任务负责 `card_shop` 注册和按shops控制入口、首次 load，以及在管理员设置中插入 `<CardShopSettingsPanel />`（无必填props）。`CardShopApp` 支持可选 win；本卡不修改任何注册/路由文件。兑换按钮使用可选窗口管理器 `wm?.openApp('voucher')`，不重写兑换业务。

如主任务已有通用custom_menu_items展示，保留前缀条目应由本小铺入口消费，避免重复展示。该接线由主任务处理。

## 浏览与隔离边界

应用采用macOS浏览器式工具栏，没有伪后退/前进按钮。外部打开始终可见；没有有效店铺时disabled。有有效URL时是用户主动点击的 `_blank` 链接，`rel=noopener noreferrer`、`referrerpolicy=no-referrer`。不会自动跳转顶层页面，也不拼接账户密钥/token到店铺URL，不读取或操作店铺DOM，不代理网页。

iframe仅允许跨origin店铺，并使用：

`allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox`

同origin（含默认端口规范化后相同）的店铺禁iframe，提示外部打开，避免当前控制台与scripts/same-origin组合。HTTPS控制台中的HTTP店铺也禁iframe。没有授予任何allow-top-navigation权限。当前URL origin门禁针对配置入口，无法读取跨源页面后续导航；不声称掌握店铺内部重定向或订单状态。

跨源店铺保留正常origin语义以支持其登录/CORS/storage；用户主动弹出的支付窗口可脱离iframe sandbox。浏览器第三方Cookie/跟踪防护、支付商规则仍可能阻挡登录或支付，应使用始终可见的外部打开按钮。

不绕过 X-Frame-Options/CSP。浏览器可能对被阻止的跨域iframe触发load，因此load只记录为unverified，不推断订单或支付状态；12秒无确认时提示可能空白/禁止嵌入，错误有重试。同店铺同URL配置刷新不重建iframe；显式刷新网页或切换店铺/URL才重建。

## 实际验证

`node --test scripts/desktop-card-shop.test.cjs`：45/45通过、0失败、0跳过。

测试使用真实Vue refs/watch、Pinia store和实际组件脚本转译；管理员/公共API全部是无网络夹具，不调用真实client。覆盖：

- HTTP(S)验证及凭据/脚本/控制字符拒绝，归属前缀与visibility，响应未知不得当空配置。
- 保留最新非归属菜单、删除全部店铺、同归属并发冲突、JSON字段顺序变化。
- store加载/强制刷新/错误恢复、同身份刷新保留应用、token轮换与同ID资料替换不清、成功空列表删除入口、ID/角色变化同步清空、旧响应与dispose隔离。
- 管理员面板仅更新菜单字段，非法输入、未知配置、非管理员、重复保存、保存前换身份、结果不明禁重发、成功刷新公共配置。
- iframe来源门禁、同源默认端口、跨源sandbox权限、不含top-navigation、外部打开与兑换接线、load不报支付成功、超时错误状态、配置未变不重建iframe。

`pnpm --filter @sub2-mac/console typecheck`：最终通过（exit 0）。未执行build或浏览器；真实店铺跨站登录、支付、XFO/CSP、第三方Cookie、窄屏/键盘与主任务动态注册需后续集成验收。本卡45项不得写为真实设置保存/购买/支付验收。

## 视觉收口与冻结

主任务反馈浏览器整链路7场景通过（保存→入口出现→iframe→reload保持→兑换→拖入校验/确认）；该结果来自主任务，本线未重复执行浏览器。

按主任务截图反馈小修 CardShopApp.vue：网页提示条仅 restriction/error/slow 时显示；配置读取错误仍可见；loading 为轻量“正在打开店铺…”，正常显示后无常驻工程说明。底部改为“购买后点击上方按钮兑换卡密。若网页无法显示，请外部打开。”内部 unverified 与不推断支付状态的逻辑不变。

修改后亲自重跑 `node --test scripts/desktop-card-shop.test.cjs`：45/45通过（含当前Vue模板编译及load状态检查），无需改测试断言文案。仅改应用模板/局部样式与本报告，不再扩展本卡范围；报告冻结，后续视觉复验由主任务完成。
# 真实店铺接入补记 · 2026-09-12

用户明确授权添加https://wzyp.cn/shop/woai，已以“WOAI 小铺”保存至当前本地后端，并回读管理员设置和公共菜单确认存在。未购买或兑换。实际后端拒绝超过32字符的菜单ID，已将新增ID改为保留前缀加16位随机十六进制，并补上长度校验和边界测试。此次此前无菜单，回读确认仅新增目标条目。
