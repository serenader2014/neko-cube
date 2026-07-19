# 参与贡献

感谢你愿意改进 NekoCube。提交改动前，请先确认问题可以在本地开发模式中复现，并避免在 issue、测试、日志或截图中包含真实订阅地址和 controller secret。

## 准备开发环境

项目要求 Node.js `20.18.1` 或更高版本。

```bash
npm ci
```

日常开发使用隔离数据和安全应用模式：

```bash
npm run dev:local
```

另开一个终端：

```bash
npm run dev:web:local
```

访问 <http://127.0.0.1:4000>。测试真实 controller 联动时，再按 README 的“联调本地 Mihomo”章节启动 `dev:mihomo` 和 `dev:clash`。

## 修改原则

- 保持改动聚焦，避免在同一个 PR 中混入无关重构。
- 复用现有组件、辅助函数和 feature folder 结构，不复制相同逻辑。
- 使用 `@shared/*` 和 `@web/*` 路径别名。
- 单个源码文件不能超过 1200 行；接近 1000 行时应先拆分。
- 行为修复应补充能复现问题的测试；共享逻辑或跨模块契约变更需要覆盖主要失败路径。
- 不要提交 `data/`、`.dev/`、`dist/`、`.env*`、日志、临时截图或 GeoIP `.mmdb` 文件。
- 示例和测试使用 `example.com`、`mock.test` 等保留域名，不要写入真实订阅 URL、私有域名、内网拓扑、token 或 secret。

## 提交前检查

至少运行：

```bash
npm run lint
npm test
npm run build
```

修改依赖时还要运行：

```bash
npm audit --omit=dev --audit-level=moderate
```

`npm run typecheck` 当前存在已知的历史错误，CI 暂不阻断。仍建议在改动前后分别运行并比较结果，确保没有新增错误。

如果只修改文档，可以跳过测试和构建，但仍应运行 `git diff --check` 检查格式。

## Pull Request

PR 描述应说明：

- 要解决的问题和采用的方案。
- 用户可观察到的行为变化。
- 执行过的验证命令及结果。
- 数据迁移、配置兼容性或安全影响。

请保持 PR 可独立审查。涉及持久化结构时，同时提供迁移策略；改变默认值时，说明它只影响新数据库，还是也会更新已有数据。

## 安全问题

不要用公开 issue 报告可被利用的漏洞，也不要附带数据库、配置包、订阅 URL 或访问凭证。请按 [SECURITY.md](SECURITY.md) 中的方式私下报告。
