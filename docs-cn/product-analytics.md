# 产品分析

# [自动]

## 导航

- $screen
  - $screen_name

## 生命周期

- 应用已安装
- 应用已更新
  - previous_version?
  - previous_build?
- 应用已打开
  - url?
- 应用变为活跃
- 应用进入后台

# [显式]

## 认证

- account_created（账户已创建）
- account_restored（账户已恢复）
  - 注意：这是恢复流程开始，不是恢复成功

## 核心

- connect_attempt（连接尝试）
- message_sent（消息已发送）
  - source（来源）
  - session_agent（会话代理）
  - session_started_source（会话开始来源）
  - happy_cli_version
  - ota_version
  - ota_runtime_version
- session_switched（会话已切换）
  - session_id
  - session_created_at
  - last_active_at
  - last_updated_at

## 语音

- voice_permission_response（语音权限响应）
  - allowed（已允许）
- voice_session_started（语音会话已开始）
  - session_id
  - elevenlabs_conversation_id
- voice_session_error（语音会话错误）
  - session_id
  - elevenlabs_conversation_id
  - error
- voice_session_stopped（语音会话已停止）
  - session_id
  - elevenlabs_conversation_id
  - duration_seconds

## Paywall

所有都包含 flow 属性，它自定义 RevenueCat 显示的升级屏幕。

- paywall_button_clicked（paywall 按钮已点击）
- paywall_presented（paywall 已展示）
- paywall_purchased（paywall 已购买）
- paywall_restored（paywall 已恢复）
- paywall_cancelled（paywall 已取消）
- paywall_error（paywall 错误）
  - error

## 评分

- review_prompt_shown（评分提示已显示）
- review_prompt_response（评分提示响应）
  - likes_app（喜欢应用）
- review_store_shown（应用商店评分已显示）
- review_retry_scheduled（评分重试已安排）
  - days_until_retry

## 更新

- ota_update_available（OTA 更新可用）
  - ota_version
  - ota_runtime_version
- ota_update_applied（OTA 更新已应用）
  - ota_version
  - ota_runtime_version
- whats_new_clicked（新功能已点击）

## GitHub

- github_connected（GitHub 已连接）

## 好友

- friends_search（好友搜索）
- friends_profile_view（好友个人资料查看）
- friends_connect（好友连接）

# 附录

## 共享 SDK 属性

- 每个 capture(...) 发送还包括：
  - $lib
  - $lib_version
  - $session_id
  - $screen_height
  - $screen_width
  - $process_person_profile
  - $is_identified
  - $device_type
  - $app_build?
  - $app_name?
  - $app_namespace?
  - $app_version?
  - $device_manufacturer?
  - $device_name?
  - $os_name?
  - $os_version?
  - $locale?
  - $timezone?
  - $screen_name?
  - event
  - distinct_id

## 身份和控制发送

- $identify
- $set
- reset
- optIn
- optOut

## 强烈偏好

- 更偏好少量带有显式属性的核心事件，而不是不断增长的重叠事件集。
- `message_sent` 是规范的出站发送事件。不要为特定表面（如语音）添加并行发送事件。改为添加或使用 `source`。
- 如果新的分析问题可以通过扩展现有的事件来回答，优先添加属性而不是发明新事件。
- `session_switched` 应携带稳定身份，而不仅仅是最近度。保持 `session_id` 和 `session_created_at`。
- OTA 上下文是一等公民，应随重要事件一起传递。在 `message_sent`、`ota_update_available` 和 `ota_update_applied` 上保持 `ota_version` 和 `ota_runtime_version`。
- 偏好捕获站点处直接、显式的属性对象。不要将事件形状隐藏在静默添加、删除或过滤字段的通用帮助层后面。
- 如果我们关心会话切换入口源，添加显式的 `source` 属性。不要尝试稍后从导航上下文重建它。

## 注意

- session_switched 现在包括稳定身份（`session_id`、`session_created_at`）加上最近度。入口源仍在合并中，直到我们添加显式 source 属性。
- elevenlabs_conversation_id 是 ElevenLabs 语音会话层返回的对话 ID。
- github_connected 是一个纯事件，没有附加 GitHub 个人资料数据。

## 相关来源

- packages/happy-app/sources/track/index.ts
- packages/happy-app/sources/hooks/useNavigateToSession.ts
- packages/happy-app/sources/-session/SessionView.tsx
- packages/happy-app/sources/realtime/RealtimeSession.ts
- packages/happy-app/sources/components/SettingsView.tsx
- packages/happy-app/sources/sync/sync.ts
- packages/happy-app/sources/track/useTrackScreens.ts
- packages/happy-app/sources/track/tracking.ts
