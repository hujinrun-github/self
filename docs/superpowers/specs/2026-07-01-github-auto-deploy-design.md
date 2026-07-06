# Portfolio GitHub 自动部署方案

## 背景

`all_note` 已经有一套稳定的自动部署骨架：

- GitHub Actions 在主分支 push 后触发
- Workflow 通过 `appleboy/ssh-action` 登录腾讯云主机
- 远端仓库目录执行 `git fetch` 和 `git reset --hard`
- 远端写入 `.env`
- 远端执行 `docker compose build` 和 `docker compose up -d --remove-orphans --wait`
- PostgreSQL 与 MinIO 作为外部基础设施长期存在，不跟应用容器一起创建

本项目希望复用同一台线上机器、同一组 PostgreSQL/MinIO 服务地址、以及相同的 GitHub Actions 发布骨架，但当前项目与 `all_note` 有几个关键差异：

- 本项目是单体 Go 服务，`D:\MyGitProject\self\cmd\server\main.go` 同时提供 API、后台页面、公开页面和静态资源
- 前端产物必须先构建到 `web/dist`，然后由 Go 服务一起提供，见 `D:\MyGitProject\self\README.md`
- 当前仓库还没有根级 `Dockerfile`、`docker-compose.yml` 和 `.github/workflows`
- 当前应用启动时会自动执行数据库迁移，见 `D:\MyGitProject\self\internal\db\db.go`
- 当前 MinIO client 只做 endpoint/credential 解析和 client 构造，不会在创建时验证 bucket 是否存在或权限是否正确，见 `D:\MyGitProject\self\internal\media\blobstore_minio.go`
- 当前路由与前端资源按站点根路径设计，不适合第一版直接照搬 `all_note` 的 `/all-note/` 子路径发布模型

## 目标

为本项目设计一套与 `all_note` 风格一致、但适配当前代码结构的 GitHub 自动部署方案，满足：

- 复用 `all_note` 的 GitHub Actions + SSH + Docker Compose 发布骨架
- 复用同一台线上机器、同一 PostgreSQL 主机、同一 MinIO Endpoint
- 应用目录、数据库、Bucket、挂载目录、凭据权限必须与 `all_note` 隔离
- 发布流程具备 CI gate、迁移前备份、健康检查与明确回滚分支
- 支持当前项目的中文主后台、多语言内容、Markdown 导入与 MinIO 混合媒体模式

## 当前约束

### 1. 本项目当前是根路径应用

`all_note` 目前公开入口是子路径形式，例如：

- `https://tylerhu-1.king-shiner.ts.net/all-note/`
- `https://tylerhu-1.king-shiner.ts.net/all-note-test/`

它能这样发布，是因为前端构建和路由已经支持 base path。

本项目当前还不具备这层能力：

- `web/vite.config.ts` 没有 `base`
- React Router 没有 `basename`
- 公共路由、后台路由和跳转都直接写死根路径，如 `/zh`、`/admin/login`、`/api/*`

因此第一版部署方案默认采用根路径入口，不直接挂到 `/portfolio/` 这种子路径。如果未来必须通过 Tailscale Funnel 子路径发布，需要单独补一轮“子路径部署兼容”改造。

### 2. 应用启动时会自动迁移数据库

当前 `db.Open(...)` 在连接 PostgreSQL 后会直接调用 `Migrate(database)`。这意味着：

- 任何带 schema 变更的版本一旦启动，就可能把数据库推进到新 schema
- 仅靠 `git reset --hard <last-good-commit>` 回滚代码并不总是安全
- 部署方案必须区分“普通发布”和“带迁移发布”

### 3. 混合媒体模式同时依赖 MinIO 与本地挂载目录

当前项目媒体策略不是纯对象存储：

- `MEDIA_BLOB_BACKEND=hybrid` 时，Markdown 导入媒体走 MinIO
- 传统图片派生文件与部分兼容路径仍依赖 `UPLOADS_DIR`
- 临时处理文件仍依赖 `PRIVATE_UPLOADS_DIR`

因此线上部署既要配置 MinIO，也要为容器挂载独立的持久化本地目录。

## 总体部署架构

### 部署形态

沿用 `all_note` 的发布方式，但服务形态改为“单容器应用”：

1. GitHub Actions 在 `main` 分支 push 后触发
2. 先执行 CI gate
3. 通过 SSH 登录线上机器
4. 进入本项目远端目录，拉取并切换到通过 CI 的具体 commit SHA
5. 生成 `.env`
6. 在 `hybrid` 模式下先做 MinIO preflight
7. 对“带迁移发布”先做数据库备份
8. 执行 `docker compose build`
9. 执行 `docker compose up -d --remove-orphans --wait` 或降级轮询方案
10. 通过健康检查确认发布成功

### 为什么不拆成 frontend/backend 两个容器

`all_note` 的前后端是分离的，因此需要两个服务。

本项目不适合这样拆。当前 Go 服务运行时需要：

- 提供 API
- 提供后台页面
- 提供公开页面
- 读取 `web/dist`
- 提供 `/uploads/*`
- 提供 `/media/*`

因此最合适的线上形态是：

- 一个应用镜像
- 一个 `docker-compose.yml` 中的 `portfolio-app` 服务

这样可以减少一层静态资源同步与反向代理复杂度。

## 线上资源规划

### 主机与基础设施

与 `all_note` 一致：

- 线上主机：同一台腾讯云机器
- PostgreSQL 主机：`119.91.114.203:19588`
- MinIO Endpoint：`http://119.91.114.203:19000`

### 应用目录

延续 `all_note` 的做法，不把真实绝对路径写死到仓库里，而是通过 GitHub Environment Secrets/Variables 注入。

建议目录结构：

```text
<same-parent-as-all_note>/
  all_note/
  self/
    .env
    docker-compose.yml
    runtime/
      uploads/
      private_uploads/
      backups/
```

这里的 `same-parent-as-all_note` 表示与 `all_note` 同级，不是共用目录。

### 端口规划

同机部署需要把端口规划写死，不能只留默认值。

建议正式端口分配：

- `all_note`：保留现有 `4200/4201`
- `self`：正式使用 `4300`

本项目是单容器对外单端口模型，因此：

- 宿主机端口：`4300`
- 容器内端口：`8080`

部署前必须执行端口占用检查，并把分配结果写进运维记录。建议远端 preflight 增加：

检查规则不能简单理解成“4300 必须空闲”，否则第二次部署会被当前 `portfolio-app` 自己占用的端口误伤。

正确规则是：

- 如果 `4300` 当前未被占用，允许继续
- 如果 `4300` 被当前已存在的 `portfolio-app` 容器占用，允许继续
- 如果 `4300` 被其他容器或非本项目进程占用，阻断部署

建议远端 preflight 逻辑先查询：

- `docker ps --filter name=^/portfolio-app$`
- 再结合 `ss -ltnp` 或 `lsof -iTCP:4300 -sTCP:LISTEN`

只有当端口持有者不是当前项目容器时才报错。

### 数据与存储隔离

建议线上应用配置：

```env
DATABASE_URL=postgres://portfolio_app:<password>@119.91.114.203:19588/portfolio?sslmode=disable
MEDIA_BLOB_BACKEND=hybrid
MINIO_ENDPOINT=http://119.91.114.203:19000
MINIO_BUCKET=portfolio-media
UPLOADS_DIR=/app/data/uploads
PRIVATE_UPLOADS_DIR=/app/data/private_uploads
```

说明：

- PostgreSQL 复用同一主机，但使用独立数据库 `portfolio`
- 建议使用独立数据库用户 `portfolio_app`，不要直接用 `postgres`
- MinIO 复用同一 Endpoint，但使用独立 Bucket `portfolio-media`
- `uploads` 与 `private_uploads` 使用独立挂载目录

## 首次上线前的基础资源准备

这部分必须先完成，不能等第一次自动部署时临场创建。

### 1. PostgreSQL 资源创建

建议使用独立数据库用户与独立数据库：

```sql
CREATE ROLE portfolio_app LOGIN PASSWORD '<strong-password>';
CREATE DATABASE portfolio OWNER portfolio_app;
```

如果安全策略要求更细粒度权限，也可以改成：

- 由管理员创建 `portfolio`
- 授予 `portfolio_app` 该库的连接和对象所有权

首次上线前必须验证：

- `portfolio_app` 能连接 `portfolio`
- 应用迁移用户对目标 schema 拥有创建与修改权限

验证方式示例：

```bash
psql 'postgres://portfolio_app:<password>@119.91.114.203:19588/portfolio?sslmode=disable' -c 'select 1'
```

### 2. MinIO 资源创建

独立 Bucket 不等于权限隔离。不能复用能访问 `all_note` 桶的高权限 MinIO 账号。

上线前必须准备：

- 独立 Bucket：`portfolio-media`
- 独立 access key / secret key
- 仅限 `portfolio-media` 的 bucket policy

建议权限范围只允许：

- `s3:ListBucket` 作用于 `portfolio-media`
- `s3:GetObject`
- `s3:PutObject`
- `s3:DeleteObject`

对象范围限定为：

- `arn:aws:s3:::portfolio-media`
- `arn:aws:s3:::portfolio-media/*`

如果当前 MinIO 管理方式支持 service account，则优先为本项目创建独立 service account；如果只支持用户级 access key，也必须确保该 key 只绑定到 `portfolio-media` 的最小权限策略。

首次上线前必须验证：

- 可以列 bucket
- 可以写入临时对象
- 可以读取临时对象
- 不能读取或写入 `all_note` 使用的桶

除此之外，部署与应用启动时在 `MEDIA_BLOB_BACKEND=hybrid` 下都必须做一次 MinIO preflight，至少包括：

- `ListBucket` 或同等级 bucket 可访问性检查
- 对 `portfolio-media/_healthchecks/` 下临时对象执行一次写入
- 立即读取该对象
- 立即删除该对象

如果 bucket 不存在、凭据权限不足、或读写校验失败，则：

- 启动 preflight 必须让应用启动失败
- 部署 preflight 必须阻断发布

### 3. 宿主机目录准备

首次上线前创建：

```bash
mkdir -p "$APP_DIR/runtime/uploads"
mkdir -p "$APP_DIR/runtime/private_uploads"
mkdir -p "$APP_DIR/runtime/backups"
```

并确认运行用户对这些目录有读写权限。

## 容器化设计

### 根级 `Dockerfile`

建议新增根级多阶段 `Dockerfile`：

第一阶段：

- 基于 Node 构建 `web/dist`

第二阶段：

- 基于 Go 构建 `cmd/server`

第三阶段：

- 运行镜像明确采用 `alpine`，并显式安装健康检查所需工具

推荐运行时能力：

- `ca-certificates`
- `tzdata`
- `wget`

这里不建议第一版直接用 `distroless` 或 `scratch`，因为当前 compose 健康检查示例依赖 `wget`。如果未来改成无 shell 运行镜像，则需要同步把健康检查切换为应用内置的自检命令或 Docker `HEALTHCHECK` 另一种实现。

### 根级 `docker-compose.yml`

建议只保留一个服务，例如 `portfolio-app`：

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: portfolio-app
    restart: unless-stopped
    env_file:
      - .env
    ports:
      - "${PORTFOLIO_PORT_HOST:-4300}:8080"
    volumes:
      - ./runtime/uploads:/app/data/uploads
      - ./runtime/private_uploads:/app/data/private_uploads
      - ./runtime/backups:/app/backups
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 20
```

## 健康检查设计

当前仓库没有现成的 `/api/health`，但自动部署需要它。

建议新增：

- `GET /api/health`

最低要求：

- 返回 `200 OK`
- 返回 JSON 或纯文本，不返回 HTML
- 不经过 admin 鉴权
- 注册在 SPA fallback 之前，不能被 `/*` catch-all 吃掉
- 响应体包含 `status=ok`
- 做一次数据库 ping

当 `MEDIA_BLOB_BACKEND=hybrid` 时，还必须把 MinIO 可用性纳入健康判断。推荐两层检查：

1. 启动或部署 preflight 执行一次完整的 bucket 访问校验与临时对象读写删校验
2. `/api/health` 在运行时返回当前 MinIO 状态；如果启动 preflight 未成功，或运行时 bucket 访问已失效，则返回非 200

为了避免把临时对象写入放到每一次健康请求上，`/api/health` 可以读取最近一次成功 preflight 的结果，或执行一个较轻量的 `ListBucket` / bucket metadata 检查，但它不能在 `hybrid` 模式下完全忽略 MinIO

为了与 compose 保持一致，第一版健康检查方案采用：

- 应用 HTTP 路由 `/api/health`
- 容器内 `wget` 发起本地探活

如果以后把运行镜像改成不含 `wget` 的精简镜像，则必须一起改健康检查实现，不能只改镜像不改 compose。

## GitHub Actions 设计

### 触发规则

建议：

- `push` 到 `main`
- `workflow_dispatch`

相对 `all_note` 当前绑定 `master`，本项目应绑定 `main`，因为当前仓库默认主分支是 `main`。

### GitHub Environment

建议专门创建：

- `portfolio-production`

这样可以把本项目的发布 Secrets、审批规则和环境变量与 `all_note` 分开。

### Secret / Variable 命名

基础设施级共享变量可以延续通用命名，但应放在 `portfolio-production` 环境里，不要在多个项目间裸共享。

例如可以继续使用：

- `SERVER_HOST`
- `SERVER_PORT`
- `SERVER_USER`
- `SERVER_SSH_KEY`
- `POSTGRES_HOST`
- `POSTGRES_PORT`
- `MINIO_ENDPOINT`

项目专属变量建议加 `PORTFOLIO_` 前缀，避免和 `all_note` 混用：

- `PORTFOLIO_APP_DIR`
- `PORTFOLIO_DATABASE_URL`
- `PORTFOLIO_DB_USER`
- `PORTFOLIO_DB_PASSWORD`
- `PORTFOLIO_MINIO_ACCESS_KEY`
- `PORTFOLIO_MINIO_SECRET_KEY`
- `PORTFOLIO_MINIO_BUCKET`
- `PORTFOLIO_APP_ORIGIN`
- `PORTFOLIO_APP_ORIGINS`
- `PORTFOLIO_PUBLIC_BASE_URL`
- `PORTFOLIO_SITE_NAME`
- `PORTFOLIO_ADMIN_EMAIL`
- `PORTFOLIO_ADMIN_PASSWORD`
- `PORTFOLIO_SESSION_SECRET`
- `PORTFOLIO_MEDIA_BLOB_BACKEND`
- `PORTFOLIO_TRANSLATION_PROVIDER`
- `PORTFOLIO_TRANSLATION_API_KEY`
- `PORTFOLIO_TRANSLATION_BASE_URL`
- `PORTFOLIO_TRANSLATION_MODEL`
- `PORTFOLIO_TRANSLATION_TIMEOUT_SECONDS`
- `PORTFOLIO_PORT_HOST`

### CI Gate

当前设计不能只做“SSH 上去构建再拉起”。在进入远端部署前，必须先跑 CI gate。

建议 workflow 结构分成两个 job：

1. `ci`
2. `deploy`

`deploy` 必须依赖 `ci` 成功后才允许执行。

CI gate 建议使用当前仓库已知可行的验证命令：

```bash
go test ./cmd/server ./internal/config ./internal/db ./internal/httpserver ./internal/auth ./internal/site ./internal/profile ./internal/content ./internal/media ./internal/backup ./cmd/migrate-sqlite-to-postgres -count=1
npm --prefix web test -- --run
npm --prefix web run build
```

为了支持 Go 测试中的 PostgreSQL 用例，CI job 建议带一个 GitHub Actions postgres service，并设置：

```env
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres?sslmode=disable
```

### Deploy Job

`deploy` job 的整体顺序建议是：

1. 校验 GitHub Environment Secrets / Variables 是否齐全
2. 通过 SSH 登录线上机器
3. `cd "$PORTFOLIO_APP_DIR"`
4. `git fetch --all --tags --prune`
5. `git checkout --detach "$GITHUB_SHA"` 或等价的 SHA pin 方式
6. 执行端口占用检查
7. 检查 `docker compose` 是否支持 `--wait`
8. 确保 `runtime/uploads`、`runtime/private_uploads`、`runtime/backups` 存在
9. 写 `.env`
10. 如果是 `hybrid` 模式，先做 MinIO preflight
11. 如果是“带迁移发布”，先做数据库备份
12. `docker compose config`
13. `docker compose build`
14. 如果远端 `docker compose` 支持 `--wait`，则执行 `docker compose up -d --remove-orphans --wait`
15. 如果远端 `docker compose` 不支持 `--wait`，则降级为 `docker compose up -d --remove-orphans`，然后循环探测 `/api/health`
16. 输出 `docker compose ps`
17. 输出最近容器日志摘要
18. 清理旧镜像

这里的关键点是：远端不能只 reset 到 `origin/main`。部署目标必须 pin 到 GitHub Actions 当前这次已经通过 CI 的具体 `GITHUB_SHA`，避免 CI 通过后 `main` 又进入新提交，导致远端实际部署的不是刚才验证过的版本。

### Release Type 判定

部署流程必须明确知道本次是 `app-only` 还是 `migration`，不能靠人工口头约定。

v1 采用“双机制”：

1. 自动检测
2. 手动覆盖

自动检测规则：

- 远端在切换前记录当前已部署 SHA，例如 `CURRENT_DEPLOYED_SHA="$(git rev-parse HEAD)"`
- 比较 `CURRENT_DEPLOYED_SHA..GITHUB_SHA` 之间是否改动了 `internal/db/migrations/*.sql`
- 如果有改动，则本次发布自动判定为 `migration`
- 如果没有改动，则默认判定为 `app-only`

手动覆盖规则：

- `workflow_dispatch` 必须允许显式输入 `release_type`
- 可选值：`auto`、`app-only`、`migration`
- 默认值：`auto`

冲突处理规则：

- `auto` 时按文件差异自动判定
- 手动指定 `migration` 时，即使没有 migration 文件变更，也走迁移发布流程
- 手动指定 `app-only` 时，如果 diff 中包含 `internal/db/migrations/*.sql` 变更，则 workflow 必须拒绝执行，防止错误降级

首次部署规则：

- 如果远端还没有已部署 SHA，首次上线一律按 `migration` 处理

### `docker compose --wait` 兼容性

部署流程不能盲目假设远端 Docker Compose 一定支持 `--wait`。

远端 preflight 必须验证：

- `docker compose up --help` 或等效能力检查中存在 `--wait`

如果支持：

- 使用 `docker compose up -d --remove-orphans --wait`

如果不支持：

- 改为 `docker compose up -d --remove-orphans`
- 然后通过循环请求 `http://127.0.0.1:${PORTFOLIO_PORT_HOST}/api/health`，或在容器内执行 `wget`，直到成功或超时

## 数据库迁移与回滚策略

这是本方案相对上一版最重要的补充。

### 发布类型划分

部署必须区分两类：

1. `app-only` 发布
2. `migration` 发布

`app-only` 发布：

- 不新增、不修改、不删除数据库 schema
- 回滚可优先走应用代码回滚

`migration` 发布：

- 包含任何数据库 schema 变化
- 必须进入“带迁移发布”流程

### 运行用户权限取舍

当前应用启动时会自动执行迁移，因此 v1 必须明确接受一个现实取舍：

- 运行用户 `portfolio_app` 需要拥有应用启动所需的 DDL 权限

也就是说，v1 不追求“运行用户最小权限 + 独立 migration role”这套更复杂模型，因为当前代码里还没有独立 migration 命令或单独 migration job。

结论是：

- v1：接受 `portfolio_app` 具备启动迁移所需权限
- 未来如果要进一步收紧权限，必须先把迁移从应用启动路径中拆出来，改成独立 migration role + 独立 migration step

### 迁移兼容原则

第一版部署策略必须遵守 expand-contract 原则：

- 优先新增列、表、索引
- 避免在同一发布中直接删除列、删除表、重命名字段
- 避免在同一发布中让旧版本应用完全无法读取新 schema

最低要求是：

- 新 schema 发布后，上一版应用至少还能启动并完成基本只读或回退动作

如果某次迁移做不到这一点，该次发布就不能被视为普通自动发布，而必须走人工值守发布和专项回滚预案。

### 带迁移发布的备份要求

只要发布包含 schema 变更，部署前必须备份。

并且备份不能在旧应用继续接受写入的情况下进行。否则一旦后续用备份恢复，备份之后到新版本启动之前这段窗口内的数据会丢失。

因此 v1 的 `migration` 发布必须进入维护窗口，并冻结写入。

由于当前项目还没有现成的维护模式页面或只读开关，v1 选择最直接的策略：

1. 停止当前 `portfolio-app` 容器
2. 确认应用已不再接受后台写入
3. 立即执行数据库备份
4. 执行新版本部署

这个取舍带来的影响是：

- `migration` 发布会产生一次明确的短时停机
- 但可以把数据库层面的 RPO 压到 0，避免“备份成功但中间窗口写入丢失”

如果未来需要无停机或更平滑的迁移发布，再单独设计维护模式、只读模式或双阶段迁移方案。

最低备份要求：

- 一份 schema-only 备份

推荐备份要求：

- 一份 schema-only 备份
- 一份完整 `pg_dump -Fc` 自定义格式备份

执行备份前必须先确认备份执行器可用。支持两种路径：

1. 宿主机已安装 PostgreSQL client，且 `pg_dump` 在 `PATH` 中
2. 使用临时 PostgreSQL client 容器执行 `pg_dump`

如果两种路径都不可用，则：

- 带迁移发布必须直接失败
- 不能跳过备份继续发布

建议备份命名包含 commit SHA 与时间戳，例如：

```text
runtime/backups/2026-07-01T210000Z-<sha>-schema.sql
runtime/backups/2026-07-01T210000Z-<sha>-full.dump
```

推荐优先避免在命令行参数中直接暴露完整数据库 URL，尤其不要把带密码的 URL 原样 `echo` 到日志里。优先使用：

- `PGPASSWORD`
- `.pgpass`
- 或受控的 PostgreSQL service file

示例命令：

```bash
PGPASSWORD="$PORTFOLIO_DB_PASSWORD" \
  pg_dump -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$PORTFOLIO_DB_USER" -d portfolio --schema-only \
  > "runtime/backups/${STAMP}-${SHA}-schema.sql"

PGPASSWORD="$PORTFOLIO_DB_PASSWORD" \
  pg_dump -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$PORTFOLIO_DB_USER" -d portfolio -Fc \
  > "runtime/backups/${STAMP}-${SHA}-full.dump"
```

如果宿主机没有 `pg_dump`，则可以退回到临时 client 容器，例如：

```bash
docker run --rm \
  -e PGPASSWORD="$PORTFOLIO_DB_PASSWORD" \
  -e POSTGRES_HOST="$POSTGRES_HOST" \
  -e POSTGRES_PORT="$POSTGRES_PORT" \
  -e PORTFOLIO_DB_USER="$PORTFOLIO_DB_USER" \
  -e BACKUP_FILE="${STAMP}-${SHA}-full.dump" \
  -v "$PWD/runtime/backups:/backup" \
  postgres:16-alpine \
  sh -lc 'pg_dump -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$PORTFOLIO_DB_USER" -d portfolio -Fc > "/backup/$BACKUP_FILE"'
```

### 回滚分支

发布失败后的回滚不能只写成一条 `git reset --hard`。

必须分成两条路径：

#### 路径 A：应用回滚

适用于：

- 没有 schema 变更
- 或者 schema 变更向后兼容，旧代码仍能在新 schema 上启动

步骤：

1. `git reset --hard <last-good-commit>`
2. `docker compose build`
3. `docker compose up -d --remove-orphans --wait`

#### 路径 B：迁移发布回滚

适用于：

- 新版本迁移后，旧代码已不兼容新 schema
- 或者新迁移本身造成数据结构问题

步骤：

1. 进入维护窗口
2. 停止应用写入
3. 评估是否优先“向前修复”而不是数据库回滚
4. 如必须回滚数据库，则使用发布前生成的备份恢复
5. 恢复后再回滚或切换到兼容版本应用

结论是：带迁移发布的默认回滚策略优先是“向前修复”，数据库恢复是最后手段，且只能依赖部署前备份。

## 推荐的 `.env` 目标内容

```env
APP_ORIGIN=https://<portfolio-origin>
APP_ORIGINS=https://<portfolio-origin>
PUBLIC_BASE_URL=https://<portfolio-origin>
SITE_NAME=Portfolio
ADMIN_EMAIL=<admin-email>
ADMIN_PASSWORD=<bootstrap-password>
SESSION_SECRET=<32+-char-secret>
DATABASE_URL=postgres://portfolio_app:<password>@119.91.114.203:19588/portfolio?sslmode=disable
UPLOADS_DIR=/app/data/uploads
PRIVATE_UPLOADS_DIR=/app/data/private_uploads
MEDIA_BLOB_BACKEND=hybrid
MINIO_ENDPOINT=http://119.91.114.203:19000
MINIO_ACCESS_KEY=<portfolio-minio-access-key>
MINIO_SECRET_KEY=<portfolio-minio-secret-key>
MINIO_BUCKET=portfolio-media
MINIO_USE_SSL=false
TRANSLATION_PROVIDER=deepseek
TRANSLATION_API_KEY=<deepseek-api-key>
TRANSLATION_BASE_URL=https://api.deepseek.com
TRANSLATION_MODEL=deepseek-v4-flash
TRANSLATION_TIMEOUT_SECONDS=30
PORT=8080
```

### `.env` 生成规则

GitHub Environment 中建议使用 `PORTFOLIO_*` 前缀变量，但应用运行时实际读取的是无前缀环境变量。

因此 workflow 必须做一层明确映射，例如：

- `PORTFOLIO_DATABASE_URL` -> `.env` 中的 `DATABASE_URL`
- `PORTFOLIO_APP_ORIGIN` -> `.env` 中的 `APP_ORIGIN`
- `PORTFOLIO_PUBLIC_BASE_URL` -> `.env` 中的 `PUBLIC_BASE_URL`
- `PORTFOLIO_MINIO_BUCKET` -> `.env` 中的 `MINIO_BUCKET`

`.env` 生成时必须满足：

- 使用 here-doc、受控模板或逐行安全写入
- 不能把 secret 原样 `echo` 到日志
- shell 必须关闭命令回显
- 生成后只输出脱敏检查结果，不输出明文值

可以接受的做法是把值重定向写入 `.env` 文件；不可接受的做法是先 `echo "$PORTFOLIO_DATABASE_URL"` 到控制台再重定向。

## 风险与注意事项

### 1. `ADMIN_PASSWORD` 只用于首个管理员引导

当前系统里，当 `admins` 表为空时，`ADMIN_EMAIL` 和 `ADMIN_PASSWORD` 用于首个管理员引导。后续再修改 `ADMIN_PASSWORD` 不会自动改密。

因此线上 `.env` 里的 `ADMIN_PASSWORD` 应视为 bootstrap 值，不应当成持续生效的登录密码管理方案。

### 2. `private_uploads` 不需要备份，但必须可写

`PRIVATE_UPLOADS_DIR` 不对外暴露，也不应纳入正式备份，但运行时必须可写，否则媒体处理和导入流程会失败。

### 3. `web/dist` 必须在镜像构建期生成

本项目运行时直接读取 `web/dist/index.html`。如果镜像里没有构建好的前端产物，服务会退回空壳 HTML，表现为“服务在线但页面不完整”。

### 4. 根路径与子路径问题不能忽略

如果未来必须挂到 `/portfolio/` 这样的子路径，必须先补前端与服务端的 base path 支持，不能只靠代理层硬切。

## 推荐实施顺序

1. 明确正式入口是根路径还是后续单独做子路径兼容
2. 创建 PostgreSQL 独立用户和数据库 `portfolio`
3. 创建 MinIO Bucket `portfolio-media`
4. 创建本项目专用 MinIO access key，并加 bucket policy 限制
5. 准备独立 `APP_DIR` 和 `runtime` 目录
6. 为本项目增加 `/api/health`
7. 增加根级 `Dockerfile`
8. 增加根级 `docker-compose.yml`
9. 增加 `.github/workflows/deploy.yml`
10. 在 GitHub 创建 `portfolio-production` Environment
11. 配置 `PORTFOLIO_*` Secrets / Variables
12. 为 CI job 配置 PostgreSQL service 与 `TEST_DATABASE_URL`
13. 首次手工 `docker compose up -d` 验证
14. 再开启 GitHub 自动部署

## 结论

本项目完全可以参照 `all_note` 做 GitHub 自动部署，但推荐采用“同一台机器 + 同一套发布骨架 + 独立数据库/独立 Bucket/独立凭据/独立挂载目录”的方式，而不是直接复制 `all_note` 的前后端双容器与子路径公开模式。

最稳妥的第一版落地方式是：

- GitHub Actions + SSH
- 远端 `docker compose build && up -d --wait`
- 单容器 Go 应用
- `portfolio-production` GitHub Environment
- PostgreSQL 使用独立库 `portfolio` 与独立用户 `portfolio_app`
- MinIO 使用同一 Endpoint 下的独立 Bucket `portfolio-media` 与专用 access key
- 发布前先过 CI gate
- 带迁移发布强制先备份，再进入单独回滚分支判断

如果后续确认必须走和 `all_note` 一样的 Tailscale 子路径发布，再单独补一轮“子路径部署兼容”改造即可。
