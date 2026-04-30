# 权限解析（基于状态）

本文档解释了如何根据应用程序和 CLI 中的当前状态为会话消息解析权限模式。

## 范围
- 应用端状态解析（会话默认值、持久化值、出站消息元数据）
- Claude CLI 解析（启动模式、每条消息更新、沙箱策略）
- 发送到 Claude SDK 的最终模式

## 权限模式
- 共享模式类型：`default | acceptEdits | bypassPermissions | plan | read-only | safe-yolo | yolo`
- Claude SDK 支持：`default | acceptEdits | bypassPermissions | plan`
- 映射到 Claude 在 `packages/happy-cli/src/claude/utils/permissionMode.ts` 中进行：
  - `yolo -> bypassPermissions`
  - `safe-yolo -> default`
  - `read-only -> default`

## 应用端解析

### 1) 会话状态加载/合并
`packages/happy-app/sources/sync/storage.ts`

合并会话时，应用使用以下顺序解析 `session.permissionMode`：
1. 现有内存中会话模式（如果非 `default`）
2. 从本地存储持久化的每个会话模式（如果非 `default`）
3. 服务器会话有效负载的模式（如果非 `default`）
4. 沙箱回退：
   - 如果 `session.metadata.sandbox.enabled === true`：`bypassPermissions`
   - 否则：`default`

### 2) 新会话草稿回退
`packages/happy-app/sources/sync/persistence.ts`

如果草稿权限模式缺失：
- 草稿默认值：`default`

### 3) 新会话 UI 默认值
`packages/happy-app/sources/app/(app)/new/index.tsx`
`packages/happy-app/sources/components/NewSessionWizard.tsx`

默认选择：
- `default`

如果选择的模式对当前选定的代理无效，UI 会重置为上述代理默认值。

### 4) 出站消息模式
`packages/happy-app/sources/sync/sync.ts`

发送时：
- 如果 `session.permissionMode` 是非 `default` 的，发送它。
- 否则：
  - 如果 `session.metadata.sandbox.enabled === true`：发送 `bypassPermissions`
  - 否则发送 `default`

此值发送到：
- 加密消息的 `meta.permissionMode`
- socket 信封的 `permissionMode`

## Claude CLI 解析

### 1) 启动解析
`packages/happy-cli/src/claude/runClaude.ts`
`packages/happy-cli/src/claude/utils/permissionMode.ts`

初始模式来自：
1. `--dangerously-skip-permissions`（最高优先级）-> `bypassPermissions`
2. `--permission-mode VALUE` 或 `--permission-mode=VALUE`
3. 提供的 `options.permissionMode`

然后应用沙箱策略：
- 如果沙箱启用：强制 `bypassPermissions`
- 如果沙箱禁用：保持解析的模式

### 2) 远程流程中每条消息更新
`packages/happy-cli/src/claude/runClaude.ts`

当用户消息包含 `meta.permissionMode` 时：
- 如果沙箱启用：强制到 `bypassPermissions`
- 如果沙箱禁用：使用传入模式

### 3) 本地 Claude 进程
`packages/happy-cli/src/claude/claudeLocal.ts`

如果启用沙箱，启动器在生成前追加 `--dangerously-skip-permissions`。

## 有效结果矩阵

### 沙箱启用
- 当会话模式是 default/缺失时，应用回退模式是 `bypassPermissions`
- Claude CLI 沙箱策略仍在远程流程中强制 `bypassPermissions`

### 沙箱禁用
- 如果应用/会话模式是非 `default` 的：使用该模式
- 如果应用/会话模式是 `default` 或缺失的：
  - 应用发送 `default`
  - CLI 使用正常模式解析（无沙箱强制）

## 现在为什么稳定了
- 客户端回退仅对沙箱会话强制跳过权限。
- CLI 沙箱策略保证沙箱的 Claude 会话无法通过消息元数据重新启用权限提示。
