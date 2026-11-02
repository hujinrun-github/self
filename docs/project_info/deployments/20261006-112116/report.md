# 手帐图片 5 MB 上传限制发布报告

发布时间：2026-10-06 11:26（Asia/Shanghai）

发布版本：`portfolio-journal-image-limit-20261006-112116-6b15ea55`

## 结果

手帐照片现在按单张 5 MB 处理。管理端在发起请求前检查文件大小，超过限制时显示“照片不能超过 5 MB，请压缩后重试。”；服务端也将直传上限设为 5 MB，避免直接请求绕过页面限制。JPG、PNG、WebP 类型和 2000 万像素保护保持不变。

Caddy 配置中没有额外的请求体大小限制，因此本次没有修改反向代理。数据库结构、MinIO、访问权限与手帐 ZIP 导入规则也没有变化；规范化后的图片仍保留独立的存储安全上限，以保证导出归档可以正常回导。

## 修改范围

- `web/src/features/journal/JournalCanvas.tsx`
- `web/src/features/journal/JournalCanvas.test.tsx`
- `internal/journal/assets.go`
- `internal/journal/journal_test.go`
- `README.md`
- `docs/superpowers/specs/2026-10-02-journal-design.md`

与上一线上源码快照比较，应用源码只有上述前五个已部署文件发生变化；设计文档不进入运行镜像。

## 验证

- 前端完整测试：26 个测试文件、281 项测试通过。
- 画布上传专项测试：22 项通过，包含 5 MB 与 5 MB + 1 字节边界。
- 前端生产构建与修改范围 ESLint 通过。
- 使用独立 PostgreSQL 实例运行服务端边界测试通过。
- `go test ./internal/journal -race -count=1`、服务入口测试与 `go vet ./internal/journal` 通过。
- 线上真实登录与上传验证通过：5,242,880 字节图片返回 201；5,242,881 字节图片返回 400 和 `Image must be at most 5 MB`。
- 线上测试创建的临时手帐本、图片和登录会话均已清理。
- 公网健康接口返回 `{"ok":true}`，公开 JS/CSS 哈希与本次发布产物一致。

## 运行状态

- 容器：`362663a64fd8ecb41f02e8dfd6daa9ad00b929f731d8a93d4fae2ea9d8fb8eae`
- 镜像：`sha256:502c40bdf45cbab77c740c3a439f97df1f5b1a65766f1ba7f01c05933666001b`
- Go 服务文件 SHA-256：`9185e4640e5d5fe8dde36713e3efe5c4c7deb117f623dfa4407732e6ffc219fa`
- `portfolio-app`：healthy，重启计数 0。
- Flowspace 前后端：容器未重建，均为 healthy，重启计数 0。
- `.env`、Compose、Caddy、端口、挂载、网络和远端 Git 工作区均保持原样。

## 备份与回滚

发布前已创建 PostgreSQL custom-format 完整备份，并通过 `pg_restore --list` 验证；运行配置和 Compose 文件以 0600 权限保存。发布目录为：

`/home/ubuntu/apps/self/runtime/releases/portfolio-journal-image-limit-20261006-112116-6b15ea55`

旧镜像回滚标签：

`self-portfolio-app:rollback-portfolio-journal-image-limit-20261006-112116-6b15ea55`

如需回滚，将该标签重新标记为 `self-portfolio-app`，然后仅重建 `portfolio-app`：

```bash
cd /home/ubuntu/apps/self
docker tag self-portfolio-app:rollback-portfolio-journal-image-limit-20261006-112116-6b15ea55 self-portfolio-app
docker compose up -d --no-build --no-deps --force-recreate --wait --wait-timeout 120 portfolio-app
```

本次没有数据库迁移，正常回滚只需恢复旧镜像；数据库备份仅用于异常数据恢复。
