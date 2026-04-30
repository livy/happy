# 竞争研究

使用此文件夹存储值得保留在 Happy repo 中的精炼竞争对手研究。

## 这里应该放什么

- 关于其他产品工作原理的 markdown 笔记
- 协议撰写、消息示例和序列图
- 解释行为的截图和小型经过清理的工件
- 指向上游文档、repo、提交、issue 和博客文章的链接
- 当发现影响产品或协议设计时，回到 Happy 的比较

## 这里不应该放什么

- 竞争对手 repo 的 git checkout
- git 子模块
- 复制的源代码树或 vendored 代码转储
- 大型原始日志、二进制文件或密钥

如果您需要 checkout 进行研究，请将其保留在此存储库之外。如果存在，优先使用 `../happy-adjacent/research/{vendor}` 下的现有相邻区域；否则使用不提交的另一个机器本地路径。

## 推荐布局

```text
docs/competition/
├── AGENTS.md
├── comparison-matrix.md            # 按主题的跨供应商摘要
├── claude/
│   ├── README.md                   # 高级概述和主要收获
│   ├── sources.md                  # 上游 URL、提交哈希、审核日期
│   ├── message-protocol.md         # 信封、流式事件、回合边界
│   ├── session-lifecycle.md        # 启动、恢复、中断、拆卸
│   └── artifacts/                  # 截图、小型跟踪片段、图表
├── codex/
│   └── ...
└── opencode/
    └── ...
```

## 每个供应商的文件期望

每个供应商文件夹都应从小处开始并保持专注：

- `README.md`：此产品是什么、检查了什么以及主要发现
- `sources.md`：repo URL、文档链接、审核的提交/标签以及审核日期
- 主题文件，例如 `message-protocol.md`、`tool-calling.md`、`subagents.md`、`task-tracking.md`、`modes-and-permissions.md` 或 `sandbox.md`（当这些主题重要时）
- `artifacts/`：只有有助于解释撰写的小型证据文件

不要在此处镜像竞争对手的 repo 布局。写下我们想要保留的结论。

## 研究工作流程

1. 从本地 checkout、文档站点、产品行为或捕获的跟踪中检查竞争对手。
2. 在 `sources.md` 中记录准确的上游引用。
3. 在供应商文件夹中写入精炼结果。
4. 当多个供应商涵盖同一主题时，将可重用的比较提取到 `comparison-matrix.md` 中。

## 当前优先级

从对 Happy 最重要的协议和控制表面开始：

- 消息协议和事件信封
- 工具调用表示和流式传输
- 子代理 / 任务委托模型
- 任务跟踪 / 待办事项表面
- 模式切换和模型切换
- 权限 / 审批流程
- 沙箱 / 工作区隔离
- 会话恢复、分叉和中断行为
- 远程同步 / 服务器架构

当前产品说明：OpenCode 目前是一个特别强的参考。它的桌面 UI、功能集，尤其是可点击的上下文/调试表面，看起来值得仔细研究。将其消息传递协议作为主要设计输入，并进一步深入研究它如何与服务器同步状态。

经验法则很简单：checkout 留在 repo 外；见解和小型支持工件放在这里。
