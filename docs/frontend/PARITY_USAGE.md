# 管理员用量与 Promo 收口

日期：2026-09-12。范围：AdminUsageApp.vue、PromoInspector.vue、scripts/parity-admin-usage.test.cjs、本文件。未修改 Commerce/main、其他并行文件、API、配置或后端；未做真实业务写入。

## 对照依据

已读 EXECUTION_PLAN.md / DESIGN.md。继续使用既有 ui-ux 质量约束和原生 Sheet/Alert/Button。
对照 output/parallel-20260911/upstream/frontend/src/views/admin/UsageView.vue、PromoCodesView.vue、components/admin/usage/UserTokenRanking.vue、UsageFilters.vue、components/charts/TokenUsageTrend.vue 及本项目 api/admin/usage.ts、promo.ts、ops.ts、dashboard.ts 和共享类型。

- 官方管理员错误列表使用 listErrorLogs(`/admin/ops/errors`)，`view=all`；日期按本地日界限转 RFC3339，参数为 phase/category/status_codes。错误详情使用 getErrorLogDetail。
- 用量统计使用 `/admin/usage/stats`，显式选取支持的用量筛选参数，不传错误阶段/类别/HTTP 状态码。
- 清理使用 `/admin/usage/cleanup-tasks` 及 `/{id}/cancel`。任务 filters 返回 start_time/end_time，创建请求使用 start_date/end_date/timezone。
- Promo 更新日期为 Unix 秒；官方 PromoCodesView 清空到期时间提交 0，不能提交 null 冒充已清除。
- 趋势使用官方 getSnapshotV2(`/admin/dashboard/snapshot-v2`)，按需开启 include_trend，粒度 day/hour。模型使用 getModelStats(`/admin/dashboard/models`) 的 model_source=requested/upstream/mapping。排名使用 getUserBreakdown(`/admin/dashboard/user-breakdown`)，sort_by 与 limit 由后端执行，不能用分页用量表本地累计冒充排名。

## 实际变更

### AdminUsageApp.vue

- 增加调用用量/错误请求切换、阶段/类别/状态码筛选、错误分页和详情读取/错误重试。使用官方参数与本地日界限；100–599 状态码与真实日历日期验证。
- 用量和错误请求独立行数据；切换/应用筛选清旧数据，统计请求仅在用量页执行；统计失败显示未知，不显示旧统计。错误页禁用用量 CSV 和新建用量清理。
- 用量、统计、用户选项、密钥选项、错误详情、清理任务均有响应 shape 防御。列表/统计/搜索/任务/详情通过请求序号和卸载标记拒绝迟到响应；支持的用量 API 使用 AbortController。错误 API 本身未提供 signal，以序号隔离结果。
- CSV 按冻结筛选完整分页（每页100）、exact_total、唯一ID累积；重复记录、空缺页、无效 shape、总数变化或数量超出均拒绝生成文件。205条/3页测试通过。中止后不再继续取页或创建下载，卸载中止。
- CSV 保留 UTF-8 BOM、RFC风格双引号转义及 CRLF；对等号/加减/at及前导空白控制符的公式载荷加单引号保护。
- 清理必须经过确认；使用冻结的已应用筛选，确认展示日期/时区、用户、密钥、账号、分组、模型和请求类型。错误请求不会被清理。新建与取消失败放在最上层 Alert slot 内，用户无需关闭确认层才能看到错误。
- 清理任务具备加载/空/失败/分页/越界页恢复；任务创建成功回第一页。响应无法确认时明确提示刷新核验，不报成功。

### 追加功能闭环（2026-09-12）

- 日/小时 Token 趋势：复用项目 Dashboard 已使用的 vue-chartjs Line + Chart.js，直接映射后端输入/输出/缓存创建/缓存读取序列，未复制后端聚合计算。当前范围无记录、加载、错误、重试分别呈现。图表可收起，小窗口图表区域独立限高滚动；禁用图表动画以适配减少动态效果要求。
- 模型分布：复用 Doughnut，支持请求模型、上游模型、映射模型三个来源，Token/实际费用两种指标；旁边保留所有模型的名称及准确数值，可滚动读取。指标切换只切换已返回字段，来源变化调用模型接口。错误保留可重试，不能显示旧来源图。
- 用户排名：新增第三页，Top 20/50/100/200，按请求数/输入/输出/缓存/总Token/用户费用六种指标排序，完全保留后端返回顺序。加载、失败、空态与刷新；点击用户复用已应用筛选并限定用户、清除不相容密钥、切回用量列表。
- 趋势/模型/排名分别维护请求序号、shape 校验、卸载结果隔离。应用筛选时刷新图表；图表明确按用量筛选统计，不将错误阶段/类别/状态码用于用量聚合。
- 显示列：原生 MacSheet 的复选配置，用量与错误独立保存于 `sub2-mac-admin-usage-columns-v1`；用户/时间、错误状态码及详情不可隐藏。支持常用基础字段及请求ID、上游ID、端点、IP、User Agent、费用等可选列。恢复时过滤未知键与固定列，存储失败保留当前窗口选择并可见提示。
- 错误筛选：原生 input+datalist 提供官方六个 phase 和八个 category 的中文建议，同时保留自由输入未知值及清空为全部。阶段为 upstream/account_auth/request/auth/routing/internal；类别为 auth/rate_limit/quota/invalid_request/service_unavailable/upstream/internal/cyber；未将官方不可反查的 other 加入建议。
- 本追加轮仅变更 AdminUsageApp.vue、测试脚本与本报告，Promo 既有修复不覆盖；未改共享 Chart、API、Commerce/main 或其他线文件。

### PromoInspector.vue

- 到期时间保留本地秒，未编辑日期时不发送 expires_at，避免修改其他字段时截断秒或改变原始精度；清空发0，修改发Unix秒。拒绝无效或自动滚动到其他日期的输入。
- 保存检查代号、金额、次数、状态、ID；返回 shape 不完整不报成功。
- 历史分页单独请求版本和错误状态；同一优惠码不同页与切换优惠码的迟到响应均不覆盖新页。响应无效显示重试，不宣称暂无记录。
- 删除必须经过确认，失败错误位于删除 Alert；保存/删除结果不得关闭后来选中的另一个优惠码。

## 可重复验证

`node --test scripts/parity-admin-usage.test.cjs`

实际结果：48/48 通过、0跳过、0失败（此前32项全部保留，追加15项功能测试及1项真实Chart注册测试）。脚本读取并转译实际 Vue script setup，使用 Vue ref/computed/watch 与 VM API 夹具，编译两个模板。Chart.js 使用项目真实依赖：测试从组件AST读取 chart.js 的命名导入及别名，注入VM后执行真实 Chart.register，检查 category/linear scale、point/line/arc element 与 tooltip/legend plugin 已注册。图表实际绘制交浏览器验收，不把注册和图表数据检查声称为截图验收。没有导入真实 API/client，不联网，不执行真实删除、清理或优惠码保存。

覆盖：shape错误、用量/统计/密钥/错误列表迟到响应、205条完整导出、重复/空页/总数变化/畸形分页拒绝、导出中止、CSV公式保护、清理确认与冻结筛选、确认层失败状态、取消失败、任务shape、官方错误筛选映射、错误页不误用统计/清理/导出、错误详情失败、Promo日期保持/清空/修改/无效日期、状态校验、历史竞态/shape、删除确认、旧保存不关闭新对象、卸载结果隔离。

新增15项：趋势 snapshot 参数/已应用筛选/粒度/stream映射、shape/旧图清空、迟到趋势；模型三来源参数及服务端数值映射、迟到来源、错误重试；排名服务端排序/Top limit/筛选、排序竞态、shape失败、用户下钻；固定列与独立偏好、偏好恢复白名单、存储失败不撤销本地选择；官方枚举及未知输入；三类聚合请求卸载隔离。

`pnpm --filter @sub2-mac/console typecheck`：最终通过（exit 0）。未执行全工作区 build，由主任务统一集成。

## 限制与后续验收

- 本卡未执行浏览器，不能把模板编译和状态机测试当作 Tab/Enter/Escape、多窗口层级或390px视觉实测；确认层错误已直接接入现有 MacAlertSheet slot，需主任务浏览器夹具复核。
- 真实后端、实时任务进度、真实导出、删除和取消任务均未操作。
- 本次用户明确要求的趋势、模型分布、用户排名、列配置及错误枚举已完成实现与隔离测试。官方其他功能如分组/端点分布、用户余额历史弹层、复杂用量列单元格细节等不在本次追加清单中，仍不能宣称整页100%复刻。
- CSV采用全量内存聚合；无后端快照事务。总数/重复/缺页变化可检测，但同总数且不同记录的并发替换无法证明快照一致性，大量数据仍受浏览器内存限制。
- 清理/保存网络失败可能发生“服务端成功但响应丢失”；不可宣称幂等。当前提示检查任务/列表，未引入后端重试协议。

## 最终同步通知（ChartJS 夹具修正）

主任务在并行中间状态遇到 imports stripped 后 ChartJS 未定义；当前测试已使用真实 chart.js 导出并按实际组件 import 别名自动注入，不再依靠空 register stub。`node --test scripts/parity-admin-usage.test.cjs` 亲自复跑48/48通过。此次只修改测试脚本和本报告，业务Vue保持上一轮最终状态，可在本线最终通知后启动总复测。
