# API

本文档介绍 HTTP API 表面和认证流程。有关 WebSocket 更新和事件有效载荷，请参阅 `protocol.md`。有关加密边界和编码详情，请参阅 `encryption.md`。

## 方法约定
- **GET** 用于读取。
- **POST** 用于变更或操作，即使该操作不能清晰映射到单个实体。
- **DELETE** 用于意图明确的情况（例如，删除令牌或删除会话/工件）。

我们有意避免完整的 REST 动词调色板，因为许多操作跨越多个实体或具有非 CRUD 语义。

## 认证
大多数端点需要 `Authorization: Bearer <token>`。

认证流程：
- `POST /v1/auth`
  - 正文: `{ publicKey, challenge, signature }`（base64 字符串）
  - 使用提供的公钥验证签名。
  - 按公钥更新账户并返回 `{ success, token }`。

- `POST /v1/auth/request`
  - 正文: `{ publicKey, supportsV2? }`
  - 创建或返回终端认证请求。
  - 响应: `{ state: "requested" }` 或 `{ state: "authorized", token, response }`。

- `GET /v1/auth/request/status?publicKey=...`
  - 响应: `{ status: "not_found" | "pending" | "authorized", supportsV2 }`。

- `POST /v1/auth/response`
  - 正文: `{ response, publicKey }`（需要 Bearer 认证）
  - 批准终端认证请求。

- `POST /v1/auth/account/request`
  - 正文: `{ publicKey }`
  - 类似于终端认证，但用于账户链接。

- `POST /v1/auth/account/response`
  - 正文: `{ response, publicKey }`（需要 Bearer 认证）

## 端点目录
### 会话
- `GET /v1/sessions`
- `GET /v2/sessions/active?limit=...`
- `GET /v2/sessions?cursor=cursor_v1_<id>&limit=...&changedSince=...`
- `POST /v1/sessions`（通过 `tag` 创建或加载）
- `GET /v1/sessions/:sessionId/messages`
- `DELETE /v1/sessions/:sessionId`

### 机器
- `POST /v1/machines`（通过 id 创建或加载）
- `GET /v1/machines`
- `GET /v1/machines/:id`

### 工件
- `GET /v1/artifacts`
- `GET /v1/artifacts/:id`
- `POST /v1/artifacts`
- `POST /v1/artifacts/:id`（版本化更新）
- `DELETE /v1/artifacts/:id`

### 访问密钥
- `GET /v1/access-keys/:sessionId/:machineId`
- `POST /v1/access-keys/:sessionId/:machineId`
- `PUT /v1/access-keys/:sessionId/:machineId`

### 键值存储
- `GET /v1/kv/:key`
- `GET /v1/kv?prefix=...&limit=...`
- `POST /v1/kv/bulk`
- `POST /v1/kv`（批量变更）

### 账户和使用情况
- `GET /v1/account/profile`
- `GET /v1/account/settings`
- `POST /v1/account/settings`
- `POST /v1/usage/query`

### 推送令牌
- `POST /v1/push-tokens`
- `DELETE /v1/push-tokens/:token`
- `GET /v1/push-tokens`

### 连接（GitHub + 供应商令牌）
- `GET /v1/connect/github/params`
- `GET /v1/connect/github/callback`
- `POST /v1/connect/github/webhook`
- `DELETE /v1/connect/github`
- `POST /v1/connect/:vendor/register`（`vendor` 为 `openai | anthropic | gemini`）
- `GET /v1/connect/:vendor/token`
- `DELETE /v1/connect/:vendor`
- `GET /v1/connect/tokens`

### 用户、好友、动态
- `GET /v1/user/:id`
- `GET /v1/user/search?query=...`
- `POST /v1/friends/add`
- `POST /v1/friends/remove`
- `GET /v1/friends`
- `GET /v1/feed`

### 版本和语音
- `POST /v1/version`
- `POST /v1/voice/token`

### 仅开发
- `POST /logs-combined-from-cli-and-mobile-for-simple-ai-debugging`（仅在启用时）

## 实现参考
- API 路由: `packages/happy-server/sources/app/api/routes`
- 认证模块: `packages/happy-server/sources/app/auth/auth.ts`
