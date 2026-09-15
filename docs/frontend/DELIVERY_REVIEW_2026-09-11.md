# Sub2-Mac 前端交付巡检 · 2026-09-11

## 交付范围

本轮交付可复建的 Vue 前端源码和独立静态包，直接连接兼容的 Sub2API 后端。保留 Vue 3、TypeScript、Pinia、现有 API 路径与桌面组件，不含后端、实例数据、真实配置或默认账号。未执行部署、后端升级、重启、真实支付及真实管理员写入。

## 发现与修复

| 问题 | 实际修复 |
| --- | --- |
| 检查不到版本却显示最新 | 原版 UpdateService 在 GitHub 失败时可能返回 200 + warning + has_update=false；现在保留警告、显式显示失败，支持 force=true 与缓存标签 |
| 合规确认事件递归 | 移除 App 对自己发送的同名 accepted 事件的监听，确认后更新组件只重试一次 |
| 前端虚假更新与固定版本 | 删除定时宣称最新、固定 v0.1.147 和宣传卡片；前端版本读取 package.json |
| URL 打开应用与身份恢复竞态 | 等待身份状态稳定后打开指定应用，删除固定 200ms 延时 |
| 设置整对象写回 | 白名单字段、模块差异提交；API 地址采用 api_base_url，条款采用 login_agreement_documents 并保留 ID；无引用 JSON 导入导出代码已移除 |
| 读取失败继续保存 | 保留并补充模块读取前禁写、错误提示与重试；账户无效响应不覆盖当前身份 |
| 弹窗不支持统一键盘路径 | Users 5 个、Groups 3 个、Channels 2 个弹窗以及设置恢复窗口接入现有 MacSheet；管理员密钥操作加确认 |
| 列表分页取消图表请求 | Activity 列表与概览使用独立请求控制器，分页不再使图表一直加载 |
| 仪表盘旧响应覆盖 | 增加请求版本和卸载保护；实时指标读取失败可见 |
| 假零值与浮动错误提示 | 运维未知指标显示占位；管理员反馈归属窗口；锁屏连接状态来自当前状态；修正配置中的本机地址文案 |
| 支付界面流程缺口 | 补齐订阅确认、订单二维码/支付链接、查询结果、完成后回读账户和退款申请表单；仅后端返回 COMPLETED 才显示支付完成 |
| 缺少可分发素材来源 | 默认 publicDir 改为 public-release，原创 24 个图标、8 个壁纸及项目标識；原有素材和 Apple 标识不进入发行包 |
| 交付目录混杂 | 白名单打包，加入许可/第三方来源、部署模板、校验清单与对应源码 |

上轮 auth.ts 的 `resp.data ?? resp` 补丁已撤销。Axios 拦截器修改的是 response.data，仍返回 Axios 响应对象；之前把夹具路径匹配问题归因于生产认证代码不成立。

## 已运行验证

| 检查 | 结果 |
| --- | --- |
| pnpm typecheck | 两个工作区通过 |
| pnpm test | 16/16（11 项窗口 + 5 项设置字段行为） |
| pnpm build | 生产构建通过，应用按需分块 |
| version-browser-check.js | 14 项；warning/缓存/503/空响应、force、确认取消、待重启、合规事件无递归 |
| settings-closeout-check.js | 5 场景；读取失败禁写、部分失败、全成功、单字段写入、条款数组 |
| delivery-browser-check.js | 15 项；三个管理页键盘/窄屏/取消，订阅载荷、二维码和支付结果 |
| frontend-browser-check.js | 15 项；两窗口弹层隔离、Tab 循环、小屏、分页、删除取消、503 保留数据 |
| keychain-browser-check.js | 22 项；123 条跨页数据、复制、编辑、四态和窄屏 |
| activity-browser-check.js | 20 项；跨页选项、205 条记录、CSV 完整性、错误恢复及窄屏 |
| all-apps-browser-check.js | 23/23 应用；浅色/深色/390px 共69张应用截图，0破图、0页面异常、0窗口/根容器横向溢出；业务写入为0 |
| 干净目录安装与复建 | 从源码候选包解压、frozen-lockfile 安装，typecheck、16项测试、build 均通过 |
| production-browser-check.js | 7 项；生产禁止开发解锁、无调试句柄、断连状态、注册策略、登录恢复目标应用及无预览夹具 |

所有浏览器业务响应来自隔离夹具，模拟订单只在夹具中存在。HTTP 503 为主动注入；应用可打开和构建通过不代表真实后端业务通过。

构建文件已逐个 SHA-256 比对，工作区与干净目录输出一致。机器可读检查汇总见 verification.json。

## 证据与复现

工作区运行证据位于 `output/review-20260911/`，截图位于 `output/playwright/release/` 以及核心/N02/N03 目录。运行日志、带本地路径的审阅材料和历史截图不打入源码发行包。

版本服务参考：[Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api)，本次查询 HEAD 为 `98d86915becae9fe9491a91ffc6defd5235c8d2b`。读取了 system_handler.go、update_service.go 和前端 system.ts；没有改动外部后端。

## 实际限制

- 当前没有运行的真实 Sub2API 后端，未验证其最新版本读取及升级链路。前端已修复警告误报；服务器访问 GitHub 被限流或阻断仍需在后端环境解决，界面提供发行页面入口。
- 部分高级原版界面（完整注册验证/账户绑定/Passkey、嵌入式收银台、微信 JSAPI/OAuth 支付等）未完整迁移。基础页面和既有接口保留，但不宣称原版所有功能等价。
- Docker/nginx 模板未在本机 Docker 环境实测；附带源码和静态构建可独立复建，生产部署仍需目标环境验收。
- 既有 `server/`、根目录二进制和旧原型未修改，也不随发行包交付。

源码/静态包及清单由 `pnpm package:release` 输出到独立目录。源码支持公开托管；遵守 LGPL 和第三方许可，并在真实后端验收后再作为完整业务服务上线。
