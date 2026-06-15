# Personal Portfolio Website Design

Date: 2026-06-15
Status: Revised for review

## Goal

Build a personal portfolio website for showcasing profile information, experience, talks, writing, projects, and contact links. The frontend uses React, the backend uses Go, and the system must make content easy to add and modify without rebuilding the site.

The first version will be close to the provided reference image: clean, content-dense, professional, and centered on the person and their work.

## Confirmed Decisions

- Use a hybrid content management approach: database-backed content with a simple admin UI.
- Build the public site with React.
- Build the backend with Go.
- Deploy as a single Go service that serves both API routes and the built React assets.
- Use SQLite for the first version.
- Use one administrator account.
- Use forms for metadata and Markdown with preview for article and project body content.
- Deploy to a single server or VPS.
- Use Vite, React, React Router, and TypeScript for the frontend.
- Use Go with `net/http`, `chi`, `database/sql`, and SQL migrations for the backend.
- Treat admin security, Markdown rendering safety, upload validation, SEO metadata, and content publication state as first-version requirements.

## Non-Goals For Version 1

- Multi-user roles and permissions.
- A full CMS with plugin architecture.
- Rich-text document editing.
- Comments, likes, newsletters, or payment features.
- External object storage such as S3.
- Separate frontend and backend hosting.

## Architecture

The application will be a Go monolith with a React frontend.

The Go service is responsible for:

- Public API endpoints under `/api/site/*`.
- Admin API endpoints under `/api/admin/*`.
- Session-based admin authentication.
- SQLite database access.
- Local file uploads under `/uploads/*`.
- Serving the built React app for public and admin routes.

The React app is responsible for:

- Public portfolio pages.
- Admin login and content management.
- Markdown editing and preview.
- Client-side routing for `/`, detail pages, and `/admin/*`.

Deployment layout:

```text
portfolio-server
data/
  portfolio.db
  uploads/
  private_uploads/
web/
  dist/
.env
```

Required runtime configuration:

```text
APP_ORIGIN
PUBLIC_BASE_URL
SITE_NAME
ADMIN_EMAIL
ADMIN_PASSWORD
SESSION_SECRET
DATABASE_PATH
UPLOADS_DIR
PRIVATE_UPLOADS_DIR
SESSION_TTL_HOURS
SESSION_IDLE_TIMEOUT_MINUTES
```

`PUBLIC_BASE_URL` is the canonical public origin, such as `https://example.com`. It is used to build canonical URLs, Open Graph URLs, sitemap entries, and absolute media URLs.

`UPLOADS_DIR` stores public normalized derivatives only. `PRIVATE_UPLOADS_DIR` stores raw upload temp files during processing and is never served over HTTP. Raw files are deleted after processing completes, whether it succeeds or fails.

HTTP route priority:

1. `/api/*`.
2. `/uploads/*`.
3. `/sitemap.xml`.
4. `/robots.txt`.
5. `/admin/preview/*`.
6. React SPA fallback for public and admin client routes.

Routes 1-5 must be registered before the React fallback.

## SQLite Operations

Version 1 supports a single running Go instance. Multi-instance writes are outside the first release.

SQLite runtime settings:

- Enable `PRAGMA journal_mode = WAL`.
- Enable `PRAGMA foreign_keys = ON`.
- Set `PRAGMA busy_timeout = 5000`.
- Use `PRAGMA synchronous = NORMAL` with WAL.
- Use explicit transactions for multi-table writes such as content plus tags or tech stacks.

Migration rules:

- Store SQL migrations in versioned files.
- Track applied migrations in a `schema_migrations` table.
- Run migrations at startup before accepting HTTP traffic.
- Use a migration lock so two startup processes cannot migrate the same database at the same time.
- Fail startup if a migration fails; do not serve with a partially migrated schema.

Backup rules:

- Back up both `data/portfolio.db` and `data/uploads/`.
- Do not back up `data/private_uploads/`; it contains only temporary raw upload files.
- Use SQLite online backup API or `VACUUM INTO` for database snapshots instead of copying the live database file directly.
- Acquire an application-level backup mutex that blocks content writes and uploads during backup.
- Snapshot the database first, then copy `uploads/` while writes remain blocked.
- Record backup start and finish timestamps in logs.
- Provide an orphan-file cleanup command that reports media files not referenced by `media_assets` before deleting anything.

## Public Site

The homepage mirrors the reference layout with these sections:

- Hero: name, headline, short summary, avatar or illustration, contact button, project link.
- Experience: timeline-style career or project history.
- Bio: longer personal introduction.
- Featured Talks: selected talks or videos.
- Writing: recent or featured articles.
- Projects: selected project cards.
- Contact: email, GitHub, LinkedIn, blog, and other links.

Public routes:

```text
/
/bio
/talks
/talks/:slug
/writing
/writing/:slug
/projects
/projects/:slug
/contact
```

The homepage must fetch one aggregated payload from `GET /api/site/home` so the first screen does not depend on many separate requests.

## SEO And Share Metadata

The public app uses a Vite SPA, but public pages still need reliable metadata for search and social sharing. Go must dynamically inject metadata into the built `index.html` for public routes before serving it.

Metadata injection applies to:

```text
/
/bio
/talks
/talks/:slug
/writing
/writing/:slug
/projects
/projects/:slug
/contact
```

Content tables that can render detail pages store:

- `seo_title`
- `seo_description`
- `og_image_media_id`

`profile` stores the default site metadata for homepage and fallback cases.

Static list pages use route-specific defaults derived from `SITE_NAME` and profile metadata, such as `Projects | {SITE_NAME}`, `Writing | {SITE_NAME}`, `Talks | {SITE_NAME}`, and `Contact | {SITE_NAME}`.

Go route handling:

- Load the matching profile, project, writing, or talk by route and slug.
- Return a `404` page with no private data when the slug is missing or unpublished.
- Inject `<title>`, description, canonical URL, Open Graph tags, and Twitter card tags.
- HTML-escape every injected text value.
- Attribute-escape every injected attribute value, including URLs.
- Validate injected URLs before output: canonical and Open Graph URLs must be absolute URLs derived from `PUBLIC_BASE_URL`; image URLs must be generated from `media_assets` or validated absolute `https` URLs.
- Never inject raw database strings into HTML by direct string concatenation.
- Fall back from `seo_title` to content title.
- Fall back from `seo_description` to excerpt or summary.
- Fall back from `og_image_media_id` to cover media, then profile avatar media.
- Generate `sitemap.xml` from `PUBLIC_BASE_URL` and published routes.
- Exclude draft, archived, future-dated, and admin preview routes from sitemap output.
- Serve `/sitemap.xml` and `/robots.txt` from Go.

## Admin Site

Admin routes:

```text
/admin/login
/admin
/admin/profile
/admin/experience
/admin/talks
/admin/writing
/admin/projects
/admin/media
```

Admin capabilities:

- Edit profile, headline, summary, bio, avatar, and email.
- Add, edit, draft, publish, archive, delete, and reorder experience entries.
- Add, edit, draft, publish, archive, delete, feature, and reorder talks.
- Add, edit, draft, publish, archive, delete, and feature writing entries.
- Add, edit, draft, publish, archive, delete, feature, and reorder projects.
- Upload media and copy the generated URL.
- Preview Markdown before saving article and project content.
- Auto-generate slugs from titles and show conflict errors before publish.
- Provide a "preview as public page" action before publishing content.
- Provide a media picker for cover images and inline Markdown images.

Version 1 uses explicit up/down controls for reordering. Drag-and-drop is outside version 1.

Admin preview rules:

- V1 preview is admin-session-only.
- Preview routes live under `/admin/preview/:resource/:id`.
- Go must register `/admin/preview/*` before the React SPA fallback.
- Go verifies the admin session before serving the preview shell.
- Unauthorized preview requests return `401` for API-style requests or redirect to `/admin/login` for browser navigation.
- After session validation, Go serves the React `index.html` shell with preview headers so React can render the preview route.
- Preview routes require a valid admin session, CSRF is not required for the read-only preview request, and responses must send `X-Robots-Tag: noindex, nofollow`.
- Preview can render draft, archived, and future-dated content only for the authenticated admin.
- Preview URLs are not shareable outside the logged-in admin browser.
- Signed public preview tokens are outside version 1.

## Data Model

Use separate tables for each content area instead of a generic content table. This keeps admin forms simple and public API responses predictable.

Core tables:

```text
admins
profile
social_links
experiences
talks
writings
tags
writing_tags
projects
techs
project_tech
media_assets
media_references
sessions
```

All publishable content fields:

- `id`
- `status` as `draft`, `published`, or `archived`
- `sort_order`
- `published_at`
- `created_at`
- `updated_at`

The publishable content tables are `experiences`, `talks`, `writings`, and `projects`. Public APIs only return rows where `status = 'published'` and `published_at <= now`.

Routable content fields:

- `slug`

The routable content tables are `talks`, `writings`, and `projects`. `experiences` do not have public detail routes or slugs in V1.

Homepage-featured content fields:

- `featured`

The homepage-featured content tables are `talks`, `writings`, and `projects`. `experiences` are ordered timeline entries and do not use `featured`.

`featured = true` only affects homepage placement. It never makes draft or future-dated content public.

Publishing rules:

- Creating content defaults to `status = 'draft'`.
- Publishing content sets `status = 'published'`.
- If `published_at` is empty when publishing, set it to the current server time.
- Future `published_at` values schedule publication.
- Archiving content sets `status = 'archived'` and keeps historical `published_at`.

Time rules:

- Store all timestamps in UTC.
- API responses use RFC 3339 / ISO 8601 strings with a `Z` UTC suffix.
- API requests that include timestamps must use RFC 3339 / ISO 8601.
- The server compares publication times in UTC.
- The frontend displays dates using the browser locale unless a page explicitly needs a fixed format.
- Tests that depend on time use an injectable server clock.

Slug rules:

- Draft routable content can change `slug`.
- Publishing locks `slug`.
- Published and archived routable content cannot change `slug` in V1.
- To change a public URL in V1, create a new draft, publish it, and archive the old content.
- Slug redirects are outside V1.

`profile` stores singleton personal information:

- `id`
- `name`
- `headline`
- `summary`
- `bio`
- `avatar_media_id`
- `email`
- `seo_title`
- `seo_description`
- `og_image_media_id`
- `updated_at`

`profile` constraints:

- The table is a singleton with exactly one row.
- The singleton row uses `id = 1`.
- `social_links.profile_id` references `profile.id`.

`social_links` stores contact and social destinations:

- `id`
- `profile_id`
- `label`
- `url`
- `icon`
- `sort_order`
- `created_at`
- `updated_at`

`social_links` constraints:

- Unique `(profile_id, label)`.
- Unique `(profile_id, url)`.
- `sort_order` controls Contact display order.
- Deleting a social link is a hard delete because it has no dependent content.

`admins` stores:

- `id`
- `email`
- `password_hash`
- `created_at`
- `updated_at`

`sessions` stores:

- `id`
- `admin_id`
- `session_token_hash`
- `csrf_token_hash`
- `created_at`
- `last_seen_at`
- `expires_at`
- `revoked_at`

`experiences` stores:

- `period`
- `title`
- `organization`
- `description`
- `status`
- `sort_order`
- `published_at`

`projects` stores:

- `title`
- `slug`
- `summary`
- `content_md`
- `cover_media_id`
- `demo_url`
- `repo_url`
- `seo_title`
- `seo_description`
- `og_image_media_id`
- `status`
- `featured`
- `sort_order`
- `published_at`

Project technology model:

`techs` stores normalized technology terms:

- `id`
- `name`
- `slug`
- `created_at`
- `updated_at`

`techs` constraints:

- Unique `slug`.
- Slugs are globally normalized with the same slugify function used for routable content.
- Public `tech=:tech` filters match `techs.slug`.

`project_tech` stores project-to-technology joins:

- `id`
- `project_id`
- `tech_id`
- `sort_order`

`project_tech` constraints:

- Unique `(project_id, tech_id)`.
- `sort_order` controls tag display order on project cards and detail pages.
- Deleting a project cascades to its `project_tech` rows.
- Removing a technology from a project hard-deletes only that join row.
- Deleting a `techs` row is blocked while any `project_tech` row references it.

`writings` stores:

- `title`
- `slug`
- `excerpt`
- `content_md`
- `cover_media_id`
- `seo_title`
- `seo_description`
- `og_image_media_id`
- `status`
- `featured`
- `sort_order`
- `published_at`

Writing tag model:

`tags` stores normalized writing tags:

- `id`
- `name`
- `slug`
- `created_at`
- `updated_at`

`tags` constraints:

- Unique `slug`.
- Slugs are globally normalized with the same slugify function used for routable content.
- Public `tag=:tag` filters match `tags.slug`.

`writing_tags` stores writing-to-tag joins:

- `id`
- `writing_id`
- `tag_id`
- `sort_order`

`writing_tags` constraints:

- Unique `(writing_id, tag_id)`.
- `sort_order` controls tag display order on writing cards and detail pages.
- Deleting a writing entry cascades to its `writing_tags` rows.
- Removing a tag from an article hard-deletes only that join row.
- Deleting a `tags` row is blocked while any `writing_tags` row references it.

`talks` stores:

- `title`
- `slug`
- `summary`
- `cover_media_id`
- `event_name`
- `video_url`
- `duration_minutes`
- `seo_title`
- `seo_description`
- `og_image_media_id`
- `status`
- `featured`
- `sort_order`
- `published_at`

`media_assets` stores uploaded file metadata:

- `file_name`
- `storage_key`
- `mime_type`
- `size_bytes`
- `width`
- `height`
- `variants_json`
- `checksum_sha256`
- `created_at`

`media_references` stores content-to-media usage:

- `id`
- `media_asset_id`
- `resource_type`
- `resource_id`
- `source`
- `created_at`

`media_references` constraints:

- `resource_type` is `profile`, `project`, `writing`, or `talk`.
- `source` is `avatar`, `cover`, `og_image`, or `markdown`.
- Unique `(media_asset_id, resource_type, resource_id, source)`.
- Index `media_asset_id` for delete blocking.
- Content saves rebuild references for that content row inside the same transaction.
- Markdown image inserts use the internal syntax `media://asset/{id}/{variant}`.
- Allowed Markdown variants are `content`, `cover`, `card`, and `avatar`.
- Content saves parse `media://asset/{id}/{variant}` references, verify that each media asset and variant exists, and store `source = 'markdown'` references.
- `media_references` tracks asset-level references only. It intentionally does not store the variant.
- Variant usage remains in `content_md` and is re-parsed when content is saved.
- Public and admin content APIs return raw Markdown plus a `media` map that resolves referenced media IDs and variants to public derivative URLs.
- Public APIs expand media IDs and references into derivative URLs where needed; database content rows do not store mutable public media URLs.
- User-entered `/uploads/*` Markdown image URLs are rejected in V1.
- User-entered remote Markdown image URLs are rejected in V1.

`media_assets.variants_json` structure:

```json
{
  "content": {
    "path": "/uploads/ab/cd/content.jpg",
    "width": 1600,
    "height": 900,
    "mime_type": "image/jpeg",
    "size_bytes": 123456
  },
  "cover": {
    "path": "/uploads/ab/cd/cover.jpg",
    "width": 1200,
    "height": 675,
    "mime_type": "image/jpeg",
    "size_bytes": 45678
  },
  "card": {
    "path": "/uploads/ab/cd/card.jpg",
    "width": 800,
    "height": 450,
    "mime_type": "image/jpeg",
    "size_bytes": 23456
  },
  "avatar": {
    "path": "/uploads/ab/cd/avatar.png",
    "width": 400,
    "height": 400,
    "mime_type": "image/png",
    "size_bytes": 12345
  }
}
```

## Database Indexes

Required indexes and constraints:

- `profile.id` primary key with a check or migration guard enforcing singleton `id = 1`.
- Unique `slug` on `talks`, `writings`, and `projects`.
- Index `(status, published_at, sort_order)` on `experiences`, `talks`, `writings`, and `projects`.
- Index `(status, featured, sort_order, published_at)` on `talks`, `writings`, and `projects`.
- Unique `tags.slug`.
- Unique `(writing_id, tag_id)` on `writing_tags`.
- Index `writing_tags.tag_id`.
- Unique `techs.slug`.
- Unique `(project_id, tech_id)` on `project_tech`.
- Index `project_tech.tech_id`.
- Unique `(profile_id, label)` and `(profile_id, url)` on `social_links`.
- Index `(profile_id, sort_order)` on `social_links`.
- Index `media_references.media_asset_id`.
- Unique `(media_asset_id, resource_type, resource_id, source)` on `media_references`.
- Unique `media_assets.storage_key`.
- Unique `media_assets.checksum_sha256` is not required because duplicate uploads are allowed in V1.
- Unique `sessions.session_token_hash`.
- Index `(admin_id, expires_at)` on `sessions`.

## API Design

Public API:

```text
GET /api/site/home
GET /api/site/profile
GET /api/site/projects?page=:page&limit=:limit&tech=:tech
GET /api/site/projects/:slug
GET /api/site/writing?page=:page&limit=:limit&tag=:tag
GET /api/site/writing/:slug
GET /api/site/talks?page=:page&limit=:limit
GET /api/site/talks/:slug
```

Public list defaults:

- `page` defaults to `1`.
- `limit` defaults to `12` and is capped at `50`.
- Sort order defaults to `published_at DESC`, then `sort_order ASC`.
- Responses include pagination metadata: `page`, `limit`, `total`, and `has_more`.
- `tech` filters use globally normalized `techs.slug`.
- `tag` filters use globally normalized `tags.slug`.
- Unknown `tech` or `tag` filters return an empty list with valid pagination metadata, not `404`.

`GET /api/site/home` response rules:

- Return one payload with `profile`, `social_links`, `experiences`, `featured_talks`, `writing`, and `projects`.
- `social_links`: all links for `profile.id = 1`, sorted by `sort_order ASC`.
- `experiences`: up to 4 published entries, sorted by `sort_order ASC`.
- `featured_talks`: up to 4 published talks. Select featured talks first by `sort_order ASC`, then backfill with recent published talks by `published_at DESC` until 4 items.
- `writing`: up to 5 published writings. Select featured writings first by `sort_order ASC`, then backfill with recent published writings by `published_at DESC` until 5 items.
- `projects`: up to 4 published projects. Select featured projects first by `sort_order ASC`, then backfill with recent published projects by `published_at DESC` until 4 items.
- If a module has no published content, return an empty array for that module.
- The frontend hides optional empty modules except `profile` and Contact.
- Contact renders from `profile.email` and `social_links`.
- Backfill never returns duplicate IDs.

Admin authentication API:

```text
POST /api/admin/login
POST /api/admin/logout
GET  /api/admin/me
GET  /api/admin/csrf
```

Admin content API:

```text
GET   /api/admin/profile
PUT   /api/admin/profile

GET    /api/admin/experience?page=:page&limit=:limit&status=:status&q=:q
POST   /api/admin/experience
GET    /api/admin/experience/:id
PUT    /api/admin/experience/:id
PATCH  /api/admin/experience/:id/status
DELETE /api/admin/experience/:id
PATCH  /api/admin/experience/reorder

GET    /api/admin/projects?page=:page&limit=:limit&status=:status&q=:q&tech=:tech
POST   /api/admin/projects
GET    /api/admin/projects/:id
PUT    /api/admin/projects/:id
PATCH  /api/admin/projects/:id/status
DELETE /api/admin/projects/:id
PATCH  /api/admin/projects/reorder

GET    /api/admin/writing?page=:page&limit=:limit&status=:status&q=:q&tag=:tag
POST   /api/admin/writing
GET    /api/admin/writing/:id
PUT    /api/admin/writing/:id
PATCH  /api/admin/writing/:id/status
DELETE /api/admin/writing/:id
PATCH  /api/admin/writing/reorder

GET    /api/admin/talks?page=:page&limit=:limit&status=:status&q=:q
POST   /api/admin/talks
GET    /api/admin/talks/:id
PUT    /api/admin/talks/:id
PATCH  /api/admin/talks/:id/status
DELETE /api/admin/talks/:id
PATCH  /api/admin/talks/reorder

GET    /api/admin/media?page=:page&limit=:limit&q=:q
POST   /api/admin/media
DELETE /api/admin/media/:id
```

Admin profile API semantics:

- `GET /api/admin/profile` returns the singleton profile row with nested `social_links`.
- `PUT /api/admin/profile` accepts profile fields plus a full ordered `social_links` array.
- `GET /api/admin/profile` returns an `ETag` derived from `profile.updated_at`.
- `PUT /api/admin/profile` requires `If-Match` with the latest profile `ETag`.
- If `If-Match` is missing, return `validation_error`.
- If `If-Match` does not match the current profile version, return `409 conflict`.
- Each `social_links` item can include an existing `id`; items without `id` are created.
- Existing links omitted from the submitted array are hard-deleted.
- Profile and social link changes are saved in one transaction.
- `GET /api/site/profile` also returns `social_links` for the public Contact section.

Admin tag and technology semantics:

- V1 has no standalone admin UI or CRUD API for `tags` and `techs`.
- Writing forms submit an ordered list of tag names.
- Project forms submit an ordered list of technology names.
- On save, the backend normalizes each name to a slug, upserts missing `tags` or `techs` rows by slug, and rewrites the join rows in the submitted order.
- If a submitted name normalizes to an existing slug with a different display name, the existing display name is reused in V1.
- Renaming, merging, and deleting global `tags` or `techs` are outside V1.
- Orphaned global `tags` and `techs` can remain in the database; they are not returned by public APIs unless joined to published content.

Admin list defaults:

- `page` defaults to `1`.
- `limit` defaults to `20` and is capped at `100`.
- `status` can be `draft`, `published`, or `archived`.
- `q` searches title, summary, excerpt, or file name depending on resource.

All admin APIs require a valid session. Public APIs only return published content whose `published_at` is not in the future.

Reorder semantics:

- `PATCH /api/admin/:resource/reorder` accepts a full ordered list:

```json
{
  "ordered_ids": [12, 7, 9]
}
```

- Allowed resources are `experience`, `projects`, `writing`, and `talks`.
- `ordered_ids` must contain exactly the IDs in the current filtered admin list scope for that resource.
- The server updates all affected rows in one transaction.
- The server normalizes `sort_order` to consecutive integers starting at `10` and stepping by `10`.
- If IDs are missing, duplicated, or unknown, return `validation_error` with field errors on `ordered_ids`.

Status update semantics:

- `PATCH /api/admin/:resource/:id/status` accepts `status` and optional `published_at`.
- Allowed resources are `experience`, `projects`, `writing`, and `talks`.
- Publishing sets `status = 'published'`; if `published_at` is omitted, the server sets it to current server time.
- Drafting sets `status = 'draft'` and keeps existing `published_at` for audit history.
- Archiving sets `status = 'archived'` and keeps existing `published_at`.

Delete semantics:

- `DELETE` is a hard delete.
- Published rows cannot be deleted directly. They must be archived first.
- Hard delete is allowed only for rows where `status = 'draft'` and `published_at IS NULL`.
- Published and archived rows are never hard-deleted in V1 because they may have had public URLs.
- Deleting a project or writing entry cascades to its technology or tag rows.
- Deleting media is blocked while any `media_references` row points at the media asset.
- Content create/update transactions must refresh `media_references` before returning success.

## Response Schemas

Home response shape:

```json
{
  "profile": {
    "name": "Jinrun Hu",
    "headline": "I build AI products, design systems, and developer tools.",
    "summary": "Short public summary.",
    "avatar": {
      "id": 1,
      "url": "/uploads/ab/cd/avatar.png",
      "width": 400,
      "height": 400
    },
    "email": "hello@example.com"
  },
  "social_links": [
    {
      "id": 1,
      "label": "GitHub",
      "url": "https://github.com/example",
      "icon": "github",
      "sort_order": 10
    }
  ],
  "experiences": [],
  "featured_talks": [],
  "writing": [],
  "projects": []
}
```

Project detail response shape:

```json
{
  "project": {
    "id": 12,
    "title": "AI Knowledge Base",
    "slug": "ai-knowledge-base",
    "summary": "RAG-powered knowledge base.",
    "content_md": "![Cover](media://asset/42/content)",
    "cover": {
      "id": 42,
      "url": "/uploads/ab/cd/cover.jpg",
      "width": 1200,
      "height": 675
    },
    "techs": [
      {
        "name": "React",
        "slug": "react",
        "sort_order": 10
      }
    ],
    "published_at": "2026-06-15T00:00:00Z"
  },
  "media": {
    "42": {
      "content": "/uploads/ab/cd/content.jpg",
      "cover": "/uploads/ab/cd/cover.jpg",
      "card": "/uploads/ab/cd/card.jpg"
    }
  }
}
```

Admin project edit response shape:

```json
{
  "project": {
    "id": 12,
    "title": "AI Knowledge Base",
    "slug": "ai-knowledge-base",
    "summary": "RAG-powered knowledge base.",
    "content_md": "![Cover](media://asset/42/content)",
    "cover_media_id": 42,
    "og_image_media_id": 42,
    "status": "draft",
    "featured": false,
    "sort_order": 10,
    "published_at": null,
    "techs": [
      {
        "name": "React",
        "slug": "react",
        "sort_order": 10
      }
    ],
    "updated_at": "2026-06-15T00:00:00Z"
  },
  "media": {
    "42": {
      "content": "/uploads/ab/cd/content.jpg",
      "cover": "/uploads/ab/cd/cover.jpg",
      "card": "/uploads/ab/cd/card.jpg"
    }
  }
}
```

Paginated list response shape:

```json
{
  "items": [],
  "pagination": {
    "page": 1,
    "limit": 12,
    "total": 0,
    "has_more": false
  }
}
```

## Authentication And Security

Use server-side sessions with a hardened cookie. Cookie-based admin APIs must include CSRF protection for every unsafe method.

Login flow:

```text
admin submits email/password
Go verifies bcrypt password hash
Go creates a session
Go rotates any existing session for this browser
browser receives hardened session cookie
admin UI fetches CSRF token
admin API checks session, CSRF token, and Origin on every unsafe request
```

Security uses the global runtime configuration values defined in the deployment section.

Admin bootstrap rules:

- Bootstrap from `ADMIN_EMAIL` and `ADMIN_PASSWORD` only when the `admins` table has no rows.
- Startup never modifies an existing admin email or password from environment variables.
- `ADMIN_PASSWORD` must be at least 16 characters.
- Passwords are stored only as bcrypt hashes.
- In production, startup logs a warning if `ADMIN_PASSWORD` remains set after the first admin has been created.
- Password rotation after bootstrap is handled by an authenticated admin flow, not by changing environment variables.

Session cookie requirements:

- Name: `portfolio_session`.
- `HttpOnly`.
- `Secure` in production. Local development may disable `Secure` only for `http://localhost`.
- `SameSite=Lax`.
- `Path=/`.
- Absolute expiration defaults to `12h`.
- Idle timeout defaults to `2h`.
- Store `created_at`, `last_seen_at`, `expires_at`, and `revoked_at` server-side.
- Store only `session_token_hash` server-side. The cookie contains the raw random session token.
- Rotate the session token after successful login and after session renewal.
- Logout must set `revoked_at`, delete the server-side session, and clear the cookie with an expired `Set-Cookie`.

CSRF and Origin requirements:

- `GET`, `HEAD`, and `OPTIONS` do not mutate state and do not require a CSRF token.
- `POST`, `PUT`, `PATCH`, and `DELETE` under `/api/admin/*` require a valid session and `X-CSRF-Token`.
- The CSRF token is generated server-side, bound to the session, and returned by `GET /api/admin/csrf` and `GET /api/admin/me`.
- The React admin app stores the CSRF token in memory and sends it as `X-CSRF-Token` for unsafe requests.
- Unsafe requests must include an `Origin` header matching `APP_ORIGIN`.
- If `Origin` is missing, the server must require strict `Referer` validation for same-origin browser requests.
- Cross-origin credentialed requests are not supported in version 1.

Login abuse protection:

- Rate-limit login attempts by IP and email.
- Default limit: 5 failed attempts per 10 minutes.
- Apply exponential backoff after repeated failures.
- Return a generic login failure message so the API does not reveal whether the email exists.

Security headers:

- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `X-Frame-Options: DENY` for admin pages.
- `Content-Security-Policy` must disallow inline script execution for public and admin pages. If a future build-time nonce strategy is added, document it before allowing inline script.
- Production CSP:

```text
default-src 'self';
script-src 'self';
style-src 'self';
img-src 'self' data:;
font-src 'self';
connect-src 'self';
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
object-src 'none';
```

- Vite production builds must not require inline scripts.
- If inline styles are introduced by a dependency, replace the dependency or add a documented nonce strategy before release.

## Markdown Rendering Safety

Article and project body content is public, so Markdown rendering must be treated as an untrusted-content boundary even though only the administrator can edit it.

Markdown storage and rendering rules:

- Store the original Markdown in `content_md`.
- V1 renders Markdown in the React frontend only.
- The backend stores and returns raw Markdown; it does not pre-render or persist HTML.
- Use one shared React Markdown component for public pages and admin preview.
- Use `react-markdown`, `remark-gfm`, and `rehype-sanitize` with a project-owned allowlist schema.
- Do not enable `rehype-raw`.
- Disable raw HTML in Markdown.
- Render admin preview and public pages with the same Markdown configuration.
- Sanitize rendered output with an allowlist before inserting it into the DOM.
- Never use unsanitized `dangerouslySetInnerHTML`.
- Escape code blocks and inline code.
- Allow only expected block and inline elements: headings, paragraphs, lists, blockquotes, tables, code, pre, strong, emphasis, links, images, and horizontal rules.

Markdown image rendering order:

1. Parse Markdown with `react-markdown`.
2. Use a custom image renderer for `img` nodes.
3. The custom renderer accepts only `media://asset/{id}/{variant}` values.
4. The renderer resolves `media://` through the API-provided media map to a same-origin derivative URL.
5. The renderer rejects missing media IDs, unknown variants, raw `/uploads/*` URLs, remote URLs, `data:` URLs, and inline SVG.
6. The resolved same-origin URL is then passed through the same sanitization allowlist as the rest of the rendered output.
7. The original Markdown `src` is never emitted directly into the DOM.

Link rules:

- Allow `http`, `https`, `mailto`, and same-origin relative URLs.
- Reject `javascript:`, `data:`, `vbscript:`, and protocol-relative URLs.
- External links must use `target="_blank"` and `rel="noopener noreferrer"`.
- Internal links remain same-tab.

Image rules:

- Allow images referenced through `media://asset/{id}/{variant}` and resolved by the shared Markdown renderer.
- Reject raw `/uploads/*` image URLs in Markdown.
- Reject remote images in Markdown in V1.
- Reject `data:` images and inline SVG.
- Require `alt` text in admin validation for cover images and Markdown image inserts.

Upload rules:

- Allow PNG, JPG, JPEG, and WebP uploads.
- Disable SVG uploads in version 1.
- Enforce a default maximum upload size of `5MB`.
- Use Go standard `image/jpeg` and `image/png`, `golang.org/x/image/webp` for WebP decode, and `github.com/disintegration/imaging` for resizing and cropping.
- Sniff MIME type server-side and do not trust the browser-provided `Content-Type`.
- Verify that the file extension, sniffed MIME type, and decoded image format agree.
- Decode the image server-side to confirm it is a valid image.
- Reject images larger than `6000 x 6000` pixels or `24MP`.
- Generate cryptographically random file names and derive extensions from the validated image type.
- Ignore user-provided file paths and prevent path traversal with `path.Clean`, base-name checks, and an uploads-root containment check.
- Store raw upload temp files under `data/private_uploads/` and delete them after derivative generation succeeds or fails.
- Store only normalized public derivatives under `data/uploads/`.
- Serve only normalized derivatives under `/uploads/*` through a Go file handler, not by exposing arbitrary filesystem paths.
- Set exact `Content-Type` and `X-Content-Type-Options: nosniff` when serving uploads.
- Do not serve raw uploads publicly.
- Strip EXIF and other metadata by generating normalized public derivatives; reject the upload if normalization fails.
- V1 derivative outputs are JPEG files for content covers/cards and PNG files for square avatar thumbnails that require transparency.
- WebP uploads are accepted as input, decoded server-side, and re-encoded to JPEG or PNG derivatives. V1 does not generate WebP derivatives.
- Generate standard derivatives for common frontend usage: original-bounded image, `1200x675` cover, `800x450` card thumbnail, and `400x400` avatar thumbnail.
- Store derivative paths and dimensions in `media_assets`.
- Keep cover images at a `16:9` target ratio unless a specific module defines another ratio.

Static asset caching:

- `web/dist/assets/*` uses long-lived immutable caching: `Cache-Control: public, max-age=31536000, immutable`.
- `index.html` and dynamically meta-injected HTML use `Cache-Control: no-cache`.
- Public API responses use `Cache-Control: no-store` in V1.
- Upload derivatives under `/uploads/*` use long-lived immutable caching: `Cache-Control: public, max-age=31536000, immutable`.
- Upload derivative file names must include a random storage key and must never be overwritten in place.
- Replacing an image creates a new media asset and new derivative paths.

## Frontend Implementation Shape

Suggested React structure:

```text
src/
  app/
    routes/
    layout/
  features/
    profile/
    experience/
    talks/
    writing/
    projects/
    media/
    auth/
  components/
    ui/
    markdown/
  styles/
    tokens.css
    global.css
  lib/
    api.ts
    format.ts
```

Public components must prioritize scanability, strong typography, stable card dimensions, and responsive behavior. Admin components must prioritize fast editing, clear validation, and predictable navigation.

Frontend UX requirements:

- Mobile layout is a first-version requirement.
- Collapse the top navigation into a menu on narrow screens.
- Stack the hero, experience, bio, talks, writing, and projects sections into a single readable column on mobile.
- Convert the desktop Experience plus Bio split layout into stacked sections on mobile.
- Use stable image aspect ratios so cards do not jump while loading.
- Use `16:9` covers for talks, projects, and writing cards unless a module overrides it.
- Provide loading, empty, and error states for every public list and admin table.
- Keep keyboard focus visible for links, buttons, inputs, menus, and admin controls.
- Use semantic landmarks: `header`, `nav`, `main`, `section`, `article`, and `footer`.
- Ensure all icon-only buttons have accessible labels.
- Respect reduced-motion preferences for transitions.

Visual system requirements:

- V1 supports light mode only. Dark mode is outside version 1.
- Use CSS Modules for component-scoped styles.
- Use `src/styles/tokens.css` for global CSS custom properties.
- Use `src/styles/global.css` for reset, base typography, layout primitives, and Markdown prose defaults.
- Do not use Tailwind or a component library in V1.
- Use the system font stack: `ui-sans-serif`, `system-ui`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `sans-serif`.
- Do not load external web fonts in V1.
- Use `ui-monospace`, `SFMono-Regular`, `Consolas`, `Liberation Mono`, `monospace` for code blocks.
- Use `lucide-react` for icons.
- Base page background: `#ffffff`.
- Main text: `#111827`.
- Secondary text: `#4b5563`.
- Muted text: `#6b7280`.
- Border: `#e5e7eb`.
- Subtle surface: `#f9fafb`.
- Primary action: `#2563eb`; primary hover: `#1d4ed8`.
- Success accent: `#10b981`; warning accent: `#f59e0b`; danger accent: `#dc2626`.
- Use CSS variables for all color tokens and spacing tokens.
- Content width maxes at `1160px` with responsive horizontal padding.
- Cards use `8px` radius, `1px` border, no heavy shadows.
- Buttons use `6px` radius, visible focus rings, and consistent icon spacing.
- Talk, writing, and project cards use fixed media aspect ratios so rows stay aligned.
- Avoid decorative gradients and oversized marketing-style hero composition; the first viewport remains a usable portfolio surface.

## Backend Implementation Shape

Suggested Go structure:

```text
cmd/server/
internal/
  auth/
  config/
  db/
  http/
  media/
  profile/
  experience/
  talks/
  writing/
  projects/
  site/
web/dist/
```

Each content module owns its handlers, request validation, and repository queries. Shared middleware handles logging, session authentication, JSON responses, and errors.

## Error Handling

API errors use consistent JSON:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Validation failed",
    "fields": {
      "title": "Title is required"
    }
  }
}
```

`fields` is optional and appears only for field-level validation errors. Keys use request field names so admin forms can map messages directly to inputs.

Recommended error categories:

- `validation_error`
- `unauthorized`
- `forbidden`
- `not_found`
- `conflict`
- `upload_error`
- `internal_error`

Slug conflicts return `409 conflict`. Missing public content returns `404 not_found`.

## Testing Strategy

Backend tests:

- Admin login and logout.
- Session-protected admin endpoints.
- Session expiration, session rotation, and logout invalidation.
- Database stores `session_token_hash`, not raw session tokens.
- Admin bootstrap creates the first admin only when no admin exists and never overwrites an existing admin.
- CSRF token and Origin validation for unsafe admin methods.
- Login rate limiting.
- UTC timestamp storage, RFC 3339 API serialization, and injectable-clock publishing behavior.
- Profile API saves nested `social_links` transactionally.
- CRUD behavior for projects, writing, talks, and experience.
- Reorder endpoints validate full `ordered_ids` payloads and normalize `sort_order` transactionally.
- Slug uniqueness for routable content.
- Slug immutability after publish for routable content.
- Hard delete is blocked for published and archived rows, and allowed only for never-published drafts.
- Global `tags.slug` and `techs.slug` filtering behavior.
- Public APIs only returning `status = 'published'` content whose `published_at` is not in the future.
- `GET /api/site/home` featured selection and backfill behavior.
- Backend stores raw Markdown without rendering or persisting HTML.
- Content saves rebuild `media_references` from cover/avatar/OG media fields and `media://asset/{id}/{variant}` Markdown references.
- Media delete is blocked when `media_references` rows exist.
- `media_assets.variants_json` is generated with the required variant keys and immutable derivative paths.
- Admin preview routes are intercepted by Go, require a valid session, and send `X-Robots-Tag: noindex, nofollow`.
- HTTP route priority serves `/api/*`, `/uploads/*`, `/sitemap.xml`, `/robots.txt`, and `/admin/preview/*` before React fallback.
- Raw upload temp files are never served and are removed after processing.
- Upload size, MIME sniffing, image decode, pixel-dimension, path traversal, and derivative-generation restrictions.
- SEO metadata injection for homepage, list pages, contact, and detail routes.
- SEO injection escapes text and attribute values.
- `/robots.txt` and `/sitemap.xml` output.
- Cache headers for `web/dist/assets/*`, meta-injected HTML, API responses, and `/uploads/*` derivatives.
- Production CSP header contains the required directives.
- Home, project detail, admin edit, error, and paginated list response schemas.
- SQLite migration and backup routines.
- Required database indexes exist in migrations.

Frontend tests:

- Public homepage renders key sections from API data.
- Public homepage handles empty optional modules and featured backfill data.
- Admin login handles success and failure.
- Admin forms validate required fields.
- Admin forms render field-level validation errors from `error.fields`.
- Admin profile form edits nested social links.
- Markdown preview renders body content.
- Markdown renderer rejects raw HTML and unsafe links.
- Markdown renderer resolves `media://asset/{id}/{variant}` references through the API-provided media map.
- Public Markdown pages and admin Markdown preview use the same renderer.
- Draft, archived, and future-dated content is not shown on the public site.
- Admin unsafe mutations send `X-CSRF-Token`.
- Loading, empty, and error states render for public lists and admin tables.
- Mobile navigation and stacked homepage sections render at narrow widths.

End-to-end test path:

```text
login
create project
mark project featured and published
confirm homepage shows project
archive project
confirm homepage no longer shows project
```

## Delivery Sequence

1. Scaffold Go server, React app, CSS Modules setup, global tokens, SQLite migrations, config loading, and baseline test commands.
2. Implement auth, session middleware, CSRF/Origin checks, login rate limiting, and their backend tests.
3. Implement SQLite migration helpers, required indexes, WAL settings, backup command, and migration/backup tests.
4. Implement profile and social links APIs with admin/public tests.
5. Implement projects, writing, talks, experience, status transitions, slug immutability, tags/tech stacks, and their API tests.
6. Implement media upload, private raw temp handling, image validation, derivative generation, `media_references`, reference blocking on delete, and upload security tests.
7. Implement Markdown rendering component, sanitizer schema, admin preview pages, and Markdown XSS tests.
8. Implement admin pages for managing content, including slug conflict handling, status changes, media picker, and preview.
9. Implement public pages, home API fallback behavior, detail routes, mobile layouts, dynamic SEO meta injection, sitemap, robots.txt, caching headers, CSP, and frontend route tests.
10. Add production build scripts, deployment notes, and final end-to-end tests.

## Implementation Defaults

Use these defaults unless an approved design change explicitly replaces them:

- Frontend: Vite, React, React Router, TypeScript.
- Styling: CSS Modules plus global CSS variables in `src/styles/tokens.css`.
- Fonts: system font stack only, no external web fonts.
- Backend: Go `net/http`, `chi`, `database/sql`, SQLite, SQL migration files.
- Reordering: up/down buttons in admin list rows.
- Upload inputs: PNG, JPG, JPEG, and WebP only.
- Upload derivatives: JPEG for content imagery and PNG for avatar derivatives needing transparency.
