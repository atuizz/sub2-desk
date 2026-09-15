# 官方功能补齐 · 运维 / 插件 / 风控分线任务卡

日期：2026-09-11。状态：本分线主要流程已实现，2026-09-12已增补O1–O7子卡；87 项隔离检查通过；交主任务集成，未宣称全部官方功能或真实后端验收完成。

## 范围与依据

- 已读 `EXECUTION_PLAN.md`、`DESIGN.md`、`UPSTREAM_PARITY.md`。本卡作为 F08–F14 并行轮次中运维/插件分线的实际实施回写；为避免跨线覆盖，不修改共享计划和 parity 总表。
- 官方只读参考：`output/parallel-20260911/upstream/frontend`，用户指定固定 0.2.4。参考其 `src/api/admin/ops.ts`、`plugins.ts`、`views/admin/PluginsView.vue`、`composables/useStepUp.ts`、`views/admin/ops/components/OpsAlertRulesCard.vue`、`RiskControlView.vue`。
- 本地服务 0.2.1 是用户提供及既有总表记录的运行基线。本次没有请求本地服务，不能证明 0.2.4 的新增端点已在该服务启用。
- 保持 Vue 3、现有 API 封装和 MacSheet/MacAlertSheet/MacButton。不引入 UI 框架、业务后端实现或演示 fallback；使用 ui-ux 流程核验，未使用 frontend-skill。

## 实际变更文件

均位于用户独占边界：

- `packages/sub2-console/src/apps/admin/OpsApp.vue`：保留概览，新增七个独立运维分类入口。
- `packages/sub2-console/src/apps/admin/PluginsApp.vue`：配置会话入口、无效列表响应报错。
- `packages/sub2-console/src/apps/admin/SecurityApp.vue`：策略入口、日志筛选与真实详情读取、提示词事件删除当前页确认，旧详情/审核配置/清理弹窗迁入 MacSheet。
- `packages/sub2-console/src/apps/admin/operations/OperationsPanel.vue`：请求、错误、日志、规则、事件、静默、关联上游错误、趋势/并发。
- `packages/sub2-console/src/apps/admin/operations/LogMaintenanceSheet.vue`：日志运行配置、恢复后端默认、写入健康、指定时间及筛选范围清理。
- `packages/sub2-console/src/apps/admin/operations/RecordDetails.vue`：多场景复用的中文字段详情；文本插值展示，不执行日志 HTML。
- `packages/sub2-console/src/apps/admin/operations/RiskPolicySheet.vue`：内容审核策略编辑。
- `packages/sub2-console/src/apps/admin/operations/PromptPolicySheet.vue`：提示词策略与节点编辑、排序、连接探测。
- `packages/sub2-console/src/apps/admin/plugins/usePluginStepUp.ts`：插件管理动作的统一官方TOTP单次重试与取消/卸载隔离。
- `packages/sub2-console/src/apps/admin/plugins/PluginConfiguration.vue`、`plugins/bridge.ts`：沙箱配置页、会话和桥接验证、敏感操作确认与官方 TOTP step-up。
- `scripts/parity-operations.test.cjs`、本文档。

`api/admin/ops.ts`、`plugins.ts` 原有封装已具备本次所需端点，直接复用，没有为增加 diff 而重写它们。隔离测试实际执行这两个封装，核验方法、路径和 payload。

没有修改 server、真实配置、根二进制、旧原型、图标、manifest、App、其他业务 App 或共享 core。未创建服务、浏览器标签或工具窗口；未运行全局 build。

## 可操作流程与覆盖

| 入口 | 本次实现的流程 | 契约与边界 |
| --- | --- | --- |
| 运维 → 请求 | 时间/平台/结果/关键词查询 → 服务端分页 → 详情；错误请求进入真实错误详情 | `listRequestDetails`，25条/页；成功请求展示返回字段，不伪造请求正文 |
| 运维 → 请求错误 / 上游错误 | 分开查询、已解决筛选、分页 → 对应详情 → 确认解决或重新打开 | 使用 split endpoints，不能混用 error ID 的详情/resolve 路由 |
| 请求错误详情 → 关联上游错误 | 独立读取、分页、展开每次上游错误详情 | `listRequestErrorUpstreamErrors(id, {page,page_size}, {include_detail:true})`；关闭详情后丢弃旧响应 |
| 运维 → 系统日志 | 时间/平台/级别/关键词查询 → 分页 → 完整返回记录详情 | `listSystemLogs`；失败保留旧行，HTML/无效200响应不能当空列表成功 |
| 运维 → 告警规则 | 新建/编辑 → 指标、比较、阈值、窗口、持续、冷却、级别、邮件、平台/分组 → 保存；启停/删除需确认 | 覆盖14个官方指标；分组指标要求有效group_id；编辑保留未知filters维度；不回传created_at等服务端字段 |
| 运维 → 告警事件 | 时间/平台/状态/级别筛选 → 游标翻页 → 详情 → 手动解决 | 使用 `before_fired_at + before_id`；取26条、展示25条判断下一页，不假装支持offset或总数 |
| 告警事件 → 静默通知 | 确认规则范围、平台/分组/区域、时长和原因 → 提交 → 到期恢复通知提示 | `createAlertSilence` 使用绝对ISO到期时间；静默不等于解决事件 |
| 运维 → 趋势与并发 | 时间/平台查询 → QPS/TPS样本条形及数值 → 平台/分组/账号并发占用和排队 | 两项读取独立处理部分失败；保留已有概览60秒刷新，新分类手动刷新 |
| 插件 → 配置 | 建立UI会话 → 沙箱页面 → 配置读取 → 宿主确认保存/测试 → 必要时官方TOTP验证 → 结果回复 | 不给iframe管理员token；不信任任意postMessage；不把插件通知当成已验证宿主成功 |
| 内容审核 → 审核策略 | 独立读取当前配置 → 分组/模型/采样范围 → 关键词/分类阈值/拦截 → 自动封禁与保留周期 → 保存 | 显式可编辑payload，不提交脱敏密钥元数据；未命中保留上限按官方为3天；读取失败禁写 |
| 内容审核 → 审核记录 | 官方result/关键词/分组/入口筛选 → 已有服务端分页 → 详情 | result为hit/blocked/pass/error；详情显示分类得分、阈值快照、命中词、输入摘要、队列耗时与封禁结果 |
| 操作日志 → 详情 | 点击记录 → `auditAPI.get(id)` → 完整脱敏请求体等；失败重试 | 不再将列表行直接当作完整详情，关闭/换记录隔离旧结果 |
| 提示词审计 → 事件 | 筛选分页 → `getEvent(id)`获取完整提示词 → 当前页删除确认 | 删除仅提交确认时捕获的当前页ID，不误称“删除所有筛选结果”；删除成功回首页重读 |
| 提示词审计 → 编辑策略与节点 | 读取当前版本 → 启停/拦截/扫描/分组/线程队列 → 节点新增/修改/移除/优先级排序 → 测试 → 保存 | 保留 `expected_config_version`；空token不覆盖已有密钥，清除和替换互斥；连接测试成功与失败分别呈现 |

## 插件桥接约束

1. 接受后端返回的同源 HTTP(S) 配置会话，要求有效 token、未来到期时间和 `ui_bridge_version=1`。异源或未知版本显式失败，不自作主张转发凭据。
2. iframe 固定 `sandbox="allow-scripts"`、`referrerpolicy="no-referrer"`；不添加 allow-same-origin、弹窗或顶层导航权限。
3. 消息须同时匹配当前 iframe `contentWindow`、opaque origin `null`、`source=sub2api-plugin-ui` 与当前 bridge token。仅处理官方 config.load/save/test、ui.resize/notify；未知消息无权限。
4. 配置请求必须有非空 request_id；拒绝并发重复ID，最多32个待响应请求，30秒超时。回复只给仍有效的对应请求。
5. 首次load前发出的合法配置请求保留；后续iframe导航、会话关闭/过期、重连均失效旧响应。旧请求即使与新文档复用相同ID也不能泄露配置。
6. 保存/测试需要宿主确认；确认及step-up完成后再次核对请求、文档、会话有效性，超时确认不能继续写入。后端 `STEP_UP_REQUIRED` 才请求6位TOTP；验证成功只重试一次。未启用TOTP、禁用管理员API key、其他后端阻断直接显示错误，不绕过。
7. 页面15秒未load有重连提示，会话到期清空桥接。插件通知带“插件消息”标记，长度限制500字符。关闭时取消确认，移除消息监听和计时器。

## 实际验证

从仓库根目录运行：

```powershell
node --test scripts/parity-operations.test.cjs
node scripts/parity-operations.test.cjs --typecheck
```

第一条：**45/45通过**。其中9项Vue SFC/script/template编译，36项实际源码隔离行为/接口测试。测试用VM执行真实组件脚本，使用拒绝外网的API夹具，不是字段存在性断言。覆盖分页、游标、详情重试/关闭隔离、部分失败、无效200响应、规则CRUD payload/防重入、关联上游请求、静默范围/到期时间、插件伪造/重复/超时/导航/过期/step-up、风控策略校验、提示词节点顺序/保密字段/版本冲突及真实API包装路径。

第二条：**退出1，不能记为类型检查全通过**。临时tsconfig仅include本线9个Vue入口及项目声明文件，继承真实项目/core类型；不会修改宽严规则或生成全局构建。最终诊断仅在边界外共享core：

- `packages/mac-ui-core/src/components/MacDock.vue:251`：回调参数 `el` 隐式any。
- `packages/mac-ui-core/src/components/MacMenubar.vue:523`、`:526`、`:528`、`:529`：回调参数 `val/id` 隐式any。

本线自身无剩余类型诊断。上述5项交主任务共享组件负责人处理，不越界修复。临时配置创建于系统临时目录，命令结束删除。

未运行真实浏览器、浅深色/390px视觉检查、全局构建或真实后端联调；未提交真实支付、账号、配置、插件安装/测试或升级操作。这里“通过”只指隔离契约和脚本行为，不等于本机0.2.1、完整官方0.2.4或生产验收。

## 未完成项与主任务集成建议

- 本卡是主要流程补齐，不是Ops全部高级功能完成。高级保留/聚合、WebSocket消费者已在O4/O6补齐。邮件通知、告警运行参数、延迟/错误分布、Token专项统计和实时汇总轮询见O1/O3；不代表全部官方Ops图表/高级参数均已原生覆盖。
- 插件UI桥接及管理侧上传/启用/停用/卸载/测试均已接入官方step-up语义。本轮已消除原管理动作缺少验证入口的缺口；真实TOTP及插件行为仍未联调。
- 内容审核密钥池管理/探测、解除用户封禁已在2026-09-12补齐前端和隔离测试；命中hash删除/清空已在O5补齐。模型/分组编辑使用明确ID/模型文本，未跨线修改或引入分组选择器。
- 后端0.2.1可能缺少0.2.4入口或关闭功能。前端应保留错误/重试，主任务在授权的隔离集成环境逐项验证，不用自动降级到演示数据或旧统一错误端点。
- 主任务集成时：从现有Ops/Plugins/Security打开新入口；在完全拦截业务请求的夹具中验证规则保存/静默/标记解决、iframe消息与TOTP、策略保存、日志详情和节点操作，再验证MacSheet键盘焦点/重叠窗口/窄屏。无需改manifest或App即可到达本次新增入口。
- 更新共享 `EXECUTION_PLAN.md`/`UPSTREAM_PARITY.md` 时使用上表逐项覆盖，不将该分线全部标为“完整官方功能已完成”。


## 最后集成点增量（2026-09-11）

### SecurityApp 窗口路由协议

- 接受 `win.customData.tab` 的 `audit`、`risk`、`prompt` 三种值，首次渲染同步选择对应页；缺失或非法初值默认audit。
- 响应后续原地修改tab、替换customData对象和替换win；即使新customData的tab与此前外部值相同，也作为新的导航意图覆盖当前手动选择。
- 非法值、删除customData不改变当前页；仅修改customData中的无关字段不打断用户选择。组件卸载停止watch。
- 保持原有数据加载逻辑，主任务可通过已有窗口数据更新直接导航，无需在main/App之外另加本线注册表或业务路由。

### 独立补齐的剩余流程

1. 插件管理的安装、启用、停用、卸载、列表连接测试统一使用 `usePluginStepUp.run`。后端返回 `STEP_UP_REQUIRED` 才打开TOTP Sheet，验证成功仅重试原动作一次；不启用TOTP等其他阻断不重试。取消、窗口卸载和迟到验证不能触发重试；提交中防重入。现有启停/卸载确认保留，验证码Sheet显示在其上层。
2. 运维 → 系统日志 → 运行配置与清理：独立读取运行配置和sink健康，任一失败不掩盖另一项结果。可编辑日志级别、采样开关/参数、调用位置、堆栈级别、保留天数；显式payload不提交source/更新者元数据。支持确认恢复后端默认。
3. 系统日志清理要求显式填写有效起止时间，再确认平台/级别/关键词和绝对时间范围。确认时冻结筛选快照，不随后续表单修改扩大范围；不会发空payload的无边界删除。成功显示后端deleted并刷新外层日志；失败保留确认供重试。

新增9项检查（相对上一轮36项）：1项新增Sheet SFC编译、2项Security窗口路由、3项插件管理step-up及接线、3项日志配置/清理/恢复行为。最终45/45通过；范围typecheck仍只有上文5项共享core诊断，无本线新增诊断。主任务负责main/App路由和全局验收，本线未触碰这些文件。


## 2026-09-12 子卡 O1：邮件通知与告警运行参数

已核对此前45项覆盖，没有重复实现插件step-up、日志维护或Security窗口tab。新增 AlertSettingsSheet：告警/报告收件人、通知级别、限流/合并窗口、恢复通知、四种定时报告；运行评估间隔、分布式锁、四项nullable阈值、全局及逐条静默。入口位于告警规则/事件页。独立读取、失败禁写、保存失败保留草稿、关闭隔离迟到响应；保留现有静默条目和其他已读取配置。

`node --test scripts/parity-operations.test.cjs`：49/49通过（新增1项SFC及3项行为测试）。仅夹具保存，没有真实发信或配置操作。剩余下一卡：审核密钥池/探测/解封，随后分布图与实时统计。


## 2026-09-12 子卡 O2：审核密钥池与解除封禁

新增 RiskKeysSheet：读取脱敏池状态，追加/替换/按hash移除/清空的互斥校验与确认快照；分别探测已保存池和新输入密钥，沿用已保存base_url/model/timeout/proxy（null映射0直连），支持文本和图片URL测试输入，展示逐项结果及审核分类结果。新增审核记录详情中的解封确认，严格使用官方 `auto_banned && user_id && user_status === disabled` 可见条件，同用户所有记录同步返回status。

`node --test scripts/parity-operations.test.cjs`：54/54通过（本卡新增1项SFC、4项行为）。未操作真实密钥、探测服务或用户账户。剩余：分布/实时统计；hash缓存删除清空和高级保留聚合仍未实施。


## 2026-09-12 子卡 O3：分布图与实时统计

新增 TrafficAnalysis，接入运维“趋势与并发”页：延迟区间分布、HTTP状态码错误分布、各时间桶SLA错误比例与429/529数量；实时汇总QPS/TPS当前/峰值/均值；OpenAI按模型Token数/速率/首字和耗时，独立1h/30m/1d/15d/30d选择及25条分页。没有复制后端统计计算，仅把官方桶/汇总结果渲染为条形与数值。

实时统计按官方OpsDashboardHeader使用 `getRealtimeTrafficSummary('1min', platform)`（不是 `1m`）。用户可开启5秒轮询，后台标签不发查询、并发查询防重入、卸载清理timer。失败保留旧快照并显示错误，不生成零；enabled=false明确标注关闭。没有新增WebSocket消费者，不能把轮询实现记成WS验收。

`node --test scripts/parity-operations.test.cjs`：59/59通过（本卡新增1项SFC、4项行为）。本轮相对45项基线新增14项：3项SFC、11项行为。未运行全局build、真实后端操作或真实浏览器验收。`node scripts/parity-operations.test.cjs --typecheck`仍退出1，仅共享core的5项回调隐式any；本线新增文件无类型诊断。共享主任务的全项目typecheck历史成功记录不等于此独立include配置成功，两者结果需分别保留。

### 当前最终覆盖和剩余

- 本轮新增文件：operations/AlertSettingsSheet.vue、RiskKeysSheet.vue、TrafficAnalysis.vue。修改OperationsPanel、SecurityApp、隔离测试和本文档，保留此前交付及并行改动。OpsApp/PluginsApp及API封装本轮无需再改。
- 已完成的Security窗口tab、插件全部管理step-up、日志维护、原规则/事件/详情流程均保留，不重复记为本轮新完成。
- O1–O3完成时的剩余：Ops高级保留/聚合、WebSocket消费者、hash维护已随后在O4–O6消除。真实邮件发送、真实密钥池探测/解封、后端0.2.1兼容性与视觉/键盘全局验收仍未完成。
- 主任务setup/batch、main/App和全局验证不在本线；本次未改这些文件，没有进行真实发信、保存配置、密钥写入、探测或解封。


### 2026-09-12 收尾复测

最后补3项行为：邮件保存失败保留草稿及并发提交只发一次；运行静默条目缺省severities可编辑与非法rule_id校验；解除封禁失败保留确认、窗口关闭后忽略迟到状态。

最终 `node --test scripts/parity-operations.test.cjs`：**62/62通过**（12项SFC、50项行为/契约；相对45项基线新增17项）。上文49/54/59为各子卡完成时的真实中间结果，不是当前总数。范围typecheck末次仍仅5项共享core TS7006，退出1；本线没有修改共享core或放宽检查。未跑全局build、未做真实业务操作。


## 2026-09-12 子卡 O4：高级数据保留与聚合

新增 `operations/AdvancedSettingsSheet.vue`，入口位于运维子页“数据保留与聚合”。独立读取 `getAdvancedSettings`，支持定期清理启停、Cron计划、错误日志/分钟指标/小时指标保留天数（0–365整数）和聚合启停。`updateAdvancedSettings`提交当前完整配置副本，仅编辑本卡字段，保留配额自动暂停、忽略错误和显示/刷新等其他已读取配置；未将这些额外字段宣称为可编辑UI。读失败禁写、确认快照不随之后的表单修改漂移、保存失败留草稿。

**0天语义已按官方中文源核对：每次定时清理时清空该类全部历史，不是无限保留。** 页面说明与确认均明确说明。保存只是配置更新，未调用立即清理或执行后端任务。

本卡新增1项SFC、2项隔离行为：范围/计划校验、保存确认、保留未编辑字段、失败禁写/保留草稿。

## 2026-09-12 子卡 O5：命中哈希缓存维护

新增 `operations/HashCacheSheet.vue`，入口“风控 → 命中缓存”。读取 `getStatus().flagged_hash_count` 后才能操作；输入64位十六进制内容SHA-256，规范为小写，确认时冻结hash，调用 `deleteFlaggedHash`；单删未命中明确显示“未找到”而非删除成功。全量清空另开危险确认，调用 `clearFlaggedHashes`，只展示返回deleted计数。失败保留确认，响应形状无效不报成功，成功后刷新状态。没有删除审核日志或真实缓存。

本卡新增1项SFC、3项隔离行为：哈希校验/冻结确认、单删与清空路径区分、读/写失败与无效响应。

## 2026-09-12 子卡 O6：官方WebSocket消费者与资源生命周期

新增 `operations/liveConnection.ts`，由TrafficAnalysis“WebSocket推送刷新”选择启用（默认关闭，与5秒轮询互斥）。复用现有官方 `opsAPI.subscribeQPS`：握手仍使用 `sub2api-admin` + `jwt.<token>` 子协议，URL不包含管理员token；不复制认证或改变网关路径。

- 不猜测旧WS指标payload结构：合法对象消息触发500ms合并刷新，然后从已验证类型的 `getRealtimeTrafficSummary('1min',platform)` 获取显示统计。握手成功仅表示已连接，UI明确不等于有效业务样本。
- 官方封装提供自动重连；消费者配置5次重试、30秒无消息检测、10秒检查周期。断网保留快照；online恢复由官方封装处理。可手动重连。
- 后台标签关闭连接并清理待刷新定时器，显示暂停；前台恢复新连接。服务端4001（实时功能关闭）后禁止自动重连，须用户显式重试。
- 切换到轮询、关闭WS或卸载组件：取消合并刷新、关闭socket、清理visibility/online/offline监听、重连及心跳timer。generation隔离旧连接回调，不能让旧消息/旧onOpen覆盖或刷新新页面。
- 对独占 `api/admin/ops.ts` 作最小修复：重试预算也约束首次open之前的持续失败；旧socket/已dispose回调不再执行；WebSocket构造异常转入受预算约束的错误/重连流程。保留其他API契约。

本卡新增7项隔离行为：独立消费者的合并/可见性/旧回调/卸载/禁用恢复；真实官方WS封装在FakeWebSocket下的认证路径、初次重试上限、有效/无效JSON、4001终止、离线恢复、心跳超时、构造异常及所有资源清理。没有调用真实WebSocket或读取真实token，测试使用固定fixture-token。

## 最新验证及主任务集成边界

- `node --test scripts/parity-operations.test.cjs`：**76/76通过**（14项SFC编译、62项行为/契约），相对前一轮62项新增14项。49/54/59/62/73等数字保留为子卡阶段证据，不是当前总数。
- `node scripts/parity-operations.test.cjs --typecheck`：本轮末次仍仅报MacDock:251与MacMenubar:523/526/528/529的5项TS7006，退出1；本线新增文件和API修复无类型诊断。没有触碰这些共享core文件或放宽类型规则。
- 本轮新文件：AdvancedSettingsSheet.vue、HashCacheSheet.vue、liveConnection.ts；现有修改仅OperationsPanel.vue、TrafficAnalysis.vue、SecurityApp.vue、api/admin/ops.ts、隔离测试及本文档。没有越界修改setup/batch/main/App或并行文件。
- 本轮仍只做前端和隔离验证：无真实保留策略变更、hash删除、WS连接、邮件发送、密钥写入、探测、解封；无全局build和新浏览器验收。主任务继续统一setup/batch与全局验收。
- 用户本轮点名的三组功能均已实现。仍不能宣称全部官方对齐：O6结束时尚余的高级错误忽略/展示偏好/配额自动暂停UI、账号可用性/用户并发专用视图已随后在O7实现。更多细分筛选图表、真实0.2.1兼容性和外部副作用仍未全面验收。


## 2026-09-12 子卡 O7：高级结构化编辑与容量子视图（最终收口）

### 高级设置编辑与保存

- AdvancedSettingsSheet 增加5类错误忽略开关（Count Tokens、客户端取消、无可用账号、无效API Key、余额不足）、告警/Token展示开关、自动刷新开关与间隔、OpenAI 5小时/7天默认配额自动暂停阈值。
- 配额阈值UI按百分比显示，`37.5% -> 0.375`；0表示关闭该窗口全局默认阈值。空值、负值和超过100%拒绝保存；保留未修改的已读取字段。后端未提供的开关/配额对象显示不支持，不创建虚构默认值写回。读取失败不能保存。
- 保存仍冻结完整草稿进行确认，成功通过saved事件将服务器返回偏好同步父窗口。保存失败保留草稿，晚到的初始化配置请求不能覆盖刚保存的偏好。

### 展示/刷新偏好实际消费

- Ops概览按 `display_alert_events` 显示最近5条告警，保留“查看全部”入口；关闭开关会失效尚在等待的卡片请求。
- TrafficAnalysis按 `display_openai_token_stats` 控制模型统计卡片；隐藏后不再请求Token统计，已在途响应不能重新显示旧数据。
- Ops概览及OperationsPanel按已保存的 `auto_refresh_enabled/auto_refresh_interval_seconds` 刷新；未知偏好不启用自动刷新，读失败可重试。后台标签暂停，其他子页打开时概览不继续刷新；规则编辑/操作提交不被自动刷新打断。
- 子页刷新会同步触发分布统计和容量快照；手动5秒实时轮询/WS选项保留，二者仍互斥。显示偏好不伪造业务状态或修改后端统计计算。

### 账号可用性与用户并发

新增 `operations/CapacityPanel.vue`，位于“运维 → 趋势与并发”，提供两个独立切换子视图：

- 账号可用性：`getAccountAvailabilityStats(platform,groupID)`；平台/分组汇总，账号可用、不可用、限流、过载、异常筛选；展示恢复时间、错误原因，详情展示完整返回状态。
- 用户并发：`getUserConcurrencyStats()`，明确是全局快照，不受平台/分组过滤；展示用户名称/邮箱、占用/容量、排队、负载；支持使用中/有排队筛选和详情。
- 两项API返回完整字典快照，前端按快照做本地搜索与25条分页，明确显示筛选数/快照数，不截断第一页。未知/功能关闭/空快照/失败区分显示；刷新失败保留旧快照，切换视图和卸载隔离迟到响应。

### 最终验证

- `node --test scripts/parity-operations.test.cjs`：**87/87通过**（15项SFC编译、72项源码行为/契约）。相对76项新增11项：1项Capacity SFC，10项高级编辑/偏好消费/容量视图行为。
- 验证包括百分比正确转换、保存事件、已有字段保留、非法值禁止写入、偏好晚到响应隔离、刷新节奏/后台暂停/编辑防打断、Token隐藏后的在途响应隔离、完整30条容量快照分页、全局用户排队筛选、切换/失败/禁用/无效响应。
- `node scripts/parity-operations.test.cjs --typecheck` 末次仍退出1，诊断仅共享MacDock:251及MacMenubar:523/526/528/529的5项TS7006；本线无新类型诊断。未修改共享core，不把主任务全项目检查与本脚本include范围结果混记。
- 用户转述主任务“邮件配置真实DOM夹具6场景通过”。这是主任务集成证据，本线没有重跑或核对其具体截图/日志，不记成真实发信成功。
- 本轮修改只在OpsApp、OperationsPanel、AdvancedSettingsSheet、TrafficAnalysis、RecordDetails、新CapacityPanel、测试和本文档；没有修改setup/batch/main/App、图标、真实配置或server。

### 剩余边界

用户本轮明确要求的高级设置UI及账号可用性/用户并发子视图均已完成，不再列为小缺口。整个分线尚不能宣称所有官方页面逐项完整对齐：更细粒度请求筛选/图表组合未全量审计；本机0.2.1与参考0.2.4兼容性、真实邮件/配额自动暂停/解封/密钥/缓存/WS行为均未执行。本线未跑全局build或本轮视觉/键盘全局验收，交主任务统一集成。
