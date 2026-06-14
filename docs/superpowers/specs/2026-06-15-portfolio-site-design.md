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
web/
  dist/
.env
```

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

The public app uses a Vite SPA, but portfolio detail pages still need reliable metadata for search and social sharing. Go must dynamically inject metadata into the built `index.html` for public routes before serving it.

Metadata injection applies to:

```text
/
/bio
/talks/:slug
/writing/:slug
/projects/:slug
```

Content tables that can render detail pages store:

- `seo_title`
- `seo_description`
- `og_image_url`

`profile` stores the default site metadata for homepage and fallback cases.

Go route handling:

- Load the matching profile, project, writing, or talk by route and slug.
- Return a `404` page with no private data when the slug is missing or unpublished.
- Inject `<title>`, description, canonical URL, Open Graph tags, and Twitter card tags.
- Fall back from `seo_title` to content title.
- Fall back from `seo_description` to excerpt or summary.
- Fall back from `og_image_url` to cover image, then profile avatar.

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
- Provide a public preview action before publishing content.
- Provide a media picker for cover images and inline Markdown images.

Version 1 uses explicit up/down controls for reordering. Drag-and-drop is outside version 1.

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
writing_tags
projects
project_tech
media_assets
sessions
```

Publishable content fields:

- `id`
- `slug` where the item has a detail page
- `status` as `draft`, `published`, or `archived`
- `featured`
- `sort_order`
- `published_at`
- `created_at`
- `updated_at`

The publishable content tables are `experiences`, `talks`, `writings`, and `projects`. Public APIs only return rows where `status = 'published'` and `published_at <= now`.

`featured = true` only affects homepage placement. It never makes draft or future-dated content public.

Publishing rules:

- Creating content defaults to `status = 'draft'`.
- Publishing content sets `status = 'published'`.
- If `published_at` is empty when publishing, set it to the current server time.
- Future `published_at` values schedule publication.
- Archiving content sets `status = 'archived'` and keeps historical `published_at`.

`profile` stores singleton personal information:

- `name`
- `headline`
- `summary`
- `bio`
- `avatar_url`
- `email`
- `seo_title`
- `seo_description`
- `og_image_url`

`admins` stores:

- `id`
- `email`
- `password_hash`
- `created_at`
- `updated_at`

`sessions` stores:

- `id`
- `admin_id`
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
- `cover_url`
- `demo_url`
- `repo_url`
- `seo_title`
- `seo_description`
- `og_image_url`
- `status`
- `featured`
- `sort_order`
- `published_at`

`writings` stores:

- `title`
- `slug`
- `excerpt`
- `content_md`
- `cover_url`
- `seo_title`
- `seo_description`
- `og_image_url`
- `status`
- `featured`
- `sort_order`
- `published_at`

`talks` stores:

- `title`
- `slug`
- `summary`
- `cover_url`
- `event_name`
- `video_url`
- `duration_minutes`
- `seo_title`
- `seo_description`
- `og_image_url`
- `status`
- `featured`
- `sort_order`
- `published_at`

`media_assets` stores uploaded file metadata:

- `file_name`
- `storage_key`
- `url`
- `mime_type`
- `size_bytes`
- `width`
- `height`
- `variants_json`
- `checksum_sha256`
- `created_at`

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
DELETE /api/admin/experience/:id
PATCH  /api/admin/experience/reorder

GET    /api/admin/projects?page=:page&limit=:limit&status=:status&q=:q&tech=:tech
POST   /api/admin/projects
GET    /api/admin/projects/:id
PUT    /api/admin/projects/:id
DELETE /api/admin/projects/:id
PATCH  /api/admin/projects/reorder

GET    /api/admin/writing?page=:page&limit=:limit&status=:status&q=:q&tag=:tag
POST   /api/admin/writing
GET    /api/admin/writing/:id
PUT    /api/admin/writing/:id
DELETE /api/admin/writing/:id
PATCH  /api/admin/writing/reorder

GET    /api/admin/talks?page=:page&limit=:limit&status=:status&q=:q
POST   /api/admin/talks
GET    /api/admin/talks/:id
PUT    /api/admin/talks/:id
DELETE /api/admin/talks/:id
PATCH  /api/admin/talks/reorder

GET    /api/admin/media?page=:page&limit=:limit&q=:q
POST   /api/admin/media
DELETE /api/admin/media/:id
```

Admin list defaults:

- `page` defaults to `1`.
- `limit` defaults to `20` and is capped at `100`.
- `status` can be `draft`, `published`, or `archived`.
- `q` searches title, summary, excerpt, or file name depending on resource.

All admin APIs require a valid session. Public APIs only return published content whose `published_at` is not in the future.

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

Configuration:

```text
ADMIN_EMAIL
ADMIN_PASSWORD
SESSION_SECRET
DATABASE_PATH
UPLOADS_DIR
APP_ORIGIN
SESSION_TTL_HOURS
SESSION_IDLE_TIMEOUT_MINUTES
```

The first startup can create the administrator from `ADMIN_EMAIL` and `ADMIN_PASSWORD` if no admin exists. Passwords must be stored as bcrypt hashes.

Session cookie requirements:

- Name: `portfolio_session`.
- `HttpOnly`.
- `Secure` in production. Local development may disable `Secure` only for `http://localhost`.
- `SameSite=Lax`.
- `Path=/`.
- Absolute expiration defaults to `12h`.
- Idle timeout defaults to `2h`.
- Store `created_at`, `last_seen_at`, `expires_at`, and `revoked_at` server-side.
- Rotate the session ID after successful login and after session renewal.
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

## Markdown Rendering Safety

Article and project body content is public, so Markdown rendering must be treated as an untrusted-content boundary even though only the administrator can edit it.

Markdown storage and rendering rules:

- Store the original Markdown in `content_md`.
- Disable raw HTML in Markdown.
- Render admin preview and public pages with the same Markdown configuration.
- Sanitize rendered output with an allowlist before inserting it into the DOM.
- Never use unsanitized `dangerouslySetInnerHTML`.
- Escape code blocks and inline code.
- Allow only expected block and inline elements: headings, paragraphs, lists, blockquotes, tables, code, pre, strong, emphasis, links, images, and horizontal rules.

Link rules:

- Allow `http`, `https`, `mailto`, and same-origin relative URLs.
- Reject `javascript:`, `data:`, `vbscript:`, and protocol-relative URLs.
- External links must use `target="_blank"` and `rel="noopener noreferrer"`.
- Internal links remain same-tab.

Image rules:

- Allow same-origin uploaded images under `/uploads/*`.
- Allow remote `https` images only if explicitly enabled by configuration.
- Reject `data:` images and inline SVG.
- Require `alt` text in admin validation for cover images and Markdown image inserts.

Upload rules:

- Allow PNG, JPG, JPEG, and WebP uploads.
- Disable SVG uploads in version 1.
- Enforce a default maximum upload size of `5MB`.
- Sniff MIME type server-side and do not trust the browser-provided `Content-Type`.
- Verify that the file extension, sniffed MIME type, and decoded image format agree.
- Decode the image server-side to confirm it is a valid image.
- Reject images larger than `6000 x 6000` pixels or `24MP`.
- Generate cryptographically random file names and derive extensions from the validated image type.
- Ignore user-provided file paths and prevent path traversal with `path.Clean`, base-name checks, and an uploads-root containment check.
- Store files under `data/uploads/`.
- Serve files under `/uploads/*` through a Go file handler, not by exposing arbitrary filesystem paths.
- Set exact `Content-Type` and `X-Content-Type-Options: nosniff` when serving uploads.
- Strip EXIF and other metadata by generating normalized public derivatives; reject the upload if normalization fails.
- Generate standard derivatives for common frontend usage: original-bounded image, `1200x675` cover, `800x450` card thumbnail, and `400x400` avatar thumbnail.
- Store derivative paths and dimensions in `media_assets`.
- Keep cover images at a `16:9` target ratio unless a specific module defines another ratio.

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
    "message": "Title is required"
  }
}
```

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
- CSRF token and Origin validation for unsafe admin methods.
- Login rate limiting.
- CRUD behavior for projects, writing, talks, and experience.
- Slug uniqueness.
- Public APIs only returning `status = 'published'` content whose `published_at` is not in the future.
- Markdown renderer rejects raw HTML and unsafe links.
- Upload size, MIME sniffing, image decode, pixel-dimension, path traversal, and derivative-generation restrictions.
- SEO metadata injection for homepage and detail routes.
- SQLite migration and backup routines.

Frontend tests:

- Public homepage renders key sections from API data.
- Admin login handles success and failure.
- Admin forms validate required fields.
- Markdown preview renders body content.
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

1. Scaffold Go server, React app, SQLite migrations, and basic config.
2. Implement auth, session middleware, and admin bootstrap.
3. Implement profile and social links.
4. Implement projects, writing, talks, experience, and media upload APIs.
5. Build admin pages for managing content.
6. Build public pages and detail routes.
7. Add tests and production build/deploy scripts.

## Implementation Defaults

Use these defaults unless an approved design change explicitly replaces them:

- Frontend: Vite, React, React Router, TypeScript.
- Backend: Go `net/http`, `chi`, `database/sql`, SQLite, SQL migration files.
- Reordering: up/down buttons in admin list rows.
- Uploads: PNG, JPG, JPEG, and WebP only.
