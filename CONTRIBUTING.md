# 参与开发

使用 Node.js 24 和 pnpm 10.28.2，执行 `pnpm install --frozen-lockfile`。

改动前阅读 docs/frontend/DESIGN.md。保留 Vue 3、TypeScript、Pinia 和 `/api/v1` 契约，桌面组件不能引入业务 API。演示数据只放开发预览和浏览器夹具。

提交前运行 `pnpm typecheck`、`pnpm test`、`pnpm build`。修改交互需运行相应浏览器脚本，并记录 1440×900 浅/深色、390×844 以及失败恢复结果。不得将模拟数据的测试结果描述为真实后端兼容性。

所有对外资源必须有来源与许可。不要提交 `.env.local`、真实凭据、数据库、运行日志或截图中的用户资料。安全问题请私下报告给项目维护者，不在公开 issue 中附令牌或个人数据。
