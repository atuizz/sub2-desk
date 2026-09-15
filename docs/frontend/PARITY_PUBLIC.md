# F14 · 公共页面与用户公告

状态：指定文件内实现完成，27/27 隔离测试通过（包括真实 Chromium），限定入口类型检查通过；主任务接线与真实 0.2.1 后端验收另计。最后更新：2026-09-12。

## 实施约束与文件

只改本任务独占文件：

- `packages/sub2-console/src/api/public.ts`
- `packages/sub2-console/src/public/{PublicPages,PublicCatalog,KeyUsagePage,SafeContent,MonitorV2,PlazaComparison}.vue`
- `packages/sub2-console/src/public/{content.ts,public.css,monitorTimeline.ts,plazaPricing.ts,admin-compliance.zh.md,admin-compliance.en.md}`
- `packages/sub2-console/src/apps/user/UserAnnouncementsApp.vue`
- `scripts/parity-public.test.cjs`、本文档

未改 main/App/manifest、图标、server、根目录二进制、真实配置、package 或 lock；未运行全局 build，没有运行真实支付、账号写入或升级。DOMPurify 由主任务统一安装（`^3.4.14`）；本线直接消费该依赖，无其他新增业务依赖。

本卡落实执行计划 F08–F14 的公共页/公告分线，未编辑其他任务独占的公共计划文件。项目认知：现有 Vue/Pinia 桌面 API 控制台的功能补齐；目标用户是匿名查询者与已登录使用者；信息优先级为查询结果、访问状态、内容、恢复操作。沿用原生 MacButton/MacSheet、主题变量与紧凑列表，不新增框架、图标或营销式面板。

## 主任务接线

`PublicPages.vue` 可直接作为 `createApp(PublicPages).use(pinia)` 根组件；不要求 props。默认读取 `window.location.pathname`，监听 `popstate`；可选 `path` prop 用于受控宿主/测试。有已保存 token 但尚无用户资料时，通过既有 `auth.initAuth()` 恢复身份。主任务不需要另加路由库。

支持路径（根 `/` 留给现有桌面）：

| 路径 | 本线行为与权限 |
| --- | --- |
| `/home` | 公共设置中的自定义 HTML 净化后原生阅读；空内容显示站点副标题及服务/法律/自定义入口；URL 内容显示明确的外部新标签入口 |
| `/key-usage` | 无需登录的 API key 查询；日期、近 7/30 天、每日 7/30/90 天、额度/订阅/到期/限流窗口、汇总与每日/模型明细；密钥掩码输入、清除、取消旧响应 |
| `/legal/:id` | 按公共设置 `login_agreement_documents` 精确匹配，Markdown 阅读；不存在与空正文分别显示；`admin-compliance` 切换固定 0.2.4 中英文原文；管理员文档保持服务端原文 |
| `/custom/:id` | 与官方相同要求登录；匹配公共自定义菜单，管理员项检查角色；`page_slug` 与 `md:` 内容通过页面 API 读取，提供 H1–H4 目录与代码复制；其余 URL 明确外链 |
| `/model-plaza` | `model_plaza_enabled` 门禁；按 `model_plaza_require_auth` 决定是否登录；模型/分组/平台/倍率筛选、说明 Markdown、原生完整价格对比（PlazaComparison） |
| `/monitor` | 与官方路由相同要求登录，尊重功能开关；V1 列表/时间线/多窗口可用率详情；V2 维度筛选、四种 matrix 分组、健康维度、趋势折线/明细、模型/错误/排行、可暂停轮询与数据覆盖提示 |
| `/available-channels` | 登录及 `available_channels_enabled` 门禁；渠道/平台/模型、公开/专属/订阅组、专属倍率、高峰倍率、搜索和共享定价 Sheet；专属倍率失败明确提示默认倍率口径 |

支持以上简单路径的尾斜杠，以及 legal/custom 标识中的 Unicode 字母数字、`_`、`-`。拒绝路径穿越、嵌套路径与无效百分号编码；不把未知路径误当首页。

可选 `adminMenuItems: CustomMenuItem[]` 供主任务传入**已获授权且已读取**的管理员自定义菜单。组件不会自行读取全量管理员设置，也不会把其私有字段放入公共配置。普通用户即使传入此 prop 也不会展示管理员项。

用户公告：注册 `user_announcements` → `apps/user/UserAnnouncementsApp.vue`，图标沿用主任务指定 `announcements`。支持常规 `win?: WindowInstance` 与 `autoPopup?: boolean`（默认 true）。打开该 App 后拉取公告，未读 `popup` 公告进入 MacSheet；silent 公告保持列表，已读不自动弹出。关闭/稍后不写服务端，显式「标记已读」成功后才更新列表并进入下一条；失败保留未读且可重试，提交去重，退出/换号/卸载隔离旧响应。

**弹窗触发边界：**目前自动弹窗从公告 App 挂载时开始。若主任务希望在登录桌面时就自动提示，需在主任务的应用生命周期打开/挂载公告 App；本线未修改 App 启动流程或建立隐藏的全局弹层。

## 上游与接口证据

只读参考：`output/parallel-20260911/upstream/frontend`，固定 commit `98d86915becae9fe9491a91ffc6defd5235c8d2b`、版本 0.2.4。当前本地服务 0.2.1 是主任务已确认的运行版本，本线未重新请求真实服务。

- 官方 `views/KeyUsageView.vue` 的 `fetchUsage/getDateParams`：GET `/v1/usage`，提交密钥仅进入 Authorization；不使用会覆盖 Authorization 的账户 apiClient。保持 `start_date/end_date/days/timezone` 及 `actual_cost ?? cost` 明细口径。
- 官方 `views/HomeView.vue`：`home_content` 为 HTML 或 URL；本线不继承无沙箱 iframe。
- 官方 `views/public/LegalDocumentView.vue`：公共协议列表及内置 admin-compliance。内置中文原文从上述固定 commit 的 `docs/legal/admin-compliance.zh.md` 只读 `git show` 获取；未编写或改写法律条款，未提交任何合规确认。
- 官方 `views/user/CustomPageView.vue`：菜单 id → page_slug / md: → GET `/api/v1/pages/:slug`，页面图片 `/pages/:slug/images/:path`。本线不继承将 user/token 拼入外部网址的嵌入行为。
- 官方 router：`/model-plaza` 可配置匿名访问；`/monitor`、`/available-channels`、`/custom/:id` 要求登录，不能把“公开入口”理解为开放受保护数据。
- 复用现有 `api/modelPlaza.ts` 类型、`api/channelMonitor.ts`、`api/channelMonitorV2.ts`、`api/channels.ts`、`api/groups.ts`、`api/announcements.ts` 与 `types/index.ts`。
- 公告：GET `/api/v1/announcements`（完整列表，再做本地未读筛选），POST `/api/v1/announcements/:id/read`。本线执行时的 POST 全部是隔离夹具，仅两次测试调用：失败 + 显式重试。

## 内容及凭据边界

Markdown 使用已有 marked；HTML/Markdown 均先 DOMPurify allowlist，再从 inert template 重建允许的格式化节点。原节点、事件属性、style/class/id、SVG/MathML、表单、脚本、iframe/object/embed 均不进入页面。允许外链仅为不含用户名/密码的 http(s)，固定 `_blank`、`noopener noreferrer`、无 referrer。图片仅保留当前 Markdown 页 slug 下的安全相对路径；远程图片、根绝对路径、百分号编码、反斜杠与 `..` 被拒绝。不会执行自定义 JS/CSS，也不会将 token/用户标识附加到外部 URL。

匿名接口客户端使用 `credentials: omit`、`cache: no-store`、`redirect: error`、`referrerPolicy: no-referrer`，密钥不入 URL/日志/存储。参数变化、清除、卸载会取消和隔离旧请求；错误正文不直接回显服务端可能包含的敏感内容。公共 JSON 请求拒绝 HTML fallback 与非成功业务码。

以上是有意收紧的内容能力；外部页面与被移除的脚本、iframe/CSS 不能算作原生功能已覆盖。

## 可复现隔离验证

基础检查（浏览器项显式 skip）：

```powershell
node --test scripts/parity-public.test.cjs
```

完整检查（本次实际执行，27 passed / 0 failed / 0 skipped，约 6 秒）：

```powershell
$env:PARITY_PUBLIC_BROWSER = '1'
node --test scripts/parity-public.test.cjs
Remove-Item Env:PARITY_PUBLIC_BROWSER
```

脚本优先使用控制台已安装的 playwright/core；本机可从 `%LOCALAPPDATA%/ms-playwright/.links` 找到已有包。其他机器可通过 `PARITY_PUBLIC_PLAYWRIGHT` 指向自己的已有 playwright/core，不会自动安装依赖。测试使用内存 esbuild/SFC 夹具，不生成应用发行包，不启动临时服务器；独立 Chromium context 的全部请求均被拦截，未知来源/路径会失败，测试结束仅关闭自己创建的 context/browser。

覆盖：7 个 SFC 脚本/模板编译；API 密钥隔离/日期/响应契约；URL/路由安全；查询去重及旧响应；自定义页登录限制；公告 popup/silent/已读队列、关闭不写入、失败重试、换号隔离；监控和渠道门禁、详情关闭隔离、倍率部分失败。浏览器验证真实 DOM 恶意 HTML、编码协议、mXSS 样例、相对图片边界；匿名查询、条款与内置合规文档、自定义阅读、无 path prop 的 `/available-channels`、倍率、共享 MacSheet、公告读失败与重试、Escape，以及 390px 浅深色无根横向溢出。浏览器 pageerror = 0，非夹具请求 = 0。

限定类型检查：创建系统临时 tsconfig，extends 控制台 tsconfig，include 仅为本线 public、api/public.ts、UserAnnouncementsApp.vue（TypeScript 正常追踪其导入依赖），显式指定既有 vite/client types，运行 `vue-tsc --noEmit -p <临时文件>`，完成后删本次临时文件。结果 exit 0。首次临时配置漏掉 vite/client 导致 2 个 ImportMeta.env 类型错误，修正测试配置后通过；未修改业务类型或降低检查严格度。

没有运行全局 build、all-apps、真实后端验收或截屏视觉签收；不把内存夹具通过写成真实 0.2.1 的字段兼容或生产完成。

## 剩余项与集成准入

- 主任务已记录路由/公告接线与全应用验证；本线没有重跑最终集成，新增公共组件仍需纳入主任务最后一次集成。
- 真实 0.2.1 公共字段、权限、页面正文/图片与公告读取的只读兼容；已读 POST 需在另行允许的测试账户流程中验收。
- V2 matrix/dimensions/模型/错误/排行及轮询已实现并保留；固定上游没有 SSE 接口，因此不再列为缺失功能。V2 目前使用有界时间窗按钮浏览，尚未复刻原版滚轮缩放/连续色带与查询参数恢复；V1 仍手动刷新。
- 公开模型完整价格对比已消费官方当前字段。其他桌面消费者仍使用原 ModelPricingSheet，其既有局限不由公共页面覆盖证明；本轮没有修改共享 Sheet。
- 内置合规中英切换、Markdown H1–H4 目录、代码复制已完成。官方管理员协议契约只有一份 content_md，没有翻译字段；切换 English 时保留原文并明示未提供译文。目录点击定位/折叠已实现，阅读时自动高亮当前标题仍未接。
- 独立源挂载、真实图片资源、深链接服务端 fallback、主任务新增桌面启动公告行为，以及 1440px/390px 完整视觉签收由主任务集成核验。

Go：可以接入主任务统一类型/构建与集成回归。No-Go：不能据本卡宣布真实后端、全部官方功能、任意网页嵌入或生产部署验收完成。


## 2026-09-12 公共页续卡实际结果

### 先前 V2 实现的结案记录（本轮没有重复实现）

固定官方 `views/user/ChannelStatusV2View.vue` 的 `loadDimensions/loadMetrics/loadTab/scheduleAutoRefresh` 使用普通 GET；常规 60/300 秒，历史回填时 10 秒。无 SSE/EventSource/stream 端点；此前将 SSE 列为缺口不准确。现有 MonitorV2、monitorTimeline 已接维度全集（只传 range）、重复键数组筛选、四种分组、按请求区间补缺失时间格与有界窗口、趋势、模型/错误/用户排行、MacSheet 单格检查。刷新保留同筛选的旧结果并逐区报错；切换筛选/身份和卸载隔离旧请求；隐藏页面暂停定时刷新。隐藏排行不发 users 请求，隐藏吞吐不展示请求数/RPM/TPM。沿用现有 API 用户/管理员前缀，未改后端/API 路径。

### 本次新增

- 法律：从固定 commit 原样读取 `docs/legal/admin-compliance.en.md`，本地中文/English 切换正文；不在线翻译、不替管理员改写条款、不新增虚构多语言 API 字段。切换不产生写请求。
- 自定义 Markdown：SafeContent 可选 tools，仅 custom 页面启用；在净化后的 DOM 中枚举 H1–H4，重复标题通过元素引用区分，不采信内容中的 id。目录支持折叠、键盘点击、定位并移动焦点。代码块旁由应用创建复制按钮，只复制 code.textContent；复制中去重、权限失败明确提示、内容更换/卸载后丢弃迟到结果。代码中的 HTML 按原文复制，不执行。
- 模型对比：新 PlazaComparison/plazaPricing 独占 public。先检查任务列表及 PARITY 文档中的共享组件占用；未发现明确现有占用锁，但不据此断言其他线空闲，最终不编辑共享组件即可避免冲突。未修改 groups/channel 策略线文件。
- 对照官方 `components/modelPlaza/PlazaModelPricingTable.vue` 与 `utils/pricing.ts`：先 token 模型，再按官方输出价降序；官方价不乘倍率；实付乘用户专属或组倍率，图片独立倍率单独处理；token 转每百万，按次/张不转百万；分时 token 倍率保留官方三位精度口径，工作日/时区及高峰叠乘说明明确。按次/图行遵从固定官方 paidRequestPrice，不擅自套 token 分时公式。
- 阶梯：实付与官方目录分开显示各自边界，避免不同档位被错误配对；保留服务端返回的实付阶梯，不用组开关删掉已返回档位。绝对价优先，缺失时按基础价×档位倍率回退；零价格保持零；1h 缓存价遵循专用价→显式缓存写入价→1h基础×缓存倍率。官方梯度不受组开关影响；whole_request/marginal 文案独立。
- 缺价格显示“未提供”，不伪造为零。非 token 实付与官方 token 价标注不同量纲，不产生无意义折扣。模型列表支持名称复制、平台/倍率筛选与清除恢复。

### 本次验证

`$env:PARITY_PUBLIC_BROWSER='1'; node --test scripts/parity-public.test.cjs`：27/27 通过，0 跳过。包含此前 V2 契约/时序/隐私/轮询测试，以及新增价格优先级/零价/阶梯/图片单位/分时/官方独立档位、法律语言纯行为测试。真实 Chromium 验证目录重复标题定位、代码字节复制/失败/去重/换页隔离、中英文正文往返、公开模型时段价和独立官方档位、筛选恢复、390px 无根横向溢出；全部网络本地拦截，0 非夹具请求、0 pageerror。首次浏览器新增倍率精确 label 定位失败，增加明确 aria-label 后复跑通过。

限定入口 vue-tsc --noEmit exit 0；配置仍按上文临时 tsconfig 方法。未跑全局 build、未改 main/App/manifest/package/lock、未操作真实业务写入。无新的 npm 依赖。夹具与类型通过不等于真实 0.2.1 后端兼容、发行产物或完整视觉签收。
