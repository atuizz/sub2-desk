# 来源与许可

Sub2 Desk（原内部项目名 Sub2-Mac）是独立的 Vue 桌面前端，不是 Apple 或 Sub2API 官方发行版。Sub2 Desk 与 Sub2API 名称的兼容关系不构成官方背书。

- Sub2API API 客户端、类型及部分工具代码来源于 [Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api)。保留上游 LGPL v3 许可，全文见 LICENSE；GPL v3 补充全文见 COPYING。参考源码核对日期：2026-09-11。
- 本项目的桌面交互、页面适配和原创代码按 LGPL-3.0-only 提供。修改记录见 CHANGELOG.md。第三方图标、壁纸和商标不因随项目提供而改为本项目所有或获得LGPL授权。
- 从1.1.1起，发行素材与用户确认的本地体验统一。`public-release`由`scripts/sync-desktop-assets.cjs`从本地`public`核验同步；完整文件哈希见`docs/frontend/DESKTOP_ASSET_MANIFEST.json`。未使用的user-ref参考图不随包提供。
- 既有桌面素材含第三方macOS应用图标与壁纸，以及本项目制作的业务语义图标和小铺图标。部分历史素材没有完整来源记录，不宣称这些素材全部原创或属于LGPL许可。业务图标制作记录见`scripts/build-semantic-icons.cjs`与`scripts/build-shop-icon.cjs`。1.1.0的独立简化素材方案已被用户明确取消。
- Vue、Pinia、Axios、Chart.js 等第三方库保留各自许可；具体版本以 pnpm-lock.yaml 为准，发行包附 THIRD_PARTY_NOTICES.md。

glass-dawn、glass-midnight、glass-lake为用户提供的ChatGPT生成壁纸，保留1672×941像素。tahoe-hd、tahoe-dark-hd、tahoe-beach-hd来自512 Pixels的macOS壁纸归档（https://512pixels.net/projects/default-mac-wallpapers-in-5k/），从1.1.1起与本地一样随发行使用，不声明为本项目原创或LGPL授权素材。历史来源与尺寸记录见docs/frontend/PARITY_WALLPAPER.md。

这是源码与静态前端的分发许可说明，不包含 Sub2API 后端程序、实例数据、模型服务、商标或第三方账户的使用授权。
