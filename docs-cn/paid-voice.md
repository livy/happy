# 付费语音 — 速率限制与认证

## 流程

```
用户点击麦克风
│
├─ 绕过模式？（自定义代理 ID）
│   └─ 直接连接到 ElevenLabs，跳过所有内容
│
├─ POST /v1/voice/conversations { agentId }
│   │
│   ├─ GET /v1/convai/conversations?agent_id=X&user_id=Y&created_after=<30d>&page_size=100
│   │   └─ 求和 call_duration_secs → usedSeconds（约 108ms）
│   │
│   ├─ conversations == 100?          → { allowed: false, reason: "voice_conversation_limit_reached" }
│   ├─ usedSeconds >= 5h?             → { allowed: false, reason: "voice_hard_limit_reached" }
│   ├─ usedSeconds >= 20min + 无订阅? → { allowed: false, reason: "subscription_required" }
│   │
│   ├─ GET /v1/convai/conversation/token?agent_id=X&participant_name=ELEVEN_USER_ID
│   │   └─ 解码 JWT → 从 video.room 中提取 conv_id
│   │
│   └─ 返回 { conversationToken, conversationId, agentId, elevenUserId, usedSeconds, limitSeconds }
│
├─ allowed: false?
│   ├─ "voice_conversation_limit_reached" → 警报（在 GitHub 上提交 issue）
│   └─ 其他 → paywall flow="voice_must_pay"
│
└─ allowed: true
    ├─ 功能标志 voice-upsell == "show-paywall-before-first-voice-chat"?
    │   └─ 仅首次免费语音开始 → 软 paywall flow="voice_trial_eligible"
    ├─ 功能标志 voice-upsell == "voice-onboarding-and-upsell"?
    │   └─ 将入门 + 升级指导注入语音提示
    └─ 否则
        └─ 控制 → 无软 paywall，无入门实验
        然后 startSession({ conversationToken }) → 通过 LiveKit 进行 WebRTC
```

## 限制

| 层级 | 限制 | 窗口 | 对我们的成本 | 发生什么 |
|------|-------|--------|------------|--------------|
| 免费 | 20 分钟 | 30 天 | ~$0.19 | Paywall |
| 订阅 | 5 小时 | 30 天 | — | 硬阻止 → BYO 代理 |
| BYO 代理 | 无限 | — | $0 | 用户自己的 ElevenLabs |
| 任意 | 100 次对话 | 30 天 | — | 硬阻止 → 提交 issue |

成本：约 $0.01/分钟（$1600 / 171K 分钟实测）。

## 跟踪

ElevenLabs 是事实来源。无本地 DB。

- 令牌生成时的 `participant_name` → 在对话记录上设置 `user_id`
- 使用情况：`GET /conversations?user_id=Y&created_after=<30d>&page_size=100` → 对持续时间求和
- `user_id` = Happy 用户 ID 的 HMAC-SHA256（确定性，单向）
- 最大 page_size 为 100 → 在 100 次对话时我们阻止（无法在没有分页的情况下跟踪更多）

**TODO：** 从 Prisma 模式中删除 `VoiceConversation` 模型（不再使用，可以删除 DB 表）。

## Paywall 流程（RevenueCat）

单个 paywall 模板，由自定义变量 `flow` 驱动规则：

| 流程 | 时间 | 行为 |
|------|------|----------|
| `voice_trial_eligible` | 功能标志变体 `show-paywall-before-first-voice-chat`，首次免费语音使用 | 软 — 可关闭，语音仍开始 |
| `voice_must_pay` | 服务器返回 `allowed: false` | 硬 — 必须购买 |
| `voluntary_support` | 设置 | 用户主动发起 |

### 未来：语音代理自我推销

让代理自然地提及定价。将 `usedSeconds`/`limitSeconds` 注入上下文，添加 `showUpgradePaywall` 客户端工具。

## 安全性

- 由 ElevenLabs 签名的 JWT，单次使用，无法伪造
- 代理设置为"仅授权" — 需要服务器生成的令牌
- 公共 repo 中的代理 ID 无害
