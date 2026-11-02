# Markdown 宽屏编辑发布报告

发布时间：2026-10-13 01:00（Asia/Shanghai）

发布版本：`portfolio-markdown-width-20261013-005727-8abb782a`

## 功能

所见即所得编辑器移除原有 824px 正文宽度上限，正文现在占满编辑器可用宽度，仅保留 28–72px 的自适应左右内边距。全屏写作使用同一规则，在宽屏下不再把正文收缩到页面中央的小列中。

单栏预览同步移除原有约 760px 的阅读列限制，正文、图片、表格和代码块可以使用更大的横向空间。源码和分屏模式原本已经占满各自面板，本次不改变；不超过 720px 的窄屏继续使用左右 18px 的紧凑边距。

## 验证

- 完整前端测试：30 个文件、368 项全部通过；生产构建通过，冻结源码构建与工作区产物的 128 个文件哈希一致。
- 1920 × 1080 桌面实测：1196px 的所见即所得编辑节点占满宿主，外侧空白为 0，左右内边距各 72px，实际文字区域约 1052px；单栏预览宽度同为 1196px。
- 1920 × 1080 全屏实测：对话框、编辑器宿主和编辑节点均为 1920px，外侧空白为 0，实际文字区域约 1776px，无横向溢出。
- 390 × 844 手机实测：编辑器与编辑节点均为 330px，左右内边距各 18px，实际文字区域约 294px，页面滚动宽度为 390px，无横向溢出。
- 全量 ESLint 仍被仓库已有的 `WritingImportDialog.tsx` `react-hooks/set-state-in-effect` 错误拦截；本次只修改两个 CSS Module，该既有错误与本次变更无关。
- 公网主 JS、主 CSS 和按需加载的 RichEditor CSS 与发布产物哈希一致；线上 `/api/health` 正常。

详细测量见 [browser-verification.json](browser-verification.json)。

## 发布范围与状态

本次只更新 Markdown 所见即所得和单栏预览的样式，不修改 Go 服务、数据库结构、权限逻辑、手帐内容或其他后台页面。

- 容器：`274184e6e5f3e8e216cdee27c780236daefd840ea5d1f7319e9f47516bb10f03`
- 镜像：`sha256:e652b997c61c5e55c2b3e97d2c3db476eb64a0480d656b19c08b3ebe0c18d516`
- Go 服务 SHA-256：`9185e4640e5d5fe8dde36713e3efe5c4c7deb117f623dfa4407732e6ffc219fa`
- healthy，重启计数 0，启动日志正常。
- `.env`、Compose、Caddy、端口、挂载、网络和远端 checkout 保持不变。
- Flowspace 前后端容器保持原样且健康。

## 备份与回滚

发布前 PostgreSQL custom-format 完整备份已通过 `pg_restore --list` 验证。发布快照目录：

`/home/ubuntu/apps/self/runtime/releases/portfolio-markdown-width-20261013-005727-8abb782a`

回滚命令：

```bash
cd /home/ubuntu/apps/self
docker tag self-portfolio-app:rollback-portfolio-markdown-width-20261013-005727-8abb782a self-portfolio-app
docker compose up -d --no-build --no-deps --force-recreate --wait --wait-timeout 120 portfolio-app
```

本次无数据库迁移，回滚无需恢复数据库。
