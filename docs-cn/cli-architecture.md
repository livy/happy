# CLI 架构

本文档描述 Happy CLI（`packages/happy-cli`）及其守护进程。CLI 既是一个交互式工具，也是一个后台会话管理器，用于保持机器状态与服务器同步。

## 系统概述

```mermaid
graph TB
    subgraph "Happy CLI"
        Entry[src/index.ts]
        API[API 客户端]
        Daemon[守护进程]
        Agents[代理运行器]
        Persist[持久化]
    end

    subgraph "~/.happy"
        Settings[settings.json]
        AccessKey[access.key]
        DaemonState[daemon.state.json]
        Logs[logs/]
    end

    subgraph 服务器
        HTTP[HTTP API]
        Socket[Socket.IO]
    end

    Entry --> API
    Entry --> Daemon
    Entry --> Agents
    Entry --> Persist

    Persist --> Settings & AccessKey & DaemonState & Logs

    API --> HTTP & Socket
    Daemon --> API
    Agents --> API
```

## 高级布局
- **入口点:** `src/index.ts` 解析子命令并路由执行。
- **API 客户端:** `src/api` 处理 HTTP + Socket.IO、加密和 RPC。
- **守护进程:** `src/daemon` 在后台运行、生成会话并维护机器状态。
- **持久化/配置:** `src/persistence.ts` + `src/configuration.ts` 管理 `~/.happy` 中的本地状态。
- **代理:** `src/claude`、`src/codex`、`src/gemini` 提供特定于供应商的运行器。

## CLI 入口流程

```mermaid
flowchart TD
    Start([happy ...]) --> Parse[解析子命令]

    Parse --> Doctor{doctor?}
    Parse --> Auth{auth?}
    Parse --> Connect{connect?}
    Parse --> Agent{codex/gemini?}
    Parse --> Default{默认}

    Doctor --> RunDoctor[运行诊断]
    Auth --> RunAuth[认证流程]
    Connect --> RunConnect[连接机器]

    Agent --> Setup[authAndSetupMachineIfNeeded]
    Default --> Setup

    Setup --> Context{后台?}
    Context --> |是| StartDaemon[启动守护进程]
    Context --> |否| RunAgent[直接运行代理]

    StartDaemon --> SpawnSession[生成会话]
```

`src/index.ts` 是 CLI 路由器。它：
- 解析子命令（`doctor`、`auth`、`connect`、`codex`、`gemini` 和默认运行流程）。
- 在需要时确保认证和机器设置（`authAndSetupMachineIfNeeded`）。
- 根据子命令/上下文启动守护进程或直接运行代理。

## 本地状态和配置

```mermaid
graph LR
    subgraph "~/.happy"
        direction TB
        settings["settings.json<br/><i>个人资料、引导</i>"]
        access["access.key<br/><i>加密密钥</i>"]
        daemon["daemon.state.json<br/><i>PID、端口、版本</i>"]
        logs["logs/<br/><i>CLI/守护进程日志</i>"]
    end

    subgraph "环境覆盖"
        direction TB
        E1[HAPPY_HOME_DIR]
        E2[HAPPY_SERVER_URL]
        E3[HAPPY_WEBAPP_URL]
        E4[HAPPY_VARIANT]
        E5[HAPPY_EXPERIMENTAL]
        E6[HAPPY_DISABLE_CAFFEINATE]
    end

    E1 -.-> settings & access & daemon & logs
```

本地状态位于 `~/.happy`（或 `HAPPY_HOME_DIR`）下：
- `settings.json`: 引导和个人资料设置（已验证/迁移）。
- `access.key`: 用于加密/认证的本地密钥材料。
- `daemon.state.json`: 守护进程 PID + 控制端口 + 版本。
- `logs/`: CLI/守护进程日志。

配置位于 `src/configuration.ts`：
- `HAPPY_SERVER_URL` 和 `HAPPY_WEBAPP_URL` 覆盖默认值。
- `HAPPY_VARIANT`、`HAPPY_EXPERIMENTAL`、`HAPPY_DISABLE_CAFFEINATE` 控制行为。

## API 客户端架构

```mermaid
graph TB
    subgraph "API 客户端"
        Base[ApiClient]
        Session[ApiSessionClient]
        Machine[ApiMachineClient]
        Encrypt[encryption.ts]
    end

    subgraph "服务器"
        HTTP[HTTP API]
        Socket[Socket.IO]
    end

    Base --> |POST /v1/sessions| HTTP
    Base --> |POST /v1/machines| HTTP

    Session --> |会话范围| Socket
    Machine --> |机器范围| Socket

    Encrypt --> Base & Session & Machine
```

### HTTP
`ApiClient` (`src/api/api.ts`) 处理：
- 会话创建（`POST /v1/sessions`），带有加密的元数据/状态。
- 机器注册（`POST /v1/machines`），带有加密的元数据/守护进程状态。
- 通过 `ApiSessionClient` 和 `ApiMachineClient` 的其他 CRUD 操作。

### WebSocket

```mermaid
graph LR
    subgraph "ApiSessionClient"
        S_In[接收: update]
        S_Out[发出: message, update-metadata,<br/>update-state, session-alive, usage-report]
    end

    subgraph "ApiMachineClient"
        M_In[接收: 机器更新]
        M_Out[发出: machine-alive,<br/>update metadata/state]
    end

    Server((Socket.IO)) --> S_In & M_In
    S_Out & M_Out --> Server
```

`ApiSessionClient` (`src/api/apiSession.ts`) 作为**会话范围**的客户端连接到 Socket.IO：
- 接收 `update` 事件并解密消息内容。
- 发出 `message`、`update-metadata`、`update-state`、`session-alive` 和 `usage-report`。

`ApiMachineClient` (`src/api/apiMachine.ts`) 作为**机器范围**的客户端连接：
- 发送 `machine-alive` 心跳。
- 使用乐观并发更新机器元数据/守护进程状态。
- 接收机器更新并在本地合并它们。

### 加密

```mermaid
flowchart LR
    subgraph "客户端"
        Plain[明文数据]
        Encrypt[encryption.ts]
        B64[Base64 编码]
    end

    Plain --> |加密| Encrypt --> B64 --> |发送| Server[(服务器)]
    Server --> |接收| B64 --> |解密| Encrypt --> Plain

    style Plain fill:#e8f5e9
    style B64 fill:#fff3e0
```

CLI 在客户端内容离开机器之前使用 `src/api/encryption.ts` 对其进行加密。
- 会话元数据、代理状态、消息、机器状态、工件和 KV 值在客户端进行加密。
- 线上编码为 base64；请参阅 `encryption.md`。

## 守护进程架构

```mermaid
graph TB
    subgraph "守护进程"
        Control[控制服务器<br/>127.0.0.1:port]
        Sessions[会话映射]
        MachineClient[ApiMachineClient]
    end

    subgraph "子进程"
        S1[会话 1]
        S2[会话 2]
        S3[会话 N]
    end

    CLI[CLI] --> |IPC| Control
    Control --> Sessions
    Sessions --> S1 & S2 & S3

    MachineClient --> |心跳| Server[(服务器)]
    MachineClient --> |状态同步| Server
```

守护进程是一个长期运行的进程，负责在后台运行会话并维护机器在线状态。

### 生命周期

```mermaid
flowchart TD
    Start([startDaemon]) --> Validate[验证版本]
    Validate --> Lock[获取锁文件]
    Lock --> Auth[认证]
    Auth --> Register[向服务器注册机器]
    Register --> Control[启动控制服务器]
    Control --> Track[跟踪子会话]
    Track --> Sync[将守护进程状态同步到服务器]
    Sync --> Running([运行中])

    Running --> |SIGTERM| Shutdown[清理并退出]
```

1. `startDaemon()` 验证运行版本并获取锁文件。
2. 它进行认证并向服务器注册机器。
3. 它启动一个本地**控制服务器**用于 IPC。
4. 它维护已跟踪子会话的映射，并在服务器上更新守护进程状态。

### 控制服务器（本地 IPC）

```mermaid
sequenceDiagram
    participant CLI
    participant State as daemon.state.json
    participant Control as 控制服务器
    participant Daemon

    CLI->>State: 读取端口
    State-->>CLI: port: 12345

    CLI->>Control: GET /list
    Control-->>CLI: [sessions...]

    CLI->>Control: POST /spawn-session
    Control->>Daemon: 生成子进程
    Daemon-->>Control: 会话已启动
    Control-->>CLI: OK

    CLI->>Control: POST /stop
    Control->>Daemon: 关闭
```

`startDaemonControlServer()` (`src/daemon/controlServer.ts`) 在 `127.0.0.1` 上运行一个 HTTP 服务器并暴露：
- `/list`（列出活动会话）
- `/stop-session`
- `/spawn-session`
- `/stop`（关闭守护进程）
- `/session-started`（会话自我报告）

CLI 通过 `controlClient.ts` 与此服务器通信，使用存储在 `daemon.state.json` 中的端口。

### 会话生成

```mermaid
flowchart LR
    subgraph "会话来源"
        CLI[CLI<br/><i>前台</i>]
        Daemon[守护进程<br/><i>后台</i>]
        Remote[移动/Web<br/><i>通过 RPC</i>]
    end

    subgraph "会话进程"
        Session[代理会话]
        Handlers[RPC 处理器]
    end

    CLI --> Session
    Daemon --> Session
    Remote --> |spawn-session| Daemon --> Session

    Session --> Handlers

    subgraph "RPC 表面"
        Handlers --> Bash[bash]
        Handlers --> Files[文件读/写]
        Handlers --> Search[ripgrep]
        Handlers --> Diff[difftastic]
    end
```

会话可以通过以下方式启动：
- 直接通过 CLI（前台）。
- 守护进程（后台）。
- 通过 RPC 的远程请求（通过机器连接来自移动/网页）。

守护进程会话生成使用 `registerCommonHandlers` 来暴露受控的 RPC 表面（shell 命令、文件操作、搜索/差异助手）。

### 机器状态

```mermaid
graph TB
    subgraph "机器元数据（静态）"
        M1[主机名]
        M2[平台]
        M3[CLI 版本]
        M4[路径]
    end

    subgraph "守护进程状态（动态）"
        D1[pid]
        D2[httpPort]
        D3[startedAt]
        D4[关闭信息]
    end

    subgraph "同步目标"
        Server[(服务器)]
        Local[daemon.state.json]
    end

    ApiMachine[ApiMachineClient]

    M1 & M2 & M3 & M4 --> ApiMachine
    D1 & D2 & D3 & D4 --> ApiMachine
    D1 & D2 & D3 & D4 --> Local

    ApiMachine --> Server
```

- **机器元数据** 是静态信息（主机名、平台、CLI 版本、路径）。
- **守护进程状态** 是动态的（pid、httpPort、startedAt、关闭信息）。

守护进程通过 `ApiMachineClient` 更新这些内容，并将本地状态镜像到 `daemon.state.json` 中用于控制/诊断。

## RPC 和工具桥接

```mermaid
sequenceDiagram
    participant Mobile
    participant Server
    participant Daemon
    participant Session

    Mobile->>Server: RPC: spawn-session
    Server->>Daemon: 通过 Socket.IO 转发
    Daemon->>Session: 生成进程
    Session-->>Daemon: 运行中

    Mobile->>Server: RPC: bash "ls -la"
    Server->>Session: 通过 Socket.IO 转发
    Session->>Session: 执行命令
    Session-->>Server: 结果
    Server-->>Mobile: 结果

    Note over Mobile,Session: 所有 RPC 都流过 Socket.IO<br/>没有直接的 REST 暴露
```

RPC 用于通过 Socket.IO 连接发送命令：
- 会话注册 RPC 处理器（例如 `bash`、文件读/写、`ripgrep`、`difftastic`）。
- 守护进程注册 spawn-session 处理器，以便服务器/移动客户端可以要求它启动本地会话。

此机制允许服务器和移动客户端驱动本地操作，而不暴露广泛的 REST 表面。

## 实现参考
- CLI 入口: `packages/happy-cli/src/index.ts`
- 守护进程: `packages/happy-cli/src/daemon`
- 控制服务器/客户端: `packages/happy-cli/src/daemon/controlServer.ts`、`packages/happy-cli/src/daemon/controlClient.ts`
- API 客户端: `packages/happy-cli/src/api`
- 持久化: `packages/happy-cli/src/persistence.ts`
- 配置: `packages/happy-cli/src/configuration.ts`
