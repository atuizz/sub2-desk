# 批量生图工作台 · PARITY_BATCH_IMAGE

日期：2026-09-12。状态：可审阅实现完成；主任务已集成入口；专项测试通过，真实生成/删除与浏览器视觉未验收。

## 主任务集成

根组件：`packages/sub2-console/src/apps/user/BatchImageApp.vue`，default export，接受可选 `win?: WindowInstance`，可作为现有窗口应用按需加载；本线没有修改 manifest/main/App。组件自行 onMounted 读取用户密钥，然后按当前密钥读取模型和任务。需要已有用户会话、原版API与网关 `/v1` 可达。主任务已将manifest id=`batch_image`及 `/batch-image`、`/docs/batch-image` 映射到此工作台（`src/desktop-routes.ts`）。Safari已更正为Gemini/Vertex说明并提供打开应用按钮。完整说明在工作台“使用说明”Sheet中；`/docs/batch-image` 当前打开工作台，不是独立公共静态说明页。

官方参考：`output/parallel-20260911/upstream/frontend/src/views/user/BatchImageGuideView.vue`、`src/api/batchImage.ts`、`src/i18n/locales/zh/batchImage.ts`，固定HEAD `98d86915becae9fe9491a91ffc6defd5235c8d2b`。官方虽名GuideView，实际包含完整任务管理；本次按完整工作台实施，没有把说明页当作业务功能完成。

## 改动文件（本次批量生图范围）

| 文件 | 内容 |
| --- | --- |
| `packages/sub2-console/src/apps/user/BatchImageApp.vue` | 密钥/模型、创建参考图表单、任务筛选分页、详情、失败项重试草稿、预览、单项/选中ZIP下载、取消、单项/选中删除确认、中文说明 |
| `packages/sub2-console/src/apps/user/batch-image/useBatchImages.ts` | 现有API编排、模型/密钥范围、数字偏移分页、请求代际隔离、输入限制、幂等标识、动作门禁、ObjectURL清理 |
| `packages/sub2-console/src/apps/user/batch-image/guide.ts` | 从官方agentInstruction完整移植中文说明；仅替换端点拼接，保留输出/参考图限制、计费、恢复记录、轮询、失败重试和凭据保护说明 |
| `scripts/parity-batch-image.test.cjs` | 实际SFC编译和实际composable离线行为测试，API完全由夹具替代 |
| `docs/frontend/PARITY_BATCH_IMAGE.md` | 本交接文档 |

复用 MacButton、MacSheet、MacAlertSheet，沿用主题变量、getAppIcon；没有改共享组件、原生图标、壁纸、登录、API契约或他人代码。

## 已实现功能闭环

- 密钥逐页读取，不限制前100条；仅显示 active、Gemini、allow_batch_image_generation=true 的密钥，用名称/ID选择，不显示完整密钥。按所选密钥读取真实可用模型。
- 默认查询全部合格密钥并按创建时间统一排序，亦可切到具体密钥；支持任务名、状态、下载状态、日期筛选、20条分页。**cursor为数字偏移**（0/20/40），按官方listOptions核对，不能使用任务ID。搜索回第一页；旧请求不覆盖新筛选，失败保留已有列表。
- 创建任务：任务名、模型、固定1K、PNG/JPEG、完整多行prompt、唯一custom_id、每条1–4张、逐条参考图上传/移除/返回编辑。验证最多200输出；Flash每条3张/其他模型按官方Pro上限14张、单图10MB、PNG/JPEG/WebP、展开后附件1000个/inline128MB。未知模型最终由所选密钥模型列表及服务端校验，不复制后端计费。
- 创建按钮明确说明会冻结费用；提交期间禁重入。相同密钥/相同payload在失败后重试复用Idempotency-Key，成功后清除；报错提醒响应丢失先查列表，不宣称幂等执行已由后端验收。
- 列表显示任务/子任务来源、状态、成功/失败数、冻结/实际费用、下载状态；进入详情并行读取最新job与items。进行中详情每60秒刷新，后台标签/忙碌时暂停，卸载清理计时器。
- 预览只在成功明细点击时读取首张图片，关闭/切换详情释放ObjectURL，旧结果不再写入。ZIP单任务下载与当前页选中任务顺序下载，错误停止；不把链接获取误写为实际文件保存完成。
- 取消任务单独确认，文案明确已成功项仍结算；仅非终态可取消。删除单项或选中的终态记录有确认，说明仅隐藏记录、账务保留；运行中禁止删除，部分失败停止后续执行。
- 失败重试先构造草稿并显示原任务关联parent_batch_id；只选failed项，不重发成功项。明细has_more或缺prompt时拒绝自动准备，不静默跳过。提交前可返回编辑区补齐原参考图/核对prompt与格式，未假设prompt_preview一定是完整原文。
- 工作台使用说明含四步中文使用方式及官方完整可复制Agent说明。剪贴板失败提供手动选择文本退路；说明不会执行任何请求。

## 已执行验证

`node --test scripts/parity-batch-image.test.cjs`：15/15通过，涵盖SFC解析/compileScript/compileTemplate，输出/参考图约束、唯一编号、完整密钥分页、cursor=20与筛选回零、旧列表响应隔离、失败提交幂等标识复用/成功清理、并发提交拒绝、模型门禁、终态删除/下载门禁、关闭详情忽略旧结果、仅失败项重试、缺prompt/不完整明细拒绝、取消/下载动作隔离、错误保留旧列表、迟到预览忽略、官方指南关键规范保留。

`pnpm --filter @sub2-mac/console typecheck`：通过。中间增加批量删除按钮时曾引入模板`&amp;&amp;`表达式转义错误，已改为正常Vue表达式后复查exit 0。未运行build，未运行浏览器，未调用真实批量生图、取消、下载或DELETE。

## 精确剩余差异

- 全部密钥合并、完整父子任务按需展开、统计聚合及多图索引切换现已实现。仍未移植IndexedDB缩略图缓存/本地下载标记；预览为内存ObjectURL，后端downloaded_at为列表依据。
- 参考图UI现支持本地上传或gs://地址、PNG/JPEG/WebP格式及主体/风格/内容用途，并可逐图修改用途与移除。超大任务拒绝并提示拆分，未自动拆成多任务。
- 列表日期透传既有API from/to；真实后端日期边界、时区与筛选返回仍需真实只读验证。
- API现有listBatchImageItems只提供status参数，无cursor参数；has_more时提示不完整并禁自动重试，不伪造全量明细。原参考图/完整prompt不保证在历史返回中保留，重试草稿必须人工核对，不能声称无损自动恢复。
- 下载保存前已校验Blob MIME（ZIP/x-zip-compressed/octet-stream）与PK local-file/empty-archive签名，拒绝HTML/JSON错误页面；这不是完整解压/CRC校验，也不证明落盘或图片业务内容。API没有AbortSignal支持，本线以代际隔离抑制旧响应，未改变共享API。
- 浅深色、390px、低窗口高度、Sheet焦点/键盘/叠放及真实业务流程交主任务统一验收；静态/夹具通过不等于这些验收完成。

## 范围切换交接（不是本次批量生图改动）

此前用户分配setup时，已在现有 `packages/sub2-console/src/api/setup.ts` 增加独立client的业务响应校验、状态/安装响应形状校验与可选AbortSignal；**没有创建setup根组件，也没有发任何真实setup请求**。用户随后将setup交主任务，本线停止继续修改该文件，未擅自恢复覆盖。主任务接管时请审阅这一已有增量。

此前M04/UPSTREAM_PARITY已经追加主任务提供的真实浏览器更新查询证据：5173管理员会话0.2.1→发现0.2.4、发行说明与安装按钮可见，本次查询成功；升级执行/回滚/重启仍未验收。批量生图范围没有再改这些文档。


## 集成后本线收尾检查（2026-09-12）

- 静态确认主任务接线：manifest注册 `batch_image`，按需加载BatchImageApp；desktop-routes.ts将 `/batch-image` 与 `/docs/batch-image` 映射至该应用；SafariApp使用 `wm.openApp('batch_image')` 按钮。M04本次没有编辑这些文件。
- 复跑 `node --test scripts/parity-batch-image.test.cjs`：15/15通过，涵盖本报告已列全部隔离场景，所有批量API由内存夹具替代，没有真实生成、取消、删除或下载。
- 独立浏览器尝试使用5181、session名 `batch-image-review`。工具在命名/创建标签前报 `unsupported Codex auth method: apikey`，没有成功打开标签或进入页面；因此创建表单、详情、浅深色/390px、键盘和视觉验收仍待主任务可用会话执行。不借用或关闭主任务标签，也没有启动/停止任何服务器。
- 主任务提供的setup“7项测试、浏览器7场景通过”归属于setup，不计入批量生图验收。本线不再修改setup代码。
- 全工作区build留给主任务统一执行；本次收尾不修改批量应用实现，仅补充报告。
- 集成后 `pnpm --filter @sub2-mac/console typecheck` **未通过**：`src/apps/user/SafariApp.vue(191,34): TS18048: '__VLS_ctx.wm' is possibly 'undefined'`。错误在主任务新增打开应用按钮的调用处，不在本线独占文件；本线未修改Safari。主任务需守卫可选窗口管理器或保证其存在后再调用openApp，并重跑类型检查。之前的本线类型通过仅属于此前快照，不能作为当前集成版本通过证据。\n


## 最终功能补齐与新版夹具（2026-09-12）

- 根节点改为无region语义的div，唯一“批量生图”region由MacWindow提供。主任务此前26应用主页回归通过属于其报告证据。
- 全密钥合并先分别读取每个密钥足够的前缀页，再全局排序切片；禁止把同一个offset直接应用到所有密钥后拼接，避免遗漏。任务保存内存中的所属密钥映射，详情、下载、取消、删除按真实owner发请求。创建须切换到具体密钥，不能以“全部密钥”隐式选一个写入。
- 关联任务按钮按owner分页查询完整任务列表，再提取root/children，跨页父子关系可展开。每次最多扫描10000记录，超过或分页不前进则明确报错，不发布不完整汇总。父子统计标为累计成功/失败记录，保留旧失败记录，不把重试成功假装原始失败消失。展开子任务也可选中下载/删除。
- 多图预览按custom_id:image_index分开缓存，索引校验避免超界；URL只保留内存，关闭/切换详情及卸载释放。未使用localStorage/IndexedDB存储key或base64。
- gs://录入检查bucket与对象路径，格式与用途字段使用现有reference_images契约。ZIP下载按MIME与PK签名校验后才调用saveBlob。
- 新版 `scripts/parity-batch-image.test.cjs` **20/20通过**。额外覆盖全密钥合并无重复/正确owner、跨页父子加载、HTML伪ZIP阻断、多图索引及越界、GCS字段。旧夹具中的submit finish未定义源于默认切到全部密钥后未选择具体密钥，已在提交夹具中显式设keyId=1；旧下载Blob(“zip”)被新签名门禁拒绝，已改为合法PK头与application/zip，另保留坏响应拒绝用例。
- 新增 `scripts/parity-batch-image-browser.js` 供主任务CLI运行，涵盖唯一region、创建空态/输入/关闭不写入/夹具提交、详情、取消确认/撤销/防重入与窄屏。全部/api、/v1请求被隔离响应；尚未完成整段浏览器场景，因此不报通过。此前本线独立CLI在创建Sheet添加提示词步骤遇到元素过渡/重建超时；随后用户明确由主任务负责浏览器，本线已关闭仅自己创建的batch-image-review会话，未动其他浏览器会话。
- 全工作区build仍由主任务统一执行，未提交真实生成/取消/删除。
- 最终复核：node --test scripts/parity-batch-image.test.cjs 为20/20通过；pnpm --filter @sub2-mac/console typecheck 退出码0。此前Safari可选wm错误已由主任务修复，当前不再阻断。此处为本次最终快照结论。
