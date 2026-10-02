# Portfolio 发布与验收记录

- 发布版本：`portfolio-20261002-151738-af0d3fe8`
- 上线时间：2026-10-02 15:32（Asia/Shanghai）
- 验收时间：2026-10-02 15:45（Asia/Shanghai）
- 网站：https://self.jinrunlab.site/zh
- 目标：`ubuntu@119.91.114.203` 的 `portfolio-app`
- 结果：已发布并验证；容器 `3fdfc6f63545` 健康，验收时持续运行 768 秒，重启计数 0。

## 发布内容与保护措施

本次发布当前工作区的新代码，包含未提交和未跟踪的应用文件。源码基于 Git HEAD `8e8e58e425fe919a21fbd97e2722bfbac7652e1d` 加工作区改动；231 个文件的快照指纹为 `af0d3fe8b5383c545b1dc55af7f50e44f5051f1d38f4a105c5ac943fb3769d6d`。

前后端在本地构建；远端仅打包 Linux amd64 运行镜像并重建 `portfolio-app`。运行镜像为 `self-portfolio-app:20261002-151738-af0d3fe8`，镜像 ID 为 `sha256:87c51f43d1b5ce302b443d92f3f030874d6493162978bbf5412dd34c35b73052`。已核验容器内后端文件和公网提供的前端 JS/CSS 与本次产物一致。

远端发布目录：`/home/ubuntu/apps/self/runtime/releases/portfolio-20261002-151738-af0d3fe8`。其中 `source/` 保存本次源码快照，`runtime/` 保存部署产物。原有本地及远端 checkout 的未提交改动均保留；未提交或推送 Git。之后如需重建本版本，应使用该快照，而非直接构建原远端 checkout。

原 `.env` 字节校验保持一致，数据库与 MinIO 凭据、bucket、宿主网关、端口、挂载及网络均未改变。Flowspace 前后端容器 ID 未改变，均 healthy、重启计数 0。

## 验证结果

| 范围 | 结果 |
| --- | --- |
| 前端 | 20 个测试文件、208 项测试通过，生产构建通过 |
| 后端 | `go build ./...`、`go vet ./...` 通过；隔离真实 PostgreSQL 上 race 测试 225 项通过，0 失败、0 跳过 |
| 独立复验 | 主 agent 对冻结源码重新构建并执行 race 测试，225 项通过 |
| 数据库迁移 | 005→006 专项验证历史点赞、公开评论、时间字段保留，新评论默认 pending、迁移幂等；线上确认 001–006 全部已应用 |
| 健康与资源 | 新容器 healthy、重启计数 0；启动日志无 fatal/panic；公网健康接口及中英日页面返回 200 |
| 认证保护 | 现有管理员 API 和浏览器登录、退出成功；未登录访问后台 401，缺少 CSRF 的写请求 403，缺访客 Cookie 的互动写入 403 |
| 文章与互动 API | 创建草稿、发布；阅读去重；点赞去重及取消；评论 pending、公开前隐藏、后台审核、公开、删除；后台统计一致 |
| 真实浏览器 | 中英日首页；390×844 手机菜单、目录锚点、点赞、评论提交；后台手机导航、审核、文章预览；1440×1000 桌面所见即所得与分屏均可用 |
| 浏览器闭环 | 手机端评论提交后显示待审核；后台批准后，退出登录的公开页面可见该评论；浏览器与 API 两个访客累计阅读 2、访客 2，重复打开未增加 |
| 布局与错误 | 抽查手机首页、文章详情、审核页、编辑器及桌面编辑器均无文档横向溢出；该浏览器会话 error/warn 日志为空 |
| MinIO | 官方 mc 在应用所在网络完成唯一临时对象上传、内容比对、删除，并确认对象不存在 |
| 清理 | 临时文章先归档，再按本次唯一 ID 和 slug 精确删除；关联评论、点赞、访客记录均为 0；测试账号会话退出，临时数据库、隧道、MinIO 容器与对象已清理 |

## 已知限制

- 前端 lint 仍有两项 HEAD 已存在的 `react-refresh/only-export-components` 错误，位于 `web/src/app/routes.tsx:75,80`；本次未引入，也未扩大范围修改。
- 前端构建仍提示较大的 JS chunk（约 662.57 kB）。
- 本次浏览器验证使用桌面浏览器的手机尺寸，未验证真实 iOS Safari 或原生软键盘。
- 普通媒体上传接口使用本地文件存储；本次 MinIO 验收使用官方客户端，不宣称已完成 Markdown 导入全流程测试。
- 首次独立迁移查询的测试脚本误把连接 URI 仅放入 `PGDATABASE`，导致客户端尝试本地 socket；改为显式 `-d` 后查询成功。应用运行与迁移本身正常。最终运行检查还修正了测试脚本对 Docker 纳秒时间戳的解析，未改应用代码。

## 备份与回滚

- 发布前 PostgreSQL custom dump：远端发布目录下 `backups/portfolio-before.dump`，80,663 字节；使用 PostgreSQL 18 客户端生成，`pg_restore --list` 验证成功（195 项）。
- 原配置备份：同目录 `backups/runtime.env`（0600）及 `backups/docker-compose.yml`，均仅保留在服务器。
- 旧镜像标签：`self-portfolio-app:rollback-20261002-151738-af0d3fe8`。
- 镜像回滚时将旧标签重新标记为 `self-portfolio-app`，仅重建 `portfolio-app`，禁止使用 `--remove-orphans`。数据库不随镜像自动回退；恢复数据库备份前需单独评估上线后数据，避免覆盖新数据。

## 证据

- [源码快照清单](source-manifest.json)
- [构建产物清单](artifact-manifest.json)
- [发布状态](release-state.json)
- [线上 API 验证](api-smoke-results.json)（包含首次测试工具调用失败及修正后的成功结果）
- [最终运行验证](final-verification.json)
- [测试数据清理记录](smoke-fixtures.json)
- [手机端评论提交截图](mobile-comment-success.png)
- [公开评论桌面截图](desktop-public-approved.png)

截图中的文章、评论仅为本次验收临时数据，已清理。
