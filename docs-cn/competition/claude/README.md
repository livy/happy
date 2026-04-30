# Claude Code

2026-03-20 从以下主要来源审核：

- `../happy-adjacent/research/claude-code` 位于 `6aadfbdca2c29f498f579509a56000e4e8daaf90`
- `../happy-adjacent/research/claude-code-acp` 位于 `521d1f766d421f8d21d162e1c799edc094781dfc`
- `../happy-adjacent/research/agent-client-protocol` 位于 `cd10d9b86e04caaf05bd5e75d860da4c17fcd2f8`
- 本地 `~/.claude/` 状态
- `docs/research/agent-teams-claude-code.md`

## 为什么重要

Claude Code 是代理团队和本地代理状态的最强工作流参考，但它不是一个干净的协议表面。

- ACP 相当干净
- 钩子暴露类型化事件接口
- 代理团队功能强大
- 最丰富的状态仍泄漏到 `~/.claude/` 文件中

## 当前看法

- Claude 是代理团队、子代理身份和权限/模式控制的绝佳创意来源。
- 作为单一规范会话协议，Claude 比 OpenCode 或 Codex 更差。
- 如果 Happy 借鉴 Claude，它应该借鉴产品行为和工作流理念，而不是隐藏的本地状态依赖。

## 重要来源

- `../happy-adjacent/research/claude-code/CHANGELOG.md`
- `../happy-adjacent/research/claude-code/plugins/plugin-dev/skills/hook-development/SKILL.md`
- `../happy-adjacent/research/claude-code/plugins/plugin-dev/skills/agent-development/SKILL.md`
- `../happy-adjacent/research/claude-code/examples/settings/README.md`
- `../happy-adjacent/research/claude-code-acp/src/acp-agent.ts`
- `../happy-adjacent/research/agent-client-protocol/src/agent.rs`
- `../happy-adjacent/research/agent-client-protocol/src/client.rs`
- `docs/research/agent-teams-claude-code.md`

请参阅 `docs/competition/claude/message-protocol.md` 和 `docs/competition/claude/sources.md`。
