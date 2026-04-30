# 协议

本文档描述了在 `packages/happy-server` 中实现的 Happy 线路协议。协议有意保持简洁：用于读取/操作的 HTTP 上的 JSON，以及用于实时同步的 Socket.IO。大多数有效负载在客户端进行端到端加密；有关加密边界和编码细节，请参阅 `encryption.md`。有关完整的 HTTP 表面和认证流程，请参阅 `api.md`。

## 传输和版本控制
- HTTP API：`/v1` 和 `/v2` 路由上的 JSON 请求/响应。
- WebSocket：路径为 `/v1/updates` 的 Socket.IO 服务器（传输方式：websocket、polling）。
- CORS：`*`（服务器端）。

## 协议设计动机
协议旨在保持最小化、显式且在间歇性连接下具有弹性。几个指导原则塑造了命名、有效负载和版本控制：

- **小表面积而非完整性。** 路由和事件仅在提供清晰的同步原语时存在（例如会话、工件、KV）。如果某个功能可以在现有原语内表达为数据，就应该这样做。
- **显式事件类型和短键名。** 更新有效负载使用 `t` 表示事件类型，使用简洁的字段名（`sid`、`id`、`seq`）来保持消息大小，同时不隐藏含义。这些名称是稳定的，因为它们在客户端之间使用。
- **持久化与临时的分离。** 任何在重连后必须可恢复的内容都是带有序列号的 `update` 事件。在线状态和使用情况是 `ephemeral` 的，以避免状态混淆并最小化存储。
- **用户级别的单调排序。** `UpdatePayload.seq` 是每个用户的单个计数器。这使得客户端协调变得简单：按顺序应用更新，您就与该用户保持一致。
- **默认乐观并发。** 版本化字段（元数据、代理状态、工件部分、访问密钥、KV）需要 `expectedVersion`。这防止了静默覆盖，并保持了客户端驱动的冲突解决。
- **客户端加密边界。** 服务器永远不需要理解明文。因此，协议将大多数有效负载视为不透明的字符串或 base64 blob，这保持了服务器逻辑的简单性和隐私保证的强大性。
- **向后兼容而非破坏性更改。** 添加新的路由/事件，而不是以不兼容的方式改变现有形状。当需要双重行为时（例如机器），服务器会发出旧的和新的更新。
- **避免完整的 REST 动词。** 读取主要是 `GET`，而写入/操作主要是 `POST`，当意图明确时使用 `DELETE`。我们避免完整的 REST 调色板，因为许多变更没有清晰地绑定到单个实体或涉及的不仅仅是 CRUD 逻辑。保持 `GET` + `POST`（加上偶尔的 `DELETE`）使客户端更简单，协议更清晰。

如果提议了新的协议字段或事件，它应该回答：这是否创建了持久的同步原语，或者可以在不扩展 API 表面的情况下在现有加密有效负载内编码？

## 认证
大多数端点需要 `Authorization: Bearer <token>`。Socket.IO 握手中也使用相同的令牌。完整的认证流程和端点记录在 `api.md` 中。

## WebSocket 连接
### 握手
使用以下方式连接 Socket.IO：

```
path: "/v1/updates"
auth: {
  token: "<bearer token>",
  clientType: "user-scoped" | "session-scoped" | "machine-scoped",
  sessionId?: "<session id>",
  machineId?: "<machine id>"
}
```

服务器端强制执行的规则：
- `token` 是必需的。
- `session-scoped` 需要 `sessionId`。
- `machine-scoped` 需要 `machineId`。

### 连接类型
- `user-scoped`：接收账户范围的更新。
- `session-scoped`：仅接收特定会话的更新。
- `machine-scoped`：由守护进程使用；接收机器更新并发出机器状态。

### 服务器 -> 客户端事件
服务器发出两种事件类型：

#### `update`
持久化的同步事件。有效负载形状：
```
{
  id: string,
  seq: number,
  body: { t: string, ... },
  createdAt: number
}
```

#### `ephemeral`
临时在线状态/使用事件。有效负载形状：
```
{
  type: string,
  ...
}
```

### 更新事件类型
下面的字段名与线上的有效负载匹配。

- `new-session`
  - `body`：`{ t: "new-session", id, seq, metadata, metadataVersion, agentState, agentStateVersion, dataEncryptionKey, active, activeAt, createdAt, updatedAt }`

- `update-session`
  - `body`：`{ t: "update-session", id, metadata?, agentState? }`
  - `metadata`：`{ value, version }` 或 null
  - `agentState`：`{ value, version }` 或 null

- `delete-session`
  - `body`：`{ t: "delete-session", sid }`

- `new-message`
  - `body`：`{ t: "new-message", sid, message: { id, seq, content, localId, createdAt, updatedAt } }`

- `update-account`
  - `body`：`{ t: "update-account", id, settings?, github? }`

- `new-machine`
  - `body`：`{ t: "new-machine", machineId, seq, metadata, metadataVersion, daemonState, daemonStateVersion, dataEncryptionKey, active, activeAt, createdAt, updatedAt }`

- `update-machine`
  - `body`：`{ t: "update-machine", machineId, metadata?, daemonState?, activeAt? }`

- `new-artifact`
  - `body`：`{ t: "new-artifact", artifactId, seq, header, headerVersion, body, bodyVersion, dataEncryptionKey, createdAt, updatedAt }`

- `update-artifact`
  - `body`：`{ t: "update-artifact", artifactId, header?, body? }`

- `delete-artifact`
  - `body`：`{ t: "delete-artifact", artifactId }`

- `relationship-updated`
  - `body`：`{ t: "relationship-updated", uid, status, timestamp }`

- `new-feed-post`
  - `body`：`{ t: "new-feed-post", id, body, cursor, createdAt }`

- `kv-batch-update`
  - `body`：`{ t: "kv-batch-update", changes: [{ key, value, version }] }`

### 临时事件类型
- `activity`：`{ type: "activity", id: sessionId, active, activeAt, thinking? }`
- `machine-activity`：`{ type: "machine-activity", id: machineId, active, activeAt }`
- `usage`：`{ type: "usage", id: sessionId, key, tokens, cost, timestamp }`
- `machine-status`：`{ type: "machine-status", machineId, online, timestamp }`

### 客户端 -> 服务器 WebSocket 事件
- `ping` -> 回调 `{}`

- `update-metadata`
  - `{ sid, metadata, expectedVersion }`
  - 响应：`{ result: "success", version, metadata }` 或 `{ result: "version-mismatch", version, metadata }`

- `update-state`
  - `{ sid, agentState, expectedVersion }`
  - 响应：`{ result: "success", version, agentState }` 或 `{ result: "version-mismatch", version, agentState }`

- `message`
  - `{ sid, message, localId? }`
  - 创建新的会话消息（加密有效负载）并向其他连接发出 `new-message` 更新。

- `session-alive`
  - `{ sid, time, thinking? }`
  - 向用户范围的连接发出 `ephemeral` 活动。

- `session-end`
  - `{ sid, time }`
  - 将会话标记为不活跃并发出 `ephemeral` 活动。

- `usage-report`
  - `{ key, sessionId?, tokens, cost }`
  - 存储使用报告并可选择为会话发出 `ephemeral` 使用情况。

- `machine-alive`
  - `{ machineId, time }`
  - 发出 `ephemeral` 机器活动。

- `machine-update-metadata`
  - `{ machineId, metadata, expectedVersion }`
  - 响应：`{ result: "success", version, metadata }` 或 `{ result: "version-mismatch", version, metadata }`

- `machine-update-state`
  - `{ machineId, daemonState, expectedVersion }`
  - 响应：`{ result: "success", version, daemonState }` 或 `{ result: "version-mismatch", version, daemonState }`

- `artifact-read`
  - `{ artifactId }`
  - 响应：`{ result: "success", artifact }` 或 `{ result: "error", message }`

- `artifact-create`
  - `{ id, header, body, dataEncryptionKey }`
  - 响应：`{ result: "success", artifact }` 或 `{ result: "error", message }`

- `artifact-update`
  - `{ artifactId, header?, body? }`，其中 `header` 和 `body` 包含 `data` + `expectedVersion`
  - 响应：`{ result: "success", header?, body? }` 或 `{ result: "version-mismatch", header?, body? }`

- `artifact-delete`
  - `{ artifactId }`
  - 响应：`{ result: "success" }` 或 `{ result: "error", message }`

- `access-key-get`
  - `{ sessionId, machineId }`
  - 响应：`{ ok: true, accessKey? }` 或 `{ ok: false, error }`

- `rpc-register`
  - `{ method }` -> 服务器发出 `rpc-registered`

- `rpc-unregister`
  - `{ method }` -> 服务器发出 `rpc-unregistered`

- `rpc-call`
  - `{ method, params }` -> 回调 `{ ok, result? | error? }`
  - 服务器通过 `rpc-request` 转发到已注册的套接字（基于 ack）。

## 按区域的 HTTP 端点
有关完整的 HTTP 端点目录和认证流程，请参阅 `api.md`。

## 排序和并发
- `UpdatePayload.seq` 是每个用户的更新序列（单调递增），用于同步排序。
- 会话、机器和工件有自己的 `seq` 字段，供客户端用于排序。
- 版本化字段（元数据、agentState、daemonState、工件头部/正文、访问密钥、KV）使用带有 `expectedVersion` 的乐观并发，并返回包含当前版本/数据的版本不匹配响应。

## 实现参考
- API 路由：`packages/happy-server/sources/app/api/routes`
- 套接字处理程序：`packages/happy-server/sources/app/api/socket`
- 事件路由：`packages/happy-server/sources/app/events/eventRouter.ts`
