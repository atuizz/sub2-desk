# 批量生图 / 运维 / 插件 / 风控独立复核

日期：2026-09-12。已先读 EXECUTION_PLAN.md、DESIGN.md，沿现有 API 与调用链复核；不新增功能。保留并行修改，未改 policies、core、main、package、壁纸或真实配置。全局构建、浏览器、桌面 core 和打包由主任务负责，本线没有执行这些操作。

## 结论

已修复本线可复现缺陷；**120/120 隔离测试通过**（批量生图 28、运维/插件/风控 92）。新增 13 个针对性回归测试。所有操作均使用内存 API/事件/计时器夹具，没有真实生图、取消、删除、插件安装、设置写入、TOTP 验证或 WebSocket 连接。

独占入口类型检查已覆盖 BatchImageApp 与原运维入口。最终没有本线文件诊断，但由于 core 是其依赖，检查仍退出 1：MacDock.vue:251、MacMenubar.vue:523/526/528/529 共 5 个 TS7006。未修改这些主任务独占文件；不能写为全量类型检查通过。

## 确定问题与修复

| 优先级 | 触发与旧行为 | 修复与证据 |
| --- | --- | --- |
| P1 | 密钥 A 的任务对象在切换到 B 后仍被操作；ownerOf 的 fallback 使用当前 key，可能把旧任务请求发往 B 的归属上下文 | 去掉当前密钥兜底；对实际任务对象记录 owner 与 generation，旧代次/未知归属禁止请求。列表、关联任务和详情回读均登记归属；跨密钥重复任务 ID 报错，不静默覆盖。回归验证旧任务与未知任务零写入。 |
| P1 | 任务提交网络失败后点“刷新密钥”，changeKey 清空 submission，相同请求重试生成新幂等键 | 保留失败提交标识，fingerprint 包含密钥 ID、实际密钥和 payload；同密钥刷新后仍复用，同 ID 密钥轮换不会误复用。成功或组件销毁后清空；不保存到持久化存储。 |
| P2 | 取消请求失败，App 无条件清 pending；批量删除中途失败仍清空全部选择 | action 显式返回成功/失败；确认框只有成功才关闭，错误进入确认层。批量删除逐项移除成功 ID，失败和未处理项保留，停止后可重试。 |
| P2 | 创建 Sheet 关闭后 FileReader 仍继续读，后续多文件可能继续处理；下载 click 抛错时 URL/DOM 无清理 | 跟踪 reader，关闭/卸载 abort，清除事件回调与草稿；逐文件检查代次。saveBlob 使用 finally 移除 link、撤销 URL。测试模拟读取中关闭和 click 抛错。 |
| P2 | Batch API 的 detail 错误丢失；message 为对象时出现 `[object Object]`；composable 只识别 Error 实例，普通 API 错误对象变泛化提示 | 按字符串读取 error.message/message/detail/error，再回退 statusText/HTTP code；保留 status、code 和 requestId。普通对象 message 可显示。测试覆盖 detail 与对象型 message。 |
| P2 | 插件配置在 TOTP 验证中取消/重置后 verifying 不复位；旧验证结果可能影响新一轮确认 | settle 递增独立 approvalGeneration 并复位 verifying；验证结果同时检查配置会话代次与确认代次。测试证明旧验证不能结算新的确认。 |
| P2 | 插件 compatibility 元数据缺失，启用逻辑访问 `.tested` 抛错；确认层不显示操作失败原因 | 使用可选链，与既有确认文案一致地按未经测试处理；启停和卸载错误进入确认层。后端仍负责接受/拒绝实际启用，没有绕过 step-up。 |
| P2 | Security 审计/审核/提示词列表在 loading 时丢弃新的筛选请求，旧响应随后显示为新筛选结果 | 三类列表独立请求代次，新筛选允许发起并只接受最新结果；卸载使旧响应失效。提示词参数使用快照。审计列表拒绝缺失 items/total 的响应。 |
| P2 | 清理审计日志验证码格式不校验，错误只通过底层 toast 提示；畸形成功响应仍宣告全部清空 | 校验六位 TOTP；验证 deleted 为非负整数；错误留在清理 Sheet，失败不关闭，每次结束清除验证码。没有改动官方 clear 的 `{totp_code}` 契约。 |
| P3 | subscribeQPS 已 dispose，但之前排队的 offline 回调仍可把状态改成 offline | handleOffline 检查 shouldReconnect；回归模拟已替换 socket 的旧 open/message/close 回调及 dispose 后的 offline，均不能改状态或重连。 |

另修复 BatchImageApp 模板内 `selectedJobs.some` 回调参数的确定 TS7006，显式标注 BatchImageJob；没有放宽 TypeScript 配置。

## 复核未发现需改动的路径

- 运维：错误/请求/日志各自 API 参数、游标分页、详细记录关联、告警规则 scope、清理范围快照；失败保留既有结果。邮件/运行/高级设置、hash 缓存与密钥池均有已有隔离测试，未整体替换这些文件。
- WebSocket：使用 subprotocol 认证，不把 JWT 放 URL；重连预算、失活检查、offline/online、服务端 fatal close、隐藏暂停、消息 debounce 和卸载清理已有保护，本轮重新执行其回归。
- 插件桥接：opaque origin、event.source、bridge_token、有效期、请求 ID 去重/超时、导航失效、active guard。配置保存/测试需要宿主确认；管理与配置路径均只在 STEP_UP_REQUIRED 后验证，再重试一次，取消不重试。无修改 iframe sandbox 或鉴权策略。
- 风控：hash 单条删除与全量清理分开确认；审核密钥池追加/替换/清空互斥且仅提交明确字段；解封捕获目标用户 ID。提示词配置保留 expected_config_version、空 token 不覆盖旧凭据；删除事件只用已确认 ID 列表。
- 批量：全密钥结果按全局时间顺序分页；关联任务分页未前进时报错；已结束任务才可删记录；ZIP MIME 与魔数校验；关闭详情拒绝迟到图片预览；重复 submit 互斥。

## 验证

```powershell
node --test scripts/parity-batch-image.test.cjs scripts/parity-operations.test.cjs
# tests 120, pass 120, fail 0, skipped 0

node scripts/parity-operations.test.cjs --typecheck
# 本线入口无诊断；core 5 项 TS7006，退出 1
```

测试编译真实 SFC/script 并执行组件或 composable 方法，模拟 Promise 时序、普通 API 错误、Blob、FileReader 和 WebSocket，不访问网络。

## 修改文件

1. `packages/sub2-console/src/apps/user/BatchImageApp.vue`
2. `packages/sub2-console/src/apps/user/batch-image/useBatchImages.ts`
3. `packages/sub2-console/src/api/batchImage.ts`
4. `packages/sub2-console/src/apps/admin/PluginsApp.vue`
5. `packages/sub2-console/src/apps/admin/plugins/PluginConfiguration.vue`
6. `packages/sub2-console/src/apps/admin/SecurityApp.vue`
7. `packages/sub2-console/src/api/admin/ops.ts`
8. `scripts/parity-batch-image.test.cjs`
9. `scripts/parity-operations.test.cjs`（类型检查入口同时纳入 BatchImageApp）
10. `docs/frontend/REVIEW_OPS_BATCH_20260912.md`

## 给主任务的集成边界

- 接手全局构建与浏览器。优先复跑：取消失败确认框、批量删除部分失败、插件 TOTP 中取消/重开、风控快速筛选、清理日志错误提示。
- 本线没有更改后端授权、请求幂等实现、图片实际计费、删除事务、TOTP 服务端验证或 WS 服务器行为。隔离通过不代表这些真实业务已验收。
- 跨密钥同任务 ID 现在保守报错；若后端文档明确允许同 ID 跨密钥复用，应另设 UI 复合身份，而不能恢复“使用当前密钥”的兜底。本轮不扩展身份模型功能。
- 没有新增独立进程/浏览器/临时服务器；只使用测试进程与临时类型配置，类型脚本 finally 自动删除临时配置。
