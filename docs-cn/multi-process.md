# 多进程 happy-server

handy-server 如何跨多个 Kubernetes 副本运行：套接字分发、基于房间的 RPC 路由、广播扇出、守护进程生命周期，以及在混乱情况下（pod 终止、短暂重连、网络分区）会发生什么。

有关更短的高级控制流程文档，请参阅 `realtime-sync-and-rpc.md`。

> **状态：** 此文档中的代码在 `main` 分支上，但 `handy.yaml` 发布的是 `replicas: 1`。将生产切换到多副本是一个单独的决定。

## 简要总结

handy-server 使用 **Socket.IO Redis streams 适配器** 通过单个 Redis 流在副本之间转发 `io.to(...).emit(...)`。RPC 路由（web → 守护进程）通过名为 `rpc:<userId>:<method>` 的 **Socket.IO 房间** 进行。服务器通过 `io.in(room).fetchSockets()`（跨副本工作的集群适配器原语）解析守护进程套接字，并将请求发送到单个 RemoteSocket。**没有 Redis 键、没有 TTL、没有 Lua-CAS 清理、没有保持活动刷新路径**——成员资格是标准的 Socket.IO 房间状态，在断开连接时自动清理。

如果在调用时守护进程短暂离线（k8s pod 循环、瞬态网络中断），服务器**最多等待 10 秒**让它重新出现，然后才失败。如果在套接字死亡时守护进程正在处理中，**在线状态轮询**会在约 1 秒内中止调用，而不是等待完整的 30 秒 emit-with-ack 超时。

`connectionStateRecovery` 在 `socket.ts` 中**被注释掉**。流适配器支持它（已验证有效），但我们首先发布与预多进程行为的一致性；客户端仍然通过 `apiSocket.onReconnected` 在每次重连时进行完整的 REST 重新获取。

## rpc-call 做什么（控制流）

```
来自 web 客户端的 rpc-call
.
├── 输入验证
│   └── 方法名 → 无效 → callback({ok:false, error:'Invalid parameters'})
│
├── 1. 通过集群适配器解析目标
│   └── fetchRoomSockets(io, 'rpc:<userId>:<method>')
│       ├── io.in(room).timeout(500ms).fetchSockets()
│       ├── 成功 → 返回 [...]
│       └── 失败（对等副本无响应、快速适配器超时）
│           └── 日志 + 返回 []（视为"无人在此"）
│       │
│       ├── 返回 [target] → 转到步骤 2
│       └── 返回 []      → 转到等待重连
│
├── 等待重连宽限期（仅在未找到目标时）
│   └── waitForRoomMember(io, room, 10_000ms)
│       └── 通过 fetchRoomSockets 每 200ms 轮询：
│           ├── 房间获得成员 → 返回 [target]
│           └── 截止日期到达     → 返回 []
│       │
│       ├── 宽限期产生 [target] → 转到步骤 2
│       └── 宽限期产生 []
│           └── callback({ok:false, error:'RPC method not available'})
│
├── 2. 对已解析目标进行健全性检查
│   ├── 房间中有多个套接字 → 记录警告，使用第一个
│   └── target.id === socket.id → callback({ok:false, error:'same socket'})
│
├── 3. 触发 emit + 竞赛在线状态轮询
│   ├── ackPromise = target.timeout(30_000).emitWithAck('rpc-request', ...)
│   │   (集群适配器通过 Redis 流跨副本路由)
│   │
│   └── presencePoll = while (alive)
│       └── 睡眠 1s，再次 fetchRoomSockets
│           ├── 目标仍在房间中 → 继续监视
│           └── 目标不存在       → 抛出 'RPC target disconnected'
│
├── Promise.race(ackPromise, presencePoll)
│   ├── ackPromise 解析 → callback({ok:true, result})
│   ├── ackPromise 抛出（超时/错误）→ callback({ok:false, error: msg})
│   └── presencePoll 抛出 → callback({ok:false, error:'RPC target disconnected'})
│
└── finally
    └── presenceAlive = false （在成功或失败时干净地停止轮询）
```

## 守护进程做什么（生命周期）

```
守护进程（机器范围或会话范围）
.
├── 连接到 handy-server
│   └── 服务器: socket.handshake.auth.token → auth.verifyToken
│       └── 附加 rpcHandler / *UpdateHandler 等
│
├── emit('rpc-register', { method })
│   └── 服务器: socket.join('rpc:<userId>:<method>')
│       └── ack: emit('rpc-registered', { method })
│       (Socket.IO 房间状态，无 Redis 键，无 TTL)
│
├── on('rpc-request', (data, cb) => …)
│   └── 处理程序运行，cb(result) 通过集群适配器返回值
│
├── 断开连接（任何原因）
│   └── Socket.IO 自动从所有房间中移除套接字
│       (集群适配器通过心跳同步；无需手动清理)
│
└── 自动重连
    └── on 'connect': 重新发出 rpc-register
        (客户端唯一的责任)
```

## 广播做什么（事件发出）

```
eventRouter.emitUpdate / emitEphemeral
.
└── io.to(rooms).emit('update' | 'ephemeral', payload)
    ├── streams 适配器: 在 'socket.io' Redis 流上 XADD
    │   (MAXLEN ~ 50000，由 Redis 自动修剪)
    └── 每个副本的 XREAD 循环拾取条目
        └── 传递给匹配房间集的本地套接字
            (在 emit 之前断开连接的套接字会错过它；客户端
             会回退到 apiSocket onReconnected → REST 重新获取)
```

`eventRouter` 使用的房间：

```
.
├── user:<userId>                              用户的所有套接字
├── user:<userId>:user-scoped                  只有 web/桌面客户端
├── user:<userId>:session:<sessionId>          会话范围的订阅者
└── user:<userId>:machine:<machineId>          一个特定的机器
```

## 代码位置

```
.
├── packages/happy-server/sources/app/
│   ├── api/socket.ts                      io.Server 设置，在设置 REDIS_URL
│   │                                       时附加流适配器，注释掉的
│   │                                       connectionStateRecovery
│   ├── api/socket/rpcHandler.ts           整个 RPC 路由层
│   │                                       (~180 行，单代码路径)
│   ├── api/socket/machineUpdateHandler.ts 不再触及 RPC 状态
│   ├── api/socket/sessionUpdateHandler.ts 不再触及 RPC 状态
│   └── events/eventRouter.ts              通过房间广播发出
│
└── packages/happy-server/deploy/handy.yaml  k8s Deployment + Service
                                             (此 PR 中 replicas: 1)
```

## 之前的问题（四个 bug）

之前的尝试将 RPC 路由状态存储为 `rpc:user:<u>:method:<m>` → socketId Redis 键，带有 60 秒的 TTL，通过 `machine-alive` / `session-alive` 心跳刷新。这有三个致命 bug（确凿证据是 #3）：

```
.
├── #1  目标 pod 死亡时，正在进行的 RPC 会消耗完整的 30 秒超时
│       io.to(deadSocketId).emitWithAck() 没有快速失败。
│       修复：在线状态轮询在约 1 秒内中止
│
├── #2  重连竞争
│       在守护进程的断开连接清理和重新注册之间，约 5-7% 的
│       跨 pod RPC 会失败，出现"方法不可用"（键已删除）
│       或"目标不可达"（键仍然指向死亡的 socketId）。
│       修复：原子 socket.join / 断开连接时自动离开，无竞争窗口
│
├── #3  静默 TTL 过期
│       守护进程保持连接，但如果由于任何原因错过了保持活动事件，
│       注册会在 60 秒后消失。守护进程永远不知道；
│       保持损坏状态直到重连。
│       修复：不再存在 TTL
│
└── #4  流适配器"无限增长"
        误报。适配器在每次 XADD 时使用 MAXLEN ~ 修剪。
        上限约为 50k 条目。从此列表中划掉。
```

带有复现命令的完整事后分析在 `deploy/integration-tests/POSTMORTEM.md`。

## 我们如何测试它

本地 minikube，带有 2 副本 handy-server、Redis、Postgres，通过 `minikube tunnel` 暴露为真实的 `LoadBalancer` 服务。所有测试工具都在 `deploy/integration-tests/` 中。

```
.
├── test-rpc-cross-replica.mjs   稳态跨 pod RPC
│                                 (50 并行 + 20 顺序)
├── test-multiprocess.mjs        广播扇出 + pod-kill 恢复
├── hammer.mjs <scenario>        pod-kill-mid-rpc、reconnect-storm、
│                                 ttl-expiry、brief-disconnect、
│                                 long-disconnect
├── network-loss.mjs             带有摘要的长时间运行 RPC 循环，
│                                 可与 iptables 停电一起使用
├── missed-events.mjs            短暂断开 → 触发广播 →
│                                 重连；验证错过的事件
│                                 行为匹配 main（从 socket 丢失，
│                                 通过 REST 重新获取恢复）
├── probe-rpc.mjs                直接 rpc-register 健全性探测 +
│                                 Redis 键检查器
├── probe-fetchsockets.mjs       fetchSockets 延迟探测
├── POSTMORTEM.md                逐 bug 完整分析
└── ../local.sh                  启动整个 minikube 堆栈
```

从头开始启动测试环境：

```bash
deploy/local.sh                                        # 配置堆栈
kubectl get pods -l app=handy-server                   # 确认 2 个副本
kubectl patch svc handy-server -p '{"spec":{"type":"LoadBalancer"}}'
minikube tunnel &                                      # 暴露 :3000
node deploy/integration-tests/test-rpc-cross-replica.mjs
```

针对修复的最终测试结果：

```
.
├── 稳态跨 pod RPC          50/50 + 20/20 ✅（约 5 秒预热后）
├── pod-kill-mid-rpc                    1612ms 快速失败 ✅（之前是 30000ms）
├── brief-disconnect                    2011ms 内成功 ✅
├── long-disconnect                     有界 10542ms ✅（10s 宽限 + ~0.5s）
├── ttl-expiry（确凿证据）            所有 5 次调用通过 +75s ✅
├── reconnect-storm（5 个循环）          96-97% 成功 ✅（只有固有
│                                         的正在进行失败，约 3%）
├── broadcast multi-process             20/20 扇出，5/5 不受影响 ✅
├── network-loss 60s 循环               85/85 零失败 ✅
└── missed-events parity                通过 socket 丢失事件，在 DB 中，
                                        已恢复=undefined ✅（匹配 main）
```

## 可调常量

```
RPC_RECONNECT_GRACE_MS        10_000   等待重连窗口（2× 心跳）
RPC_RECONNECT_POLL_MS            200   宽限期内的轮询节奏
RPC_PRESENCE_POLL_MS           1_000   进行中期间的在线状态轮询节奏
RPC_PRESENCE_FETCH_TIMEOUT_MS    500   每次调用跨副本 fetchSockets 上限
RPC_CALL_TIMEOUT_MS           30_000   emitWithAck 上限 — 与 main 相同
                                       （两者都不支持 >30s RPC）
```

## 值得了解的适配器细节和限制

```
.
├── streams 适配器发现
│   pod 启动后约 5s，适配器的心跳交换意味着
│   跨副本 fetchSockets() 可能看不到所有房间。
│   首次推出后的前几个 RPC 可能会命中等待重连
│   宽限期；我们将 RPC_RECONNECT_GRACE_MS 设置为 10s，以覆盖 2 个心跳
│   周期。
│
├── MAXLEN ~ 50000
│   在 socket.ts 中配置。每次 XADD 自动修剪，无需清理。
│
├── fetchSockets() 跨副本
│   默认每个请求有 5 秒超时。我们为在线状态轮询传递 timeout(500)，
│   这样单个无响应副本不会使每个轮询停滞 5 秒。
│
├── 从 RemoteSocket emitWithAck
│   通过集群适配器跨副本工作（流适配器
│   继承 ClusterAdapterWithHeartbeat，它实现 BROADCAST_ACK
│   和 FETCH_SOCKETS_RESPONSE）。
│
└── 同一 RPC 房间中的多个套接字
    实际上不应该发生（每台机器一个守护进程，一个方法
    注册）。如果发生，我们记录警告并选择 targets[0]。
    与之前的 Redis 最后写入获胜行为具有相同的影响范围。
```

## 我们仍然不做的事情（有意，推迟）

```
.
├── connectionStateRecovery
│   在 socket.ts 中注释掉。启用它会让短暂断开
│   跳过繁重的 REST 重新获取（事件通过流适配器
│   通过 restoreSession 重放）。已验证有效——未发布以
│   在这个维度上保持与 main 的一致性。
│
├── 守护进程重连期间正在进行的 RPC 连续性
│   与上述耦合。启用 connectionStateRecovery AND
│   恢复感知的在线状态轮询（即"等待 N 秒让相同的
│   socketId 回来再失败"），正在进行的 RPC 可以
│   在守护进程上经受短暂的网络波动：守护进程的处理程序
│   保持运行，ack 包坐在客户端的 sendBuffer 中，
│   重连刷新它，调用者得到结果。今天，在线状态
│   轮询一旦房间为空就会快速失败调用，这会杀死
│   这种情况。此 PR 范围外。
│
├── LB 上的用户亲和路由
│   通过流适配器的跨 pod RPC 开销约为 3-6ms。JWT 感知
│   路由（Envoy / Istio / nginx-lua）将是比修复本身
│   更大的基础设施更改。作为未来工作跟踪。
│
├── UI "重连中…" 指示器
│   服务器现在等待守护进程 10 秒。客户端尚未在
│   UI 中显示该等待。apiSocket 端更改，与此 PR 分开。
│
├── 调整适配器发现窗口
│   5s 是流适配器的默认 heartbeatInterval。降低它
│   会减少新 pod 启动竞争，但会增加 Redis 通信。
│
└── 长时间运行的 RPC（> 30s）
    main 或此 PR 都不支持。CLI 中的 Bash 命令有
│   自己的 30s 上限，与服务器的 30s emit 超时正好竞争。
    提升需要服务器和（可能添加的）客户端
    超时。
```

## 参考

- Socket.IO 房间：<https://socket.io/docs/v4/rooms/>
- `fetchSockets()`：<https://socket.io/docs/v4/server-api/#serverfetchsockets>
- 广播事件：<https://socket.io/docs/v4/broadcasting-events/>
- 内存使用：<https://socket.io/docs/v4/memory-usage/>
- 流适配器源：<https://github.com/socketio/socket.io-redis-streams-adapter>
- 连接状态恢复：<https://socket.io/docs/v4/connection-state-recovery>
- 讨论 #5062（广播 emitWithAck 等待所有）：<https://github.com/socketio/socket.io/discussions/5062>
