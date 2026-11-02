# 手帐筛选框样式更新

- 发布：`portfolio-journal-filter-20261003-013332-a7409602`，2026-10-03 01:37（Asia/Shanghai）。
- 结果：`portfolio-app` healthy，重启计数 0，容器 `bb356d6328ed`。
- 管理入口：<https://self.jinrunlab.site/admin/journal>。

## 变更与验证

按截图优化“所有标签 / 所有心情”两个筛选框：保留原生选择交互，改为等宽控件、自定义箭头和足够的右侧留白，高度与日期控件统一为 46px；选择后使用浅绿色底色与边框，长标签闭合时省略并保留完整 option/title，手机自适应排列。

仅修改 `JournalCollection.tsx` 与 `JournalPages.module.css`，未改变筛选逻辑、后端程序、权限或数据库结构。

- 23 项现有页面测试、生产构建与修改文件 ESLint 通过。
- 本地真实浏览器验证默认样式、长标签、选中状态、标签/心情过滤、空结果和清除筛选恢复记录。
- 390px 双列及 320px 单列布局均无文档横向溢出，16px 字号保持可读。
- 线上独立标签页确认 157×46px 控件、40px 右侧留白及新箭头样式；临时标签页已关闭，用户原页面和线上记录未修改。
- 容器内 128 个静态资源及公网 JS/CSS 的 SHA-256 与构建产物一致。
- 服务健康、数据库/MinIO 探针成功；环境、Compose、端口、挂载、网络、原远端工作区和后端二进制保持原样。

准备发布期间检测到 Flowspace 前端被其他操作独立更新，首次准备因此在任何服务修改前停止。重新只读核验其健康状态、更新基线后继续；本次仅重建 `portfolio-app`，Flowspace 保持重新核验后的容器与配置。

## 发布与回滚

源码快照含 254 个文件，指纹 `a740960227624960cae73e42df13abf3d21bbf5aba7e99dc957ecee25de8dae4`。运行镜像 `sha256:c9d57f1763f55f788a114d11ab283e3a8342611c413da8d43570dfba660ea738`，在上版镜像上仅替换前端资源。本地和远端代码均未提交或推送。

发布目录：`/home/ubuntu/apps/self/runtime/releases/portfolio-journal-filter-20261003-013332-a7409602`。发布前数据库备份 `backups/portfolio-before.dump`（103,176 字节，SHA-256 `ac6b90a959be5fbd17392bf022a24a066c449073e275d08915921365bf39886e`），PostgreSQL 18 的 `pg_restore --list` 验证成功（243 项）。原配置备份权限 0600，仅在服务器保留。

回滚时在 `/home/ubuntu/apps/self` 执行：

```bash
docker tag self-portfolio-app:rollback-portfolio-journal-filter-20261003-013332-a7409602 self-portfolio-app
docker compose up -d --no-build --no-deps --force-recreate --wait --wait-timeout 120 portfolio-app
```

仅回滚镜像，不自动恢复数据库；不使用 `--remove-orphans`。

构建仍有既有主 JS chunk 较大的提示；未扩展检查与本次无关的全量 lint。手机验证使用浏览器视口。

## 证据

- [源码清单](source-manifest.json)与[产物清单](artifact-manifest.json)
- [发布前基线](baseline.json)与[备份校验](backup-verification.json)
- [发布状态](release-state.json)
- [浏览器验证](browser-verification.json)
- [公网验证](public-verification.json)与[最终健康检查](final-verification.json)
