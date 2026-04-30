# 部署

本文档描述如何部署 Happy 后端（`packages/happy-server`）及其所需的基础设施。

## 运行时概述
- **应用服务器：** 运行 `tsx ./sources/main.ts` 的 Node.js（Fastify + Socket.IO）。
- **数据库：** 通过 Prisma 使用 Postgres。
- **缓存：** Redis（目前用于连接性和未来扩展）。
- **对象存储：** 用于用户上传资产的 S3 兼容存储（MinIO 可用）。
- **指标：** 可选的 Prometheus `/metrics` 服务器，在独立端口上运行。

## 所需服务
1. **Postgres**
   - 所有持久化数据所需。
   - 通过 `DATABASE_URL` 配置。

2. **Redis**
   - 启动时需要（调用 `redis.ping()`）。
   - 通过 `REDIS_URL` 配置。
   - 由此 repo 管理：`packages/happy-server/deploy/happy-redis.yaml`（StatefulSet + redis-exporter sidecar）。

3. **S3 兼容存储**
   - 用于头像和其他上传资产。
   - 通过 `S3_HOST`、`S3_PORT`、`S3_ACCESS_KEY`、`S3_SECRET_KEY`、`S3_BUCKET`、`S3_PUBLIC_URL`、`S3_USE_SSL` 配置。
   - **单独部署** — 不由此 repo 的 Kubernetes 清单管理。在生产中，`S3_PUBLIC_URL` 后面的 S3 兼容服务（MinIO 或类似）由外部基础设施配置和管理。应用仅通过环境变量使用它：`S3_PUBLIC_URL` 在 Deployment 中设置，凭证来自 Vault 通过 ExternalSecret（`/handy-files`）。
   - 如果未设置 `S3_HOST`，服务器回退到本地文件系统存储（`./data/files/`）。
   - 对于本地 k8s 开发，通过 `deploy/overlays/local/minio.yaml` 部署 MinIO pod。

## 环境变量
**必需**
- `DATABASE_URL`：Postgres 连接字符串。
- `HANDY_MASTER_SECRET`：用于认证令牌和服务器端加密的主密钥。
- `REDIS_URL`：Redis 连接字符串。
- `S3_HOST`、`S3_ACCESS_KEY`、`S3_SECRET_KEY`、`S3_BUCKET`、`S3_PUBLIC_URL`：对象存储配置。

**通用**
- `PORT`：API 服务器端口（默认 `3005`）。
- `METRICS_ENABLED`：设置为 `false` 以禁用指标服务器。
- `METRICS_PORT`：指标服务器端口（默认 `9090`）。
- `S3_PORT`：可选的 S3 端口。
- `S3_USE_SSL`：`true`/`false`（默认 `true`）。

**可选集成**
- GitHub OAuth/App：`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`、`GITHUB_APP_ID`、`GITHUB_PRIVATE_KEY`、`GITHUB_WEBHOOK_SECRET`，加上重定向 URL/URI。
  - `GITHUB_REDIRECT_URL` 由 OAuth 回调处理程序使用。
  - `GITHUB_REDIRECT_URI` 由 GitHub App 初始化器使用。
- 语音：`ELEVENLABS_API_KEY`（生产中 `/v1/voice/conversations` 所需）。
- 订阅：`REVENUECAT_API_KEY`（服务器端 RevenueCat 密钥，语音订阅检查所需）。
- 调试日志：`DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING`（启用文件日志 + 开发日志端点）。

## Docker 镜像
在 `Dockerfile.server` 提供了生产 Dockerfile。

关键说明：
- 服务器默认端口为 `3005`（在容器环境中显式设置 `PORT`）。
- 镜像包含用于媒体处理的 FFmpeg 和 Python。

## Kubernetes 清单
示例清单位于 `packages/happy-server/deploy`：
- `handy.yaml`：服务器的 Deployment + Service + ExternalSecrets。
- `happy-redis.yaml`：Redis StatefulSet + Service + ConfigMap。

部署配置期望：
- 端口 `9090` 上的 Prometheus 抓取注解。
- 由 ExternalSecrets 填充的名为 `handy-secrets` 的 secret。
- 将端口 `3000` 映射到容器端口 `3005` 的服务。

## 本地开发助手
服务器包包含本地基础设施的脚本：
- `pnpm --filter happy-server db`（Docker 中的 Postgres）
- `pnpm --filter happy-server redis`
- `pnpm --filter happy-server s3` + `s3:init`

在运行 `pnpm --filter happy-server dev` 时，使用 `.env`/`.env.dev` 加载本地设置。

## 实现参考
- 入口点：`packages/happy-server/sources/main.ts`
- Dockerfile：`Dockerfile.server`
- Kubernetes 清单：`packages/happy-server/deploy`
- 环境变量使用：`packages/happy-server/sources`（`rg -n "process.env"`）
