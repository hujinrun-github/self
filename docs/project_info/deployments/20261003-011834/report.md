# 手帐全屏编辑与保存反馈更新

- 发布版本：`portfolio-journal-ui-20261003-011834-fccd7fe5`。
- 上线：2026-10-03 01:22（Asia/Shanghai）。
- 结果：容器 `e9ef0c76367c` healthy，重启计数 0。
- 手帐管理：<https://self.jinrunlab.site/admin/journal>。

## 本次变更

画布工具栏新增全屏编辑、退出全屏与 Esc 退出。全屏保留同一画布实例、选中元素和撤销记录，按可用空间调整显示比例；手机使用属性抽屉，全屏内可直接保存。

用户澄清问题是“保存后没有弹窗”，本次补上手动保存结果提示：保存成功、已保存且无新修改、空白尚无内容、失败的具体原因，以及请求期间继续编辑时的同步提示。自动保存继续使用状态栏，不频繁弹出提示。通知可关闭，并在全屏内可见、可操作。

改动仅涉及 `web/src/features/journal/` 下 6 个画布、页面、样式与测试文件。后端 Go 二进制与数据库结构、密码访问规则均未改变。源码基于 `e73164258bb10cd707464f576ea9e119aac891b4` 及当前未提交改动；冻结 254 个文件，指纹 `fccd7fe5402249728fdfc4365d0d550672bfc0dab3906a2425c3d274100a3796`。

## 验证

- 前端全量 26 个文件、280 项测试通过；生产构建、修改文件 ESLint 通过。
- 回归覆盖：服务端成功后才提示、无改动保存、空白页反馈、失败与重试、保存期间继续编辑、全屏退出保留历史、全屏焦点与通知。
- 本地真实浏览器：旅行模板全屏编辑、贴纸修改、保存成功提示、退出/撤销/重做、从列表重新打开及刷新后内容保留。
- 390×844 手机：全屏画布与视口同尺寸、文档无横向溢出，属性抽屉与保存提示可用；修正工具栏文字挤压问题。
- 线上浏览器：独立临时空白页验证全屏、空白保存提示与 Esc 退出。未创建或修改线上手帐记录，用户原编辑页未刷新、未改动；临时标签页已关闭。
- 中英日首页、手帐页、健康接口均 HTTP 200，手帐仍返回 `private, no-store`。公网初始 JS/CSS 校验和匹配构建产物。
- 容器内 128 个静态资源匹配清单；后端 SHA-256 保持 `8d19aba5b3ff4366d8c7cb1068397a1ccf1d399f77e4dbd4a8ff657340920eaf`。
- `.env`、Compose 文件、环境变量、端口、挂载、网络与远端脏工作区保持原样。数据库/MinIO 健康探针成功，Flowspace 前后端容器与配置未变且健康。

## 发布与回滚

发布目录：`/home/ubuntu/apps/self/runtime/releases/portfolio-journal-ui-20261003-011834-fccd7fe5`。在已上线手帐镜像上仅替换前端资源，镜像 ID：`sha256:2ed1ae40d6296a575800bf5689485623e0e0e4a0555cb0d55335f80c0cead3ae`。本地及远端源码均未提交或推送。

发布前完整 PostgreSQL custom dump：`backups/portfolio-before.dump`，103,169 字节，SHA-256 `1c3657a3a154aab4fafb580aa754282bda0b4e9140fa32627b87751bbafe6078`。使用 PostgreSQL 18 客户端，`pg_restore --list` 校验成功（243 项）。配置备份仅留在远端，权限 0600。

回滚标签：`self-portfolio-app:rollback-portfolio-journal-ui-20261003-011834-fccd7fe5`，对应上一版 `portfolio-20261003-003459-f4cb5414`。在 `/home/ubuntu/apps/self` 执行：

```bash
docker tag self-portfolio-app:rollback-portfolio-journal-ui-20261003-011834-fccd7fe5 self-portfolio-app
docker compose up -d --no-build --no-deps --force-recreate --wait --wait-timeout 120 portfolio-app
```

仅回滚镜像，不自动恢复数据库；禁止使用 `--remove-orphans`。本次沿用现有会话与数据配置。

构建仍有既有主 JS chunk 较大的提示；手机验证使用浏览器视口，并非真实 iOS Safari。

## 证据

- [源码清单](source-manifest.json)
- [产物清单](artifact-manifest.json)
- [基线](baseline.json)与[备份校验](backup-verification.json)
- [发布状态](release-state.json)
- [浏览器验证](browser-verification.json)
- [公网验证](public-verification.json)
- [最终健康检查](final-verification.json)
