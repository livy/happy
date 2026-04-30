# Claude Code 协议和控制表面

## 底线

Claude Code 不是一个协议。它是几层：

- ACP 用于干净的客户端/代理会话控制
- 钩子 JSON 用于事件拦截和策略
- 本地 `~/.claude/` 文件用于丰富的团队和子代理状态
- 产品行为部分记录在变更日志和设置示例中

这使其功能强大，但更难干净地复制。

## ACP 会话协议

ACP 是 Claude 堆栈中最干净的部分。

- ACP 是 JSON-RPC
- 会话通过 `session/update` 流式传输更新
- 更新包括用户块、代理块、思考、工具调用、工具调用更新、计划、当前模式更新、配置选项更新和会话信息
- 提示执行、取消、加载、恢复、分叉、关闭和列表都是显式协议操作

主要源文件：

- `../happy-adjacent/research/agent-client-protocol/src/agent.rs`
- `../happy-adjacent/research/agent-client-protocol/src/client.rs`
- `../happy-adjacent/research/agent-client-protocol/src/tool_call.rs`

## Claude ACP 适配器行为

Claude ACP 适配器将 Claude Code 行为映射到 ACP 中。

- 权限模式，例如 `default`、`acceptEdits`、`plan`、`dontAsk` 和 `bypassPermissions`，通过面向 ACP 的控件暴露
- 模式和模型配置作为配置选项和当前模式更新发出
- 额外的工作区范围通过 `_meta.additionalRoots` 传递
- 会话创建、加载、恢复、重放和分叉在适配器层中实现

这对 Happy 很重要，因为它显示了干净协议在哪里停止以及特定于提供者的行为在哪里开始。

主要源文件：

- `../happy-adjacent/research/claude-code-acp/src/acp-agent.ts`
- `../happy-adjacent/research/claude-code-acp/src/settings.ts`

## 钩子/事件协议

Claude 有一个单独的类型化事件表面用于钩子。

- 钩子输入包括 `session_id`、`transcript_path`、`cwd`、`permission_mode` 和 `hook_event_name`
- 钩子事件包括 `PreToolUse`、`PostToolUse`、`Stop`、`SubagentStop`、`SessionStart`、`SessionEnd`、`UserPromptSubmit`、`PreCompact` 和 `Notification`
- 变更日志注释添加了额外事件，例如 `PermissionRequest`、`SubagentStart`、`TeammateIdle` 和 `TaskCompleted`
- 钩子输出可以允许、拒绝、询问、抑制输出或注入系统消息

这是 Claude 设计中最好的部分之一：事件拦截是显式的。

主要源文件：

- `../happy-adjacent/research/claude-code/plugins/plugin-dev/skills/hook-development/SKILL.md`
- `../happy-adjacent/research/claude-code/CHANGELOG.md`

## 子代理和任务跟踪

Claude 在产品级别上最强，但状态存在于几个地方。

- 自定义代理使用 frontmatter（如 `name`、`description`、`model`、`color` 和可选的工具限制）定义为 markdown
- `Task` 工具启动或与代理通信
- 本地团队状态位于 `~/.claude/teams/` 下
- 本地任务队列状态位于 `~/.claude/tasks/` 下
- 子代理对话链位于 `~/.claude/projects/.../subagents/` 下

Happy 的主要教训不是复制隐藏文件布局。教训是保持代理身份、团队成员资格和任务生命周期显式。

主要源文件：

- `../happy-adjacent/research/claude-code/plugins/plugin-dev/skills/agent-development/SKILL.md`
- `docs/research/agent-teams-claude-code.md`
- `~/.claude/teams/`
- `~/.claude/tasks/`

## 权限和模式切换

Claude 将此视为真实状态，而不是仅提示的约定。

- 设置文件定义询问/拒绝策略以及是否允许绕过模式
- `PreToolUse` 钩子可以做出权限决策
- 专用的 `PermissionRequest` 钩子也可以批准或拒绝
- 计划模式是真实的运行时模式，而不仅仅是不同的措辞
- 自定义代理可以携带自己的权限模式

这是 Happy 的强大模式：模式和权限状态应该是一流的和可检查的。

主要源文件：

- `../happy-adjacent/research/claude-code/examples/settings/settings-strict.json`
- `../happy-adjacent/research/claude-code/plugins/plugin-dev/skills/hook-development/SKILL.md`
- `../happy-adjacent/research/claude-code/CHANGELOG.md`

## 沙箱和工作区控件

Claude 的安全故事是分层的。

- shell 沙箱主要专注于 `Bash`
- 设置包括网络白名单、命令排除和嵌套沙箱行为
- 存在额外的读/写控制和受保护目录
- 工作区信任是与沙箱分开的门

这不如 Codex 的沙箱策略统一，但仍然比假装所有工具安全都是同一回事要好。

主要源文件：

- `../happy-adjacent/research/claude-code/examples/settings/README.md`
- `../happy-adjacent/research/claude-code/examples/settings/settings-bash-sandbox.json`
- `../happy-adjacent/research/claude-code/CHANGELOG.md`

## 恢复、分叉和生命周期

Claude 明确将会话生命周期视为产品优先级。

- 会话开始/结束和压缩具有钩子事件
- 恢复和继续有许多围绕文本恢复和工具结果重播的变更日志修复
- 分叉被重命名为分支并需要隔离修复
- 会话支持命名和命名恢复
- 本地每个会话状态通常由 `session_id` 键入

这提醒 Happy，恢复正确性不是小细节；它是一项协议功能。

## 远程和同步影响

Claude 是这里最薄弱的干净参考。

- ACP 对于远程控制和代理互操作性很有前途
- 存在到 `claude.ai/code` 的远程控制桥
- MCP 网络有详细文档
- 但最丰富的团队和子代理状态仍存在于 `~/.claude/` 下的本地文件中

因此，Claude 作为工作流参考很有用，但不是 Happy 自己同步协议的最佳单一来源。

## Happy 应该借鉴什么

- 一流的模式和权限状态
- 围绕工具和生命周期的类型化事件拦截
- 强大的子代理身份和任务生命周期概念
- 显式的恢复/分叉语义
- 不要复制依赖隐藏的本地文件作为主要状态模型
