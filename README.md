# Sub2 Desk

[![CI](https://github.com/atuizz/sub2-desk/actions/workflows/ci.yml/badge.svg)](https://github.com/atuizz/sub2-desk/actions/workflows/ci.yml)

Sub2API 的独立桌面式 Web 控制台。产品名为 Sub2 Desk，使用 macOS 风格的窗口、Dock、启动台、浅深色和 390px 紧凑布局；包含 26 个核心业务/工具应用，并可按配置增加小铺应用。

这是**独立的第三方前端项目**，需连接兼容的原版 Sub2API 后端。它不是 Apple 或 Sub2API 官方客户端；发行包不附带后端程序、数据库、预设账号或实例配置。品牌与界面参考 macOS 的交互语言，但产品名称、图标和发行素材均独立设计。

## 最新集成验收

2026-09-16 公开源码通过 [Linux CI](https://github.com/atuizz/sub2-desk/actions/runs/35035651585)：1061项回归1057通过、4项按环境跳过，类型与release构建通过；真实 Docker 镜像构建、页面/登录路由、API/健康路径转发和缺失资源404检查通过。容器上游使用隔离夹具，这不等于真实支付或生产后端验收。Windows干净源码包1061项中1058通过、3跳过。此前R10真实本地后端只读复查了27个应用入口，支付空配置和空用量已修复。兼容基线为官方 Sub2API 0.2.4；邮件、真实支付、供应商 OAuth/Passkey 未做实联验收。详见[执行任务卡](docs/frontend/EXECUTION_PLAN.md)。

最新实现及检查记录见 [执行任务卡](docs/frontend/EXECUTION_PLAN.md) 和其中的 PARITY/REVIEW 报告。已接入首次安装、批量生图、扩展认证、支付收银台和高级运营流程；仍保留 [官方功能对照与边界](docs/frontend/UPSTREAM_PARITY.md)，不宣称完整替代原版。

本地预览包使用当前桌面素材：`pnpm build` 后执行 `pnpm package:desktop`。公开发行使用原创素材：先执行 `pnpm build:release`，再执行 `pnpm package:release`。两套素材不同，请按用途选择。

## 本地启动

需要 Node.js 24、pnpm 10.28.2。

Windows 已有完整本地实例可使用 `scripts/start-all.ps1`，默认读取 `output/backend-runtime`；先加 `-CheckOnly` 可只读检查。前端发行包不含该实例目录。详见[本地运维说明](docs/LOCAL_OPERATIONS.md)。

```sh
corepack enable
corepack prepare pnpm@10.28.2 --activate
pnpm install --frozen-lockfile
pnpm dev
```

打开 http://127.0.0.1:5173 。将 `packages/sub2-console/.env.example` 复制为同目录 `.env.local`，设置 `SUB2API_DEV_TARGET` 为后端地址后重启开发服务器。默认代理 `/api`、`/v1`、`/health` 到 `http://127.0.0.1:8000`。生产默认 API 基址仍为 `/api/v1`。

`/?ui-lab` 是独立组件预览，不依赖账号或业务 API。`?unlocked` 仅在开发环境用于测试，生产构建禁用该入口。

## 功能与边界

- 用户侧：用量概览、API 密钥、使用记录及完整 CSV 导出、渠道、订阅、充值订单、兑换码、模型目录。
- 管理侧：用户、分组、渠道、账号、订阅、公告、代理、插件、风控、订单与运维视图。
- 系统设置：外观偏好、账户资料、按模块的系统配置、原版后端更新、备份入口。
- 桌面组件：窗口生命周期、拖拽/缩放、弹层焦点和键盘管理；独立开发消费者展示复用方法。
- 小铺：管理员在“系统设置→小铺与兑换”填写店铺名称和链接，保存后出现购买应用，获得卡密后打开兑换。第三方店铺若禁止内嵌，可从工具栏外部打开。
- 文件导入：管理员可把官方账号导出的JSON拖到桌面或账号窗口，先本地校验/预览再确认导入；支持最多10文件，单文件20MB、合计50MB。不支持的格式不会自动上传。

前端构建、交互夹具与限定范围的真实后端核心业务已经验证；这些证据不代表全部供应商或任意部署环境。Stripe/Airwallex、微信支付/OAuth、邮件、Passkey等已有实现，真实渠道联调不计入已验收结论。缺少后端能力或付款凭据时显示失败/恢复入口，不生成模拟成功结果。官方0.2.4仍存在部分退款后续退的后台限制，详见发布审核。

软件更新使用 `/admin/system/check-updates?force=true`。返回 `warning`、超时或错误时明确显示“未能确认最新版本”；HTTP 200 不等于检查成功。若提示 GitHub 限流/连接错误，需恢复后端访问更新源，或打开页面中的发行链接。前端不修改后端更新源，也不绕过管理员合规确认。

## 检查

```sh
pnpm typecheck
pnpm test
pnpm test:parity
pnpm build
```

构建结果：`packages/sub2-console/dist/`。不能双击 HTML 代替 HTTP 服务。

首次安装入口为 `/setup`。反向代理需精确转发 `/setup/status`、`/setup/test-db`、`/setup/test-redis`、`/setup/install`，并将 `/setup` 本身交给前端。已安装的后端只显示登录入口；安装会修改后端配置，须在目标环境确认参数后执行。

浏览器验证使用 Playwright CLI（不访问真实业务数据）：

```sh
pnpm dev --host 127.0.0.1 --port 5181 --strictPort
# 在另一个终端执行
npx --package @playwright/cli playwright-cli -s=sub2-check open about:blank
npx --package @playwright/cli playwright-cli -s=sub2-check run-code --filename scripts/version-browser-check.js
npx --package @playwright/cli playwright-cli -s=sub2-check run-code --filename scripts/settings-closeout-check.js
npx --package @playwright/cli playwright-cli -s=sub2-check run-code --filename scripts/delivery-browser-check.js
npx --package @playwright/cli playwright-cli -s=sub2-check run-code --filename scripts/all-apps-browser-check.js
npx --package @playwright/cli playwright-cli -s=sub2-check close
```

截图输出目录由运行环境创建；先创建 `output/playwright/release/all-apps/apps`。更多页面回归见 scripts 下的 keychain/activity/frontend-browser-check 脚本，统一测试端口 5181。检查返回的 `passed`/断言结果，不以 CLI 进程退出码代替测试结果。

## 部署

把静态包置于独立 Web 根目录，使用反向代理将 API 路径转交原版 Sub2API。不要把项目根目录或旧 `server/` 直接作为静态站点公开。

附带 `Dockerfile` 和 `deploy/nginx.conf.template`。当前 Docker 方案是“前端静态镜像 + 外部 Sub2API 后端”，不是包含 PostgreSQL/Redis 的全栈安装器：

```sh
docker build -t sub2-desk:1.0.0 .
docker run --rm -p 8080:80 --add-host=host.docker.internal:host-gateway -e SUB2API_UPSTREAM=http://host.docker.internal:8000 sub2-desk:1.0.0
```

`SUB2API_UPSTREAM` 使用可达的后端 origin（协议、主机、端口，不带路径和尾斜杠）。公网环境由外层反向代理配置 HTTPS。Docker 镜像已在 Linux CI 中实跑并验证转发；若要一键部署完整系统，还需要额外编排兼容的后端、PostgreSQL、Redis、数据卷和备份策略。

使用已有 Sub2API 后端时，也可以用 Compose 启动前端：

```sh
git clone https://github.com/atuizz/sub2-desk.git
cd sub2-desk
cp deploy/.env.example deploy/.env
# 编辑 deploy/.env，将 SUB2API_UPSTREAM 设为容器可访问的后端地址
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Compose 会启动 Sub2 Desk 前端，并把 `/api/`、`/v1/`、`/health` 和安装路径转发到 `SUB2API_UPSTREAM`。它不会自动创建后端、数据库或 Redis；这些服务需要由已有 Sub2API 部署提供。

## 发行与开源

```sh
pnpm build:release
pnpm package:release
```

该命令按白名单生成源码和静态前端两个 `.tar.gz` 包及 SHA-256 清单。日常开发与默认构建保留既有 macOS 风格图标和壁纸；`build:release` 单独使用 `public-release` 原创素材，发行包仅打包这套原创素材；不打包原 `public`、后端、数据、旧原型、环境变量、日志和截图。源码可解压后安装依赖、复建并托管。

品牌定位、命名和视觉使用边界见 [品牌说明](docs/BRAND.md)。许可：LGPL-3.0-only，来源和第三方说明见 [NOTICE.md](NOTICE.md)、[LICENSE](LICENSE)、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本项目不使用 Apple 官方图标、壁纸或标识作为发行素材，也不表示与 Apple 官方有关联。

开发约束见 [DESIGN.md](docs/frontend/DESIGN.md)，变更见 [CHANGELOG.md](CHANGELOG.md)，本轮验收见 [交付记录](docs/frontend/DELIVERY_REVIEW_2026-09-11.md)。
