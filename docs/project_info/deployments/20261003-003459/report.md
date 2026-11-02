# 手帐功能发布记录

- 发布版本：`portfolio-20261003-003459-f4cb5414`。
- 上线时间：2026-10-03 00:44（Asia/Shanghai）；最终验收：00:50。
- 网站：<https://self.jinrunlab.site/zh>。
- 手帐：<https://self.jinrunlab.site/zh/journal>；管理入口：<https://self.jinrunlab.site/admin/journal>。
- 目标：`ubuntu@119.91.114.203`，仅重建 `portfolio-app`。

## 发布内容

上线画布手帐及其管理、私密图片、导入导出功能。首页和公开手帐入口无需账户登录；访客输入对应手帐本的密码后才能读取正文及图片。管理员沿用后台登录，进入管理页面后直接查看。新手帐本默认关闭公开展示，设置密码及公开标题后可以开启。

本次冻结当前工作区的 254 个应用文件，包含尚未提交的手帐代码，基于 Git HEAD `e73164258bb10cd707464f576ea9e119aac891b4`。快照指纹：`f4cb54145e4d9c5f3b508e1c5e289c0992e9d8b910c8d6b24e7ed768d92551da`。该快照保留线上此前的动效更新。含服务器凭据的 `docs/project_info`、所有 `.env`、运行数据和依赖目录均未纳入上传源码。

前端与 Linux amd64 Go 二进制在本地构建，远端打包运行镜像。镜像标签为 `self-portfolio-app:portfolio-20261003-003459-f4cb5414`，镜像 ID 为 `sha256:dca9a570d6aaeade0dbb54fbbeb87b05a72c9f4dc84d1bd9b1527ef2b50c91d2`。容器 ID：`9ae7137de6fa98dac5ec7730f1c323a385c180eee502d9a9ed861465bf252c88`。

远端发布目录：`/home/ubuntu/apps/self/runtime/releases/portfolio-20261003-003459-f4cb5414`，保留源码、构建产物、清单和备份。未修改远端已有脏工作区，未提交或推送 Git；以后重建本版本应使用该发布快照。

## 验证

- 本地验收：271 项前端测试通过；生产构建、Go 全量测试（隔离真实 PostgreSQL）、`go vet`、手帐 race 测试及本次前端文件 ESLint 通过。画布编辑、自动保存、冲突处理、离线草稿、移动、导出恢复等已完成本地浏览器验收。
- 线上数据库：PostgreSQL 18.4，迁移 `001_initial` 至 `007_journal` 全部生效；新增六张手帐表。
- 新服务 healthy、重启计数 0，启动日志无 fatal/panic；健康接口验证数据库及 MinIO 探针成功。
- 中英日首页、手帐页面和健康接口均返回 HTTP 200。手帐页面/API 返回 `private, no-store`。
- 容器内 129 个运行文件的 SHA-256 与构建清单一致；公网初始 JS/CSS 的 SHA-256 与构建产物一致。
- `.env` 字节校验、容器环境变量、端口、数据挂载、网络及宿主网关配置保持一致。继续使用 MinIO `host.docker.internal:19000` 和 `portfolio-app` 桶。
- Flowspace 前后端容器 ID、配置均保持原样，未操作 frps 或其他服务。

线上 HTTPS API 与真实浏览器完成 13 项检查：管理员直读画布和图片；新本默认隐藏；匿名目录仅含允许公开的字段；未解锁正文及图片均返回 401；错误密码拒绝、正确密码解锁；访客 Cookie 具有 Secure、HttpOnly、SameSite=Lax；改密立即撤销已有授权，管理员访问不受影响；新密码与主动锁定正常。

390×844 手机浏览器确认密码页不预取正文/图片，解锁后显示只读画布且无横向溢出；1440px 后台画布无需手帐密码。另验首页及手帐目录的桌面、手机布局，无页面脚本异常或横向溢出。截图已目视检查。

唯一临时手帐、记录、图片及其访客授权已精确删除，API 返回 404，并已退出本次管理员会话。应用自身的安全审计事件按设计保留，已删除手帐的关联 ID 置空。

## 备份与回滚

- 完整 PostgreSQL custom dump：发布目录下 `backups/portfolio-before.dump`，85,673 字节；PostgreSQL 18 客户端生成，`pg_restore --list` 验证成功，共 204 项。SHA-256：`ea77ed3b3d6358d712d97c292e649a3e384bf060f4ffba097cc91832fb500365`。
- 原配置：`backups/runtime.env` 与 `backups/docker-compose.yml`，权限 0600，仅保留在服务器。
- 本次实际切换前版本为 `portfolio-motion-20261002-181131-c4294989`，其镜像 ID 为 `sha256:4b51bc2e3c37e83ef311023499a1e8cf73649525951f57869d376095c90d3504`。
- 已保存回滚标签：`self-portfolio-app:rollback-20261003-003459-f4cb5414`。

需要回滚时，在 `/home/ubuntu/apps/self` 执行：

```bash
docker tag self-portfolio-app:rollback-20261003-003459-f4cb5414 self-portfolio-app
docker compose up -d --no-build --no-deps --force-recreate --wait --wait-timeout 120 portfolio-app
```

迁移 007 仅新增表和索引，旧镜像可以保留这些表运行。不要随镜像自动还原数据库，以免覆盖上线后新数据。不要使用 `--remove-orphans`。

## 已知限制

- 全量前端 lint 仍包含既有 `WritingImportDialog` 的 set-state-in-effect 错误与 `public/head.ts` 依赖警告，本次修改范围检查通过。
- Vite 仍提示主 JS chunk 较大（约 758 kB）。
- 浏览器手机检查采用桌面 Chromium 的手机尺寸，不代表已验证真实 iOS Safari 或原生软键盘。

## 证据

- [源码快照](source-manifest.json)
- [构建产物](artifact-manifest.json)
- [发布前基线](baseline.json)
- [备份校验](backup-verification.json)
- [发布状态](release-state.json)
- [迁移与运行文件核验](runtime-verification.json)
- [公网路由与静态资源核验](public-verification.json)

- [线上手帐权限及浏览器验收](production-journal-smoke-results.json)
- [临时数据清理记录](production-journal-smoke-fixture.json)
- [首页与目录浏览器验证](public-browser.json)
- [最终运行检查](final-verification.json)
- [手机密码页](journal-locked-mobile.png)
- [手机画布阅读](journal-reader-mobile.png)
- [桌面管理画布](journal-admin-desktop.png)

截图仅包含已删除的本次临时验收内容。
