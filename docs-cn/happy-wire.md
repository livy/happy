# happy-wire

本文档描述共享线路包：`@slopus/happy-wire`。

## 为什么这个包存在

在 `happy-wire` 之前，线路级消息和会话协议模式在各个包（CLI、应用程序、服务器和代理）中重复。这导致了漂移风险，并使协议演化更加困难。

`@slopus/happy-wire` 集中了这些共享模式和类型，以便所有客户端和服务都同意相同的线路契约。

## 包标识

- npm 名称：`@slopus/happy-wire`
- 工作区路径：`packages/happy-wire`
- 包类型：可发布库（非私有）
- 消费者中的版本化依赖：`^0.1.0`

## 共享内容

### 1. 线路消息模式

从 `@slopus/happy-wire` 共享：
- 来自 `messages.ts`：`SessionMessageContentSchema`、`SessionMessageSchema`、`MessageMetaSchema`、`SessionProtocolMessageSchema`、`MessageContentSchema`（顶层 `role` 联合：`user|agent|session`）、`UpdateNewMessageBodySchema`、`UpdateSessionBodySchema`、`UpdateMachineBodySchema`、`CoreUpdateContainerSchema`
- 来自 `legacyProtocol.ts`：`UserMessageSchema`（`role: 'user'`）、`AgentMessageSchema`（`role: 'agent'`）、`LegacyMessageContentSchema`（仅用于传统的 `role` 区分联合）

这些用于加密的消息/更新契约（`new-message`、`update-session`、`update-machine`）。

### 2. 会话协议模式

从 `@slopus/happy-wire` 共享：
- `sessionEventSchema`
- `sessionEnvelopeSchema`
- `createEnvelope(...)`
- `SessionEnvelope` 和相关类型

这是统一会话协议事件流的规范模式。

`sessionEnvelopeSchema` 中的当前角色集：
- `'user'`（用户发起的信封）
- `'agent'`（代理/系统输出信封）

当前会话线路负载形状（解密的消息体）：
- 对于会话协议记录，外层消息 `role` 始终为 `'session'`
- `content` 是直接的会话信封对象（不包装在 `content.data` 下）
- 信封级角色保留在 `content.role`（`'user' | 'agent'`）内
- 信封时间戳要求为 `content.time`（Unix 毫秒）

## 此仓库中的迁移

### CLI（`packages/happy-cli`）

- 会话协议导入现在直接引用 `@slopus/happy-wire`。
- `src/sessionProtocol/types.ts` 现在从 `@slopus/happy-wire` 重新导出作为兼容性垫片。
- `src/api/types.ts` 中的 API 线路模式现在从 `@slopus/happy-wire` 源共享消息/更新模式。

### 应用程序（`packages/happy-app`）

- `sources/sync/apiTypes.ts` 中的共享 API 消息/更新模式现在从 `@slopus/happy-wire` 导入以下内容：
  - `ApiMessageSchema`
  - `ApiUpdateNewMessageSchema`
  - `ApiUpdateSessionStateSchema`
  - `ApiUpdateMachineStateSchema`

### 服务器（`packages/happy-server`）

- Prisma JSON 消息内容类型现在引用 `@slopus/happy-wire` 中的 `SessionMessageContent`。
- 事件路由器使用共享的 `SessionMessageContent` 类型进行 `new-message` 负载类型化。

### 代理（`packages/happy-agent`）

- `RawMessage` 现在别名 `@slopus/happy-wire` 中的 `SessionMessage`。

## 版本控制模型

所有其他工作区包现在声明对 `@slopus/happy-wire` 的版本化依赖。

这有意镜像发布后消费，并减少与工作区本地文件的隐藏耦合。

## 构建和发布

`@slopus/happy-wire` 配置方式与此仓库中现有的可发布库相同：

- 通过 `pkgroll` 输出 ESM/CJS/类型
- `build`：类型检查 + 捆绑
- `test`：构建 + vitest
- `prepublishOnly`：构建 + 测试
- `release`：`release-it`
- 通过 `publishConfig` 配置 npm 发布注册表

使用与其他可发布包相同的发布入口点：

```bash
yarn release
# choose happy-wire
```

或：

```bash
yarn workspace @slopus/happy-wire release
```

从干净检出构建工作区时，首先构建 `@slopus/happy-wire`，以便依赖包可以解析生成的 `dist` 输出。

## 发布检查清单（维护者）

1. 确保所有工作区构建/测试都是绿色的。
2. 确认线路模式更改是向后兼容的或已记录。
3. 提升并发布 `@slopus/happy-wire`。
4. 如有需要，更新下游包版本。
5. 仅在新的 `happy-wire` 版本可用后发布依赖包更新。

## 注意事项

- `happy-wire` 应只专注于线路契约（类型 + Zod 模式 + 小助手）。
- 域/业务逻辑应保留在消费者包中。
- 尽可能保持模式添加是增量的，以尽量减少客户端破坏。
