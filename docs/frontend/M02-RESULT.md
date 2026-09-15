# M02 · 管理应用实现结果

日期：2026-09-11。状态：本轮关键流程已实施，可交主任务集成；不代表上游全部管理能力已移植。

## 范围与约束

- 已读取 EXECUTION_PLAN.md、DESIGN.md，并按 ui-ux 做局部交互质量检查；未使用 frontend-skill。
- 仅修改本任务负责的 admin Vue、admin-polish.css、admin-feedback.ts 与本文档。没有改 API、core、stores、manifest、全局/用户样式、图标、壁纸、玻璃登录、后端、真实配置或只读上游。
- 参考：output/parallel-20260911/upstream/frontend；由主任务提供的 HEAD 为 98d86915becae9fe9491a91ffc6defd5235c8d2b。参考目录只读。
- 没有操作浏览器、启动临时服务器、执行真实管理写入或全工作区 build。没有覆盖/恢复整目录。

## 逐页实际结果（11 个管理 App）

| 应用 | 本轮实现 | 上游对照与关键缺口 |
| --- | --- | --- |
| AccountsApp | API Key 支持自定义端点和 Antigravity 上游；新增 Anthropic OAuth/Setup Token 已取得访问令牌录入、Bedrock SigV4/API Key、Anthropic/Gemini Vertex Service Account 结构化凭据；按选择的 type 发创建载荷。编辑默认不提交凭据，可显式替换；提交前取最新账号并保留非敏感配置如 model_mapping。校验必填/JSON/区域/端点，成功后清空本地凭据。新增、批量编辑、CRS、导入 Sheet 加提交锁。 | 对照 CreateAccountModal/EditAccountModal 的凭据字段。完整交互式 OAuth、各平台授权码/刷新元数据、Codex PAT/session 专用流程、Gemini OAuth、上游账号扩展调度配置未移植；录入访问令牌不承诺续期。 |
| UsersApp | 停用用户增加附着确认和请求锁；余额拒绝负数/非法数值；授权分组在完整加载前禁写，失败可重试，保存防重入。API 密钥切换用户时清空旧数据并以请求代次屏蔽过时响应，弹层可重试，并提示返回数量不足。保留已有 MacSheet。 | 对照 UsersView 与现有 users API。getUserApiKeys 包装没有分页参数，不能在本任务禁改 API 的范围内保证该明细全量，现明确显示截断提示；平台额度、身份绑定等高级表单未补齐。 |
| GroupsApp | 停用分组增加确认和请求锁；复制防重入；快速倍率/RPM 校验与提交锁；创建/编辑 Sheet 标题区分。保留已有 MacSheet。 | 对照 GroupsView。组合路由、细分定价、模型白名单、利润控制等上游高级配置未移植。 |
| ChannelsApp | 渠道保存接通计费模型来源、限制已定价模型、模型定价/映射、账号统计定价开关；保留原有高级定价规则与 features_config。模型映射检查缺项/重复及危险对象键，价格检查非法/负数。分组读取全量接口，失败显示重试且不覆盖绑定。去除服务端分页后再次本地过滤导致的隐形行。删除最后页后返回有效页。停用渠道增加确认。 | 对照 ChannelsView。价格输入明确标注美元/Token；完整阶梯/时段、图片/视频专属字段、features_config 和账号统计规则的专门编辑器未移植，已有结构保留；需后续真实定价验收。 |
| ChannelsApp / 监控 | 监控读取全部页后本地筛选，避免默认首屏截断。配额模式接通 account_id，验证关联账号 ID，probe 更新发 0 解绑，创建不发 0。校验端点/模型/周期/凭据及 Antigravity 仅 quota 的限制。监控删除、保存和状态切换防重入，错误显示在 Sheet 内。 | 对照 ChannelMonitorView 和既有 channelMonitor API。关联账号目前输入 ID，由后端核验平台一致性；账号搜索选择器、探测历史图、extra headers/body/template/API mode 等高级表单仍待补齐。 |
| AnnouncementsApp | 创建/编辑/预览从全屏 Teleport 迁到窗口 MacSheet，失败提示在表单内；提交中锁关闭。修复 UTC 时间截断后被当本地时间二次偏移；结束早于开始时阻止提交；删除末页后页码归位。 | 对照 AnnouncementsView。预览保持纯文本安全展示，Markdown 渲染/受众条件等上游高级能力未补齐。 |
| SubscriptionsApp | 用户候选逐页取全量，后端限制每页数量仍继续取；辅助读取失败后可在 Sheet 重试且禁分配。分配/延期迁到 MacSheet，校验正整数天数并锁提交/关闭。 | 对照 SubscriptionsView。大量用户尚需搜索式选择器；未新增订阅批量分配或完整使用详情。 |
| CommerceApp | 兑换码 CSV 从本页自行拼接改为既有 exportCodes 全量导出接口，传当前筛选，防重复导出并显示错误；计划分组使用全量接口且读取失败不吞错；退款验证大于零且不超过实付金额。 | 对照 RedeemView、订单/计划与优惠码/佣金页面入口及现有 API。其余商业弹层未全面迁 MacSheet；批量兑换码、佣金深层配置等仍不完整。未执行任何支付、退款或充值请求。 |
| SecurityApp | 修复已取得审核记录却总显示暂无记录：真实表格、输入摘要按需展开、总数和分页。同步处理中/检查/放行/拦截/异常/耗时从写死 0 改为 runtime 字段；审核 Key 负载渲染真实 masked 记录。未知计数/配置版本显示占位。操作日志加载期间禁翻页。 | 对照 RiskControlView、AuditLogView 和既有类型。风险策略编辑、解除封禁/命中哈希管理、完整日志详情和提示词节点管理仍有缺口；未声称风控管理完全对齐。 |
| ProxiesApp | 新增编辑入口复用表单，调用 update；密码留空保留；创建/编辑迁 MacSheet 并显示表单错误。修正原有 expire_at 错误字段：发送 expires_at Unix 秒，列表读取 expires_at，清空有效期发送 null。地区为探测字段，去除不可保存的地区输入。批量解析校验协议/端口、支持 URL/方括号 IPv6、HTTPS 默认443、密码冒号不截断。测试读取 success=false 并显示错误，不再静默当完成；请求锁和成功结果可见。 | 对照 ProxiesView 与 Create/UpdateProxyRequest。其余批量/质量/关联账号弹层仍为旧式；代理到期 fallback 等高级配置未新增。 |
| PluginsApp | 启停插件增加明确确认，未测试版本不再无提示 accept_untested=true；不兼容/启动中禁止启用操作。恢复现有 test 接口入口，显示成功耗时或失败原因，保留卸载确认与防重入。 | 对照 PluginsView。插件 UI session/bridge 配置与渐进 rollout 编辑未移植，启用确认明确当前100%匹配流量。 |
| OpsApp | 补齐类型和 API 已支持的6小时/24小时时间范围，保留原有快照错误恢复及刷新生命周期。 | 对照 ops/OpsDashboard。复杂趋势图、告警、日志、运行时设置未新增；本轮只补明确断开的筛选选项。 |

## 共用的局部改动

- admin-feedback.ts 增加 collectAdminPages：按服务端 total 持续读取、ID 去重、检测无进度/畸形响应并抛错；只供管理 App 使用，不改 API 层。
- admin-polish.css 增加附着编辑器的局部控件、分组详情、可见错误样式，全部沿用既有主题变量；未触碰 app-polish.css 或 Tailwind 配置。
- AdminFeedback.vue 本轮只审阅，未修改。

## 验证证据

1. `pnpm --filter @sub2-mac/console typecheck`：最终通过（退出码0）。中途发现并修正本任务的 Object.hasOwn 目标库、Proxy expires_at/协议/nullable 日期类型问题。曾观察到其他任务 MacLockscreen 的类型错误，未越界修改；最终检查时已不再报错。
2. 内存隔离夹具：用 TypeScript transpileModule 提取现有 `<script setup>`，注入 ref/computed 与纯内存 API stub；23 项断言通过。覆盖 API Key、Antigravity、Bedrock 两种模式、非法/合法 Vertex、Setup Token、创建 type、未改凭据省略、替换保留映射、后端每页仅40条时完整83条、重复分页拒绝、渠道字段/重复映射、quota必填/绑定/probe解绑、代理协议端口/IPv6/密码冒号、公告时区往返。
3. 后续回归：12 个 admin Vue（含 AdminFeedback）SFC parse + compileTemplate 全部通过；3 项附加场景通过：同页重复ID去重、畸形分页响应拒绝、代理 update 的 Unix 秒/正确字段/密码省略。
4. 上述夹具在命令标准输入中运行，输出保存在本任务工具记录；未生成额外测试文件，API 全部为 stub，没有网络或真实写入。
5. 未执行 build（由主任务统一执行），未执行浏览器/截图/键盘/移动端视觉验证，未连接真实管理 API。以上仅证明类型、模板编译与隔离载荷/状态逻辑。

## 改动文件

所有代码路径相对 `packages/sub2-console/src/apps/admin/`：

- AccountsApp.vue
- UsersApp.vue
- GroupsApp.vue
- ChannelsApp.vue
- AnnouncementsApp.vue
- SubscriptionsApp.vue
- CommerceApp.vue
- SecurityApp.vue
- ProxiesApp.vue
- PluginsApp.vue
- OpsApp.vue
- admin-feedback.ts
- admin-polish.css

独立结果：`docs/frontend/M02-RESULT.md`。不修改共享 EXECUTION_PLAN.md，避免并行覆盖。

## 主任务集成建议

- 统一构建后，优先用拦截 API 的浏览器夹具验证新增 Sheet 的焦点/关闭锁、390px 表单滚动与渠道定价单位呈现；本轮无视觉验收截图。
- 不把认证载荷/表单静态验收写成 OAuth 真实授权、计费准确性、真实退款或生产管理验收。
- 继续按上表缺口逐卡处理，避免把“11页已审阅”当作“全部上游功能已补齐”。
