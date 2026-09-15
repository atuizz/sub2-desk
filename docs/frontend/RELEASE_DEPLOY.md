# 发布部署收口 · DEPLOY-01 · 2026-09-13

状态：本任务请求体对齐、真实 Windows nginx 传输验收完成；Docker 生产镜像与真实后端业务验收未完成。本卡对应 RELEASE_READINESS_20260913 第 3 项及第 4 项的 nginx 子项，不能据此把五项发布门禁整体标为通过。

## 改动与限制契约

官方参考源码 `output/upstream-current-20260912/backend/internal/config/config.go` 的 `server.max_request_body_size` 和 `gateway.max_body_size` 默认均为 `256*1024*1024`；示例 `deploy/config.example.yaml` 明列 `268435456`。这是官方默认值的源码证据，不是当前生产配置的读取结果。

| 层级 | 本轮约束 |
| --- | --- |
| nginx 请求体 | `client_max_body_size 268435456`，恰好 256 MiB 接受，多 1 字节拒绝；覆盖整个 server，包括 API、网关、安装接口等 |
| 前端最终 JSON | UTF-8 编码 `JSON.stringify(payload)`，最多 268435456 字节；包含字段名、JSON 转义、base64、提示词、元数据及封装 |
| 账号文件预算 | 单文件 20 MiB、最多 10 文件、合计 50 MiB，原有限制保留；合并后对 `{data,skip_default_group_bind:false}` 再检查，`false` 比 `true` 多 1 字节，覆盖两种提交选项 |
| 批量参考图业务预算 | 单图解码 10 MiB、按 output_count 计算总量 128 MiB，原有数量与模型限制不变；最终 HTTP JSON 另检查，不能只算解码大小 |
| 原版后端 | 部署时必须核实实际 server/gateway 限制不少于本契约；端点专有配额、模型限制仍由后端执行 |

base64 长度为每张图片 `4*ceil(decodedBytes/3)`，128 MiB 单份数据转为 base64 是 178956972 字节（约 170.67 MiB），还需 JSON 封装。多个图片须分别计算 padding。`output_count` 的解码预算重复计数不意味着 HTTP 内重复发送图片。账号 JSON 也不能仅依赖输入文件大小：例如 `1e20` 解析再序列化会展开，最终请求可能更大。

实际修改：

- `deploy/nginx.conf.template`：20m 改为精确字节；通过 map 仅在真实 Upgrade 请求设置 `Connection: upgrade`，普通请求为 `close`。
- `Dockerfile`：设置 `NGINX_ENVSUBST_FILTER=^SUB2API_UPSTREAM$`，只替换上游变量，保留 nginx 自身 `$uri/$scheme/...`。
- `desktop-file-drop.ts`：增加最终 JSON 字节校验 helper，不改拖放业务。
- `apps/admin/accounts/importData.ts`：仅导入上述 helper 并在合并预览进入 ready 前调用；无 API、导入策略或状态机改写。这两行是账号请求体限制的必要接线。
- `apps/user/batch-image/useBatchImages.ts`：在现有 validatePayload 末尾增加最终 JSON 字节检查，其他业务逻辑不变。该处保持无新增运行时依赖，以兼容现有独立测试加载器；专项测试同时约束两个入口的 256 MiB 边界。
- 新增 `scripts/upload-limits-nginx.cjs`、`scripts/upload-limits.test.cjs` 和本卡。未改主 `scripts/package-release.cjs`、server、二进制、实际业务配置及主实例。

## 可复现运行

在 Windows 项目根目录执行（Node 24、现有 pnpm 依赖、PowerShell Expand-Archive、Git 自带 OpenSSL/GPG）：

```powershell
node --max-old-space-size=4096 --test scripts/upload-limits.test.cjs
node --test scripts/desktop-accounts.test.cjs scripts/parity-batch-image.test.cjs
pnpm --filter @sub2-mac/console typecheck
pnpm --filter @sub2-mac/console exec vite build --outDir ../../output/release-validation/deploy/frontend-build
node scripts/upload-limits-nginx.cjs
```

可通过 `UPLOAD_TEST_OPENSSL`、`UPLOAD_TEST_GPG` 指定可执行路径；自定义 GPG 应为接受 Windows 路径的版本，默认 Git GPG 已做 MSYS 路径转换。脚本每次新建 UTC 时间戳隔离目录，下载固定 nginx 1.28.0 Windows ZIP、分离签名与 nginx.org 公钥；验证 HTTPS 来源及有效签名后才执行 nginx。指纹固定为 `D6786CE303D9A9022998DC6CC8464D549AF75C0A`。信任来源是 nginx.org HTTPS 发布的公钥，未声称建立个人 Web of Trust。

脚本生成仅一天有效、SAN 为 localhost/127.0.0.1 的测试证书；TLS 客户端显式信任该测试证书且保持证书/主机名校验，未使用 rejectUnauthorized=false。所有端口由系统分配高端口且仅监听 loopback。测试只派生模板的 listen、root、upstream 和 TLS 配置，不替换路由、限制或代理逻辑。HTML 是明确标记的最小 SPA 传输夹具，API 上游仅为统计字节和头信息的内存 echo，绝不连接主实例。

大请求采用流式发送有效 JSON 标量加空白，验证精确传输字节及 nginx 413；图片 base64 和最终 JSON 的真实序列化另由前端专项验证。该组合验证传输与前端限制，不声称大体积请求已被真实业务处理。每次实测传输约 1.5 GiB，nginx 默认请求缓冲可能使用临时磁盘；部署容量需考虑并发上传，256 MiB 不是内存/磁盘容量保障。

只使用本次 prefix 的 nginx PID 执行 reload/quit，finally 关闭本次 echo 服务并检查 HTTP/TLS 端口不可连接。未调用全局进程终止命令；不安装系统级 Docker 或 nginx。

## 本轮证据与结果

最终有效证据：`output/release-validation/deploy/2026-09-12T20-41-46-026Z/`（北京时间 2026-09-13 04:41–04:42）。`report.json` 为 16 组真实验收结果，`access.log` / `error.log` 为真实 nginx 日志，`rendered-nginx.conf` 为实跑配置，`nginx-config-test.txt` 为 nginx -t 输出，`nginx-signature-verification.txt` 为签名验证。

- 官方 ZIP SHA-256：`db8c7a529f84c819702bd1c50926b27d961a48b4f72fc7c46b30314fc2bbfd7c`；GPG Good signature/VALIDSIG 通过。
- TLS 校验及 `/`、`/admin/accounts`、`/batch-image`、`/setup`、未知深链接实际返回 SPA；静态资源缓存与缺失资源 404 通过。
- `/api/`、`/v1/`、`/health`、四条 setup 后端路径实际到达 echo，原始 path/query、Host、X-Real-IP、X-Forwarded-For、HTTPS scheme 与普通 Connection 均通过。
- 实际 WebSocket 101 与双向文本帧 echo 通过。
- Content-Length 请求 20971620、52428800、178961068、268435455、268435456 字节全部实际转发，上游收到字节相等；声明 268435457 的请求在上传前 413，未到上游。
- chunked 实际传输 268435456 字节放行、268435457 字节 413，拒绝请求未到上游；TLS 下另上传 1 MiB 并核对上游收到的字节。
- 本次 nginx reload、停止后不可连接、重启恢复 TLS SPA/API 通过；断开 echo 后实际 502，不回退为 SPA 200。
- 本次端口 49658（echo）、49659（HTTP）、49660（TLS），已关闭；nginxPidRemoved=true、listenersClosed=true。
- `upload-limits-tests.txt`：7/7，通过实际 256 MiB JSON 与 +1 边界、UTF-8/转义、128 MiB base64 膨胀、导入在上传前拒绝超限；`frontend-regression.txt`：原有账号/生图 50/50。
- `typecheck.txt`、`build.txt`：全前端类型检查、独立输出目录默认 Vite 构建通过。初次类型检查曾遇并行账号线尚未写入 header-overrides 的临时缺文件，后续文件就绪后复跑通过；未替他人修改。

早期 20:36 目录为尚无 PGP/重启验证的初测；20:38 目录为 Git GPG 路径问题导致执行前失败；20:40 为中间通过版。保留这些审计记录，不用它们覆盖上面的最终证据。

## 生产部署边界与剩余验收

Docker 探测 `docker version` 返回 ENOENT。本机没有安装 Docker，**未构建、启动或验收 Docker 镜像**。Windows nginx 1.28.0 不等价于 `nginx:1.28-alpine` 的 Linux 镜像；其 entrypoint envsubst、Alpine 文件权限、容器 DNS/网络、host.docker.internal、健康探针与重启策略均待有 Docker 的隔离目标实测。镜像标签可能更新，发布冻结时应记录实际 digest。

模板本身仅监听 HTTP 80；本轮 TLS 是隔离验证配置增加的监听。正式部署必须由实际 TLS 入口终止 HTTPS（或经审核加入正式证书监听），并核验可信证书链、续期、HTTP→HTTPS 跳转、外层代理/CDN 的请求体上限和 WebSocket。若 TLS 在外层终止，本层 `$scheme` 为 http，必须按可信代理拓扑传递真实 scheme，不能直接信任公网客户端自带 X-Forwarded-Proto。本轮未宣称外层 TLS 拓扑已完成。

建议隔离容器验收步骤：构建候选镜像→用测试上游配置 SUB2API_UPSTREAM→容器 nginx -T 核对实际渲染→重复 TLS/SPA/API/WS/字节边界→记录镜像 digest 与重启结果。Linux 接宿主上游时需明确 `--add-host=host.docker.internal:host-gateway` 或使用同一容器网络服务名；不得假设开发机8000在目标容器可达。

真实官方后端版本、账号导入/生图/支付与其他业务闭环、数据库恢复、后端升级与回滚由主任务验收。此处没有业务写入，也没有生产切换。主任务冻结候选后还需重新构建/打包并关联本卡；独立构建通过不等于生产包或后端通过。

Go/No-Go：请求体源码与真实 nginx 子门禁 Go；完整 Docker 部署、正式 TLS 拓扑、真实后端业务及稳定版总门禁仍待主任务收口。
