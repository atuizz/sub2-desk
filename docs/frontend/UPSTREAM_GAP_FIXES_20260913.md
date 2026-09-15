# 日志、设置与基础类型缺口修复 · 2026-09-13

**U02 已完成本线授权范围：G01 日志持久化、G04 隐藏排行与 Beta/Fast 规则、G03 公共类型/分组/设置阈值入口、G07 基础类型清理。** 全量635项测试中634通过、1项可选浏览器测试跳过；独立浏览器27项断言通过；类型检查与生产构建通过。所有业务请求均为隔离夹具，没有真实写入、升级或重启。

本轮续接9月12日中断，先核实落盘，再补边界和验证。沿用已固定的官方 v0.2.4 / `5de5e2bed035d43591a2e10e51f420ef6a84eb98` 源码，不在此轮重新宣布9月13日最新发行状态。官方版本来源仍见 [CURRENT_UPSTREAM_20260912.md](CURRENT_UPSTREAM_20260912.md)。

## 修复结果

| 项目 | 实际变化 | 验收及边界 |
| --- | --- | --- |
| G01 日志持久化 | `api/admin/ops.ts` 补必填 `persist_access_logs:boolean`；`LogMaintenanceSheet.vue` 显示“持久化访问日志”并在保存payload中明确回传 true/false。未返回、null或字符串时禁用保存并提示重新读取 | 验证GET=true，修改level仍PUT=true；用户明确关闭才PUT=false。写入健康接口失败不阻断有效配置读取；配置读取失败不写默认值；保存失败保留草稿；只提交编辑字段，不传source等服务端元数据 |
| G04 隐藏用户排行 | `SettingsApp.vue` 的“功能开关→渠道监控”增加开关，`settingsForm.ts` 加入模块差异保存 | `GET/PUT /admin/settings` 使用 `channel_monitor_hide_user_ranking`，关闭明确发送false，无其他模块字段。后端未返回布尔值时不能操作；公共MonitorV2已支持该字段，本轮没有重复修改公共页 |
| G04 Beta规则 | 设置新增“请求策略”，复用 `PolicyRulesPanel.vue` | 独立 `GET/PUT /admin/settings/beta-policy`，编辑beta_token/action/scope、拒绝提示、模型范围与fallback；支持新增、移除、撤销未保存修改；没有规则时显示真实空态，不添加默认规则 |
| G04 Fast/Flex规则 | 同一组件第二个消费者，支持 all/priority/ultrafast/flex、force_priority、用户ID范围及模型fallback | GET主配置的 `openai_fast_policy_settings`；PUT主配置时仅发送该字段，绝不将Fast规则误传到beta-policy。说明遵守官方“用户专属优先、同类规则按顺序”语义 |
| G03 MiniMax | `types/index.ts` 的 AccountPlatform / GroupPlatform 加minimax；`GroupsApp.vue` 筛选与创建/编辑平台选项加MiniMax；Settings暂停阈值使用六个平台枚举 | 验证筛选GET参数platform=minimax、创建夹具POST platform=minimax；阈值回显75→修改65，其他平台值原样保存。缺失或整项null时显示空值且禁写；拒绝越界、非整数、凭空新增后端未返回的平台。**PlatformQuotaLimits仍仅五种平台，未改** |
| G07 基础类型 | AdminGroup/CreateGroupRequest/UpdateGroupRequest统一使用model_allowlist及codex_models_manifest_config；移除无调用者的models_list_config/ModelsListConfig。`admin-policies.ts`保留原导出名称，改为引用基础类型 | 已追踪所有调用者；策略组件及冻结的groups API继续使用原导出，运行payload不变。全项目类型检查和策略回归通过 |
| G07 其他类型 | 补PublicSettings隐藏排行、AccountListItem、GrokMediaEligibilityMode/State、AdminUsageLog.upstream_request_id；`api/channels.ts`只补区间四项倍率及max_reasoning_effort_multiplier可选类型 | 基础index.ts与固定官方源码仅剩注释差异。现有公共定价扩展仍可用，公共定价回归通过。AccountListItem/Grok类型供父任务接线，本线没有改变账号API默认lite或OAuth流程 |

## 规则编辑的行为保证

`policyRules.ts`和`PolicyRulesPanel.vue`用于两种真实规则集合，复用现有MacGroupCard/MacButton，不增加UI框架或后端逻辑。

- 两个模块独立读取、保存与显示结果；读取失败、能力缺失或格式损坏均禁写，不让空数组覆盖后端规则。
- 保留规则顺序、未编辑规则、未知扩展字段及可选字段语义；删除前一行也不会丢失后一行的未知配置。后端返回的null可选列表与空fallback保持默认语义。
- 修改规则后验证token、处理方式、账号范围、模型项及正整数用户ID，拒绝重复ID；不自动“修正”用户未编辑的未来规则。
- 保存期间禁用规则编辑和重复提交；失败保留草稿。提交已完成但响应缺少规则时提示核对并禁用再次保存，须重新读取。
- 面板卸载后，迟到读取/保存不能恢复旧状态或显示成功。移除规则只改本地草稿，显式保存才提交。
- 请求策略页不显示混合的“保存配置”，每个模块有自己的“保存规则”；移动端可滚动到按钮，表单有明确标签、焦点与错误反馈。

## 变更文件边界

业务文件共10个：

```text
packages/sub2-console/src/api/admin/ops.ts
packages/sub2-console/src/api/channels.ts                     # 仅类型字段
packages/sub2-console/src/apps/admin/operations/LogMaintenanceSheet.vue
packages/sub2-console/src/apps/admin/GroupsApp.vue             # 仅MiniMax选项
packages/sub2-console/src/apps/user/SettingsApp.vue
packages/sub2-console/src/apps/user/settings/settingsForm.ts
packages/sub2-console/src/apps/user/settings/PolicyRulesPanel.vue
packages/sub2-console/src/apps/user/settings/policyRules.ts
packages/sub2-console/src/types/index.ts
packages/sub2-console/src/types/admin-policies.ts
```

测试：修改 `parity-operations.test.cjs`、`parity-policies.test.cjs`、`settings-form.test.cjs`；新增 `settings-policies.test.cjs`、`settings-upstream-browser-check.js`。默认全量测试命令会自动发现新增 `.test.cjs` 文件。

上一轮 `api/admin/settings.ts`、`api/admin/groups.ts`、`api/admin/system.ts` 的SHA-256与已交付manifest全部一致，保持冻结。没有修改AccountsApp、accounts API、OAuth、auth/client、main/App、server、真实配置、根目录二进制、旧原型或旧上游参考。Types中新加的Grok/AccountListItem定义未替父任务执行G02/G05的运行时改造。

`AntigravityTokenInfo.plan_type`仍属于父任务OAuth文件范围；既有字符串索引签名和账号OAuth提取已保留该值，本轮没有更动该文件。其可选显式类型声明不足不构成字段被丢弃的运行时bug。公共定价局部扩展可留存，基础字段已补齐，无须为了去重跨入公共页边界。

## 验证与原始证据

全部证据位于 `output/upstream-current-20260912/audit/`，旧报告的日志未覆盖。

| 实际运行 | 结果 | 证据 |
| --- | --- | --- |
| `node --test scripts/parity-operations.test.cjs` | G01初轮96/96 | `g01-tests.log` |
| 设置/策略专项初轮 | 83/83 | `settings-policy-tests.log` |
| `pnpm --filter @sub2-mac/console typecheck` | 通过 | `gap-fixes-typecheck-20260913.log` |
| ops/settings/policies/public/current-upstream六份专项测试 | 208项，207通过，1项可选公共浏览器跳过 | `gap-fixes-tests-20260913.log` |
| `node scripts/test-parity.cjs --all` | **635项，634通过，0失败，1项可选公共浏览器跳过** | `gap-fixes-all-tests-20260913.log` |
| `pnpm --filter @sub2-mac/console build --outDir ../../output/upstream-current-20260912/audit/gap-final-build-20260913` | **vue-tsc -b及Vite均通过，613模块**；产物在独立新目录，未覆盖父任务dist | `gap-final-build-20260913.log`及同名产物目录 |
| `scripts/settings-upstream-browser-check.js` | **27项通过**；真实DOM操作、1440浅深色与390px；pageErrors=[]，unexpected=[] | `gap-browser-20260913.json` |

浏览器夹具在本次新建context中执行，未操作父任务已有标签。origin=`http://127.0.0.1:5197`，该Vite进程的 `SUB2API_DEV_TARGET=http://127.0.0.1:9`，仅为本次子进程环境变量，没有写真实配置。所有 `/api/**` 与health均由夹具fulfill，其他origin全部abort。10次模拟写请求包括2次主动503失败和1次不完整成功响应；均未发送到真实8000。证据数组已逐条复制快照，后续切换缺字段场景不会改变先前已记录payload。

截图：`gap-thresholds-light.png`、`gap-policies-light.png`、`gap-policies-dark.png`、`gap-policies-mobile.png`、`gap-logging-light.png`、`gap-logging-dark.png`、`gap-logging-mobile.png`。已查看390px策略页与日志弹层截图，内容/保存按钮通过实际滚动操作验证可达，无横向溢出。截图中“设置验收”等为明确夹具。

已关闭新建browser context，停止本次5197 Vite，监听消失。完整文件hash、冻结核验和实例回收结果见 `gap-delivery-manifest-20260913.json`。

## 交接状态

本线G01、G04及G07基础类型已完成，G03中明确分配给本线的types/Groups/Settings已完成。父任务继续G02 Grok媒体、G03账号卡片/API Key、G05非lite默认与重载类型、G06未知路由；不要重复覆盖本轮文件。

本次证据证明固定v0.2.4契约下的前端实现与夹具行为。没有进行真实配置保存、分组创建、账号导入、第三方调用、升级或重启，不将测试/构建通过标记为真实业务验收通过。上一轮8000不可达是9月12日现场快照，本轮未重新探测，也不将其写成9月13日当前状态。
