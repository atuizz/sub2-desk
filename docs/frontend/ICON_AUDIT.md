# 应用图标审计与接线规则

> 本文为2026-09-08基线；最新逐项决策与8个业务图标修订见 [2026-09-11逐项复核](ICON_REVIEW_2026-09-11.md)。

审计日期：2026-09-08。范围是当前仓库文件，不沿用旧截图或旧审阅结论。

## 结论

- APP_ICONS 精确覆盖 ALL_APPS 的 24 个 ID；24 个成品资源均不同。
- 选取现有 18 个 PNG、6 个 SVG；全部转换为 256 × 256 RGBA PNG，原图未覆盖，未下载外部素材、未手画替代图案。
- 24 个来源文件合计 6,108,325 字节；新资源合计 880,878 字节（约 0.84 MiB），减少 85.58%。这是图标资源体积，不是页面总包体或加载耗时。
- 当前 public 目录的 44 个 SVG 无 image 内嵌位图、无 emoji 文本。根目录 assets 的 SVG 也已逐个解析，未发现内嵌位图或 emoji。文字节点是 $, O, T, yd、根目录 GIFT CARD 等普通文字，不能把 SVG 扩展名直接等同于伪矢量或 emoji。
- 既有素材缺少单独来源与许可清单。本轮仅标记为“仓库既有素材”，不把外观类似 macOS 视为官方来源或已核实发布授权。6 个 SVG 是既有业务图形，未将其冒充 Apple 原生图标。

## 盘点范围与重复

- 根目录 assets：37 个 PNG/SVG；生产候选 packages/sub2-console/public/assets：66 个 PNG/SVG（22 PNG、44 SVG），不包含本轮新增 app-icons 子目录。
- 根目录另有 41 张 PNG/SVG 页面截图或对比图，属于审阅证据，不作为应用图标。依赖目录、构建产物、output 截图不计入来源素材。
- 同名但根目录/public 内容不同：settings.svg, terminal.svg, trash.svg, voucher.png, voucher.svg, wallet.png, wallet.svg。前端映射统一以 public 为来源，禁止按同名文件从根目录同步覆盖。
- 根目录 voucher.png 与 cert.png 二进制相同；public/voucher.png 已是不同的礼品卡图像。public/cert.png 的画面是礼服，名称不能证明证书/安全语义，因此未使用。
- 原 manifest 中 ops/activity 共用 activity.png，admin_subscriptions/subscriptions 共用 calendar.png。本映射分别用 notes.png 表达使用记录、subscriptions.svg 表达个人权益，保留运维波形及管理员日历。
- accounts 改选现有 keychain.png，keychain 保留 passwords.png：上游凭据与用户 API 密钥在形状和颜色上分离。

## 24 个应用映射

所有来源均相对于 packages/sub2-console/public/assets；成品路径为 /assets/app-icons/<应用 ID>.png。

| 应用 ID | 来源 | 选择依据 | 成品字节 |
| --- | --- | --- | ---: |
| finder | finder.png | 保留访达 | 29,506 |
| launchpad | launchpad.png | 保留启动台 | 29,852 |
| dashboard | dashboard.svg | 仪表语义；现有矢量 | 35,513 |
| ops | activity.png | 活动监视器，保留运维语义 | 60,328 |
| users | users.svg | 多人语义；现有矢量 | 24,649 |
| groups | shortcuts.png | 叠层与流程分组 | 54,632 |
| channels | apps.png | 应用集合与渠道配置 | 33,323 |
| admin_subscriptions | calendar.png | 日历与期限管理 | 55,569 |
| accounts | keychain.png | 上游凭据钥匙串，与 API 密钥区分 | 49,553 |
| plugins | developer.png | 开发工具与扩展 | 51,008 |
| announcements | reminders.png | 通知与事项列表 | 29,674 |
| proxies | proxies.svg | 网络节点与连接；现有矢量 | 30,794 |
| security | security.svg | 盾牌与安全；现有矢量 | 42,475 |
| commerce | numbers.png | 账务与统计 | 34,425 |
| keychain | passwords.png | 保留多色密码钥匙 | 28,676 |
| safari | safari.png | 保留指南针 | 51,291 |
| activity | notes.png | 日志与记录，避免复用运维波形 | 33,198 |
| network | network.svg | 可用连接；现有矢量 | 26,650 |
| subscriptions | subscriptions.svg | 权益卡片，与管理员日历区分 | 27,461 |
| wallet | wallet.png | 采用 public 内钱包，不取根目录旧版 | 27,383 |
| voucher | voucher.png | 采用 public 内礼品卡，不取 cert 别名 | 26,018 |
| appstore | appstore.png | 保留应用商店 | 37,896 |
| terminal | terminal.png | 保留终端 | 14,412 |
| settings | settings.png | 保留系统设置 | 46,592 |

## 光学与材质规则

1. 图形保持原颜色、原方向、原高光与阴影；无重绘、描边替换、裁圆角或统一黑白化。
2. 以 alpha ≥ 32 的非透明像素求包围盒，使其最长边为 210 px（256 画布的约 82%），中心放在 (128,128)。这提供一致的可见尺寸，不按文件原始边长盲目缩放。
3. 使用 Lanczos3 等比重采样、sRGB、完整 RGBA 和 PNG 无损压缩；完整透明画布一同缩放，保留包围盒之外的柔和阴影。
4. 使用 256 px 文件适合 16–128 CSS px 的常用呈现；128 CSS px 对应 2× 像素密度。更大宣传图应选原素材，不能声称放大 256 px 后仍有原始 1024 px 细节。
5. default 不叠底板；dark 增加深色衬底与细边界；transparent 去底板并保留轻微阴影；tinted 只给衬底染色。四种模式的主体图像始终 opacity:1，无整体变暗、去色或单色滤镜。
6. tinted 的色调由 --mac-icon-tint 或既有 --accent 控制。当前不是一套重制的官方浅/深/着色图标变体。
7. 按钮 hover/focus 仅轻微放大图像，交互语义与焦点环仍由父按钮负责；减少动态效果时关闭图像位移与缩放。

## main 接线

本轮不修改 manifest、core index、Dock、Launchpad、Finder 或其他现有组件。

1. manifest 导入 src/assets/appIcons.ts 的 getAppIcon；只把每个应用的 icon 改成 getAppIcon(app.id)，或在数组构造结束时仅映射 icon 字段。保持 ID、角色、组件、窗口参数原样。
2. core index 由 main 增加导出：

```ts
export { default as MacAppIcon } from './components/MacAppIcon.vue';
```

3. 统一 Dock、启动台、访达、桌面入口与窗口标题图标；不必改工具栏功能性小 glyph。使用示例：

```vue
<MacAppIcon :src="app.icon" :size="48" :appearance="dockIconTheme" alt="" />
```

父按钮已有应用名或 aria-label 时 alt 传空；独立图标需传应用名。src/alt/size/appearance 为呈现接口，interactive 可选，load/error 可监听。组件不负责启动应用、权限或窗口状态。

4. 使用 MacAppIcon 后，移除对应节点及其祖先上的 dock-icon-theme-dark/transparent/tinted 旧滤镜、额外 opacity、背景与重复图片缩放；父级 filter 会连同整个组件一起作用，子图片 filter:none 无法抵消祖先滤镜。保留 Dock 容器自己的背景材质。
5. 原始 img 如果暂不接组件，也可以先使用 APP_ICONS 的成品路径。不要再额外裁切透明边缘或把 82% 留白压缩第二遍。
6. 后续新增应用：更新 APP_ICON_SOURCES、APP_ICONS 和本表，重新核对 ALL_APPS 的 ID 集合；不把未知 ID 的兜底网格当作正式图标验收。

## 校验与剩余边界

- 已逐个解析两个来源目录的 PNG 尺寸和 SVG 结构，查看 public 应用素材联系表及 24 个成品联系表。
- 24 个映射与当前 manifest ID 集合一致：通过；选定来源文件生成前后 SHA-256 一致：通过。
- 已检查 Vue scoped CSS 编译产物：父按钮交互选择器必须把完整后代选择器包入 :global(...)，不得产生全局 button:hover 的 transform。
- 类型检查及组件编译由交付时命令结果确认；完整 Dock/Launchpad 接线后的浅深色、四种 appearance、16/32/48/80px、390px 屏幕、焦点与减少动画测试由 main 集成完成。
- 文件失败时组件展示文字占位并发出 error；没有静默请求第三方图标或替换成 emoji。

## 原始 PNG 完整清单

| 文件 | 尺寸 | 字节 | 两目录关系 |
| --- | --- | ---: | --- |
| activity.png | 1024 × 1024 | 788,766 | 与根目录相同 |
| apps.png | 1024 × 1024 | 462,118 | 与根目录相同 |
| appstore.png | 1024 × 1024 | 414,174 | 与根目录相同 |
| calculator.png | 256 × 256 | 24,481 | 与根目录相同 |
| calendar.png | 256 × 256 | 47,145 | 与根目录相同 |
| cert.png | 1024 × 1024 | 410,807 | 与根目录相同 |
| developer.png | 1024 × 1024 | 718,238 | 与根目录相同 |
| finder.png | 256 × 256 | 29,709 | 与根目录相同 |
| keychain.png | 1024 × 1024 | 438,316 | 与根目录相同 |
| launchpad.png | 256 × 256 | 23,794 | 与根目录相同 |
| music.png | 256 × 256 | 22,372 | 与根目录相同 |
| notes.png | 256 × 256 | 28,517 | 与根目录相同 |
| numbers.png | 1024 × 1024 | 375,252 | 与根目录相同 |
| passwords.png | 1024 × 1024 | 373,032 | 与根目录相同 |
| photos.png | 256 × 256 | 63,793 | 与根目录相同 |
| reminders.png | 1024 × 1024 | 325,252 | 与根目录相同 |
| safari.png | 256 × 256 | 42,277 | 与根目录相同 |
| settings.png | 1024 × 1024 | 678,499 | 与根目录相同 |
| shortcuts.png | 1024 × 1024 | 570,918 | 与根目录相同 |
| terminal.png | 256 × 256 | 7,692 | 与根目录相同 |
| voucher.png | 1024 × 1024 | 414,330 | 与根目录不同 |
| wallet.png | 1024 × 1024 | 354,824 | 与根目录不同 |

## public SVG 完整清单

| 文件 | viewBox | text 节点 | image 节点 |
| --- | --- | --- | ---: |
| accounts.svg | 0 0 1024 1024 | 无 | 0 |
| activity.svg | 0 0 100 100 | 无 | 0 |
| admin-subscriptions.svg | 0 0 1024 1024 | 无 | 0 |
| announcements.svg | 0 0 1024 1024 | 无 | 0 |
| appstore.svg | 0 0 100 100 | 无 | 0 |
| avatar.svg | 0 0 256 256 | 无 | 0 |
| books.svg | 0 0 100 100 | 无 | 0 |
| channels.svg | 0 0 1024 1024 | 无 | 0 |
| chrome.svg | 0 0 100 100 | 无 | 0 |
| clash.svg | 0 0 100 100 | 无 | 0 |
| cloud.svg | 0 0 100 100 | 无 | 0 |
| commerce.svg | 0 0 1024 1024 | $ | 0 |
| dashboard.svg | 0 0 1024 1024 | 无 | 0 |
| downloads.svg | 0 0 100 100 | 无 | 0 |
| file.svg | 0 0 256 256 | 无 | 0 |
| folder.svg | 0 0 256 256 | 无 | 0 |
| gdrive.svg | 0 0 100 100 | 无 | 0 |
| groups.svg | 0 0 1024 1024 | 无 | 0 |
| keychain.svg | 0 0 100 100 | 无 | 0 |
| launchpad.svg | 0 0 128 128 | 无 | 0 |
| music.svg | 0 0 100 100 | 无 | 0 |
| network.svg | 0 0 1024 1024 | 无 | 0 |
| numbers.svg | 0 0 100 100 | 无 | 0 |
| ops.svg | 0 0 1024 1024 | 无 | 0 |
| outlook.svg | 0 0 100 100 | O | 0 |
| plugins.svg | 0 0 128 128 | 无 | 0 |
| proxies.svg | 0 0 1024 1024 | 无 | 0 |
| qq.svg | 0 0 100 100 | 无 | 0 |
| security.svg | 0 0 1024 1024 | 无 | 0 |
| settings.svg | 0 0 128 128 | 无 | 0 |
| subscriptions.svg | 0 0 1024 1024 | 无 | 0 |
| teams.svg | 0 0 100 100 | T | 0 |
| terminal.svg | 0 0 128 128 | 无 | 0 |
| trash-full.svg | 0 0 256 256 | 无 | 0 |
| trash.svg | 0 0 100 100 | 无 | 0 |
| users.svg | 0 0 1024 1024 | 无 | 0 |
| voucher.svg | 0 0 1024 1024 | 无 | 0 |
| wallet.svg | 0 0 1024 1024 | 无 | 0 |
| wallpaper-darkspace.svg | 0 0 2560 1440 | 无 | 0 |
| wallpaper-sequoia.svg | 0 0 2560 1440 | 无 | 0 |
| wallpaper-sonoma.svg | 0 0 2560 1440 | 无 | 0 |
| wechat.svg | 0 0 100 100 | 无 | 0 |
| word.svg | 0 0 100 100 | 无 | 0 |
| youdao.svg | 0 0 100 100 | yd | 0 |

## 来源与成品指纹

以下是本次生成时的完整 SHA-256；原图未覆盖。文件路径分别见上方来源表和 /assets/app-icons/<ID>.png。

| ID | 来源 SHA-256 | 成品 SHA-256 |
| --- | --- | --- |
| finder | c14e156894692c54043065d006a51d4a83e8803aa4e50fb678ef2c8ed594348d | 3259d5da169582847eff72b6094d926a5f051a7bd138295c2c73ad4cda7967bd |
| launchpad | faf594b61be97ca7bace10efe6197f15b5afb49fbb247b1afdd2782ff1013466 | c7be51e66bec9464e47020cde2b53e710c9fc57101403fcd1de47d36de191ab9 |
| dashboard | 38d55b459457330c79e64e6ed60831d8961389f1dfc54663c8eff65f27582e39 | 3109e87dfa5bb2b5172480961892dd85277f4c77dc973a374c54d56b54438547 |
| ops | 79f909a5839f2d307f00a8d8d363d73e907604b39de0fa74c5493a8e7acf28dd | bd1be56081a94de85622b6096931a14d66459024c20275213f9eb42a531eb855 |
| users | 8c68bbd91cfa15d06ed23855e37d9fd5d7192b341d7e4a57c6c53aa1edf0bdcb | 54725b2afd4c4378e0bc238de09cff68cb9df47c47e618c88118fec13795c050 |
| groups | f14812bac2ae363d7120b5999991fe9a6643ac118e824183f0562ea44af17b5e | e41e7fe17f7cc470d45da397840db0b27a8bdea141e5b9bd5077588e4cb762e7 |
| channels | bd734d6e8f45e83851d2b2166e9edee4af2cb779825cd0851ea4434012647e2e | 3259275d930ba5831e1d01af2ae7ee2ca835dd3978c06a5efe02a36c7238b094 |
| admin_subscriptions | 89178c34b36ada74540759ae00e65ad2ca69eea3bad9089f92a41e6093caab10 | 57fea8d800c3fc0ad313e0c43173b26575db4e505bf38c9a8adcda196554ebfa |
| accounts | 4fd8b0ac18ac42a19d211b1985440ff6e723734912f18ed8b1ac63ba286014f8 | 39d2f595fb2b51f3f2efc8336bfe33d51ba4b00381ebef9d9417102543302b4f |
| plugins | 8ef1859d19c91c9a864e943f81248df3b4de4d48c3106b2d4125b1f1e3345f9a | cf7d3a57019deba9c926235d2125411f8d9bff33faa233fe78cde01dae4ed72e |
| announcements | 40a18cef9883f240fce6ce0ab0874325c3239bd0cb40ae339ac1221e571d9aff | e048389846664dcdcd05f852111a22bfa7d131bc07e0430fb69bcaf281d668ea |
| proxies | c5e9eaa05d6b65b3506a2b43f8ba0c97021652ca0148db241a9e69704e569c22 | 9aff77f7a1be5899322fcce4abefcb4807a5df578969408883d7b804241c5348 |
| security | 9e569c53d57b369ca3cc3061ff9295bbb9a2d438267608169c21b8f81033bb20 | 47c7bbb4e46f987e463b3ddf84a75502c5e63a01ef841062999a3271228f7d11 |
| commerce | 530cae92ccdb408b42c34a07b8c5fd4363e774d605e012b87f11a22f5ccb6d79 | d99f844edc88f81f900b3dd3f5c5dbf2e87026acead498ed0be183037bb77787 |
| keychain | 432f6125dcaa22b6d693b0f50c0c6e8e4dd1fb8061547f66154effc98c6b7257 | 165a64d93bc0ac0ef9f258adf6f0e11b0e800ef98f412961304b2d1ddd8ae6dd |
| safari | 9d33999255dbb3b5cb1e4155ae87a7f411f9c51f82bfca9f9fe29ed33c8ccd44 | fde1760be839776598c92c192197038482fbf718d19dd13616f18d374e15c80e |
| activity | 74e4077a96064e8d58d86bafb6c5c3119240f244b66db96f42e7432c2b0e6f8d | fecdacfba08fda33f4803a40ef1e919525db0a750201bb0b20a1d1c79658f317 |
| network | cd47376a7dd81410610a35c959d3198aaf93d7d33e8936072c959ee5580715fd | 9414ac3bf5aac9335bfef36a954fda3fcab50ef8ab8118bae5ad20a22ee1491b |
| subscriptions | 87f37b2d8a689f4332f42d2c6d59bf7bf023e16235509cf7eaae09686ed24807 | ba82d744cb72137ef982dddb909b0e3d452996a72ffb2300204e8d1eab3f62f7 |
| wallet | 2ac97de82c66efa2fd83edb3511650a9017e65e1c1e128458e0f0a1b46fe3b6e | 0cb60310c09b954339a0584ec57d39a995d87267a0033287539b1f01da079207 |
| voucher | 32edf0833a5d92b20eb4c0c71c3138686ce59311484cacb047330de2cfba63a2 | 646ebd596dde0344e5954d253f89cce21e1088698af2fb0c267391b5dfd6c7cd |
| appstore | 02d758ea8a2a93c8f6302c1b4a22c1823db0fc84b44a484a82ac2e8d2d1fad45 | 179991e46e4ab08c826afe7aae26fd9b28d2e64b745563818e7a0c108558c21d |
| terminal | 20d5a4bade18f39508b70ce7f3a6131ddb7429ca6166c44df2d41343fb3c65b3 | f5354d99404ec8048116f2751a219dc9a83b7304b2fd1986111819e3cfb72e2c |
| settings | 42f7f5a5cad6e2d4a3218d3abea77c074975301808e575bf863adde28d748365 | deb19ddfd5c8f5d15740313e2274923f16d5a529d49158504bcca85212b444d3 |

## 交付时校验结果（2026-09-08 22:35）

- core 类型检查通过；MacAppIcon 的 scoped CSS 编译通过，未生成裸 button/a 的全局 transform。
- console 类型检查当前仅报告分工外 src/stores/system.ts:28 的 Object.hasOwn 与 ES2020 lib 不兼容；本轮未修改该文件，也不将整项目类型检查记为通过。main 可在原位置使用 Object.prototype.hasOwnProperty.call(ACCENT_COLORS, saved.accentColor)，保持现有编译目标。
- 成品 PNG 尺寸、alpha ≥ 32 主体最长边 208–212 px 与中心误差 ≤ 1.5 px：24/24 通过；SHA-256 唯一数量 24/24。
- 根目录 41 张 PNG/SVG 截图均能读取有效尺寸：通过。两个原素材目录的 SVG data:image/image/foreignObject 检查：0 个命中。
- 已查看同一批24个成品在浅色和深色底面的联系表；四种组件 appearance 与 Dock 祖先滤镜仍需 main 浏览器接线检查。
