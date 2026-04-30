# 会话协议

本文档定义了 Happy 会话的统一消息协议。它用单一的扁平事件流取代了现有的 `output`、`codex` 和自定义 `acp` 格式的混合。旧会话继续使用传统格式；新会话专门使用此协议。

有关现有线路协议（WebSocket 传输、加密、排序）的上下文，请参阅 `protocol.md`。

## 与 ACP 的比较

真正的[代理通信协议](https://agentcommunicationprotocol.dev)是基于 REST 的代理到代理互操作性标准。我们的协议解决了不同的问题：在移动/网页客户端上呈现加密的代理聊天会话。

| 关注点 | ACP | 此协议 |
|---|---|---|
| 目的 | 代理到代理互操作（REST）| 带代理会话的加密聊天 |
| 传输 | REST + SSE | 通过 WebSocket 的加密有效负载 |
| 消息模型 | `Message { role, parts[] }` 带 MIME 类型 | 扁平事件流，由 `t` 区分 |
| 内容类型 | MIME 类型（`text/plain`、`image/png`）| 显式事件类型（`text`、`service`、`file` 等）|
| 文件 | `content_url` 或带 MIME 类型的 base64 | 先上传，通过 `ref` 引用 |
| 图像 | 与文件相同（MIME 类型部分）| 带有可选图像元数据（`width`、`height`、`thumbhash`）的 `file` 事件 |
| 工具调用 | 部件上的 TrajectoryMetadata | 一流的 `tool-call-start` / `tool-call-end` |
| 生命周期 | 7 个运行状态，11 个 SSE 事件类型 | `turn-start` / `turn-end` + 代理 `start` / `stop` |
| 事件身份 | 运行上的 UUID，消息上的 created_at | 每条消息上的 `id`（cuid2）+ `time`（毫秒）|

**为什么不直接使用 ACP？**

1. **加密** — ACP 假设明文 REST。我们的有效负载是端到端加密的。
2. **工具调用在 UI 中可见** — ACP 将工具建模为用于调试的元数据。我们用加载动画、描述和权限对话框呈现它们。
3. **即时图像渲染** — ACP 没有 thumbhash 或尺寸。我们的 `file` 事件可以携带图像元数据用于即时占位符布局。
4. **简单性** — 总共 9 个事件类型。客户端在单个 `switch` 中实现完整协议。

**我们从 ACP 中借鉴的内容：**

- 信封上的角色（`user` / `agent`）
- 通过引用内容（`content_url` → `ref`）
- 生命周期事件与内容事件的分离

## 信封

每个加密的消息有效负载：

```json
{
  "id": "<cuid2>",
  "time": 1739347200000,
  "role": "user" | "agent",
  "turn": "<cuid2>",
  "subagent": "<cuid2>",
  "ev": { "t": "...", ... }
}
```

| 字段 | 类型 | 描述 |
|---|---|---|
| `id` | cuid2 | 全局唯一的消息标识符 |
| `time` | number | Unix 时间戳，毫秒 |
| `role` | `"user"` \| `"agent"` | 谁产生了此事件 |
| `turn` | cuid2? | 由 `turn-start` 建立的回合 id。所有代理消息都需要；不带 `turn` 的代理消息将被忽略 |
| `subagent` | cuid2? | 可选。由子代理产生的消息的子代理标识符。必须是适配器生成的 cuid2 |
| `ev` | object | 事件主体，由 `ev.t` 区分 |

## 子代理

当工具调用产生子代理（例如 Task 工具）时，该子代理产生的所有消息都将 `subagent` 设置为适配器生成的 cuid2 id。父提供者工具调用信封是可选的；适配器可以隐藏父工具调用的噪音，仅发出子代理生命周期/内容。

子代理可以嵌套 — 子代理的工具调用可以产生另一个子代理。每个级别使用自己的 `subagent` id。

对于提供者适配器，孤立处理是 CLI 的责任：如果子代理消息在其父被子代理注册之前到达，CLI 应该缓冲并仅在父已知后发出它。

提供者原生 id（Claude/Codex 工具 id 等）不得用作 `subagent` 值。

## 事件

### `text`

显示给用户的文本内容。支持 markdown。

```json
{ "t": "text", "text": "你好，我能帮什么忙？" }
```

| 字段 | 类型 | 描述 |
|---|---|---|
| `text` | string | 消息文本（markdown）|
| `thinking` | boolean? | 可选。如果这是内部推理，则为 `true`，默认不向用户显示 |

### `service`

按原样显示给用户的仅代理服务文本。支持 markdown。

```json
{ "t": "service", "text": "**服务：** 正在重新连接..." }
```

| 字段 | 类型 | 描述 |
|---|---|---|
| `text` | string | 服务消息文本（markdown）|

### `tool-call-start`

代理开始工具调用。

```json
{
  "t": "tool-call-start",
  "call": "tc_abc",
  "name": "grep",
  "title": "正在搜索 handleClick",
  "description": "在 **src/** 目录中搜索 `handleClick`",
  "args": { "pattern": "handleClick", "path": "src/" }
}
```

| 字段 | 类型 | 描述 |
|---|---|---|
| `call` | string | 工具调用标识符，由 `tool-call-end` 匹配 |
| `name` | string | 工具名称（小写，连字符分隔）|
| `title` | string | 简短摘要（内联 markdown：`` `code` ``、**粗体**、*斜体*、[链接]）|
| `description` | string | 完整描述（内联 markdown：`` `code` ``、**粗体**、*斜体*、[链接]）|
| `args` | object | 工具输入参数 |

### `tool-call-end`

工具调用完成。通过 `call` 匹配先前的 `tool-call-start`。

```json
{ "t": "tool-call-end", "call": "tc_abc" }
```

| 字段 | 类型 | 描述 |
|---|---|---|
| `call` | string | 匹配 `tool-call-start.call` |

### `file`

文件附件。必须先将文件上传到服务器。

```json
{ "t": "file", "ref": "upload_def", "name": "report.pdf", "size": 524288 }
```

| 字段 | 类型 | 描述 |
|---|---|---|
| `ref` | string | 服务器上传 ID |
| `name` | string | 显示文件名 |
| `size` | number | 必需的文件大小，以字节为单位 |
| `image` | object? | 当文件是图像时，可选的图像元数据 |
| `image.width` | number | 图像宽度，像素 |
| `image.height` | number | 图像高度，像素 |
| `image.thumbhash` | string | Base64 编码的 [ThumbHash](https://evanw.github.io/thumbhash/) 用于即时占位符 |

### `turn-start`

代理开始处理。始终是 `role: "agent"`。信封包含一个 `turn` id（cuid2），它标识回合。此 `turn` 值必须被视为回合标识符；它与消息 `id` 是分开的。

```json
{ "id": "a2", "turn": "t2", "ev": { "t": "turn-start" } }
```

### `turn-end`

代理完成处理。始终是 `role: "agent"`。携带与它关闭的消息相同的 `turn`。

```json
{ "t": "turn-end", "status": "completed" }
```

| 字段 | 类型 | 描述 |
|---|---|---|
| `status` | `"completed"` \| `"failed"` \| `"cancelled"` | 最终回合结果 |

### `start`

子代理开始的代理生命周期标记。始终是 `role: "agent"`。使用信封 `subagent` 来识别哪个子代理启动了。

```json
{ "t": "start", "title": "研究代理" }
```

| 字段 | 类型 | 描述 |
|---|---|---|
| `title` | string? | 子代理的可选人类可读标题 |

### `stop`

子代理停止的代理生命周期标记。始终是 `role: "agent"`。使用信封 `subagent` 来识别哪个子代理停止了。

```json
{ "t": "stop" }
```

## 示例流

```
← { id: "a1", time: 1000, role: "user",  ev: { t: "text", text: "查找 TODO" } }
← { id: "a2", time: 1001, role: "agent", turn: "t2", ev: { t: "turn-start" } }
← { id: "a2b", time: 1001, role: "agent", turn: "t2", ev: { t: "service", text: "**服务：** 已连接到远程运行时" } }
← { id: "a3", time: 1002, role: "agent", turn: "t2", ev: { t: "text", text: "正在搜索..." } }
← { id: "a4", time: 1003, role: "agent", turn: "t2", ev: { t: "tool-call-start", call: "tc1", name: "grep", title: "正在搜索 TODO", description: "在项目根目录中搜索 `TODO`", args: { pattern: "TODO" } } }
← { id: "a5", time: 1004, role: "agent", turn: "t2", ev: { t: "tool-call-end", call: "tc1" } }
← { id: "a6", time: 1005, role: "agent", turn: "t2", ev: { t: "text", text: "找到了 3 个 TODO。" } }
← { id: "a7", time: 1006, role: "agent", turn: "t2", ev: { t: "turn-end", status: "completed" } }
```
