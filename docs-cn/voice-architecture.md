# 语音架构

ElevenLabs 语音助手如何与 Happy 应用集成，将消息路由到会话，以及管理上下文交付。

## 组件

```text
SessionView.tsx            UI — 麦克风按钮，触发语音启动/停止
RealtimeSession.ts         生命周期 — 启动/停止，令牌获取，会话路由状态
RealtimeVoiceSession.tsx   原生 ElevenLabs 桥（useConversation 钩子）
RealtimeVoiceSession.web.tsx  Web ElevenLabs 桥（相同接口）
voiceHooks.ts              上下文交付 — 格式化并路由应用事件到语音代理
contextFormatters.ts       用于会话上下文、消息、权限的文本格式化程序
realtimeClientTools.ts     语音代理可以调用的工具实现
voiceConfig.ts             功能标志和常量
storage.ts                 全局状态（realtimeStatus、realtimeMode）
types.ts                   共享类型定义
```

## 会话路由

`RealtimeSession.ts` 中的单个模块级变量 `currentSessionId` 控制语音代理的工具调用路由到哪个会话。它是两者的唯一事实来源：

- **路由**：`realtimeClientTools.ts` 中的 `messageClaudeCode` 和 `processPermissionRequest` 通过 `getCurrentRealtimeSessionId()` 读取它。
- **聚焦去重**：`voiceHooks.onSessionFocus()` 与它比较，以避免为已聚焦的会话重新注入上下文。

当用户在语音活动时导航到不同的会话时，`onSessionFocus` 更新 `currentSessionId`，以便后续语音命令路由到新查看的会话。

```text
用户在会话 A 上点击麦克风
  │
  v
startRealtimeSession("A")
  └──> currentSessionId = "A"

用户导航到会话 B
  │
  v
sync.onSessionVisible("B")
  └──> voiceHooks.onSessionFocus("B")
         └──> setCurrentRealtimeSessionId("B")

语音代理调用 messageClaudeCode
  └──> getCurrentRealtimeSessionId() → "B"
```

## 语音启动

当语音会话启动时，`onVoiceStarted(sessionId)` 构建一个初始提示，包含：

1. **会话目录** — 每个活动会话的单行（id + 摘要），以便代理知道所有可用的目标。
2. **当前会话上下文** — 通过 `injectSessionContext(sessionId)` 完整转储：会话元数据、路径、摘要和消息历史。

```text
onVoiceStarted("A")
  │
  ├──> formatSessionDirectory()
  │      → "可用会话：\n- abc: "重构认证"\n- def: "修复深色模式""
  │
  └──> injectSessionContext("A")
         → "# 会话 ID：abc\n# 项目路径：...\n## 历史\n..."
```

## 上下文交付

应用事件通过两个具有不同语义的通道交付给语音代理：

### sendContext() — 静默后台注入

调用 `voice.sendContextualUpdate()`。代理接收信息但**不**响应。始终立即发送，从不排队。

用于：新消息、会话焦点更改、会话在线/离线、完整会话转储。

### sendPrompt() — 触发代理响应

调用 `voice.sendTextMessage()`。作为用户回合 — 代理将响应。**在任何人说话时排队**，当模式转换为 `idle` 时作为单个批次刷新。

用于：权限请求、就绪事件（代理完成工作）。

### 批处理

当用户或代理说话时，提示在 `pendingPrompts[]` 中排队。对 `realtimeMode` 的 zustand 订阅在模式返回到 `idle` 时触发 `flushPendingPrompts()`，将所有排队的提示连接到单个 `sendTextMessage` 调用中。

```text
realtimeMode = 'agent-speaking'
  │
  ├── onReady("abc")        → sendPrompt() → 排队
  ├── onPermission("abc")   → sendPrompt() → 排队
  ├── onMessages("abc")     → sendContext() → 立即发送
  │
  v
realtimeMode → 'idle'
  │
  v
flushPendingPrompts()
  └──> voice.sendTextMessage(连接的提示)
```

### 会话上下文注入

`injectSessionContext(sessionId)` 是用于注入完整会话上下文的共享代码路径。它被 `onVoiceStarted`（构建初始提示字符串）和 `onSessionFocus`（发送上下文更新）两者使用。它通过 `shownSessions` 跟踪哪些会话已经显示，以避免冗余转储。

## 实时模式

存储中的 `realtimeMode` 跟踪谁当前在说话：

| 模式 | 含义 | 来源 |
|------|---------|--------|
| `idle` | 没人说话 | 默认 / 语音结束后 |
| `agent-speaking` | ElevenLabs 代理正在产生音频 | `onModeChange({ mode: 'speaking' })` |
| `user-speaking` | 用户麦克风 VAD 高于阈值 | `onVadScore({ vadScore })` |

优先级：`agent-speaking` > `user-speaking` > `idle`。如果两者同时触发，代理获胜（代理输出期间的用户语音可能是串扰）。

### VAD 检测

ElevenLabs 提供 `onVadScore({ vadScore: number })` — 用户麦克风活动的连续 0-1 信号。我们通过防抖推导二进制状态：

- `vadScore > VAD_THRESHOLD`（0.5）→ `user-speaking`，重置静音计时器
- `vadScore <= VAD_THRESHOLD` → 启动静音计时器（`VAD_SILENCE_MS` = 300ms），超时时转换到 `idle`

代理模式更改（`onModeChange`）优先于 VAD。当 `onModeChange` 报告 `'speaking'` 时，我们设置 `agent-speaking`，不管 VAD 如何。当它报告 `'listening'` 时，我们遵从 VAD 状态。

```text
ElevenLabs SDK
  │
  ├── onModeChange({ mode: 'speaking' })
  │     └──> realtimeMode = 'agent-speaking'
  │
  ├── onModeChange({ mode: 'listening' })
  │     └──> realtimeMode = (VAD active ? 'user-speaking' : 'idle')
  │
  └── onVadScore({ vadScore })
        └──> 如果代理不说话：
               vadScore > 0.5 → 'user-speaking'
               vadScore ≤ 0.5 → 防抖 → 'idle'
```

## 语音代理工具

语音代理可以调用这些客户端工具（在 `realtimeClientTools.ts` 中定义）：

- **messageClaudeCode** — 通过 `sync.sendMessage(sessionId, message)` 向当前聚焦的会话发送文本消息。
- **processPermissionRequest** — 允许或拒绝当前会话上待处理的权限请求。

两者都从 `getCurrentRealtimeSessionId()` 读取目标会话。

## 生命周期

```text
应用挂载 RealtimeVoiceSession 组件
  └──> useConversation() 钩子初始化
  └──> registerVoiceSession(impl) — 使实例全局可用

用户点击麦克风
  └──> voiceHooks.onVoiceStarted(sessionId) — 构建初始提示
  └──> startRealtimeSession(sessionId, prompt)
         ├──> fetchVoiceToken() — 服务器端门控（参见 plans/elevenlabs-voice-usage-gating.md）
         ├──> currentSessionId = sessionId
         └──> voiceSession.startSession({ token, initialContext, ... })

用户再次点击麦克风（或导航离开）
  └──> stopRealtimeSession()
         ├──> voiceSession.endSession()
         ├──> currentSessionId = null
         └──> voiceHooks.onVoiceStopped() — 清除状态
```

## 相关

- `docs/plans/elevenlabs-voice-usage-gating.md` — 语音会话的使用门控和 paywall 流程。
