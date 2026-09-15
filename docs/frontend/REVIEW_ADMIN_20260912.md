# 管理员模块独立复核 · 2026-09-12

## 结论

本轮确认并修复 7 类缺陷；新增 10 项行为回归。账号、策略、管理员用量三组专项共 **146 项通过、0 失败**。这表示源码/隔离夹具验证通过，不表示真实管理员业务写入或全部界面已验收。

先读取 EXECUTION_PLAN.md 与 DESIGN.md；保留共享工作区并行改动，不改 auth/core/main/App/package、真实配置、server 或二进制。全局构建、真实浏览器集成、桌面与打包由主任务负责。本轮没有启动服务、打开浏览器或访问真实写接口。

## 检查范围与方法

- AccountsApp 与 accounts：编辑调用链、getById 后再 update 的异步边界、基础字段与策略差异、凭证更新、OAuth 重授权、批量授权部分失败和不确定写入结果。
- GroupsApp/ChannelsApp/UsersApp 与 policies：详情对象身份、卸载后的响应、差异 payload、用户属性/平台额度独立保存、批量更新失败重试、模型映射及未知字段保留。
- AdminUsageApp：列表/统计/图表请求版本、筛选快照、导出取消/完整性/CSV 注入、详情隐私、清理确认与失败状态。
- PromoInspector：详情切换/历史分页响应隔离、更新 payload、日期精度与清空语义、隐藏草稿清理。
- 只读核对现有 API 类型与官方 0.2.4 固定参考；没有复制后端业务判断。只读检查 App 的管理员入口门禁及用户/角色变化清窗，不修改主任务文件。

测试执行实际 Vue/TS 函数，注入可控 Promise 与假 API，重点构造迟到响应、并行修改、失败重试和含秘密的响应；不是仅判断字段是否存在。

## 发现与修复

| 优先级 | 确定问题及触发条件 | 修复 | 回归证据 |
| --- | --- | --- | --- |
| P1 | AccountsApp 编辑策略也固定提交旧列表中的 name/concurrency/priority/group_ids；另一个操作修改这些字段后，会被无关策略保存覆盖。保存前 GET 尚未完成便卸载时，还会继续 PUT。 | 保存编辑打开时的基础字段快照，仅提交用户实际改过的字段；保留最新详情上的凭证/extra 合并。GET 返回后检查卸载、当前编辑 ID、Sheet 状态及返回 ID，才允许 PUT。 | 模拟服务端名称/并发/组已变化，策略保存不再携带这些字段；卸载后释放 GET，写请求为 0。 |
| P1 | AdminUsage 两个详情 Sheet 遍历全部 DTO 并 JSON.stringify 对象；返回的 api_key.key、请求头、请求/响应正文或未来字段可能直接展示。 | 使用标量操作字段白名单，仅展示 ID、模型、平台、状态、阶段、计费/Token/时延等；不渲染任意嵌套对象、请求/响应正文或任意错误消息。 | 注入嵌套密钥、Authorization、私有正文和未知字段，显示结果仅保留允许字段。 |
| P2 | PromoInspector 只改备注也全量回写金额、上限、状态和代号，可覆盖其他管理员的无关修改。关闭后仍保留隐藏草稿。 | 建立独立基线、只提交实际变更；保留原有未改日期不发送与清空日期为 0 的契约。item=null 时清草稿、日期、历史与基线。 | 只改备注 payload 精确为 notes；关闭后草稿与历史清空。既有日期精度测试保留，夹具返回完整 code 而非假设每个 PATCH 都提交 code。 |
| P2 | UsersApp 卸载仅更新列表请求版本，没有失效 API-key 请求；迟到响应可重新填充私有密钥列表。 | 卸载时同时递增 keysVersion 并清 userApiKeys。 | 请求中卸载后返回含私密 key 的响应，列表仍为空。 |
| P2 | Groups/Channels 的详情响应未检查请求 ID，异常代理/接口返回另一个对象时会打开错误对象并允许编辑；卸载期间返回仍修改本地编辑状态。 | 加入卸载检查及严格 detail.id 检查，不匹配时不打开编辑。 | 两个模块分别请求 ID=1、返回 ID=99，编辑窗口均保持关闭。 |
| P2 | 批量用户属性部分失败后，用户改了表单，再点“仅重试失败项”，原实现使用新属性值；同一次批量操作最终会产生不一致结果。 | 保留原确认请求的值快照；重试只替换失败 ID 集合，忽略之后的表单和选择变化。 | 第一轮 gold 部分失败，之后改为 silver、选择用户99，重试仍只向原失败用户2提交 gold。 |
| P2 | AdminUsage 统计请求漏传既有 API 支持的 native_compaction_v2/upstream_model_mismatch，已应用筛选与统计口径可能不同。 | 明确传递这两个已应用字段，不从未提交表单取值，不添加 API 不支持的字段。 | 应用这两个筛选后，实际 getStats 参数均保留 true。 |

## 已检查且保留的行为

- 账号新建需要完成提供商授权；重授权使用专用接口；批量授权不确定写结果不自动重复创建；卸载后停止后续账号写入。既有状态测试通过。
- 分组/渠道已有 changedFields 与嵌套扩展字段保留；用户平台额度和属性独立保存，不由基本信息保存顺带覆盖。用户策略组件以 user ID 作为 key，换用户会重新挂载，不把“没有监听 userId”误报为当前接线 bug。
- 管理员用量列表、统计、趋势、模型、排名和错误详情已有响应版本控制；导出使用筛选快照，取消/重复分页/总数变化时停止下载，CSV 公式前缀已防护。
- Promo 的旧历史/保存响应不会关闭新选择的对象；删除须先确认，失败保留目标。原生数字/时间验证仍保留。
- 管理员 App 打开由 App.launchApp 的 category/role 校验限制；用户/角色变化会清理窗口。真实服务端权限仍由后端承担，前端检查不能替代服务端鉴权。

## 验证

```powershell
node --test scripts/parity-accounts.test.cjs scripts/parity-policies.test.cjs scripts/parity-admin-usage.test.cjs
pnpm --filter @sub2-mac/console exec vue-tsc --noEmit --project src/apps/admin/policies/tsconfig.json
```

- 三组专项：146/146 通过，其中本轮新增10项；包含账号模块现有独立 vue-tsc 检查和本轮模板编译。
- policies 专用项目的 vue-tsc：exit 0，覆盖策略组件及 Groups/Channels/Users 调用链。
- 测试日志：`output/admin-review-tests-20260912.txt`。
- 曾尝试扩展账号测试的临时窄 core barrel 来覆盖其他模块，发现该夹具缺少 TableColumn 等类型导出；已撤销临时扩展，使用已有 policies 专用 tsconfig 验证，未因此降低任何产品类型约束。
- 未运行全局 build、全项目 browser 或打包；AdminUsage/Promo 的最终全项目类型集成由主任务统一复核。

## 剩余风险与明确边界

1. API 没有本卡可用的版本比较/ETag 乐观锁。差异提交减少无关覆盖，但两个管理员同时编辑同一字段仍是后写覆盖；本轮不新增后端协议。
2. 显式账号导出仍按既有业务能力包含账号/代理数据；这与普通用量详情意外展示嵌套密钥不同，没有擅自删除原有导出能力。请主任务确认交付说明与下载文件处理要求。
3. 管理员用量清理、余额、配额重置及创建请求在网络不确定结果下的真实幂等性，不能由前端夹具证明；本轮未真实执行。用量清理已有“提交但结果无法确认”提示，仍需业务级验收确认。
4. 默认用量详情不再显示任意错误消息/请求正文。如业务确需查看原始诊断，应使用现有运维诊断入口；本轮不新建敏感内容查看功能。
5. 本轮是指定范围独立缺陷复核，不是逐个路由、每个输入组合或真实角色权限的穷尽证明。浏览器焦点/层级、失败后的页面回滚、全项目构建、包内资源及真实0.2.1后端兼容仍由主任务收口，不据此宣称全量业务验收。

## 修改文件

- `packages/sub2-console/src/apps/admin/AccountsApp.vue`
- `packages/sub2-console/src/apps/admin/GroupsApp.vue`
- `packages/sub2-console/src/apps/admin/ChannelsApp.vue`
- `packages/sub2-console/src/apps/admin/UsersApp.vue`
- `packages/sub2-console/src/apps/admin/AdminUsageApp.vue`
- `packages/sub2-console/src/apps/admin/PromoInspector.vue`
- `packages/sub2-console/src/apps/admin/policies/BulkUserPolicies.vue`
- `scripts/parity-accounts.test.cjs`
- `scripts/parity-policies.test.cjs`
- `scripts/parity-admin-usage.test.cjs`
- 本报告；测试日志见上。
