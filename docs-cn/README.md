# Happy 文档

此文件夹记录 Happy 的内部工作原理，重点关注协议、后端架构、部署和 CLI 工具。从这里开始。

## 索引
- project-architecture.md: 项目整体架构总览，覆盖 app、CLI/daemon、server、wire 包和主数据流。
- protocol.md: 线路协议 (WebSocket)、有效载荷格式、排序和并发规则。
- realtime-sync-and-rpc.md: 实时套接字管理和 RPC 控制流的高级概述。
- api.md: HTTP 端点和认证流程。
- encryption.md: 加密边界和线上编码。
- backend-architecture.md: 内部后端结构、数据流和关键子系统。
- deployment.md: 如何部署后端和所需的基础设施。
- cli-architecture.md: CLI 和守护进程架构以及它们如何与服务器交互。
- multi-process.md: 更深层次的多副本 Socket.IO + Redis 流行为、故障模式和集成测试历史。
- dev-environments.md: 本地 `environments/data/` 工作流程、实验室项目配置、`env:cli` 直通行为和守护进程使用。
- session-protocol.md: 统一加密聊天事件协议。
- session-protocol-claude.md: Claude 特定的会话协议流程（本地与远程启动器、去重/重启）。
- plans/provider-envelope-redesign.md: 建议替换当前的提供者/会话信封设计。
- permission-resolution.md: 跨应用和 CLI 的基于状态的权限模式解析（包括沙箱行为）。
- happy-wire.md: 共享线路模式/类型包和迁移说明。
- voice-architecture.md: ElevenLabs 语音助手集成、会话路由、上下文批处理和 VAD 检测。
- research/: 一般研究笔记和探索性文章。
- competition/: 竞争对手研究、协议分析和比较笔记。
- competition/AGENTS.md: 存储竞争对手研究结果的结构和规则，不提交原始检出。

## 约定
- 路径和字段名反映了 `packages/happy-server` 中的当前实现。
- 示例是说明性的；权威来源是代码。
