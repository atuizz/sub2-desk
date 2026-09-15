# 账号体验与最新版契约收口 · 2026-09-13

## 本轮完成

- 账号列表从十列平铺调整为身份/认证、运行状态、分组、调度、额度/倍率、操作；平台图形放在账号身份旁，优先展示名称与健康状态，最近使用和到期为次级信息；真实额度使用进度展示，缺失数据不伪造。编辑/测试为直接操作，计划测试、重新授权、删除及Grok媒体资格在更多操作中，移动端保留详情操作。
- 添加账号不再使用平台和认证类型的普通下拉：9个平台卡片、认证方式说明、必填名称和凭据、选填分组/调度，高级设置折叠。底部固定取消/创建及缺少必填信息说明。编辑平台/认证类型保持不可更改。
- OAuth显示完整可选中授权链接，提供复制与打开；复制失败给手动复制方式，异步复制迟到不影响新会话。授权、交换、保存仍用原API，不自动提交账号。
- MiniMax/Kimi/DeepSeek/Zhipu使用官方按量/Coding Plan及协议/端点配置，编辑先读完整详情；自适应转固定协议或清空团队字段时正确删除旧字段，不把旧credentials再次合并回来。
- 小铺使用原创独立店面图标，默认/release、Dock/桌面/启动台/访达/窗口标题统一。见SHOP_ICON_FINAL.md。
- 最新稳定版核对为官方v0.2.4，标签commit 5de5e2be；前端tree与旧参考相同。修复模型候选endpoint、日志persist_access_logs保存、隐藏排行/beta策略、MiniMax分组/阈值、Grok媒体资格GET/PUT；未知路径显示404及返回桌面。详见CURRENT_UPSTREAM_20260912.md、UPSTREAM_GAP_FIXES_20260913.md、PARITY_GROK_MEDIA.md。

## 验证

普通Chromium隔离页面实际验证平台切换、认证方式、缺必填不可创建、生成链接/精确复制、Escape、1440浅深/390px和固定底部操作。截图在output/account-editor-final：list-light.png、list-mobile.png、platform-picker.png、editor-light.png、editor-dark.png、editor-mobile.png。生成授权是夹具响应，无真实账号授权或写入。新增Clipboard取消/失败及CN编辑删除语义专项，保留历史防重/差异保存测试。

CN/Grok独立测试和浏览器证据见各PARITY报告；日志/设置分线27个浏览器检查通过，小铺默认/release图标84项浏览器检查通过。全量最终结果见output/account-editor-final/verified-tests.txt；类型和两种构建输出同目录。本轮的浏览器表格中账号/用量为测试数据，不是实机业务。

## 本地启动与实际边界

本轮重新启动本地已有Redis及output/backend-runtime/sub2api.exe；启动时使用C:/Program Files/Go/lib/time/zoneinfo.zip作为仅子进程ZONEINFO，解决unknown time zone Asia/Shanghai，不改真实配置或二进制。5173公共接口实际返回后端0.2.1，官方最新为0.2.4，未执行升级。用户已授权本地拉起测试，未执行安装、真实支付、账号增删、生图计费或安全设置修改。

最新版前端契约与旧后端实际功能支持不能混为一谈；真实OAuth、支付、Grok媒体资格等仍需目标版本/供应商配置验收。账号列表保持非lite模式（缺groups的lite类型问题不会通过启用lite引入）；原版部分细分操作仍见历史PARITY边界，不能宣布全部官方功能100%等价。新店铺内嵌保留用户已确认的正常浏览器行为，不再因内置浏览器限制盲改sandbox。
