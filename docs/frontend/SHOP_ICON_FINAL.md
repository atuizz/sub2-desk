# I04 · 小铺独立图标完成记录

日期：2026-09-12。状态：本任务完成，可供父任务集成。范围仅为小铺图标及对应接线。

## 实际变更

原 `card_shop` 在 manifest 应用定义和末尾统一映射中都复用了 `wallet`。现新增独立 `card_shop` 注册项，并将这两处图标引用改为 `getAppIcon('card_shop')`；其他应用的图标、窗口参数、角色和组件定义未改。小铺工具栏使用已有 `MacAppIcon` 显示同一图标，旁边保留应用名称，图像为装饰性空 alt。

原创 SVG 使用珊瑚红条纹雨棚、瓷白店面、青色玻璃橱窗、黄铜把手和石质台阶。保留左上光源、材质高光、内凹窗框、柔和投影；没有通用底板、钱包复用、外部素材、字体依赖或内嵌位图。

默认和 `--mode release` 使用相同的独立图标，版本 URL 为 `/assets/app-icons/card_shop.png?v=shop-20260912-r1`。SVG 与高清 PNG 也同时提供给两种模式。

## 修改文件（11 个）

| 文件 | 内容 |
| --- | --- |
| `packages/sub2-console/src/assets/appIcons.ts` | 仅新增小铺源图及成品映射 |
| `packages/sub2-console/src/apps/manifest.ts` | 仅小铺定义及末尾小铺图标映射 |
| `packages/sub2-console/src/apps/user/CardShopApp.vue` | 工具栏增加统一图标与对应布局 |
| `scripts/build-shop-icon.cjs` | 独立 SVG 生成、光学尺寸归一化、PNG 派生、浅深底审阅图及资产清单 |
| `packages/sub2-console/public/assets/semantic/card_shop.svg` | SVG 源图 |
| `packages/sub2-console/public/assets/app-icons/card_shop.png` | 256px RGBA 运行时图标 |
| `packages/sub2-console/public/assets/app-icons/card_shop-1024.png` | 1024px RGBA 高清图标 |
| `packages/sub2-console/public-release/assets/semantic/card_shop.svg` | release 同源 SVG |
| `packages/sub2-console/public-release/assets/app-icons/card_shop.png` | release 同源 256px PNG |
| `packages/sub2-console/public-release/assets/app-icons/card_shop-1024.png` | release 同源 1024px PNG |
| `docs/frontend/SHOP_ICON_FINAL.md` | 本任务卡、验证与父任务交接 |

辅助证据均位于 `output/shop-icon-final/`：修改前三个源码快照、独立构建目录、浏览器夹具运行器、截图与 JSON 报告。没有覆盖共享 `dist` 或其他人的临时服务。

## 尺寸、透明边距与材质核验

以 `alpha >= 32` 求可见包围盒；256px 成品经 1024px 源渲染后 Lanczos3 缩小，保持 sRGB、完整 RGBA 和无损 PNG。

| 资产 | 尺寸 | 可见包围盒 | 透明边距（左/上/右/下，以阈值计） | 字节 |
| --- | --- | --- | --- | ---: |
| SVG | 1024×1024，viewBox 256×256 | 840×772 | 92/126/92/126 | 8,887 |
| 运行时 PNG | 256×256 | 210×193 | 23/31/23/32 | 53,582 |
| 高清 PNG | 1024×1024 | 840×772 | 92/126/92/126 | 180,510 |

所有画布最外沿 alpha 均为 0，阴影未被裁断。主体最长边为画布的 82.03%，中心误差不超过半像素。public 与 public-release 对应三个文件的 SHA-256 分别一致；两份生产构建中的这三个文件也与源资产完全一致。

- 运行时 PNG SHA-256：`ed065df8a54654311a877a74e54d2a010a684addcef56931f88898b11b077a70`
- 高清 PNG SHA-256：`2628c069b46471754ce543fe262def51ea04f95adeff30228bbec5fd5096250f`
- SVG SHA-256：`4818615e554af55640b0a59293765dd75dfbf9e5e32591bf06c3268395d579f5`

已查看 `shop-sizes-light-dark.png` 的 16/32/64/128/256px 两组背景，以及 `shop-detail.png` 的 512px 细节：雨棚与橱窗在小尺寸仍可辨识；深色背景下瓷白边缘清楚，主体没有整体变暗；无需依靠包裹底板表达应用语义。16px 仅保留店铺轮廓与主色，细小把手和包裹不作为该尺寸的辨识要求。

## 检查结果

按类型检查 → 构建 → 浏览器的顺序执行：

1. `pnpm --filter @sub2-mac/console typecheck`：通过。
2. `node --test scripts/desktop-card-shop.test.cjs`：现有 47/47 通过。
3. `pnpm --filter @sub2-mac/console exec vite build --outDir ../../output/shop-icon-final/build-default`：通过，608 模块。
4. `pnpm --filter @sub2-mac/console exec vite build --mode release --outDir ../../output/shop-icon-final/build-release`：通过，608 模块。
5. 对两份生产产物执行 Chromium 浏览器夹具：默认/release × 浅/深，各 21 项，共 **84/84 通过**。生产页面无开发句柄；Dock、桌面、启动台、访达网格/列表、窗口标题、工具栏均解码为同一 256px 小铺图标；钱包仍使用自身图标。实际从启动台及访达打开/聚焦小铺，并检查 390×844、1440×900 布局，0 脚本异常、0 横向溢出。
6. 实际点击外部打开并在新标签读取隔离店铺；内嵌 iframe 夹具加载通过，sandbox 属性逐字保持。源码与修改前对比，小铺 script 业务逻辑及 iframe 整个元素标签一致，仅新增呈现所需导入。

浏览器证据：`output/shop-icon-final/browser-results.json`；截图 `default-light-shop.png`、`default-light-finder.png`、`default-light-launchpad.png` 及对应 `default-dark`、`release-light`、`release-dark` 和 `*-390.png`。资产证据：`assets.json`、`scope-verification.txt`。

复现生成：`node scripts/build-shop-icon.cjs <sharp模块路径>`。本机 sharp 路径为 `C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp`。生成器只写小铺六项资产及本任务审阅证据，不重生其他图标；无需修改项目依赖或锁文件。

复现浏览器：`node output/shop-icon-final/browser-check.cjs <playwright模块路径>`，本机模块位于上述运行时 `node_modules/playwright`。运行器为每份生产构建创建随机本地端口和隔离浏览器上下文，结束时关闭所有本次创建的实例。

## 业务边界与父任务交接

不需要修改 `App.vue`。当前动态注册已使用 `ALL_APPS.find(app => app.id === 'card_shop')`，Dock、桌面和启动台从同一注册项读取 icon；访达读取 manifest，窗口在创建时继承该 icon。两处 manifest 的钱包映射均已修正，不能只保留第一处修改。已有页面通过 HMR 时，历史窗口实例可能仍保留创建时的旧 icon；关闭重开小铺或刷新页面即可取得新图标，本次生产核验均从新页面启动。

用户说明“正常 Chrome 可打开、内置浏览器有限制”的店铺访问边界保持。未修改 `utils/cardShop.ts`、内嵌白名单、sandbox、超时/fallback 或外部打开策略。本机 Google Chrome 自动化启动进程直接退出，因此本轮页面核验使用 Playwright Chromium；未重新证明正常 Chrome 或 Codex 内置浏览器对真实第三方店铺的放行情况。

所有 API 和店铺请求由隔离夹具拦截，唯一模拟写请求为每个上下文的登录；没有真实购买、真实店铺配置保存或后端写入。未改 `server/`、真实配置、根目录二进制、旧原型、Accounts/OAuth、其他图标或共享桌面组件。

本图标任务无待实现项。父任务负责合并本卡结果至共享 `EXECUTION_PLAN.md` 与最终交付记录；本次按独占边界只更新此卡，不编辑父任务共享计划。最终打包/发布以及真实店铺兼容性验收不包含在本卡完成声明中。

源码发行交接：当前 `scripts/package-release.cjs` 使用白名单，尚未包含 `scripts/build-shop-icon.cjs` 与 `docs/frontend/SHOP_ICON_FINAL.md`。父任务最终打包时应将这两个路径加入 `selected`；该打包脚本不属于本卡独占范围，因此本次只登记。图标六项资产所属 `public-release`/桌面模式 `public` 目录已有整体打包规则，运行时图标不受这两项文档/工具遗漏影响。
