# 实时同步和 RPC

这是 Happy 如何使用 Socket.IO 进行实时同步和点对点 RPC 的高级文档。

相关文档：
- `protocol.md`：线路契约、事件名称和有效负载形状
- `multi-process.md`：关于跨副本行为、故障模式和测试历史的更深入笔记
- `backend-architecture.md`：服务器子系统概述
- `cli-architecture.md`：守护进程和客户端套接字所有权

## 核心部分

Happy 在 `/v1/updates` 使用一个 Socket.IO 端点，有三个连接范围：
- `user-scoped`：应用/网页客户端和账户范围的监听器
- `session-scoped`：一个活动的会话进程
- `machine-scoped`：一台机器的一个守护进程

在服务器上：
- `socket.ts` 认证握手，用 `userId` 和范围元数据标记套接字，并在设置 `REDIS_URL` 时启用 Redis 流适配器。
- `eventRouter.ts` 处理普通实时更新的扇出。
- `rpcHandler.ts` 处理 `rpc-register`、`rpc-unregister` 和 `rpc-call`。

在客户端：
- `ApiSessionClient` 拥有一个长期存在的会话范围套接字。
- `ApiMachineClient` 拥有一个长期存在的机器范围套接字。
- 应用的 `apiSocket` 拥有一个长期存在的用户范围套接字。
- `RpcHandlerManager` 注册处理程序并在重连时重新注册它们。

## 房间模型

普通扇出房间：
- `user:<userId>`
- `user:<userId>:user-scoped`
- `user:<userId>:session:<sessionId>`
- `user:<userId>:machine:<machineId>`

RPC 注册房间：
- `rpc:<userId>:<prefixedMethod>`

服务器使用房间成员资格作为谁当前拥有 RPC 方法的事实来源。

## 实时同步流程

1. 客户端以一个范围（`user-scoped`、`session-scoped` 或 `machine-scoped`）连接。
2. 服务器将该套接字添加到适当的用户/会话/机器房间。
3. 当持久状态变化时，`eventRouter` 向匹配的房间发出 `update` 事件。
4. 当临时在线状态变化时，服务器向匹配的房间发出 `ephemeral` 事件。
5. 重连时，如果客户端在离线时遗漏了任何内容，可以重新获取状态。

## RPC 流程

1. 调用者发出带有方法名称和参数的 `rpc-call`。
2. `rpcHandler.ts` 解析房间 `rpc:<userId>:<method>`。
3. 服务器在该房间中查找目标套接字。
4. 如果没有目标，服务器在失败前短暂等待重连。
5. 如果存在目标，服务器通过 `rpc-request` 转发请求。
6. 目标通过 `RpcHandlerManager` 运行处理程序并确认结果。
7. 如果目标在调用中消失，服务器失败调用，而不是等待完整超时。

这就是 Happy 如何在用于普通实时同步的同一传输之上进行点对点控制流量。

## 当前的尖锐边缘

- `packages/happy-agent/src/machineRpc.ts` 仍为机器的 `spawn` 和 `resume` 创建一次性调用者套接字，而不是重用长期存在的调用者连接。
- `packages/happy-server/sources/app/api/socket/rpcHandler.ts` 仍在一个地方混合了房间查找、重连宽限、调用中在线状态检查和指标发射。

## 调试

如果此路径不可靠，首先要检查的是：
- RPC 成功/失败率
- RPC 延迟
- websocket 连接 churn
- Redis 流延迟

有关更深入的跨副本和故障模式详细信息，请使用 `multi-process.md`。
