# M04 · 官方功能清单与更新兼容

状态：已交付可审阅实现，2026-09-11 06:30（Asia/Shanghai）。只完成 M04；未运行全工作区 build、未操作浏览器、未读取/修改真实业务数据、未执行后端升级/回滚/重启，未改 backend/config/server 或只读参考。

## 给主任务的重大事实

1. **官方原版入口仍保留在 8000 根路径。** `/` 和 `/admin/dashboard` 返回官方 Sub2API HTML；实际主 JS、3 个 vendor JS、2 个 CSS 均200且类型正确。并非只检查首页200。未进行官方登录和页面交互，因此只能认定 HTML/静态资产可访问。
2. **不能直接 iframe 嵌入。** 根响应有 `X-Frame-Options: DENY`、CSP `frame-ancestors 'none'`。建议桌面与官方完整站点并存，用顶层/新标签访问原版保底；本轮不修改这些安全头。
3. **后端运行版本是0.2.1，参考 main 是另一个来源快照。** 公共接口 `GET http://127.0.0.1:8000/api/v1/settings/public` 为200、code=0、version=0.2.1。只读参考 HEAD 为 `98d86915becae9fe9491a91ffc6defd5235c8d2b`，refs main/origin/main，提交标题同步 VERSION 到0.2.4；控制台 package version=1.0.0。三者不可混用，也未证明运行二进制的构建commit。
4. **23应用不等于官方全部功能。** 对照已覆盖上游64条路由（含重定向、catch-all）并补充51行内部操作（含本次M01/M03增量）。审计在 Security，返佣在 Wallet/Commerce，不能误记为完全缺失。真正显著缺口：OAuth回调/Passkey/第三方验证码及协议注册、独立支付SDK及落地页、管理员全用户用量、运维告警/日志/细节、账号重授权/计划测试、渠道高级定价、用户/分组高级策略。
5. **未证明更新源连通。** 未调用受保护的真实 check-updates，更没有升级。warning 的UI处理、公共接口200、官方资源可访问都不能证明 GitHub发行源可达；此前网络问题仍须由有授权的主任务独立诊断。

## 实际改动

| 文件 | 改动 |
| --- | --- |
| `docs/frontend/UPSTREAM_PARITY.md` | 64条官方路由→views→当前manifest应用逐条对照；内部操作清单、只读HTTP实测、三种版本来源、完整官方功能/更新保留方案和限制 |
| `packages/sub2-console/src/apps/user/settings/SoftwareUpdatePanel.vue` | 当前版本独立调用既有 getVersion；更新失败仍可展示版本；缓存不宣称实时最新；source/unknown build_type 不显示在线安装；错误文案不武断诊断网络；warning不自动当缓存 |
| `scripts/m04-version.test.cjs` | 离线加载实际SFC脚本，用API夹具验证版本状态、安装门禁、卸载后迟到结果；编译实际SFC模板 |
| `docs/frontend/M04-RESULT.md` | 本卡交接与证据边界 |

`packages/sub2-console/src/api/admin/system.ts` 已核对，与上游路径/请求payload/15分钟更新超时相符，已有 getVersion(signal) 足够，本轮无需修改。未改变图标、壁纸、玻璃登录、getAppIcon 或其他负责人的文件。

## 调用链与交互意图

SettingsApp 管理员软件更新标签 → SoftwareUpdatePanel → api/admin/system → apiClient → 原版 `/api/v1/admin/system/*`。这是管理员维护页，首要判断是当前版本与更新状态；失败恢复动作是检查更新/查看发行页。沿用现有MacGroupCard/MacButton/MacAlertSheet及原有确认流程。使用 ui-ux 轻量检查，不使用 frontend-skill。

原问题：当前版本只依赖 check-updates 的响应；GitHub检查抛错时无法显示已安装版本；源码构建也能触发在线安装。修复后当前版本读取与更新源检查独立，卸载/新检查时保持取消与陈旧结果防护。只有明确 release 构建、有有效新版本、无warning、未检查中且无需等待重启时允许确认安装。

## 已执行验证

- `node --test scripts/m04-version.test.cjs`：11/11通过。覆盖模板编译、更新检查失败仍获0.2.1、warning禁止安装、source/空/undefined构建禁止安装、release确认安装与待重启、缓存措辞、无效版本、卸载后忽略迟到版本、版本接口失败与更新检查状态独立。所有维护动作均为内存夹具，没有真实POST。
- 上游路由完整性静态核验：64条路径全部出现在表格，`missing=[]`；上游路由引用的视图文件全部存在，`badViews=[]`。
- 真实只读HTTP：公共版本接口、根入口、管理员深链接、6个页面实际资源；详见 UPSTREAM_PARITY。`/assets/` 实际为HTML fallback，已明确不以它证明静态资源正常。
- 第一次专项脚本运行因 pnpm 隔离下 `@vue/compiler-sfc` 无法直接解析失败；改用 Vue 正式导出 `vue/compiler-sfc` 后通过，没有安装依赖或改package。
- 未跑全工作区类型检查/build，也未做浏览器浅深色/窄屏/交互验收；主任务统一执行。SFC模板编译/脚本夹具不是完整TypeScript类型或视觉验收。

## 剩余缺口与主任务接续

- 主任务已接菜单“原版完整控制台”新标签：开发默认目标后端，生产显式VITE_OFFICIAL_CONSOLE_URL；M04只读确认App/菜单/Vite源码并同步到对照表，未编辑这些文件。生产跳转/会话共享仍未验收，未使用iframe或移除安全头。
- 保持官方原站点及发行资产；桌面独立部署/更新。生产反代、同域子路径base、资源冲突、OAuth/支付回跳、Cookie/CORS和退出同步仍未实施与验收；具体替代方案和约束已写入对照文档。
- 当前后端关闭支付、Passkey、OAuth等多项功能。关闭不代表官方没有该功能；不得以本机未启用为由删除parity缺口。
- 更新面板真实版本/检查授权、GitHub源状态、回滚候选、重启恢复观察尚未验收。源码构建在线安装已限制，但其余维护能力仍由后端拒绝或执行，未在本轮触发。
- 已读取M01/M03最终报告并将定价Sheet、监控详情、订阅语义、订单分页/换单隔离、邮箱码/邀请码注册、TOTP与账户邮箱管理增量合入UPSTREAM_PARITY；两线的静态/夹具结果已注明来源，未上推为真实业务验收。M02后续结果仍需增量复核。

Go：本轮前端代码与文档可进入主任务统一审阅、类型/构建检查。No-Go：不能宣称完整替代官方全部功能、可确认本次真实更新查询成功，不能推断升级执行通过或后端升级已完成。


## 本次文档增量交接

仅修改 UPSTREAM_PARITY.md 与本报告，未修改任何前端代码。已同步主任务官方新标签入口和M01/M03结果，保留64条路由并将内部操作增至51项。UPSTREAM_PARITY末节给出已有管理员浏览器会话下3步只读核验：打开软件更新捕获version GET，点击一次强制检查捕获check-updates?force=true，仅摘录脱敏响应字段并核对面板；认证/权限/合规阻断不归因于更新源。不触发登录、认证写入或更新/回滚/重启。M04本次未调用任何真实认证或版本接口。


## 主任务真实更新查询补充

主任务已在5173现有管理员会话打开Settings→软件更新：当前运行0.2.1，成功发现0.2.4，显示完整发行说明与安装更新按钮。由主任务提供的真实浏览器证据确认本次更新查询成功；此前“未验证更新源”的结论已被该次查询证据更新。未执行安装/重启；升级执行、二进制下载替换、回滚与恢复仍未验收。未提供原始cached/build_type/warning响应，本文不补造这些字段。本节取代前文历史时点“未确认/未检查”的当前状态判断，保留历史只读过程。
