# 来源与许可

Sub2 Desk（原内部项目名 Sub2-Mac）是独立的 Vue 桌面前端，不是 Apple 或 Sub2API 官方发行版。Sub2 Desk 与 Sub2API 名称的兼容关系不构成官方背书。

- Sub2API API 客户端、类型及部分工具代码来源于 [Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api)。保留上游 LGPL v3 许可，全文见 LICENSE；GPL v3 补充全文见 COPYING。参考源码核对日期：2026-09-11。
- 本项目的桌面交互、页面适配、2026-09-11 修订及原创发布素材按 LGPL-3.0-only 提供。修改记录见 CHANGELOG.md。下游分发需保留许可、来源和对应源码。
- `public-release/assets` 由 `scripts/generate-release-art.cjs` 生成，SVG 为源文件，PNG/JPEG 为派生文件；没有复制原有 macOS 图标、壁纸或 Apple 标识。
- 原有 `public/assets` 缺少素材来源记录，因此从 release 构建和发行包排除；本地默认体验仍保留原素材。它们不是本项目开源许可覆盖的发行资源。
- Vue、Pinia、Axios、Chart.js 等第三方库保留各自许可；具体版本以 pnpm-lock.yaml 为准，发行包附 THIRD_PARTY_NOTICES.md。

2026-09-12新增：glass-dawn、glass-midnight、glass-lake为用户提供的ChatGPT生成壁纸，保留1672×941像素；这些JPEG和缩略图不是generate-release-art.cjs生成。tahoe-hd、tahoe-dark-hd、tahoe-beach-hd来自512 Pixels的macOS壁纸归档，仅放入本地public素材，不纳入public-release，也不声明为本项目原创或LGPL授权素材。来源与尺寸见docs/frontend/PARITY_WALLPAPER.md。

这是源码与静态前端的分发许可说明，不包含 Sub2API 后端程序、实例数据、模型服务、商标或第三方账户的使用授权。
