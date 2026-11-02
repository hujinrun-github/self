# 服务部署信息

> 最新状态（2026-10-13 01:00）：后台 Markdown 所见即所得和单栏预览已放宽为接近全宽，仅保留 28–72px 自适应边距；全屏正文占满窗口，窄屏仍为 18px 边距，`portfolio-app` healthy。编辑区高度、全屏入口、手帐功能、Go 服务、数据库结构、Caddy 与 MinIO 保留。详见文末最新发布记录。

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

## 手帐功能发布完成（2026-10-03）

已按本文部署方式上线画布手帐，仅重建 `portfolio-app`。

- 前台：<https://self.jinrunlab.site/zh/journal>，无需账户登录，凭手帐本密码查看。
- 管理：<https://self.jinrunlab.site/admin/journal>，登录后台后直接查看和编辑。
- 新手帐本默认关闭公开展示；在管理端设置查看密码、公开标题并开启展示后，首页显示入口。
- 发布版本：`portfolio-20261003-003459-f4cb5414`；容器：`9ae7137de6fa`。
- 发布后 healthy、重启计数 0，数据库迁移 001–007 已应用，线上 13 项手帐权限及浏览器检查通过；临时数据和登录会话已清理。
- `.env`、MinIO 配置、4300 端口及数据挂载保持原样；Flowspace 前后端容器未变且健康。
- 发布前已保存完整数据库备份与旧镜像。源码快照和备份目录：`/home/ubuntu/apps/self/runtime/releases/portfolio-20261003-003459-f4cb5414`。
- 本地与远端工作区改动保留，未提交或推送 Git。
- 完整验收和回滚说明：[手帐部署报告](deployments/20261003-003459/report.md)。

## 手帐全屏与保存提示更新（2026-10-03 01:22）

- 画布支持全屏编辑、手机属性抽屉及 Esc 退出；全屏内直接保存。
- 点击保存后弹出明确结果；自动保存仍使用状态栏。
- 发布版本：`portfolio-journal-ui-20261003-011834-fccd7fe5`；容器：`e9ef0c76367c`，healthy、重启计数 0。
- 280 项前端测试、生产构建与修改范围 ESLint 通过；桌面、手机及线上浏览器验证通过。
- 本次仅更新前端，Go 二进制、数据库结构、访问权限及其他服务保持不变。
- 完整数据库及旧镜像备份已保留；[发布与回滚报告](deployments/20261003-011834/report.md)。

## 手帐筛选框样式更新（2026-10-03 01:37）

- 标签、心情筛选框改为等宽，自定义箭头与选中样式；日期高度对齐，窄屏自适应。
- 发布：`portfolio-journal-filter-20261003-013332-a7409602`；容器：`bb356d6328ed`，healthy、重启计数 0。
- 23 项页面测试、生产构建、修改范围 ESLint、桌面/手机及线上视觉检查通过。
- 仅更新前端，后端、数据库、权限及部署配置不变，旧镜像与完整数据库备份已保留。
- [部署与回滚记录](deployments/20261003-013332/report.md)。

## 手帐图片上传限制更新（2026-10-06 11:30）

- 手帐照片单张上限统一为 5 MB；前端选择超限文件时立即提示，服务端同时拒绝绕过前端的超限请求。
- 支持的 JPG、PNG、WebP 类型及 2000 万像素保护保持不变。
- 发布：`portfolio-journal-image-limit-20261006-112116-6b15ea55`；容器：`362663a64fd8`，healthy、重启计数 0。
- 281 项前端测试、生产构建、修改范围 ESLint、手帐后端 race 测试与真实 PostgreSQL 边界测试通过。
- 线上登录后实测：恰好 5 MB 上传成功，5 MB 多 1 字节返回 `Image must be at most 5 MB`；临时手帐本和图片已清理。
- `.env`、数据库结构、Caddy、MinIO、端口、挂载和远端工作区保持不变；Flowspace 前后端未重建且保持 healthy。
- 发布前完整数据库备份已验证，旧镜像回滚标签已保留；[部署与回滚记录](deployments/20261006-112116/report.md)。

## 手帐书页翻阅更新（2026-10-08 22:06）

- 解锁后点击“翻阅手帐”或打开记录，进入带纸张、书脊和页叠的书页阅读器；桌面双页、手机单页。
- 支持按钮、方向键和底部独立滑动翻页；画布可继续拖动、缩放。后台选定手帐本后也可直接翻阅和编辑当前页。
- 锁定、过期、前台验证和换本立即隐藏新旧书页；修复迟到会话和重叠验证竞态。
- 发布：`portfolio-journal-book-20261008-220224-cea21ecd`；容器：`02a309094438`，healthy、重启计数 0。
- 299 项前端测试、生产构建、修改范围 ESLint、桌面／手机浏览器及公网资源校验通过。
- 本次仅更新前端，5 MB 图片限制、Go 服务文件、数据库结构及原部署配置保留；Flowspace 前后端未重建且健康。
- 完整数据库备份已验证，旧镜像回滚标签已保留；[部署与回滚记录](deployments/20261008-220224/report.md)。

## 手帐全屏只读分享更新（2026-10-08 22:35）

- 后台、已保存记录和解锁后的前台新增“分享手帐”，可复制整本或指定起始页链接。
- 分享页为独立全屏只读书页，没有网站导航及编辑工具，支持桌面／手机翻页和浏览器全屏。
- 链接不包含密码或会话；接收者仍需查看密码。未开启展示、没有密码或已归档的本子不可分享；仅展示已保存内容。
- 发布：`portfolio-journal-share-20261008-223127-0ce90fc6`；容器：`31dd44efa002`，healthy、重启计数 0。
- 353 项前端测试、生产构建、修改范围 ESLint、桌面／手机／全屏及公网资源检查通过。
- 本次仅更新前端，Go 服务、数据库结构、5 MB 图片限制、运行配置和 Flowspace 服务保持原样。
- 完整数据库备份及旧镜像保留；[部署与回滚记录](deployments/20261008-223127/report.md)。

## 手帐纸张空间扩展更新（2026-10-08 22:56）

- 编辑器纸张设置新增“扩大纸张”，每次宽高增加 50%，最大边为 4000；只扩展空白空间，现有文字、照片和贴纸的位置、大小与样式保留。
- 扩展支持撤销、重做和自动保存。原记录保留已保存的尺寸，在编辑器按需扩大。
- 编辑器和阅读器最低缩放调整至 2%，最大纸张在 320px 手机也能整页显示；全屏只读分享仍需查看密码。
- 发布：`portfolio-journal-space-20261008-225006-e4e0d8bb`；容器：`1aaee435a63b`，healthy、重启计数 0。
- 368 项前端测试、生产构建、修改范围 ESLint、桌面／手机保存和分享页浏览器验证、公网资源校验通过。
- 本次仅更新前端，Go 服务、数据库结构、5 MB 图片限制、运行配置和 Flowspace 服务保留；完整数据库备份与旧镜像已保存。
- [部署与回滚记录](deployments/20261008-225006/report.md)。

## Markdown 编辑区扩展与全屏写作更新（2026-10-13 00:40）

- 桌面端 Markdown 编辑区改为 600–820px 自适应高度，可同时显示更多正文和预览；小屏继续使用原有自适应布局。
- 工具栏原有全屏入口改为始终可见的“全屏写作”文字按钮；全屏调整为铺满浏览器窗口，并保留源码、所见即所得、预览、目录、查找替换和导出能力。
- 全屏切换复用原编辑器，正文、选区和撤销历史保留；Esc 退出后恢复页面滚动和按钮焦点。
- 发布：`portfolio-markdown-fullscreen-20261013-003611-442a472d`；容器：`806e1c3946bb`，healthy、重启计数 0。
- 30 个前端测试文件、368 项测试、生产构建、TypeScript、修改范围 ESLint、桌面和手机浏览器检查、公网资源校验通过。
- 本次仅更新前端；Go 服务、数据库结构、运行配置、手帐内容和 Flowspace 服务保持不变。完整数据库备份与旧镜像已保留。
- [部署与回滚记录](deployments/20261013-003611/report.md)。

## Markdown 宽屏编辑更新（2026-10-13 01:00）

- 所见即所得正文移除原有 824px 上限，改为占满编辑器宽度，仅保留 28–72px 自适应左右边距；全屏模式同样生效。
- 单栏预览同步移除约 760px 的窄列限制；源码和分屏模式保持原样，不超过 720px 的窄屏继续使用 18px 边距。
- 1920px 桌面实测普通编辑节点宽 1196px、全屏编辑节点宽 1920px，均无额外外侧空白或横向溢出；390px 手机无横向溢出。
- 发布：`portfolio-markdown-width-20261013-005727-8abb782a`；容器：`274184e6e5f3`，healthy、重启计数 0。
- 30 个前端测试文件、368 项测试、生产构建、桌面／全屏／手机浏览器检查及公网资源校验通过。
- 本次仅更新两个 Markdown CSS Module；Go 服务、数据库结构、运行配置、手帐内容和 Flowspace 服务保持不变。完整数据库备份与旧镜像已保留。
- [部署与回滚记录](deployments/20261013-005727/report.md)。
