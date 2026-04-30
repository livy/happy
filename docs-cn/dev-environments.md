# 开发环境

本文档介绍 [`environments/environments.ts`](../environments/environments.ts) 中的本地环境管理器。

## `pnpm env:*` 的功能

- `pnpm env:new`: 在 `environments/data/envs/<name>` 下创建一个新的隔离环境。
- `pnpm env:use <name>`: 切换当前环境。
- `pnpm env:server`: 在当前环境中运行服务器。
- `pnpm env:web`: 在当前环境中运行 Web 应用。
- `pnpm env:cli`: 在当前环境中运行 CLI。

每个环境都会注入自己的：

- `HAPPY_HOME_DIR`
- `HAPPY_SERVER_URL`
- `HAPPY_WEBAPP_URL`
- `HAPPY_PROJECT_DIR`
- Expo/服务器端口设置
- 种子化时的开发认证值

每个全新的环境还会从 `environments/lab-rat-todo-project/` 复制一个轻量级的测试项目到 `environments/data/envs/<name>/project`。

当前限制：实验室项目仅作为普通文件复制。它还不包含 git 历史记录，因此依赖于真实仓库历史的提供程序测试仍然需要后续的测试套件升级。

## `pnpm env:cli` 是一个直通命令

`pnpm env:cli` 将额外参数直接转发给 `happy`。

示例：

```bash
pnpm env:cli --help
pnpm env:cli codex
pnpm env:cli daemon status
pnpm env:cli daemon stop
pnpm env:cli daemon start
```

这相当于激活环境并手动运行 CLI：

```bash
source environments/data/envs/<name>/env.sh
happy daemon status
```

## `env:cli` 存在的原因

它是当前环境的便捷包装器。它不会自行创建或选择环境。它只是：

1. 读取 `environments/data/current.json`
2. 为该环境构建环境变量
3. 使用应用这些变量启动 CLI

如果您想要更底层的 shell 原生工作流，请直接使用生成的环境文件：

```bash
source environments/data/envs/<name>/env.sh
happy
```

## 重启当前环境守护进程

以下任一方式都可以：

```bash
pnpm env:cli daemon stop
pnpm env:cli daemon start
```

或者：

```bash
source environments/data/envs/<name>/env.sh
happy daemon stop
happy daemon start
```
