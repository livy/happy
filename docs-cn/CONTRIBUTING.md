# 贡献 Happy

Happy 是由整天使用 AI 编码工具的工程师构建的——我们构建 Happy 是为了能够在任何地方使用它们。欢迎提供使该工作流程更好的贡献。

如果您的 PR 或问题没有得到回复，请标记 **@bra1ndump**。

## 贡献优先级

我们按以下顺序审核贡献：

1. **错误修复** — 崩溃、流程中断、数据丢失
2. **UI 润色** — 优化、布局修复、视觉一致性
3. **新功能** — 服务于核心用例的新功能
4. **重构** — 代码质量改进、测试覆盖率
5. **核心重构** — 同步引擎、RPC 层、服务器更改（先讨论）

如果您的贡献在此列表中排名较低，可能需要更长时间才能得到审核。这并不反映其价值——这只是我们的分类方式。

## 问题

我们目前无法单独回复每个问题。我们使用 AI 辅助分类批量审核它们。它们很有用——请继续提交——但带有明确修复的 PR 将始终获得优先处理。

每个问题都应该以问题的**一段式摘要**开头。不要将要点埋在复现步骤或日志中。首先说明什么坏了以及您期望什么。

## Pull Requests

### 规则

1. **以一段式摘要开头。** 什么坏了或缺失了？此 PR 做了什么？快速浏览 20 个 PR 的人需要在 10 秒内理解您的 PR。

2. **展示它有效的证明。** 包含视频、屏幕截图或实际日志输出来演示在真实运行应用中的修复。"之前"的状态可以用文字描述。"之后"必须直观展示。单元测试通过是不够的——展示它端到端工作。

3. **在请求人工审核之前处理 Codex 审核评论。** 我们对所有 PR 使用自动化 Codex 审核。先解决那些——它们会捕获明显的问题，这样人工审核者就可以专注于重要的事情。

4. **保持 PR 专注。** 每个 PR 一个修复。每个 PR 一个功能。如果您触及了不相关的内容，请拆分出去。

5. **核心更改需要先讨论。** 如果您的 PR 触及了同步引擎、RPC 协议、加密或服务器——在编写代码之前先开一个 issue 或 Discord 线程。这些领域影响每个用户，需要设计对齐。

### 什么造就了好的 PR

- **展示它有效的证明。** 屏幕截图、屏幕录制或实际日志输出来演示在真实运行应用中的修复。单元测试通过是不够的——展示它端到端工作。
- 链接到它修复的问题（如果存在）
- 简短、清晰的标题（`fix: voice session stuck in connecting state` 而不是 `Update voice.ts`）
- 没有不相关的更改，没有路过式重构

## 开发设置

### 前提条件

- Node.js >= 20
- pnpm (`npm install -g pnpm`)
- Git

### 开始使用

```bash
git clone https://github.com/slopus/happy.git
cd happy
pnpm install
```

### Happy 应用（移动端 + Web 端）

```bash
pnpm --filter happy-app start          # Expo 开发服务器
pnpm --filter happy-app ios:dev        # iOS 模拟器
pnpm --filter happy-app android:dev    # Android 模拟器
pnpm web                                # 浏览器（快捷方式）
pnpm --filter happy-app typecheck      # 在所有更改后运行
```

该应用有三个构建变体——所有变体都可以在同一设备上同时安装：

| 变体 | 包 ID | 应用名称 | 用例 |
|---------|-----------|----------|----------|
| 开发 | `com.slopus.happy.dev` | Happy (dev) | 带热重载的本地开发 |
| 预览 | `com.slopus.happy.preview` | Happy (preview) | Beta 测试和 OTA 更新 |
| 生产 | `com.ex3ndr.happy` | Happy | App Store 发布 |

将 `ios:dev` 替换为 `ios:preview` 或 `ios:production`（`android:` 同理）。

#### macOS 桌面 (Tauri)

```bash
pnpm --filter happy-app tauri:dev      # 带热重载运行
pnpm --filter happy-app tauri:build:dev
```

### Happy CLI

```bash
pnpm --filter happy build
pnpm --filter happy test
pnpm --filter happy cli:install   # 构建 + 将此工作区链接为全局 `happy` + 重启守护进程
```

`cli:install` 用指向此工作区的符号链接替换从 npm 安装的 `happy` 二进制文件。
它重用 `~/.happy/`（认证、会话）——没有单独的开发主目录。要撤销：

```bash
npm unlink -g happy && npm i -g happy@latest
```

要沙箱化开发数据，请在运行 `happy` 之前在 shell 中设置 `HAPPY_HOME_DIR=~/.happy-dev`。

### Happy 服务器

```bash
pnpm --filter happy-server standalone:dev   # 本地服务器（无需 Docker）
```

在 `localhost:3005` 上运行，带有嵌入式 PGlite。要将应用指向您的本地服务器：

```bash
EXPO_PUBLIC_HAPPY_SERVER_URL=http://localhost:3005 pnpm --filter happy-app start
```

## 项目结构

这是一个包含四个包的 monorepo：

- **happy-app** — React Native + Expo 移动/Web 客户端
- **happy-cli** — 封装 Claude Code 和 Codex 的 Node.js CLI
- **happy-agent** — 远程代理控制
- **happy-server** — 加密同步的后端

有关架构详情，请查看 [docs/](.) 文件夹或直接询问 Happy——它知道项目是如何设置的。

## 社区

- [Discord](https://discord.gg/fX9WBAhyfD) — 提问和讨论的最佳场所
- [文档](https://happy.engineering/docs/)
