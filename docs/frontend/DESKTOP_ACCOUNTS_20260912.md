# DESKTOP-ACCOUNTS · 账号平台层级与 JSON 导入

日期：2026-09-12。状态：代码、账号隔离测试、独立类型检查和专用浏览器夹具完成。没有执行真实账号导入。

## 本卡目标与边界

已读取 EXECUTION_PLAN.md、DESIGN.md 和 ui-ux 技能。使用现有 Vue/共享 MacButton、MacSheet 和账号 API；保留既有账号应用图标、玻璃桌面与编辑/授权/计划测试功能，不使用 frontend-skill。不改 App、core、manifest、Settings、package/lock、后端或真实配置。

用户任务：识别平台 → 筛选账号 → 判断状态与认证类别 → 操作账号；导入路径为选择/拖入 → 本地校验和预览 → 明确确认 → 展示实际结果。

## 实际变更

- 平台从紧凑下拉框提升为可横向滚动的平台导航，选中态、图标、文字与辨识色共同表达，不只依赖颜色。选择仍触发现有服务端平台筛选。
- Anthropic/OpenAI/Grok/Kimi/智谱保留官方只读参考 `components/common/PlatformIcon.vue` 的现有填充路径（0.2.4，98d86915）；来源在 PlatformMark 注释中保留。未找到可靠现有图标的 Gemini/Antigravity/DeepSeek 使用明确文字缩写和辨识色，不伪造官方 logo，也没有替换桌面应用图标。
- 列表强调账号名，ID 为次要信息；平台标识与认证类别分行。状态保留启用、停用、异常、冷却、暂停调度语义。去除状态 tooltip 原样泄漏后台错误文本的入口。
- 390px 使用紧凑三列：选择、账号（含平台/类别）、状态。其余指标和全部既有操作通过“详情与操作”展开，不要求横向滚动才能编辑/测试/删除。宽窗口保留完整表格与固定操作列，操作列使用实底避免内容透叠。
- 工具栏直接提供“导入 JSON”，同时保留更多工具入口。

## 三个导入入口共用一条调用链

1. 账号窗口原生 file drop。
2. 导入 Sheet 的多文件选择控件。
3. 主任务 `launchApp('accounts', { importFiles: File[] })`。

统一进入 `createAccountImport.select`；只有 `confirm` 调用既有 `accountsAPI.importData({data, skip_default_group_bind})`，不会在读取、拖放、选择、打开窗口时调用写接口。

AccountsApp 监听 `win.customData.importFiles`，已打开的同一窗口再次收到新数组也生效。接收后删除 customData 字段；文件读完还释放父组件的 File[] 引用。文件控件 change 后立即清 input.value，关闭、取消、卸载时清未提交 payload。

窗口 file drop 调用 preventDefault + stopPropagation，防止浏览器导航或桌面重复处理，并派发 `window` 事件 `sub2-files-consumed` 给主任务复位遮罩。仅拦截文件拖动，不干扰文本拖动。目录通过 webkitGetAsEntry / webkitRelativePath 识别并提示。

## 校验、预览与结果

- 复用主任务只读依赖 `src/desktop-file-drop.ts` 的 `validateDesktopFiles`：最多10个、扩展名 JSON、每个非空且≤20 MiB、合计≤50 MiB。读取内容后再次验证实际字节数。
- 接受官方 exportData 的 accounts/proxies 结构，以及官方支持的可选空/缺省 type/version、`sub2api-data`/`sub2api-bundle`、版本0/1与UTF-8 BOM。账号要求基本类型/凭证对象/非负整数并发与优先级，代理要求合法结构和端口。单文件账号或代理超过10,000条时要求拆分，避免无界预览。
- 任一文件错误则整批停止，不静默忽略；多个有效文件合并后只请求一次。重复文件、重复代理引用明确拒绝，防止模糊代理绑定。
- 预览只展示文件数量、账号/代理数量、已知平台与类别计数；不展示账号名称、原 JSON、凭据、代理地址/密码，也不原样显示解析器片段、服务端 error/message。未知平台/类别显示“其他”。
- 默认勾选跳过默认分组绑定，与上游导入界面保持一致；用户可在确认前取消勾选。
- 成功计数必须是非负整数，且账号及代理处理总数与提交数量一致。全部完成、部分失败、全部失败分别表达；缺失/不一致响应、网络失败显示“结果无法确认”，不会用0兜底或提示成功。
- 部分失败可能已有账号写入，不宣称回滚；没有自动重试整个文件。提交过程中阻止重复确认、替换文件和关闭。提交结果后触发列表刷新，刷新失败不改变已经确认的导入结果。
- 同一账号窗口以规范化 JSON 的 SHA-256 指纹记住提交过的文件，即使关闭 Sheet、改文件名、再次从桌面打开同一窗口，也不重发已提交文件。只保存指纹，不将密钥存入日志/localStorage/sessionStorage。

## 验证与证据

```powershell
node --test scripts/desktop-accounts.test.cjs scripts/parity-accounts.test.cjs
```

**64/64通过**：新增22项与既有42项。既有专项包括独立 vue-tsc，只检查账号文件及真实共享 Sheet/Button 依赖；未运行全局构建。

新增测试执行实际导入控制器，覆盖：官方结构与BOM、隐私、多个文件合并、格式/版本/大小/目录错误、重复文件与代理引用、替换/取消后迟到文件读取、防重入、部分失败、未知结果、卸载边界、同窗口关闭后重发保护，以及暗色 CSS 不污染全局主题。

浏览器复跑方式（仅专用独立 session）：

```powershell
# 使用专用本地 Vite 测试入口，默认脚本 origin 为 http://127.0.0.1:5197
pnpm --filter @sub2-mac/console exec vite --host 127.0.0.1 --port 5197 --strictPort
New-Item -ItemType Directory -Force output/playwright/desktop-accounts | Out-Null
npx --yes --package @playwright/cli playwright-cli -s=desktop-accounts-20260912 open about:blank --browser msedge
npx --yes --package @playwright/cli playwright-cli -s=desktop-accounts-20260912 run-code --filename scripts/desktop-accounts-browser.js --raw
npx --yes --package @playwright/cli playwright-cli -s=desktop-accounts-20260912 close
```

**19项浏览器断言通过**：平台真实筛选请求、暗色图标对比、文件选择 change/拖放/desktop customData 三路接入、消费 File 引用、预览取消零写入、部分失败与未知结果禁重发、重复文件、JSON错误不泄漏、390px详情操作和确认按钮可达、0运行异常。

浏览器所有 API 和站外请求均被拦截，仅2次假 import POST（部分失败、网络失败），未访问真实认证或写入真实账号。文件选择由DOM File/DataTransfer注入 change 事件验证，不是系统文件选择器交互测试。

证据：

- `output/desktop-accounts-tests.txt`
- `output/playwright/desktop-accounts/results.txt`
- `output/playwright/desktop-accounts/light.png`、`dark.png`（1440×900视口）
- `output/playwright/desktop-accounts/mobile.png`、`mobile-import.png`、`mobile-import-dark.png`（390×844视口）

截图已实际查看，确认小屏表格没有横向溢出、Sheet有内滚动及可达底部确认，浅深色可读。主任务的全桌面 drop 集成测试仍独立负责，本卡验证其约定的 customData 接口和 consumed 事件。

## 限制与未验收项

- 未做真实0.2.1后端导入、真实凭据校验、真实代理连接或账号可用性验收；服务端仍负责这些规则。
- 防重复指纹仅在当前账号窗口生命周期内有效，不是服务端幂等协议。关闭整个窗口/重载页面或修改文件内容后，仍须按提示核对现有账号，不可宣称跨会话幂等。
- 提交中的请求无法通过关闭撤销；卸载只隔离迟到UI响应，不表示服务器回滚。
- 多个文件如果代理引用冲突会整批拒绝，不自动决定保留哪一个代理；部分失败原始错误不显示以保护秘密，只报告可靠计数。
- 全局构建/发布包和主任务桌面级drop实际入口由主任务统一验收。本卡未修改对应文件。

## 文件清单

修改：`packages/sub2-console/src/apps/admin/AccountsApp.vue`。

新增：

- `packages/sub2-console/src/apps/admin/accounts/PlatformMark.vue`
- `packages/sub2-console/src/apps/admin/accounts/AccountImportSheet.vue`
- `packages/sub2-console/src/apps/admin/accounts/importData.ts`
- `scripts/desktop-accounts.test.cjs`
- `scripts/desktop-accounts-browser.js`
- `docs/frontend/DESKTOP_ACCOUNTS_20260912.md`

只读依赖：主任务的 `src/desktop-file-drop.ts`。未修改既有账号测试文件或其他并行文件。
