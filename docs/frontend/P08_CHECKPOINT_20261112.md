# P08 可恢复检查点 · 2026-11-12

状态：按用户最新任务收束要求停止扩展。当前视觉改造未完成，未推送、未部署，未生成新发行 ZIP。

## 恢复入口

- 独立工作树：`/Users/chuzu/Work/WindowsMigration/D/sub2-mac-polish-20261112`
- 分支：`codex/frontend-polish-20261112`
- 前一轮完整基线：`8e3f796`；本次检查点提交信息为 `Checkpoint unfinished workspace visual refinement`。
- 原目录 `sub2-mac` 中他人的修改未操作。不要用此工作树覆盖原目录。
- 继续前先检查本卡与 `EXECUTION_PLAN.md`，读取当前 Git 差异；保留现有业务流程与 API 契约。

## 当前改动

共享控件：MacToggle 从会被表格样式覆盖的 Tailwind 按钮改为独立 34×20 圆角开关，使用蓝色和状态文字；保留原模型事件与草稿 change 通知。调整 MacButton、MacGroupCard 和 MacWindow 的尺寸、表面与圆角。浅深色主题明确背景、内容、辅助信息、选中和状态色阶；Dock 收敛多重高光。

工作区：分组/渠道增加用途说明并整理倍率、计费、可用账号、状态和操作；账号/密钥增加内容容器层次；仪表盘指标色阶、用量时间区、钱包余额主区、订阅主从布局、设置分类和内容卡片已有候选。模型广场和可用渠道复用 PlatformMark；MCP 步骤列表及用户/订阅/订单/插件/代理/公告/运维/全站用量部分展示已调整。没有引入后端逻辑或新增业务功能。

图标：11 个业务图标统一外壳/光照；连接、订阅、账号、插件、模型广场重绘了主体。源码在 `scripts/build-semantic-icons.cjs`，输出在 `public-release/assets/semantic` 与 `app-icons`；资源 manifest 已按候选更新。保留系统图标和壁纸。图标尚未通过用户复审。

钱包原先缺少身份时显示 `admin@sub2api.local`、缺少余额时显示 0，现使用明确缺省显示，避免将未知写成账户事实。

## 验证证据

- `output/playwright/p08/typecheck-final.log`：core / console 类型检查通过。
- `output/playwright/p08/build.log`：release 构建通过；是本地静态构建，不是部署。
- `output/playwright/p08/tests.log`：1179 项，1175 通过、4 项既有条件跳过、0 失败。检查在收到收束要求前已启动。
- `output/playwright/p08/interaction-results.json`：复用 P07 脚本的 39 项交互断言通过，无未捕获 JS 异常；密钥、渠道、分组共 3 次写入都由隔离夹具接收。
- `output/playwright/p08/closeout-smoke-results.json`：钱包、订阅、模型、可用渠道、MCP、插件、运维、全站用量 8 页的空数据或读取失败状态能渲染，无未捕获 JS 异常；不代表有数据布局或真实业务验收。
- `git diff --check` 通过。
- `output/playwright/p08/interaction/` 为模拟数据截图；`closeout-*.png` 为最小渲染截图。仅人工查看了分组、钱包及早期分组图，尚未逐页完成视觉复审。

没有真实业务写入。工具控制台中 HTTP 503 来自主动注入失败；不能称零控制台错误。不要将本次检查统计等同全页面视觉质量达到要求。

## 明确未完成

1. 所有常用工作区的有数据、长内容、空、错误状态逐页检查与精修。
2. 钱包、订阅、模型、连接、MCP 等新展示的浅深色/390px 交互覆盖。
3. 运营列表、设置各分类、复杂编辑器的完整布局与可理解性审阅。
4. 图标整体一致性、实际大小及用户复审；此轮候选不能写为已接受设计。
5. 管理页逐步添加的 CSS 规则仍需进一步整理，恢复时先检查级联影响，避免继续堆叠覆盖。
6. 真正线上后端业务验证、生产部署及发布交付。

本次工具实例：Vite 5312、Playwright CLI 会话 `sub2-polish-p08`，收尾时关闭。原用户 Edge 与 Muse 会话未操作。无需等待任何外部任务或代理。
