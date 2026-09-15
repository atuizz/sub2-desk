# M01 用户应用实施结果

日期：2026-09-11。状态：实现完成，静态检查与隔离逻辑检查通过，交主任务统一构建和浏览器验收。

## 边界

- 已先读 EXECUTION_PLAN.md、DESIGN.md；采用 ui-ux 的既有产品局部改进门槛，未使用 frontend-skill。
- 仅修改下列 6 个用户侧 Vue 文件及本报告；没有修改 Settings、app-polish.css、Tailwind、注册表、Core、API、stores、后端、真实配置、原型或官方参考目录。
- 未启动浏览器、临时服务器，未调用真实业务接口，未执行支付、取消、退款等真实操作，未运行 build。
- 官方只读参考：output/parallel-20260911/upstream/frontend，任务提供 HEAD `98d86915becae9fe9491a91ffc6defd5235c8d2b`。

## 实际改动

| 文件（均在 packages/sub2-console/src/apps/user） | 当前行为 → 本次结果 |
| --- | --- |
| AppStoreApp.vue | “就绪”无点击行为 → 打开模型定价 Sheet；分组筛选状态无入口 → 紧凑分组选择和结果计数；统一输入/输出报价 → 区分 Token、按次和图片独立倍率；刷新失败 → 保留上次目录并提示，取消旧目录请求；保留 getAppIcon 接线 |
| ModelPricingSheet.vue（新增局部组件） | 模型广场与可用渠道共同复用 MacSheet；展示输入/输出、5m/1h 缓存写入、缓存读取、官方平价参考、阶梯、分时/高峰提示；区分渠道基础价格与含分组倍率价格；提供复制模型名称及管理密钥入口，复制失败可手动选取名称；未提供价格显示“未提供”，不补零 |
| NetworkApp.vue | 自制 fixed 全屏定价弹层 → 共享定价 Sheet；节点名 → 可打开监控详情 Sheet，使用既有 status(id) 查询 7/15/30 天可用率、当前/平均延迟；详情切换与关闭隔离旧响应；列表刷新失败保留旧数据，倍率加载失败明确提示默认倍率；可用率重复乘 100 → 按上游 0–100 百分数展示；未知/检测失败不再统一伪装成不可用；quota 占位模型显示“配额检查” |
| SubscriptionsApp.vue | 卡片墙 → 订阅列表/单项额度详情分栏，窄窗口横向选择条；提供搜索、有效/其他筛选和状态栏；suspended 错标撤销 → 已暂停；已到期 active / 未开始订阅准确区分；无分组详情不宣称无限额；24h 内到期不误写“今日”；计时每分钟更新并卸载清理；不足一天订阅的单次日额度不宣称每日重置；购买入口传 wallet 的 subscription tab |
| WalletApp.vue | 订单仅前 50 条 → 25 条服务端分页、总数、上一页/下一页；筛选回第一页，页数缩小时回退有效页；乱序请求不能覆盖当前订单；加载失败保留已有行且不当成空态；增加已支付/入账中/过期/取消筛选；复用窗口时响应 customData.tab，订阅入口能切到套餐页 |
| CheckoutSheet.vue | 旧二维码/支付查询失败可能污染新订单 → generation 隔离成功、失败与 busy；同一订单重复查询 COMPLETED 只通知 paid 一次；收到完成/入账中/过期/取消/失败/退款状态后隐藏旧付款码和链接 |

保留现有 Vue 3、TypeScript、Pinia、业务 API 契约、真实状态和原生图标；没有复制上游后端业务逻辑或加入演示 fallback。

## 上游核对依据

- `src/views/ModelPlazaView.vue` → `src/components/modelPlaza/PlazaModelPricingTable.vue`：生效倍率、图片独立倍率、按次单位、官方参考价不乘倍率、分时倍率/阶梯语义。
- `src/views/user/SubscriptionsView.vue` → `src/utils/subscriptionQuota.ts`：订阅到期提示、24h 内单次日额度的显示规则。
- `src/components/user/MonitorDetailDialog.vue`、`src/composables/useChannelMonitorFormat.ts`：监控详情接口、0–100 可用率、未检测与 quota 占位语义。
- 订单分页直接使用本地已有 `paymentAPI.getMyOrders({ page, page_size, status })` 和 BasePaginationResponse；未增设接口。

## 验证结果

1. 6 个文件分别通过 Vue SFC 解析、compileScript、compileTemplate（读取实际文件，通过 stdin Node 脚本执行）。
2. 同一隔离脚本将实际 script setup 经 TypeScript 转译后装入 VM，用 Vue ref/computed 与 Promise 夹具验证，13 组行为检查通过：
   - 图片独立倍率和 Token 分组倍率各一组；分组过滤；目录刷新失败保留旧数据。
   - 100%/未知可用率及未知状态；监控详情响应乱序；关闭详情后旧失败隔离。
   - 暂停/已过期/无效日期；24h 内一次性日额度文案。
   - 订单页码/状态参数及旧页响应隔离；总数缩小后的页码回退。
   - 已支付完成的通知去重与付款入口状态；换单后旧失败隔离。
   - 最终输出：`M01 PASS: 19 checks (6 SFC/template compiles, 13 behavior groups); no browser or real API calls.`
3. `pnpm exec vue-tsc --noEmit --pretty false`（cwd packages/sub2-console）：最终退出码 0。第一次检查曾报并行文件 ChannelsApp.vue:176 的 Object.hasOwn/ES2020 错误，M01 未修改该文件，后续检查已无该错误。
4. 与 `output/checkpoints/frontend-before-parallel-20260911.zip` 做逐字节对比：ActivityApp.vue、KeyChainApp.vue、DashboardApp.vue 均未变化。CSV 全量导出、请求隔离、图标接线和既有仪表盘修复未被本线覆盖。
5. 本工作区不是 Git checkout；逐文件差异通过检查点 zip 比对，未使用整目录覆盖恢复。

以上是静态/隔离逻辑结果，不是浏览器视觉、真实后端兼容性或支付验收。

## 主任务验收与剩余缺口

- 主任务统一执行 build；本轮尚未验收浅深色/390px截图、真实 Sheet Tab/Enter/Escape、订阅分栏滚动与多窗口叠放。
- 建议浏览器夹具重点：模型“查看定价→复制/密钥”；渠道“节点详情→关闭→旧请求完成”；订阅“选择→筛选→购买→已存在钱包切页”；订单第 2 页与快速切筛选；换单后的旧 QR/查询失败及已完成重复查询。
- 未补完整上游模型广场全部能力：官方阶梯对比、Markdown 全局说明、上游新增视频/缓存倍率扩展字段仍需后续专卡与本地 API 类型同步；当前只使用本地既有字段。
- 未实现监控时间轴、配额/探针模式切换和自动轮询；新增详情为手动按需查询。
- 订阅额度仍来自既有订阅列表，不代表实时扣费验收；购买入口是可购套餐列表，没有臆造按原订阅自动续费接口。
- 没有改 Activity、KeyChain、Dashboard、Voucher、Finder、Safari、Terminal；本卡聚焦已完成的四个业务应用及两个局部 Sheet，不宣称用户所有页面完全对齐上游。

## 第二段追加：Activity / Dashboard / KeyChain

用户在第一段交付后追加最多 12 分钟，授权原范围内改善这三个页面。以上“未改 Activity/KeyChain/Dashboard”是第一段检查点结论；第二段新增修改如下，最终共涉及 9 个 Vue 文件。

### 新增实现

- **ActivityApp.vue**：用量分析改为“趋势 / 模型 / 分组 / 端点 / 全部”分段选择，默认显示单个趋势图，避免四图挤占日志和筛选区；“全部”恢复原并排图表，原折叠按钮增加“图表”标签并仅在使用记录页显示。详情 Sheet 收紧自身内边距并处理窄屏三列信息与长文本。保留 showCharts 原默认值、指标四态、日期/粒度/筛选、详情、列选择、CSV 全量导出与全部请求生命周期。
- **DashboardApp.vue**：仅开发者中心图表区增加“趋势 / 模型分布 / 并排比较”，默认单图趋势；可按需查看完整模型列表或恢复双图。管理员总览和所有数据源/日期/刷新/回顶函数不变。最近使用日志、快捷操作整块模板未修改，不触碰其 16px 内边距与 44px 标题规则。
- **KeyChainApp.vue**：密钥名称变成可键盘触达的只读详情入口，使用原 MacSheet 展示遮罩密钥、状态、所属分组、总额度、已用额度、消费、到期/最近使用、周期额度及 IP 黑白名单；详情只读取现有列表，不额外请求、不显示完整密钥、不触发写入。详情通过 ID 获取最新列表对象，刷新后不会持续展示旧引用；对象消失时禁用编辑/接入操作。编辑与接入按钮关闭详情后调用原有流程，不改变其 payload。

以上均为页面局部实现；未修改共享 app-polish.css、toolbar 高度/标题规则、Core、Tailwind 或其他协作范围。

### 第二段检查

- `pnpm exec vue-tsc --noEmit --pretty false`（cwd packages/sub2-console）：退出码 0。
- Activity、Dashboard、KeyChain：分别通过 Vue SFC 解析、compileScript、compileTemplate。
- 使用 TypeScript AST 对比检查点与当前文件，统一换行后：Activity **117** 条、Dashboard **64** 条、KeyChain **58** 条原非 import 顶层语句全部逐项保留。这涵盖既有函数、CSV、请求版本/取消、watch、生命周期和编辑/删除写入逻辑；只新增视图状态与只读详情帮助函数。
- 开发者中心从 `ROW 5: Recent Usage` 到模板结尾的完整片段与检查点一致，未改变已验收底部块。
- 对实际新增详情逻辑做隔离检查：只读打开无编辑调用；列表刷新后展示最新对象；仅显示已设置的周期额度；编辑跳转关闭前一 Sheet；列表对象消失后不执行操作；缺失金额显示占位。全部通过。
- 没有运行 build、浏览器或真实接口。主任务仍需核验图表切换时 Chart.js 尺寸、浅深色/390px、密钥详情 Sheet 的键盘焦点及详情→编辑焦点交接；本段不将静态结果写成视觉或后端验收。
