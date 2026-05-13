# 项目整体架构

本文档是 Happy 当前代码库的总体架构速览。更细的后端、CLI、协议、加密、语音等主题，请继续阅读同目录下的专项文档。

## 总体定位

Happy 是一个 pnpm monorepo。产品形态是：本地电脑上的 `happy` CLI/daemon 负责启动和控制 Claude/Codex 等 agent，`happy-server` 负责账号、加密同步、WebSocket 路由和持久化，`happy-app` 是 iOS/Android/Web/Tauri 客户端，用来远程查看、发送消息、授权、查看文件 diff、恢复和复制会话。

```txt
Happy Monorepo
├─ packages/happy-app       Expo + React Native app, also web/Tauri desktop
├─ packages/happy-cli       npm 包 happy，本地 CLI + daemon + agent wrappers
├─ packages/happy-server    Fastify API + Socket.IO + Prisma backend
├─ packages/happy-wire      shared Zod schemas / wire protocol types
├─ packages/happy-agent     remote-control CLI client
├─ packages/happy-app-logs  dev log receiver
└─ packages/codium          Electron/Vite experimental desktop/editor surface
```

## 运行拓扑

```txt
Mobile/Web/Desktop App
│  package: happy-app
│  state: Zustand storage + Sync service
│
├─ REST → happy-server
│  ├─ sessions, messages, machines, settings, profile, attachments
│  └─ most sensitive payloads are encrypted before server persistence
│
└─ Socket.IO /v1/updates → happy-server
   └─ user-scoped connection
      receives updates, machine status, push/focus routing events

Local Machine
│  package: happy-cli
│
├─ happy daemon
│  └─ Socket.IO /v1/updates → happy-server
│     └─ machine-scoped connection
│        registers RPC handlers:
│        spawn-happy-session
│        resume-session
│        stop-session
│        sync-local-sessions
│        sync-local-session-messages
│        claude-fork-session
│
└─ happy claude / happy codex session process
   └─ Socket.IO /v1/updates → happy-server
      └─ session-scoped connection
         sends encrypted agent messages, state, metadata, usage
```

## 后端结构

后端入口是 `packages/happy-server/sources/app/api/api.ts`，WebSocket 入口是 `packages/happy-server/sources/app/api/socket.ts`。

```txt
startApi()
├─ Fastify
├─ enableMonitoring()
├─ enableErrorHandlers()
├─ enableAuthentication()
├─ REST routes
│  ├─ authRoutes
│  ├─ sessionRoutes / v3SessionRoutes
│  ├─ machinesRoutes
│  ├─ pushRoutes
│  ├─ attachmentRoutes
│  ├─ updateRoutes
│  ├─ voiceRoutes
│  ├─ artifactsRoutes
│  ├─ feedRoutes / kvRoutes / userRoutes
│  └─ account/connect/dev/version/accessKeys
└─ startSocket()
   ├─ auth middleware verifies token
   ├─ clientType:
   │  ├─ user-scoped
   │  ├─ machine-scoped
   │  └─ session-scoped
   ├─ eventRouter tracks active connections
   └─ handlers:
      rpcHandler, usageHandler, sessionUpdateHandler,
      machineUpdateHandler, artifactUpdateHandler, accessKeyHandler
```

持久层是 Prisma，schema 在 `packages/happy-server/prisma/schema.prisma`。

```txt
Account
├─ Session[]
│  ├─ metadata: string             encrypted
│  ├─ agentState: string?          encrypted
│  ├─ dataEncryptionKey: Bytes?
│  └─ SessionMessage[]
│     ├─ seq
│     ├─ localId
│     └─ content: Json             encrypted payload
├─ Machine[]
│  ├─ metadata: string             encrypted
│  ├─ daemonState: string?         encrypted
│  └─ dataEncryptionKey: Bytes?
├─ AccountPushToken[]
├─ UploadedFile[]
├─ Artifact[]
├─ UserFeedItem[]
├─ UserKVStore[]
└─ VoiceConversation[]
```

## App 结构

`happy-app` 的主同步服务在 `packages/happy-app/sources/sync/sync.ts`，全局状态在 `packages/happy-app/sources/sync/storage.ts`，Socket 客户端在 `packages/happy-app/sources/sync/apiSocket.ts`。

```txt
happy-app
├─ sources/app              expo-router pages
├─ sources/-session         main session screen
├─ sources/components       chat UI, session list, file viewer, markdown, diff
├─ sources/sync
│  ├─ sync.ts               orchestration: fetch/sync/send/reconnect
│  ├─ storage.ts            Zustand store + selectors
│  ├─ apiSocket.ts          Socket.IO + REST wrapper
│  ├─ encryption/           session/machine/artifact encryption
│  ├─ reducer/              raw agent events → UI message model
│  ├─ typesRaw.ts           raw encrypted record normalization
│  └─ projectFiles/gitStatus/messageMeta/etc
├─ sources/realtime         voice/realtime integrations
├─ sources/auth             token/auth storage
└─ sources/text             i18n translations
```

### 发送消息链路

```txt
User sends message in SessionView
│
├─ AgentInput.onSend()
│
├─ sync.sendMessage(sessionId, text, options)
│  ├─ get session encryption
│  ├─ ensure session is online, not thinking, no pending permission
│  ├─ optional attachments:
│  │  ├─ encryptBlob()
│  │  ├─ requestAttachmentUpload()
│  │  └─ uploadEncryptedBlob()
│  ├─ RawRecord:
│  │  {
│  │    role: "user",
│  │    content: { type: "text", text: string },
│  │    meta: { sentFrom, permissionMode, model, effort? }
│  │  }
│  ├─ encryptRawRecord()
│  ├─ enqueue local normalized message
│  └─ pendingOutbox.push({ localId, content })
│
├─ POST /v3/sessions/:id/messages
│
└─ server emits update
   ├─ app receives user-scoped update
   └─ CLI session receives session-scoped update
      └─ routes into Claude/Codex process
```

## CLI 和 daemon 结构

`happy-cli` 有两条主线：用户直接运行 agent，以及后台 daemon 接受 app 远程 RPC。daemon 入口在 `packages/happy-cli/src/daemon/run.ts`，machine socket 在 `packages/happy-cli/src/api/apiMachine.ts`，session socket 在 `packages/happy-cli/src/api/apiSession.ts`。

```txt
happy-cli
├─ src/commands             CLI command entrypoints
├─ src/daemon               long-running local daemon
├─ src/api
│  ├─ api.ts                HTTP API client
│  ├─ apiMachine.ts         machine-scoped socket + RPC registration
│  └─ apiSession.ts         session-scoped socket + message sync
├─ src/claude               Claude wrapper/session integration
├─ src/codex                Codex wrapper/session integration
├─ src/gemini/openclaw      other provider adapters
├─ src/agent                ACP-ish provider abstraction
├─ src/modules/common       shared RPC handlers: files, shell, git, etc.
└─ src/resume               reconnect/resume support
```

### 远程启动和恢复链路

```txt
App asks machine to spawn/resume
│
├─ apiSocket.machineRPC(machineId, method, params)
│  └─ encrypted with machine encryption
│
├─ server rpcHandler
│  └─ routes method `${machineId}:${method}` to machine-scoped socket
│
├─ ApiMachineClient.rpcHandlerManager
│  ├─ spawn-happy-session
│  ├─ resume-session
│  ├─ claude-fork-session
│  └─ sync-local-sessions
│
└─ daemon
   ├─ spawnHappyCLI()
   ├─ track PID/session metadata
   ├─ persist encryption/session resume data
   └─ child happy claude/codex reports session via local webhook
```

## 关键设计点

- Server 是同步和路由中枢，但核心会话内容、metadata、agent state 大多是客户端加密后存储。
- Socket.IO 按连接类型分流：app 是 `user-scoped`，daemon 是 `machine-scoped`，agent session 是 `session-scoped`。
- App 的 UI 不直接消费原始 server 数据，而是经 `Sync` 拉取、解密、normalize，再写入 Zustand `storage`，组件通过 selectors 渲染。
- CLI daemon 是远程控制的关键：app 不能直接碰本机文件或进程，必须通过 machine RPC 让 daemon 执行。
- `happy-wire` 是共享协议层，避免 app/cli/server 对消息 envelope 和事件类型各写一套。

## 相关文档

- `backend-architecture.md`: 后端内部结构、数据流和关键子系统。
- `cli-architecture.md`: CLI 和守护进程架构。
- `realtime-sync-and-rpc.md`: 实时套接字管理和 RPC 控制流。
- `encryption.md`: 加密边界和线上编码。
- `happy-wire.md`: 共享线路模式和类型包。
- `session-protocol.md`: 统一加密聊天事件协议。
