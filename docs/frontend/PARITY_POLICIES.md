# PARITY-POLICIES-01 / 02 / 03–05 · 分组、渠道、用户高级编辑

日期：2026-09-11。此独占任务卡承接 EXECUTION_PLAN.md 的 N05 / 官方功能补齐；为保留其他并行工作的文件边界，本线只在本文回填状态，不编辑 EXECUTION_PLAN.md 或 UPSTREAM_PARITY.md。

状态：子卡 01–05 已实施，本轮指定的渠道功能、创建属性、属性筛选/批量、多媒体定价与 manifest 已收口。最终 48/48 隔离测试及独占类型检查通过；不是整个官方平台或真实 0.2.1 后端验收。

## 2026-09-12 续作实况：子卡 03–05

开始前核对落盘：上次 features_config 轮次仅做源码读取，目录未有该组件；保留此前 36 项已完成实现。本次新增功能不改壁纸、全局类型、Account App、主任务 setup/batch 范围；所有业务写操作仅由内存测试夹具执行。

- **03 已实现**：官方 features_config 三项：Anthropic web_search_emulation、OpenAI codex_image_generation_bridge、Anthropic bedrock_cc_compat。开关结构化编辑；保留未知顶层/其他平台字段，显式 false 可保存；兼容已有布尔和平台映射两种回显。官方 0.2.4 ChannelsView 的 Bedrock 读取用布尔、写入用映射，二者并不一致；本实现保留实际返回的旧布尔形状，新增采用官方写入的映射形状，真实服务端行为待验。ChannelsApp 监听 win.customData.tab 变化，在复用窗口时切到 pricing/monitor 并加载对应列表，忽略非法值。子卡检查：38/38，独占类型检查退出码 0。
- **04 已实现**：创建用户时联动结构化属性表单，先读取定义并校验，再创建、按用户 ID PUT 属性。创建成功但属性保存失败时保留 createdUserId，重试只保存属性，不重复创建。新增属性筛选（服务端 attr[id] 参数）与当前页复选；批量并发/RPM 使用 POST /admin/users/batch-limits，明确 user_ids、all:false；批量属性使用既有 PUT /admin/users/:id/attributes 逐个写入，逐项失败统计与仅重试失败 ID。官方 userAttributes.ts 只有 /admin/user-attributes/batch 的批量读取，没有属性批量写入接口，故未虚构接口。子卡检查：42/42，独占类型检查退出码 0。
- **05 已实现**：分组图片/批量图片开关、独立倍率、三档美元/张价格；Grok 视频独立倍率、三档美元/秒价格、模型族×分辨率动态行；搜索每次/千次与 Realtime/TTS/STT 单价；复用逐模型阶梯/时段价格编辑器；高峰时间与倍率。新增 Codex manifest 固定账号开关、分组 OpenAI 账号分页搜索/选择/移除、fallback_to_scheduler；仅提交变化配置，保留未知扩展和已有账号顺序。子卡检查：46/46，独占类型检查退出码 0。

新增文件：policies/ChannelFeaturesEditor.vue、AttributeFields.vue、CreateUserAttributes.vue、UserAttributeFilters.vue、BulkUserPolicies.vue、GroupMediaEditor.vue、CodexManifestEditor.vue。
修改文件：GroupsApp.vue、ChannelsApp.vue、UsersApp.vue、policies/GroupPolicyEditor.vue、api/admin/groups.ts、types/admin-policies.ts、scripts/parity-policies.test.cjs、本文。所有业务源码完整根路径均为 packages/sub2-console/src/ 下对应目录。未修改全局 types/index.ts。

最终复核：`node --test scripts/parity-policies.test.cjs` **48/48 通过**；`pnpm --filter @sub2-mac/console exec vue-tsc --noEmit -p src/apps/admin/policies/tsconfig.json` **退出码 0**。补充创建响应缺失 ID/网络歧义的禁重提处理，避免创建结果不明时重复 POST；属性批量值增加邮箱、URL、多选校验。

浏览器：使用用户提供的 Playwright CLI，新建 **policies-0912** session，未访问/复用主任务 parity-check。文档页面由 route.fulfill 注入隔离预览，仅从现有 5173 Vite 读取组件源码；/api 业务请求全部被本 session 夹具拦截，没有登录和真实数据写入。

实际操作通过：三项功能开关开/关并检查值（含 Bedrock 布尔形态、未知 future 字段保留）；数字属性输入 0 后值为字符串 `"0"`；多选值为字符串数组；按按钮更新 win.customData 对象，真实 ChannelsApp 从 pricing 切到 monitor 再切回 pricing，展示对应列表。390px 视口功能区实测宽 358px、scrollWidth 不大于 clientWidth，局部截图已查看。截图：`.playwright-cli/element-2026-09-11T19-17-37-107Z.png`；操作快照：`.playwright-cli/page-2026-09-11T19-17-13-043Z.yml`。

夹具初版请求拦截误匹配 `/src/api` 导致三项模块 MIME 错误，修正为放行源码后重载成功；另有 Vite HMR WebSocket 被本机浏览器本地网络限制阻止的日志。不能将浏览器控制台写成全程零错误。以上是局部组件与 tab 行为验证，不是新增全桌面浅深色/Sheet 焦点或真实后端验收。已关闭本次 policies-0912 浏览器 session，没有关闭主任务 session 或停止共享服务器。

本轮精确源码/文档文件清单（16 个；加上 CLI 自动产生的本次快照/截图）：

1. `packages/sub2-console/src/apps/admin/ChannelsApp.vue`
2. `packages/sub2-console/src/apps/admin/GroupsApp.vue`
3. `packages/sub2-console/src/apps/admin/UsersApp.vue`
4. `packages/sub2-console/src/apps/admin/policies/GroupPolicyEditor.vue`
5. `packages/sub2-console/src/apps/admin/policies/policy-contract.ts`
6. `packages/sub2-console/src/apps/admin/policies/ChannelFeaturesEditor.vue`（新）
7. `packages/sub2-console/src/apps/admin/policies/AttributeFields.vue`（新）
8. `packages/sub2-console/src/apps/admin/policies/CreateUserAttributes.vue`（新）
9. `packages/sub2-console/src/apps/admin/policies/UserAttributeFilters.vue`（新）
10. `packages/sub2-console/src/apps/admin/policies/BulkUserPolicies.vue`（新）
11. `packages/sub2-console/src/apps/admin/policies/GroupMediaEditor.vue`（新）
12. `packages/sub2-console/src/apps/admin/policies/CodexManifestEditor.vue`（新）
13. `packages/sub2-console/src/api/admin/groups.ts`
14. `packages/sub2-console/src/types/admin-policies.ts`
15. `scripts/parity-policies.test.cjs`
16. `docs/frontend/PARITY_POLICIES.md`

## 第二轮任务卡：PARITY-POLICIES-02

用户收取首轮后，明确授权在同一独占范围继续补五项。本轮已经实现五项，没有以缺口清单代替实现，也没有发现需要声称“官方没有 API”的项目。

| 指定功能 | 实现入口与行为 | 已核对契约 |
| --- | --- | --- |
| 复合路由 | 编辑已有 composite 分组 → 管理复合路由与预览；共享 Sheet 中列表、新建、编辑（含启停）、确认删除、服务端匹配预览 | GET/POST `/admin/groups/:id/composite-routes`；PUT/DELETE `.../:routeId`；POST `.../preview`，请求 `{model, endpoint}` |
| Messages / 推理策略 | 分组编辑内的两个折叠模块；Opus/Sonnet/Haiku 目标、精确模型覆盖；最高推理强度、超限降级/拒绝、全局或 exact/prefix/suffix 模型范围的来源→目标/拒绝规则 | PUT `/admin/groups/:id` 的 `messages_dispatch_model_config`、`max_reasoning_effort`、`max_reasoning_effort_over_limit`、`reasoning_effort_mappings`；平台与详情字段门禁 |
| 属性定义管理 | Users 顶部“属性定义” → 共享 Sheet；包含停用定义的列表、创建/编辑/启停、选项行、输入校验、上移/下移、确认删除 | GET/POST `/admin/user-attributes`；PUT/DELETE `.../:id`；PUT `.../reorder`，`{ids}` 包含完整顺序 |
| 额度重置 | 用户编辑 → 平台额度；日/周/月真实返回的已用值及对应重置按钮，经共享 Alert 确认后执行 | POST `/admin/users/:id/platform-quotas/reset`，精确 `{platform, window}`；从响应更新用量，保留限额草稿 |
| 模型同步 | 渠道/统计规则的定价编辑 → 同步模型目录、候选多选加入；单条定价 → 选择参考模型、查询默认价、只填空白 | GET `/admin/channels/pricing/sync-models?platform=...`；GET `/admin/channels/model-pricing?model=...`；只修改草稿，不自动提交渠道 |

源证据：上述路由均在本地已有 `src/api/admin/groups.ts` / `channels.ts` / `users.ts` 或官方 `src/api/admin/userAttributes.ts` 中存在；分组字段与可选值另对照官方 `groupsMessagesDispatch.ts`、`groupsReasoningEffort.ts` 和 `src/types/index.ts`。属性定义包装函数补入独占 `api/admin/users.ts`，没有新建全局 API 聚合文件或修改全局 types/index.ts。

可靠性细节：

- 复合路由保持 priority=0，不沿用官方表单 `|| 100` 将零改写的行为；匹配结果完全来自 preview 响应，没有在前端复制路由算法。
- Messages 配置保留未编辑的系列、精确覆盖和嵌套扩展字段。推理映射按作用域校验重复来源，新增全局规则省略空 model/match_type；未编辑的未知旧规则保留。
- 属性定义仅更新变化字段且不改标识 key；选项值/标签逐行编辑，支持正则、长度、正负数值范围。排序成功后回读真实 display_order；回读失败显示“已保存但读取失败”并禁写，不伪造排序编号。
- 删除和用量重置需要共享 MacAlertSheet 确认，失败原因同时进入确认层；保存互斥，失败保留草稿。关闭组件后忽略迟到结果。
- 模型目录去重并排除已有精确/通配符配置，用户选择后才加入新定价。默认价直接按每 Token 契约填入空白字段，保留已有价格与零，选择对象变化后的迟到响应不能写入别的条目。
- 36 项隔离测试包括这些组件的真实 setup 方法及“推理编辑器 → GroupPolicyEditor → GroupsApp → API”的完整保存调用链。没有运行全局 build 或真实业务请求。

本轮修改文件（16 个，首轮之外新增 6 个）：GroupsApp.vue、UsersApp.vue、policies/GroupPolicyEditor.vue、PricingPolicyEditor.vue、UserPolicyEditor.vue、CompositeRoutesEditor.vue（新）、GroupDispatchEditor.vue（新）、AttributeDefinitionsEditor.vue（新）、ModelCatalogEditor.vue（新）、ModelDefaultPrices.vue（新）、policy-panel.css（新）、api/admin/channels.ts、api/admin/users.ts、types/admin-policies.ts、scripts/parity-policies.test.cjs、本文。完整路径见文末。

## 范围与依据

- 官方只读参考：`output/parallel-20260911/upstream/frontend`，用户指定版本 0.2.4 / HEAD `98d86915`。本地后端按用户提供信息为 0.2.1；本线未启动、升级、修改或向它发起业务请求。
- 对照官方 `src/types/index.ts`、`src/views/admin/GroupsView.vue`、`groupModelAllowlist.ts`、`src/api/admin/groups.ts`、`channels.ts`、`users.ts`、`userAttributes.ts`、`src/components/admin/channel/types.ts`、`UserEditModal.vue`、`UserAttributeForm.vue`。
- 保持 Vue 3 / TypeScript / Pinia、原版 API、现有图标/玻璃/共享 MacSheet。没有使用 frontend-skill，没有复制后端业务计算。
- 产品路径：管理列表选择对象 → 读取详情 → Sheet 中分模块编辑 → 校验与保存；基础更新只发送变化字段，失败保留表单。

## 已实现

### Groups

- 编辑前通过 `GET /admin/groups/:id` 读取完整详情，读取失败不打开可写 Sheet；列表旧值不作为高级编辑基线。
- 保留基础表单，补 Gemini 平台入口。新增结构化的日/周/月美元额度、模型白名单、模型路由、分组策略折叠区。
- 白名单使用真正的 `model_allowlist: { enabled, models }`，支持逐行模型与末尾通配符；不是 `models_list_config`，后者仅影响模型列表展示。
- 路由使用 `model_routing: Record<string, number[]>` 与 `model_routing_enabled`；每行模型及账号 ID，可新增/移除，拒绝重复/非法 ID 和污染键。
- 策略包括 Claude Code only、OAuth only、隐私要求、Messages 调度开关、MCP XML、OpenAI Fast 强制/免费、长上下文定价、利润控制及两项小数参数、两类回退分组 ID、默认映射模型、支持模型系列。
- 后端未返回白名单或版本敏感策略字段时禁写该控件；不以静态参考 0.2.4 推定当前 0.2.1 支持。创建时可配额度与路由，白名单及这些可选策略需要创建后详情返回能力才能配置。
- 基础与高级字段分别做差异比较；保留 null、零、未编辑配置及嵌套未知字段，不将整个详情对象提交。

### Channels

- 编辑改为读取 `GET /admin/channels/:id` 的详情；名称等基础修改不回写未改的定价、空映射平台、统计规则、features_config。
- 新增可复用的 `PricingPolicyEditor`：平台、模型、计费模式；输入/输出/缓存写入/一小时缓存写入/缓存读取/图片输入输出价格；按次价格；Fast/Flex 倍率；详情实际返回时可编辑最高推理强度倍率。
- Token 类价格显示为美元/百万 Token，仅在输入事件中换算为后端每 Token 价格。未编辑数值不做往返换算；空与零保留。
- 阶梯可新增/移除：Token 下上限、档位名、排序、所有 Token/缓存单价、四类倍率、按次价格。Token 区间不能重叠；图片/按次以档位匹配，不误用 Token 重叠校验。
- 时段可启停、新增/移除：IANA 时区、仅工作日、开始/结束秒级时间、倍率。按官方约束拒绝重叠、倒序、非法时区、超过两位小数的倍率；结束 00:00:00 表示日末，跨午夜需拆段。
- 新增账号统计定价规则表单：规则名、分组 ID、账号 ID，以及复用同一价格/阶梯/时段编辑器的嵌套规则。
- 保留既有模型映射与 restrict_models（仅允许已定价模型）；支持增删映射，未编辑映射不进行重建提交。

### Users

- 编辑增加邮箱；基本信息只发送变化字段，空密码不发送。基础保存后保持 Sheet 打开，避免丢失尚未保存的高级表单。
- 平台额度模块：独立读取、失败提示/重试、添加/移除平台、日/周/月限额、独立保存。完整读取成功前不允许全量替换。
- 使用 `GET/PUT /admin/users/:id/platform-quotas`，写入 `{ quotas: [...] }`；保留全部已读平台、空值和零，不把 usage 字段提交为限额，不静默遗漏未知平台。
- 属性模块：分别读取启用的定义与用户值；支持 text、textarea、number、email、url、date、select、multi_select 控件及必填/数值/长度/正则校验。数值属性遵循字符串值契约；多选序列化为 JSON 数组字符串，界面不用 JSON 编辑器。
- 属性写入独立的 `PUT /admin/users/:id/attributes`，包裹 `{ values: ... }`，仅发送变化属性，不与基本信息 PUT 混用。不更改隐藏或未编辑的属性值。
- 两个高级模块独立加载/保存/成功或失败反馈；404 或其他读失败只禁写对应模块。保存互斥、保留失败草稿、关闭后忽略迟到的读取结果。

## 验证与可重复命令

从 `D:\sub2-mac` 执行：

```powershell
node --test scripts/parity-policies.test.cjs
pnpm --filter @sub2-mac/console exec vue-tsc --noEmit -p src/apps/admin/policies/tsconfig.json
```

- 隔离测试编译真实 Vue SFC setup 和模板，以内存 API transport 执行组件逻辑与实际 App 保存方法；不连接浏览器或后端。
- 第二轮执行结果：`node --test scripts/parity-policies.test.cjs` **36/36 通过**；独占入口 `vue-tsc --noEmit -p src/apps/admin/policies/tsconfig.json` **退出码 0**。
- 覆盖价格单位/空/零/非法数字、阶梯区间与档位差异、时段校验、模型模式冲突、白名单能力门禁、路由类型/重复/污染键、未改字段与空映射保留、完整额度替换、读取失败禁写/重试、重复提交、失败草稿、属性独立 payload、迟到响应、三个 App 的差异保存和全部独占 Vue 的模板编译。
- 独占 `policies/tsconfig.json` 以这三个 App 与新组件为入口，不包含其他并行 App 的入口；沿用现有 strict TypeScript 约束，不关闭检查。
- 曾执行 `pnpm --filter @sub2-mac/console typecheck`，当时被其他线的 `ProviderPayment.vue` 缺少 Stripe/Airwallex 模块及 `PublicPages.vue` 缺少 PublicCatalog 阻断。未修改这些文件；不能将此结果描述为全项目类型检查通过。
- 没有运行任何全局 build，没有真实浏览器账户/支付/配置/升级操作，没有修改 server、根目录二进制或真实配置。

## 尚未完成与验收边界

- 本轮是关键高级编辑补齐，不是完整 Groups/Channels/Users 官方功能复刻。
- 原分组缺口已在子卡 05 补齐结构化编辑；完整真实后端兼容与视觉验收仍单独记录。
- 原用户属性筛选/批量操作及创建联动缺口已在子卡 04 补齐。创建用户成功但网络丢失响应的歧义仍需人工核对，后端无创建幂等键契约。
- features_config 已按官方公开的三项功能完成可视化。未知扩展字段保留，不猜测其业务语义；版本敏感行为仍待真实后端验收。
- 当前只验证源代码/API 契约与隔离组件行为，未验证 0.2.1 对每个已存在字段的实际处理，更不能承诺服务端仅因接收请求就应用配置。
- 未执行全桌面浅深色、Sheet 焦点/布局验收或全局生产构建。第三轮仅做上文记录的局部 390px 截图与 tab/表单行为检查；不能据此宣称所有界面已视觉验收。

## 精确修改文件

所有路径相对项目根目录；仅以下文件属于本线。

1. `packages/sub2-console/src/apps/admin/GroupsApp.vue`
2. `packages/sub2-console/src/apps/admin/ChannelsApp.vue`
3. `packages/sub2-console/src/apps/admin/UsersApp.vue`
4. `packages/sub2-console/src/apps/admin/policies/GroupPolicyEditor.vue`（新增）
5. `packages/sub2-console/src/apps/admin/policies/PricingPolicyEditor.vue`（新增）
6. `packages/sub2-console/src/apps/admin/policies/AccountStatsPolicyEditor.vue`（新增）
7. `packages/sub2-console/src/apps/admin/policies/UserPolicyEditor.vue`（新增）
8. `packages/sub2-console/src/apps/admin/policies/PolicyNumber.vue`（新增）
9. `packages/sub2-console/src/apps/admin/policies/policy-contract.ts`（新增）
10. `packages/sub2-console/src/apps/admin/policies/tsconfig.json`（新增）
11. `packages/sub2-console/src/api/admin/groups.ts`
12. `packages/sub2-console/src/api/admin/channels.ts`
13. `packages/sub2-console/src/api/admin/users.ts`
14. `packages/sub2-console/src/types/admin-policies.ts`（新增专用类型；未改 types/index.ts）
15. `scripts/parity-policies.test.cjs`（新增）
16. `docs/frontend/PARITY_POLICIES.md`（本任务卡）

17. `packages/sub2-console/src/apps/admin/policies/CompositeRoutesEditor.vue`（第二轮新增）
18. `packages/sub2-console/src/apps/admin/policies/GroupDispatchEditor.vue`（第二轮新增）
19. `packages/sub2-console/src/apps/admin/policies/AttributeDefinitionsEditor.vue`（第二轮新增）
20. `packages/sub2-console/src/apps/admin/policies/ModelCatalogEditor.vue`（第二轮新增）
21. `packages/sub2-console/src/apps/admin/policies/ModelDefaultPrices.vue`（第二轮新增）
22. `packages/sub2-console/src/apps/admin/policies/policy-panel.css`（第二轮新增局部样式）
