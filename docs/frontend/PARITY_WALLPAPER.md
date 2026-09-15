# 壁纸高清核验（2026-09-12）

## 新素材接入

现已接入六张新增壁纸，设置→桌面与壁纸可选择，右键轮换及刷新持久化共用白名单。原壁纸保留。

- 用户提供：暖金晨光、午夜蓝玻璃、冰蓝湖光，实际1672×941，不放大。转换JPEG后约173–322KB。
- 网络高清：Tahoe浅/深色原图6016×6016，湖畔日景6016×3384；由高清源中心裁切并缩小为3840×2160，约1.06–1.95MB。
- 所有新增预览使用480×270缩略图及懒加载，避免选择器同时下载全尺寸壁纸。
- 来源：https://512pixels.net/projects/default-mac-wallpapers-in-5k/ 。三张下载文件为该页链接的26-Tahoe-Light-6K.png、26-Tahoe-Dark-6K.png、26-Tahoe-Beach-Day.png。仅本地public启用Apple壁纸；release模式与无public的源码构建不显示这些条目。
- 导入脚本scripts/import-wallpapers.cjs；实际尺寸/体积/原始URL记录于output/wallpapers/manifest.json。

类型检查与默认生产构建通过。以下为接入前的历史核验，不代表目前仍无新素材。

浏览器最终验证：scripts/wallpaper-browser-check.js 在独立wallpaper-review会话通过六张选择/解码/保存及刷新恢复。首次复用旧会话曾被旧addInitScript每次导航写入tahoe的测试夹具干扰；新独立会话通过，无需修改产品持久化逻辑。

直接读取当前图片元数据：默认 public/assets/tahoe.jpg 和 tahoe-night.jpg 均为1376×768，是大屏拉伸模糊的直接原因。桌面使用 background-size:cover，没有额外全屏模糊滤镜。

现有 galaxy.jpg 为5120×2880；sonoma.jpg为2560×1440，sequoia.jpg为2048×1152，monterey/ventura为2000×1125。可分发public-release壁纸均为2560×1600。

未生成新壁纸、未替换用户偏好。当前工具没有内置图像生成能力，OPENAI_API_KEY未配置，无法实际调用用户提到的image2.5。不得把插值放大宣称为原生4K或AI生成。后续需要可用生成工具或同款授权高清源，再执行尺寸、视觉、体积与设置入口验收。
