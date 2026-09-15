# 官方当前稳定版与桌面前端契约核对 · 2026-09-12

**2026-09-13修复更新：**G01日志persist_access_logs、G04隐藏排行/Beta与Fast规则、G03中本线负责的MiniMax types/Groups/Settings入口、G07基础类型已完成。全量635项中634通过、1可选跳过；独立浏览器27项、类型检查及613模块构建通过。详细结果见[UPSTREAM_GAP_FIXES_20260913.md](UPSTREAM_GAP_FIXES_20260913.md)。以下第1–6节保留9月12日审计快照和缺口定义，G01/G04/G07不再作为未修复项；G02及账号UI、G05/G06仍由父任务推进。本次没有重新查询最新发行或8000运行状态，没有真实写入。

任务卡 U01（E01 的独立上游契约子项）。结论：**官方最新稳定版为 v0.2.4，发行标签 commit 为 `5de5e2be`；其整个 frontend tree 与旧参考 `98d86915` 相同。现有前端有明确的局部兼容缺口，不能仅凭版本号不同判定不兼容，也不能宣布全部官方功能验收完成。**

本轮完成独立源码获取、64 条官方路由源码映射、API 差异审阅及三份 API 文件的最小修正。相关 118 项隔离测试、类型检查、独立目录生产构建和 14 项软件更新浏览器夹具通过。本机 8000 两次连接拒绝，当前运行版本及真实受保护 API 兼容性未能核验。没有启动、升级、重启或写入真实后端。

## 1. 来源与版本证据

| 来源 | 本轮核实结果 |
| --- | --- |
| 官方仓库 | <https://github.com/Wei-Shaw/sub2api>，与旧参考 origin 一致 |
| 最新稳定发行查询 | `GET https://api.github.com/repos/Wei-Shaw/sub2api/releases/latest`，`tag_name=v0.2.4`、`draft=false`、`prerelease=false` |
| 发行页及时间 | <https://github.com/Wei-Shaw/sub2api/releases/tag/v0.2.4>；`published_at=2026-09-09T07:04:53Z`（北京时间 15:04:53） |
| 附注标签对象 | `d681d0798064ee0ffff376d19687d12f09fe600f`，type=`tag`，不能当作 commit |
| 标签解引用 commit | `5de5e2bed035d43591a2e10e51f420ef6a84eb98`，提交时间 `2026-09-09T14:43:55+08:00` |
| 本次源码目录 | `D:/sub2-mac/output/upstream-current-20260912`；独立 depth=1、single-branch 标签 checkout，包含 frontend 和 backend 源码 |
| 获取时间 | checkout reflog：`2026-09-12T02:55:44Z`；官方元数据再次取得于 `2026-09-12T02:59:09Z`（北京时间 10:59:09） |
| 旧参考 | `D:/sub2-mac/output/parallel-20260911/upstream/frontend`，HEAD=`98d86915becae9fe9491a91ffc6defd5235c8d2b`；未 fetch、checkout 或修改 |
| 新旧 frontend tree | 均为 `df93f2897eb2a720b8ad7eba7642101f34262611`；两份源码 tracked status 均干净 |
| 两 commit 的实际差异 | GitHub compare 仅列 `backend/cmd/server/VERSION`；frontend、API 与路由无新增差异 |
| 前端自身版本 | `packages/sub2-console/package.json` 为 `1.0.0`，是桌面前端版本，不是 Sub2API 运行版本 |

获取命令：

```powershell
git clone --depth 1 --branch v0.2.4 --single-branch https://github.com/Wei-Shaw/sub2api.git output/upstream-current-20260912
```

**发行标签源码中的 VERSION 文件写着 0.2.3，并不否定发行版是 0.2.4。** 官方 `.github/workflows/release.yml:29` 的 `update-version` 阶段从 tag 生成 VERSION artifact，发行构建在第 97 行下载该 artifact；第 275 行起才把 VERSION 同步回 main。这解释了随后 `98d86915` 的 VERSION=0.2.4。未修改取下来的 VERSION，也未把源码默认值当成官方发行二进制运行值。

原始证据都在新目录的 `audit/`：`provenance.json`、`release-latest.json`、`tag.json`、`stable-vs-old-reference.json`。不以 main 未发行变更作为本轮稳定版准入条件。

## 2. 本机 8000 公共 version

本轮只对明确目标执行 `GET http://127.0.0.1:8000/api/v1/settings/public`。首次连接拒绝；第二次时间 `2026-09-12T02:59:09.0690369Z`，仍为连接拒绝，没有 HTTP 状态码、业务 code 或 version 响应。脱敏原始记录：`audit/local-public-version.json`。

工作区的 `M04-RESULT.md`、`UPSTREAM_PARITY.md` 曾记录公共 version=0.2.1，以及父任务看见更新至 0.2.4；这些是历史现场证据，本轮没有重新确认。当前应写“运行版本未知（此前记录 0.2.1）”，不能写“当前确定运行 0.2.1”，更不能从端口此刻不可达推翻历史运行记录。

因此，本轮能对齐**稳定源码契约**，无法把该结论延伸成“本机现有二进制支持全部 v0.2.4 能力”。没有读取凭据、借用管理员会话、调用真实 update/rollback/restart，亦未为核验自行拉起后端。

## 3. API 比较方法与结果

下文 U 指新独立目录源码，L 指 `packages/sub2-console/src`。逐项对照 U frontend API、U backend 路由/handler/DTO 与 L 调用者；没有把类型字面差异直接当作运行错误。

`audit/compare-contracts.cjs` 对 TypeScript AST 提取 apiClient/axios 的直接 GET/POST/PUT/PATCH/DELETE 调用和 interface 字段，去除换行符差异后比较。排除上游 `__tests__`，并集 59 个 API 文件，修正后 37 个完全相同；L 自有 `public.ts`、`admin/promptAudit.ts` 不是上游文件缺失。抽取器不证明动态 URL、fetch/SSE/WS 的完整性，原始差异均经语义复核。

| 核对项 | 事实、处理与边界 |
| --- | --- |
| accounts 文件直接 HTTP 调用 | U 62 处、L 60 处；缺的是 Grok 媒体资格 GET/PUT，详见 G02。其他直接调用路径/方法匹配；不代表 60 个操作全部已有 UI 或真实验收 |
| settings 文件直接 HTTP 调用 | 28/28 匹配；settings、SMTP、邮件模板、管理密钥、冷却、面板限流、stream-timeout、rectifier、beta-policy、web-search-emulation 均沿用官方路径 |
| system 文件直接 HTTP 调用 | 6/6 匹配；AbortSignal 是本地取消能力，未更改请求契约 |
| 分组候选 | 原 L `/admin/groups/:id/models-list-candidates` 不在稳定版路由中，已改成 `/admin/groups/:id/model-allowlist-candidates`；不是根据版本猜测 |
| 支付 public verify/resolve | AST 表面少两条，实际通过 `publicPaymentPost` 调到同名官方路径，保留 `out_trade_no` / `resume_token`，是误报，未改 |
| usage 错误详情 | 字符串拼接 `/usage/errors/` + id 与官方模板字符串相同，非缺口 |
| 提示词审计、用户属性 | 本地自有封装/便捷函数对应 U backend `admin.go:136` 起及用户属性注册；不能因官方 API 文件组织不同判定接口不存在 |
| 认证、client | 只读对照；额外 OAuth pending 动态请求和桌面重定向/认证处理不属于本线可修改范围。没有据此更换认证链路 |
| 类型扩展 | `types/admin-policies.ts` 已补 `model_allowlist`、`codex_models_manifest_config`，groups API 使用这些扩展；`public/MonitorV2.vue` 已处理 hide_user_ranking；`public/plazaPricing.ts` 已处理区间倍率，不能按基础 index.ts 的缺字段重新认定这些功能缺失 |

原始审计：`audit/contract-inventory.json`、`audit/inventory-summary.json`。`contract-inventory-before.json` 留有修复前对照；其旧路线扫描把两条守卫重定向调用算成路由（66），已修正为仅取 `const routes` 定义，最终路由数 **64**。

### accounts 重点契约

U `backend/internal/server/routes/admin.go:357` 起注册账号路由：列表 GET，创建 POST，详情 GET，更新 PUT，删除 DELETE；批量操作、重授权、导入/导出及上游用量探测分别有独立 endpoint。L API 保留官方 `page` / `page_size` / `platform` / `type` / `status` / `group` 等筛选和分页；ETag/304 为独立处理，不能把 304 当成新空数据。

- `GET /admin/accounts?lite=1`：U handler 第 206、650、790、830 行及 `dto.AccountListItem` 明确压缩列表不含 `groups/account_groups`；L list/listWithEtag 仍写 `Account`，只是类型过强。当前 AccountsApp 没有请求 lite，且行展示对缺 groups 使用 group_ids 数量退化，不能宣称当前必崩；在启用 lite 前应修类型并确保详情编辑重新 GET。
- `GET /admin/accounts/data` 导出在 U routes 第 408 行受 step-up 约束；`POST /admin/accounts/data` 导入是独立写操作。本轮均未访问，不用普通 GET 200 推断可导出或可导入。
- `POST /admin/accounts/:id/apply-oauth-credentials`：U account_handler 第 1557 行起只接受 type/credentials/extra，普通编辑字段不能混入。本轮保留现有重授权与批量导入实现，没有复制后端逻辑。
- Grok 媒体资格与 MiniMax 平台是可精确定义的新增覆盖缺口，见 G02/G03。

### settings 重点契约

U `backend/internal/server/routes/admin.go:557` 与 `handler/admin/setting_handler_update.go` 确认主配置 `GET/PUT /admin/settings`，更新请求为显式字段。L `settingsForm.ts` 按模块计算差异并拒绝写入后端未返回字段；主配置接口不会因为 API helper 默认值而自动进行真实保存。

- MiniMax：U `service/domain_constants.go:118` 明确六种停调阈值平台。L API helper 原只枚举五种，调用 normalize/sanitize 时会丢弃传入的 minimax；已补齐。本轮没有把 SettingsApp 的实际 copySettings 流程误称为已发生该丢弃，UI 仍只有五个平台输入。
- `channel_monitor_hide_user_ranking`：U dto/settings.go 第 310 行、更新请求第 337 行均存在；已在 L SystemSettings/UpdateSettingsRequest 补可选字段。公共监控已经有隐藏行为，管理设置切换入口仍缺。
- `OpenAIFastPolicyRule.service_tier`：U `service/settings_view.go:674` 起包含 `ultrafast`；L API union 已补齐。Beta/Fast 规则编辑 UI 并未因类型修复而自动实现。

### update 重点契约

U `backend/internal/server/routes/admin.go:659`、`handler/admin/system_handler.go`、`service/update_service.go:81` 与 L `api/admin/system.ts` 对照：

| endpoint（均为 `/api/v1` 下） | 请求与返回关键字段 | 本地结论 |
| --- | --- | --- |
| GET `/admin/system/version` | `{ version }` | 匹配；本地支持 AbortSignal |
| GET `/admin/system/check-updates` | 可选 `force=true`；`current_version, latest_version, has_update, cached, warning?, build_type, release_info?` | 匹配；warning/错误/无效版本不得称最新；source/未知构建不启用安装 |
| GET `/admin/system/rollback-versions` | `{ versions: [{version,published_at,html_url}] }` | 匹配；实际候选由后端决定 |
| POST `/admin/system/update` | 无 body；一般 `{message,need_restart:true,operation_id}`；已最新分支 `{message,already_up_to_date:true,current_version,latest_version,operation_id}`，不含 need_restart | 原 API 类型把 need_restart 写成必填，已改可选并补可选元数据；透传结果，不伪造重启 |
| POST `/admin/system/rollback` | 无 body 恢复本地 backup，或 `{version}` 下载指定历史发行；返回 message/need_restart/version/operation_id | 匹配；保留 900000ms 超时 |
| POST `/admin/system/restart` | 无 body；返回 message | 匹配；回包不代表服务已恢复 |

特别限制：后端 system_handler 第 31 行明确更新/回滚与 HTTP 连接取消解耦；客户端超时不证明服务端停止，后续不得自动重放。版本接口虽独立请求，后端内部仍调用更新服务，因此“独立读取”不等同于完全不依赖更新服务。在线安装、下载校验、二进制替换、重启后恢复没有在本轮实际验证。

## 4. 路由完整性

稳定版 `frontend/src/router/index.ts` 定义 **64 条路由**（包含重定向及 catch-all）。旧参考相同，没有因“查到最新版本”而产生新的路由集合。

| 本地入口分类 | 数量 | 判断 |
| --- | --- | --- |
| desktop-routes.ts 映射 | 37 | 对应用户和管理员桌面应用/子页；只是入口与源码映射 |
| main.ts 独立页面 | 14 | 7 个公共页面、1 个 setup、6 个支付/微信支付返回页 |
| App → MacLockscreen / auth | 11 | 登录、注册、邮箱验证、OAuth 回调、钉钉补邮箱、密码找回/重置 |
| `/` | 1 | 官方重定向 /home，本地是桌面根；产品差异，非接口不兼容 |
| catch-all | 1 | 本地 main 默认 App，缺官方独立 404；见 G06 |

逐条 64 行对照（每条含官方路由行号、本地入口）：[route-matrix.md](../../output/upstream-current-20260912/audit/route-matrix.md)，机器记录为同目录 `route-matrix.json`。映射数量不能证明每个页面内部操作、权限、Feature flags、第三方认证或支付都完整。`/docs/batch-image`、`/shop`、`/announcements` 等桌面别名/扩展不计作官方新增路由。

## 5. 可实施的精确缺口（交父任务）

按实际风险排序；以下需要超出本线 API-only 边界的表单/组件/类型改动，因此只登记，没有更改父任务文件。

| ID / 优先级 | 触发条件与证据 | 精确下一步及验收 |
| --- | --- | --- |
| G01 / P1 日志保存关闭访问日志持久化 | L `apps/admin/operations/LogMaintenanceSheet.vue:26` 的 payload 白名单遗漏 `persist_access_logs`；L `api/admin/ops.ts:830` 也缺类型。U `ops_settings_handler.go:137` 绑定非指针 bool，`service/ops_log_runtime.go:141` 使用 `next := *req` 整份替换。旧值 true 时保存任一其他设置，会写成 false | 同时补 OpsRuntimeLogConfig 字段及 LogMaintenanceSheet 的回显/保存；后端未返回时应禁写或做明确能力处理，不以 false 猜测。夹具 GET=true，修改 level 后 PUT 仍 true；读取失败零 PUT。API 中偷偷额外 GET/合并不是本轮采用的修复 |
| G02 / P2 Grok 媒体资格 | U routes admin.go:375/376 与 `handler/admin/grok_media_eligibility_handler.go:17`；L accounts API 缺 GET/PUT `/admin/accounts/:id/grok-media-eligibility`、类型及入口 | 账号线补 `mode:'auto'|'enabled'|'disabled'`；响应 `{account_id,mode,eligible,reason}`；仅 Grok OAuth。提交 `{mode}`，不得改写整份 extra。测试三态、普通账号拒绝、失败保留原态 |
| G03 / P2 MiniMax 平台与阈值入口 | U AccountPlatform/GroupPlatform 和官方阈值支持 minimax；L `types/index.ts` 联合类型、AccountsApp 平台列表第 219 行、GroupsApp 第 66 行未提供；SettingsApp 第 2155 行仍只枚举五个平台 | 账号/策略/设置线分别补平台与正确账号能力、分组入口、阈值字段；沿用本轮 API normalize/sanitize。区分旧后端没有 minimax 字段的情况，不能强行提交。不要把五种 PlatformQuotaLimits 全局余额限额平台也擅自扩成六种 |
| G04 / P2 设置规则入口 | API 已声明隐藏排行与 ultrafast，但 SettingsApp/settingsForm 未提供 `channel_monitor_hide_user_ranking` 保存入口，也未调用 beta-policy 规则编辑 API；U SettingsView 第 7128、12107 行有对应操作 | 管理设置单独任务补只读回显与差异保存；隐藏排行在公共 MonitorV2 已有消费，不能再记为整个公共功能缺失。Fast 规则按官方 beta-policy 结构编辑，保留未知字段与未改规则 |
| G05 / P2 lite 列表类型 | U `AccountListItem=Omit<Account,'groups'>`；L list/listWithEtag 返回 Account | 账号线收窄列表类型；开启 lite 后表格无需 groups，编辑必须取详情，ETag=304 保留旧列表；当前未请求 lite，不记为现有确定崩溃 |
| G06 / P3 未知页面路由 | U router:719 加载 NotFound；L main:20 默认 App，desktopTarget 无匹配返回 undefined | 父任务在 main/App 范围补未知路径提示及返回桌面；保留现有公共页/认证/支付优先级。`/` 的桌面行为可继续作为产品选择 |
| G07 / P3 基础类型清理 | L index.ts 仍留 `models_list_config`，与稳定 handler 的 model_allowlist 不同，但 admin-policies 扩展及实际保存已接后者；channels 基础类型缺区间倍率，public/plazaPricing 已补本地扩展；AntigravityTokenInfo 缺可选 plan_type | 后续统一基础类型与扩展，删除无人使用旧字段前核查调用者；不把已由扩展解决的问题重复实施，不把模型展示清单无条件改成请求访问白名单 |

未把这张表称为全部官方内部功能的完整审计；邮件模板高级操作、账号所有上游特性、支付 SDK、插件及外部身份提供方仍应沿原 PARITY 分卡做操作级核对。版本兼容与功能覆盖是两个维度。

## 6. 本轮实际变更与验证

实现只修改：

1. `packages/sub2-console/src/api/admin/settings.ts`：补 MiniMax 阈值枚举/归一化及两项设置类型，修后与稳定上游文件一致。
2. `packages/sub2-console/src/api/admin/groups.ts`：修模型候选 endpoint；新增官方名称 `getModelAllowlistCandidates`，保留旧桌面导出 `getModelsListCandidates` 作为别名；未更改任何分组创建/保存字段或既有策略扩展。
3. `packages/sub2-console/src/api/admin/system.ts`：准确建模 `already_up_to_date` 分支，need_restart 可选，增加可选版本/操作元数据；未更改维护操作行为。
4. `scripts/current-upstream-contracts.test.cjs`：6 项隔离回归，默认 `node scripts/test-parity.cjs --all` 会自动发现；不依赖下载的上游源码，也不访问真实后端。

| 检查 | 结果与证据 |
| --- | --- |
| `pnpm --filter @sub2-mac/console typecheck` | 通过；`audit/typecheck.log` |
| `node --test scripts/current-upstream-contracts.test.cjs scripts/m04-version.test.cjs scripts/settings-form.test.cjs scripts/parity-policies.test.cjs scripts/parity-accounts.test.cjs scripts/parity-routes.test.cjs` | 118/118，无失败/跳过；`audit/contract-tests.log` |
| `pnpm --filter @sub2-mac/console exec vite build --outDir ../../output/upstream-current-20260912/audit/build` | 通过，608 modules；类型检查已先单独通过。构建在独立新目录，没有覆盖父任务 dist；`audit/build.log` |
| 现有 `scripts/version-browser-check.js` | 只替换 origin=5196 与截图输出路径，在本次新建 browser context 运行；14 项通过，warning/cache/failure/malformed/force/确认/取消/待重启/390px 均有断言；`audit/browser-version.json` |
| 浏览器副作用隔离 | 所有 `/api/**` 和 health 被夹具 fulfill，外部 origin 被 abort；1 次“安装”POST 仅在夹具内完成，没有发到 Vite/真实 8000，没有自动 restart；pageErrors=[] |
| 图片 | `audit/version-light.png`、`version-dark.png`、`version-mobile.png`；390px 截图已人工查看，面板无横向溢出。图内 1.0.0/1.1.0 是原脚本夹具，不是本机或官方版本 |
| 测试环境回收 | 本次创建的 5196 Vite 已停止，监听消失；新建 browser context 已关闭，未关闭其他人的标签或服务器 |
| 源码边界 | 不改 auth.ts/client.ts/accounts 及账号组件、App/main、server、真实配置、根目录二进制或旧原型；旧上游参考未修改；新上游源码 tracked status 干净，audit 为本次附加证据 |

**Go：**父任务可以集成本轮三份 API 修正与专项测试，使用固定稳定源码继续逐个缺口实施。**No-Go：**不能据此宣布本机运行二进制已与最新版全面兼容、全功能齐备或允许自动升级；G01 应优先修复，当前 8000 公共版本及受保护接口仍待现场恢复后只读核验。
