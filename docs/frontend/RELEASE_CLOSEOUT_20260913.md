# 发布五项收口执行记录 · 2026-09-13

本次不再只做API夹具：使用SHA-256验证过的官方Windows v0.2.4发行二进制，独立PostgreSQL 17，独立Redis协议测试缓存，真实运行前端及nginx。当前用户8000实例没有被升级或修改业务数据。用户明确无支付沙箱和OAuth测试应用，同意这些外部渠道列为未验收。

## 五项状态

| 项目 | 结果 |
| --- | --- |
| 1 功能缺口 | 本次点名的Gemini AI Studio能力/自定义client流程、混合渠道确认、请求头/TLS/TTL/masking/平台控制，以及监控缩放/URL恢复、用量分布/余额历史/共享价格/Markdown高亮已实现。64条路由有逐项记录，不把它等同每个官方细节穷举证明。见docs/RELEASE_ACCOUNTS.md、RELEASE_FEATURES.md |
| 2 核心真实业务 | 官方0.2.4与真实PostgreSQL核心闭环通过；模型上游为本地受控HTTP服务，缓存为miniredis协议测试依赖；不能宣称真实模型供应商/生产Redis集群验收。支付/OAuth/邮件等按用户约定未真实验证 |
| 3 上传限制 | 前端最终JSON与nginx统一256MiB，保留文件/模型业务限制；真实nginx16项包括256MiB及+1字节、chunked、413、TLS、WS、重启通过 |
| 4 部署、升级恢复 | 真实nginx+最终release前端+官方后端6项通过；官方包0.2.1→0.2.4、数据库备份/恢复及二进制回滚通过。GitHub API403使自动在线升级未完成；无Docker/WSL发行版，Docker镜像未构建运行。正式TLS证书/CDN拓扑须在实际部署目标验收，不能假报完成 |
| 5 冻结候选包 | 包含最新三屏账号流程及本次修复，默认/release按同一源码生成，哈希与干净复建证据随最终交付记录更新。无线上发布或推送 |

## 官方产物与隔离拓扑

- v0.2.4：从官方GitHub release下载，zip SHA256 `a11c3f9d9e72f94bf167e798392ab6efdba9ea615f9b31dd9b06e64eea43b2ff`（空格仅排版，实际清单见artifacts/checksums-0.2.4.txt）；与官方checksums.txt逐字比较通过。v0.2.1也同样验证。GitHub releases/latest页面最终重定向v0.2.4；API元数据请求本次被限流。
- 本次所有运行资料在output/release-validation。核心后端58004、PostgreSQL55433数据库sub2_release_validation、缓存56379 DB0。升级实例58005使用sub2_upgrade_validation和缓存DB1。均绑定127.0.0.1，当前8000/55432/6379未被操作。
- 生产测试入口为nginx58080/58443，最终dist与真实58004对接；测试TLS由显式CA验证，不关闭证书校验。普通Chromium真实登录、数据列表和用量读取，外部供应商未访问。
- 管理员合规前置以**仅隔离数据库的测试记录**满足，记录user_agent标记fixture；没有代表用户签署合规承诺，也未把接受协议接口记为真实验收。测试账号/密码/token仅在output私有文件，不进入发行包。
- 首次自动初始化时空数据库密码触发官方发行二进制的维护库选择问题，改用隔离测试非空密码后重新初始化到指定数据库；未修改官方源码。TOTP测试密钥明确32字节hex，运行时区使用UTC。缓存helper支持TTL推进，但不是生产Redis性能/持久化验收。

## 实际业务证据

`evidence/core.json`：17条检查。官方版本、密码登录、用户/分组/账号创建、账号修改回读、官方JSON导入、设置→公共API、用户API Key、真实网关转发、PostgreSQL用量和余额扣减、兑换/重复拒绝、订阅及权限。

真实计费：本地受控上游返回1000输入Token、100输出Token，网关余额从10变为9.99979；兑换5后为14.99979，用量行实际入库。受控上游只模拟模型响应，不模拟Sub2API、数据库或账务服务；不消耗真实供应商额度。

`evidence/core-lifecycle.json`：专用OAuth凭据应用（合成凭据，无提供商兑换）、一次性账号删除、订阅延长/撤销/恢复、真实refresh token轮换、停用API Key访问拒绝及删除，共7条。撤销订阅是官方soft-delete，详情GET404、revoked列表可见，恢复后重新active；测试按真实契约调整，没有修改后端行为。

`evidence/frontend.json`：真实前端密码登录、三屏创建账号并列表回读、真实扣费记录、390px用户订阅。没有route.fulfill替换API。

`evidence/production.json`：最终release开发解锁失效、nginx登录/账号列表、三屏存在、用量深链接、TLS后端版本、404页面，共6项；0 pageerror。

`evidence/upgrade-verified-0.2.4.json`与`upgrade-verified-0.2.1.json`：0.2.1建用户余额7.5→pg_dump→0.2.4运行保留7.5→故意改测试余额99→pg_restore备份→回滚0.2.1恢复7.5、认证读取通过。升级使用官方校验过的发行包。`official-update-check.json`记录403 warning；`official-update-result.json`记录官方接口返回already_up_to_date，**因warning不计成功在线更新**。

## 发布声明边界

## 最终候选验证

工作区全量727项：726通过、1可选public浏览器跳过；公共浏览器本轮分线已单独32/32通过，另有19组新增非账号交互检查。类型检查和release构建通过。候选源码包全新解压后用pnpm10.28.2锁定安装，类型/构建通过；727项中725通过、2跳过（可选public浏览器、未随包分发的官方checkout对比；固定契约测试仍执行）。257项源码/部署文件哈希逐项一致，差异0。没有把第二个可选跳过隐瞒成同一数字。

当前本机无Docker守护进程且无已安装WSL发行版，未安装系统级虚拟化组件。故五项不能被描述为“不带条件全部生产验收完成”：源码、核心业务、上传和候选包已收口；部署的Docker/生产拓扑与自动在线更新依然有明确环境条件。未以这些条件阻止生成可审阅交付物。

可以交付有明确能力矩阵的候选前端和已验证静态nginx部署方案；不能声称任意Docker/生产Redis/支付OAuth供应商/所有部署拓扑均验收。没有当前可用Docker守护进程，也没有可用外部沙箱，所以上述条件不能通过再跑本地夹具消除。用户后续部署前须核验这些特定环境项。现有功能全部保留，未用删除功能来规避验收。
