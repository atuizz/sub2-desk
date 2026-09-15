# 1.0.0 发布前审核

范围：当前Vue/Pinia前端、可分发素材模式、源码/静态归档、Docker输入、nginx模板、依赖与私密文件排除，以及已有业务验收证据。用户授权审核无阻断后部署和发布，邮件与真实支付不作为此次验收门槛。当前还未指定正式服务器、域名、后端origin与发布仓库；本报告不把本地验证写成线上验收。

## 本轮确定问题与修复

1. Dockerfile只复制packages，新增的Vite配置却需要scripts/release-snapshot.cjs，快照还需要Dockerfile/deploy。已明确COPY所需输入；没有扩大为复制整个工作区。回归按Dockerfile的实际COPY列表验证所有快照输入，并实际复现该目录锁定安装、类型和构建成功。
2. 静态包原先仅提供依赖许可标识表。collect-licenses现在保留100个生产依赖版本的原始LICENSE/COPYING/NOTICE或README许可段，并生成THIRD_PARTY_LICENSES.txt；源码/静态包与镜像均携带。3个上游npm包（Airwallex SDK/airtracker、Vue devtools API）本身未附完整版权文本，附录诚实记录版本和声明，不编造版权，不能把此自动整理称为专业法律审核。
3. nginx HTTPS上游增加SNI；静态HTML/资源加入nosniff/no-referrer，关闭服务版本号。保留现有API与setup精确转发、WebSocket头、长请求超时、关闭响应缓冲和256MiB上传限制。
4. 白名单归档加固.env、私钥/证书、dump及运行文件拒绝规则。对实例配置中的已知秘密、当前会话及管理员测试密码进行精确匹配扫描，未发现真实凭据。两处字符串命中经核实是数据库类型/default username，而非密码赋值；不把精确扫描夸大成全格式密钥保证。

## 验证证据

- output/prepublish-audit/tests.txt：885项，884通过、1项可选公共浏览器跳过。已有相同应用代码的R08浏览器证据保持；本次没有声称重新穷举所有业务界面。
- console-typecheck.txt/core-typecheck.txt：类型检查通过。build-release.txt：release构建通过。
- dependency-audit.json：在线生产依赖audit未报告已知漏洞（0 critical/high/moderate/low）；不代表未来漏洞或所有手写代码安全。
- container-build-context、container-install.txt、container-build.txt：按Docker COPY生成独立上下文，锁定安装与pnpm build:release通过。使用本机Node，不是Linux Docker镜像执行；Docker引擎在本机不可用。
- nginx/report.json：22项真实nginx检查通过，含SPA深链接、资源404/cache/MIME、API/v1/setup/header转发、超过上传限制拒绝、现用后台真实0.2.4只读访问。真实业务写入0；临时nginx与echo服务回收。
- artifact-scan.json：公开源码文件排除、已知本地秘密核对，扫描范围和已复核误报明确记载。最新归档路径与扫描结论由伴随validation.json收口。

## 上线条件与边界

最终候选：output/releases/1.0.0-20260913-184251，含source/static归档和SHA256。新源码包535个文件扫描通过；独立解压锁定安装后885项882通过3可选跳过（公共浏览器及两项未随包分发的官方源码对比），类型与release构建成功。234静态文件逐哈希一致，证据rebuild-comparison.json。构建输入检查不能代替Docker引擎实跑。归档旁RELEASE_NOTES.md/validation.json记录打包后完成的核验；打包时文档阶段保留，不伪造时间顺序。

审核后的静态前端和可分发源码可进入部署。必须只公开静态包html目录，不能把D:/sub2-mac、output、server或任何私有备份目录作为Web根。默认5173是开发服务，不作为公网生产入口；本地测试用账户和默认数据库凭据不可沿用为公开生产配置。

正式上线待提供目标服务器/域名/后端origin和发布仓库；届时校验目标身份、可用空间、备份与回滚目录、独立静态根、TLS和正确API路由，部署后验证登录及只读业务。若使用Docker，还须在目标构建/运行镜像；若采用已有nginx静态部署，Docker实跑不是该路径的前置条件。尚未执行远端修改、DNS切换或公开Release上传。

官方0.2.4部分退款后续退仍受后台限制；GitHub API403时自动更新仍可能不可用；邮件/真实支付/OAuth提供商、生产Redis、正式TLS/CDN未被本地夹具替代验收。桌面预览素材有与可分发素材不同的来源边界，只将release素材包作为开源发布候选。
