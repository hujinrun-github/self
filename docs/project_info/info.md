# 服务部署信息

> 最新状态（2026-10-02）：`portfolio-app` 已恢复 healthy，公网网站及健康接口正常。当前 MinIO 使用 `host.docker.internal:19000` 和 `portfolio-app` 桶；后文 2026-10-01 的失败记录为历史排查过程。

## 部署的IP以及连接方式：ssh ubuntu@119.91.114.203，密码：823717hjrLyj

## frps 服务（2026-10-01 更新）

- 部署机器：`119.91.114.203`，运行用户：`ubuntu`。
- 版本：`0.69.1`。
- 程序目录：`/home/ubuntu/frp_0.69.1_linux_amd64`。
- 配置文件：`/home/ubuntu/frp_0.69.1_linux_amd64/frps.toml`。
- 日志文件：`/home/ubuntu/frp_0.69.1_linux_amd64/nohup.out`。
- 启动方式：后台独立进程（沿用原 nohup 方式），没有注册 systemd 服务。
- 本次重启后的 PID：`1259060`，后续操作必须重新查询 PID，不能直接复用此值。

### 监听端口

| 端口 | 用途 |
| --- | --- |
| `7000` | frpc 接入端口 |
| `7500` | frps 管理面板（本次新增） |
| `19000` | MinIO 服务转发 |
| `19001` | MinIO 管理页面转发，与 frps 管理面板不同 |
| `19588` | PostgreSQL 转发 |
| `29000` | 已有业务转发，本次保持原状，具体业务用途未核实 |

### 管理面板

- 访问地址：<http://119.91.114.203:7500/>。
- 用户名：`admin`。
- 已生成独立强密码，保存在本机 `/Users/hujineun/.config/frps/119.91.114.203-dashboard-20261001-065342.txt`，文件权限为 `0600`；不在项目文档中记录密码。
- 服务端正式配置和备份的文件权限均为 `0600`。
- 生效配置如下，密码行仅展示占位说明，不可将占位值复制覆盖正式配置：

```toml
webServer.addr = "0.0.0.0"
webServer.port = 7500
webServer.user = "admin"
webServer.password = "<独立生成的密码>"
```

### 本次变更与验证

此前配置只有 `bindPort = 7000` 和 token 认证，缺少 `webServer` 配置，因此未启动管理面板监听。

本次保持原有 frpc token 和转发配置不变，补充管理面板配置，并在配置校验通过后重启 frps。

- 原配置备份：`/home/ubuntu/frp_0.69.1_linux_amd64/frps.toml.bak.20261001-065342`。
- `frps verify` 配置校验通过。
- 管理页面未认证返回 `401`，使用正确账号密码返回 `200`。
- 公网访问 `7500` 返回 `401`，确认端口已可达；本次未修改主机防火墙或云安全组。
- `7000、7500、19000、19001、19588、29000` 均已恢复监听。
- 管理 API 确认 `faster-whisper、minIO-server、minIO-web、postgre` 四个 TCP 代理均为 `online`。

### 维护说明

修改配置后先执行：

```bash
cd /home/ubuntu/frp_0.69.1_linux_amd64
./frps verify -c ./frps.toml
```

重启时先查询并核对当前 frps PID、程序目录和启动参数，再对该进程发送 `SIGTERM`，等待退出后启动。不要直接重复启动，避免端口冲突。重启会使现有转发连接短暂断开，随后由 frpc 重新连接。

```bash
cd /home/ubuntu/frp_0.69.1_linux_amd64
nohup ./frps -c ./frps.toml >> nohup.out 2>&1 < /dev/null &
```

如需回滚，先备份当前配置，再恢复上述原配置备份，并按相同方式重启和验证端口。原配置未启用管理面板，回滚后 `7500` 将关闭。


## portfolio-app 数据库修复（2026-10-01）

- 部署目录：`/home/ubuntu/apps/self`。
- 容器名称：`portfolio-app`；镜像：`self-portfolio-app`。
- 应用宿主端口：`4300`；配置文件：部署目录下的 `.env`。
- 数据库连接目标：`host.docker.internal:19588`，容器中映射到 `172.17.0.1`。
- 实际数据库名、用户名均为 `portfolio`，以容器 `DATABASE_URL` 为准。

### 已确认原因与处理

启动日志中的 `ping postgres: connection failed` 隐藏了原始 PostgreSQL 认证错误。经数据库系统目录核实，原先既没有 `portfolio` 角色，也没有 `portfolio` 数据库。

已使用获授权的数据库管理员连接，仅创建两个缺失对象：

- `portfolio` 登录角色：沿用应用现有 `DATABASE_URL` 中的密码，无超级用户、建角色、建库、复制或绕过行级安全权限。
- `portfolio` 数据库：所有者为 `portfolio`；以 `template0` 初始化，编码为 UTF8。

应用现有凭据已通过数据库连接验证，且对 `public` schema 有 USAGE、CREATE 权限。应用自动重试后完成 `001_initial` 至 `005_writing_engagement` 共 5 个迁移，当前有 26 张 public 表、1 个初始化管理员。未在本文记录数据库密码。

### 数据库修复后的 MinIO 阻塞（切换前）

数据库问题已解决，但 `portfolio-app` 尚未恢复健康。创建数据库后的新启动日志显示：

```text
put probe object: The request signature we calculated does not match the signature you provided. Check your key and signing method.
```

切换配置前阻塞在 MinIO 启动探针。目标为同一台部署机的 `19000` 端口，当时 bucket 为 `portfolio-media`。只读对比确认 `portfolio-app` 与 `flowspace-backend` 的 MinIO access key、secret key 相同，但这不足以证明服务端认可这些凭据，签名失败原因仍需继续核对。

本次没有修改 MinIO 配置或 Flowspace 数据；核验时 `flowspace-backend` 和 `flowspace-frontend` 均保持 healthy。仅完成数据库修复，不能据此认定整个 portfolio 服务恢复。


## 复用 Flowspace MinIO 配置（2026-10-01）

按用户要求，已将 `portfolio-app` 的 MinIO 配置同步为 `flowspace-backend` 的实际运行配置，并只重建 `portfolio-app`。

| portfolio 配置项 | 已生效的来源 / 值 |
| --- | --- |
| `MINIO_ENDPOINT` | Flowspace 的 `MINIO_ENDPOINT`：`http://119.91.114.203:19000` |
| `MINIO_ACCESS_KEY` | Flowspace 的 `MINIO_ACCESS_KEY`，不在本文记录值 |
| `MINIO_SECRET_KEY` | Flowspace 的 `MINIO_SECRET_KEY`，不在本文记录值 |
| `MINIO_BUCKET` | Flowspace 的 `FLOWSPACE_MINIO_BUCKET`：`flowspace` |
| `MINIO_USE_SSL` | `false`，与 HTTP 地址一致 |

Flowspace 容器中 `FLOWSPACE_MINIO_ENDPOINT`、`FLOWSPACE_MINIO_ACCESS_KEY`、`FLOWSPACE_MINIO_SECRET_KEY` 均为空，实际使用上述通用 `MINIO_*` 字段。两边 access key、secret key 在此次同步前就相同，本次实际改变了 endpoint 和 bucket。

- 修改文件：`/home/ubuntu/apps/self/.env`。
- 原配置备份：`/home/ubuntu/apps/self/.env.bak.minio-reuse.20261001-081050`。
- 重建后的容器 ID：`ee74207dce62`；后续应重新查询，不依赖此快照。
- 已核验容器实际 MinIO 环境变量与 Flowspace 一致，应用镜像及其他运行参数保持不变。

### 验证结果：配置已同步，服务尚未恢复

新容器启动时访问 `http://119.91.114.203:19000/flowspace/?location=` 超时，日志为 `context deadline exceeded`，随后自动重启；`4300/api/health` 尚不可用。

独立检查也确认：

- 从 `flowspace-backend` 容器内访问 `http://119.91.114.203:19000/minio/health/live` 超时。
- 经可达的 `127.0.0.1:19000`，用同一组 MinIO 凭据发送带签名的 bucket location 请求，返回 HTTP 403、`SignatureDoesNotMatch`。
- Flowspace 前后端容器仍显示 healthy、restart count 为 0；该状态不代表 MinIO 文件读写已验证成功。

因此仅复用 Flowspace 的现有配置尚不能解决问题；需要继续核对 MinIO 实际服务端配置及部署机访问公网 `19000` 的网络路径。本次没有修改 Flowspace 容器或 MinIO 服务端。


## MinIO 修复完成（2026-10-02）

已使用用户本轮提供的 MinIO 凭据，并将 bucket 改为 `portfolio-app`。公网 `119.91.114.203:19000` 从部署机访问仍超时，因此应用使用已验证可达的宿主网关地址。

### 当前生效配置

- `MINIO_ENDPOINT=http://host.docker.internal:19000`
- `MINIO_BUCKET=portfolio-app`
- `MINIO_USE_SSL=false`
- `MINIO_ACCESS_KEY`、`MINIO_SECRET_KEY` 已更新到部署机 `.env`，本文不记录凭据。
- 修改文件：`/home/ubuntu/apps/self/.env`，权限 `0600`。
- 切换前备份：`/home/ubuntu/apps/self/.env.bak.minio-working.20261002-150722`。
- 只重建 `portfolio-app`，保留原镜像及其他运行参数；当前容器 ID 为 `149066755cea`（仅作此次记录）。

### 已完成验证

1. 官方 MinIO `mc` 客户端在 `self_default` 网络中，通过 `host.docker.internal:19000` 成功访问 `portfolio-app` 桶。
2. 使用独立 UUID 探针对象，完成上传、下载内容比对、删除；删除后返回 `Object does not exist`。所有临时诊断容器均已清理。
3. 应用自身启动探针通过，日志出现 `serving jinrun-Portfolio on :8080`。
4. 容器 `running / healthy`，持续运行 189 秒后复查，重启计数仍为 `0`。
5. 部署机 `http://127.0.0.1:4300/api/health` 返回 `200` 和 `{"ok":true}`。
6. 公网 <https://self.jinrunlab.site/> 跳转到 `/zh` 后返回 `200`；<https://self.jinrunlab.site/api/health> 返回 `200` 和 `{"ok":true}`。
7. `flowspace-backend` 的容器 ID、配置未变；Flowspace 前后端仍为 healthy，重启计数为 `0`。本地未提交的应用代码未构建或部署。

此次通用 curl SigV4 探测曾返回 `SignatureDoesNotMatch`，但官方 `mc` 客户端和应用真实读写均成功。因此该通用探测结果不能单独作为本轮凭据无效的依据，验收以官方客户端、应用启动探针及健康接口为准。

### 后续自动部署配置

当前仓库 `.github/workflows/deploy.yml` 从 GitHub Variables 读取 `PORTFOLIO_MINIO_ENDPOINT`、`PORTFOLIO_MINIO_BUCKET`、`PORTFOLIO_MINIO_USE_SSL`，从 Secrets 读取 `PORTFOLIO_MINIO_ACCESS_KEY`、`PORTFOLIO_MINIO_SECRET_KEY`；部署脚本会据此重新生成 `.env`。

本次已更新部署机配置，未读取或修改 GitHub Variables / Secrets。下次自动部署前需核对这些来源与本次有效配置一致，避免再次写回旧值。


## 新代码发布完成（2026-10-02 15:45）

已将当前工作区的新代码部署到同一服务器，仅重建 `portfolio-app`，保留刚修好的数据库和 MinIO 配置。

- 发布版本：`portfolio-20261002-151738-af0d3fe8`。
- 当前容器：`3fdfc6f63545`；验收时 healthy，持续运行 768 秒，重启计数 0。
- 前端 208 项测试、后端 race 225 项测试通过；数据库迁移 006 已生效。
- 已完成线上登录、文章发布、阅读和点赞去重、评论审核公开、MinIO 写读删，以及真实浏览器手机与桌面布局验证。
- 临时文章、评论、点赞及访客数据均已清理；Flowspace 前后端保持原容器且健康。
- 本地和远端未提交改动均保留；源码快照及回滚备份位于 `/home/ubuntu/apps/self/runtime/releases/portfolio-20261002-151738-af0d3fe8`。
- 完整验收与回滚记录：[发布报告](deployments/20261002-151738/report.md)。
