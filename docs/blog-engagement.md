# 文章互动

本功能覆盖写作文章，各语言版本按同一文章 ID 共享互动数据。

## 交互与统计口径

- 访客填写昵称与正文即可评论，无需注册。新评论先待审核，管理员公开后才出现在文章中；历史公开评论保持公开。
- 每个浏览器每篇文章最多一个有效点赞，可取消；重复请求不增加点赞。历史点赞计数保留。
- 访客数按匿名浏览器 Cookie 累计去重。同一浏览器、同一文章在滚动 24 小时内只计一次有效阅读。
- Cookie 不是自然人身份。清理 Cookie、换设备或浏览器会成为新访客。这些指标不代表实时在线人数或未经去重的 PV。
- 后台概览的访客数为各文章访客数之和，不是全站独立访客数。
- 阅读由详情页加载完成且可见时单独登记；查询互动数据不增加阅读数。
- 评论是纯文本，公开接口不返回邮箱、IP、访客标识。数据库不保存明文 IP。

## HTTP 合同

前台路径前缀 `/api/site/writing/{slug}`，支持 `locale=zh|en|ja`。JSON 请求，通过现有 `apiFetch` 携带 Cookie。

| 请求 | 输入 | 返回 |
| --- | --- | --- |
| GET `/engagement?page=1&limit=10` | 无 | `{like_count,liked,view_count,visitor_count,comment_count,comments,page,limit,has_more}` |
| POST `/view` | `{}` | `{view_count,visitor_count}` |
| POST `/like` | `{liked:boolean}` | `{like_count,liked}` |
| POST `/comments` | `{author_name,body}` | `{id,author_name,body,created_at,status:"pending"}`（201） |

公开评论仅含 `id,author_name,body,created_at`。先查询互动数据建立访客 Cookie，再登记阅读。评论限制昵称 80 字、正文 1000 字；服务端限制请求体、校验来源并限制频率。失败沿用 `{error:{code,message,fields?}}`，过于频繁返回 429。

后台接口使用现有登录和 CSRF 保护：

| 请求 | 输入 | 返回 |
| --- | --- | --- |
| GET `/api/admin/comments` | `status=pending|published|hidden|all&page=1&limit=20&writing_id=...` | `{items,total,page,limit,has_more}` |
| PATCH `/api/admin/comments/{id}` | `{status:"published"|"hidden"|"pending"}` | 更新后的评论 |
| DELETE `/api/admin/comments/{id}` | 无 | 204 |
| GET `/api/admin/writing/stats` | `page=1&limit=20` | `{items,total,page,limit,has_more,summary}` |

后台评论额外含 `writing_id,writing_title,writing_slug,status,updated_at`。统计条目含 `writing_id,title,slug,status` 及 `view_count,visitor_count,like_count,comment_count,pending_comment_count`；summary 为后五项汇总。comment_count 仅统计已公开评论，不以当前页长度代替。

完整前端类型在 `web/src/lib/engagement.ts`。

## 部署与数据兼容

迁移 `006_writing_engagement_moderation.sql` 保留原有点赞总数与公开评论，仅新增匿名访客记录并将新评论默认值改为待审核。后台页面位于 `/admin/engagement`。

访客 Cookie 由现有 `SESSION_SECRET` 签名，有效期一年，设置 HttpOnly、SameSite=Lax；`PUBLIC_BASE_URL` 使用 HTTPS 时强制 Secure，兼容反向代理终止 TLS。写入来源使用配置的前台来源与公开站点地址校验。更换签名密钥或 Cookie 到期会产生新的访客身份。

基础频率限制在单服务进程内生效：评论每个浏览器 10 分钟最多 5 条、每个连接 IP 最多 60 条；点赞和阅读分别限制为每分钟 120 次／浏览器、600 次／连接 IP。只在内存保留 IP 的带密钥散列，限流记录有过期时间和容量上限；不信任客户端自行设置的转发 IP。多实例部署可进一步由网关统一限流。

## 参考

- [WordPress 评论管理](https://wordpress.com/support/comments/manage-your-sites-comments/)：审核队列及批准／撤销批准。
- [WordPress 评论设置](https://wordpress.com/support/comments/)：匿名评论与公开前审核。
- [Ghost 文章统计](https://ghost.org/help/post-analytics/)：区分独立访客与总浏览量。本项目的 24 小时去重是自己的有效阅读规则。
