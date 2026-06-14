# Personal Portfolio Website Design

Date: 2026-06-15
Status: Approved for planning

## Goal

Build a personal portfolio website for showcasing profile information, experience, talks, writing, projects, and contact links. The frontend uses React, the backend uses Go, and the system must make content easy to add and modify without rebuilding the site.

The first version should be close to the provided reference image: clean, content-dense, professional, and centered on the person and their work.

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

The homepage should fetch one aggregated payload from `GET /api/site/home` so the first screen does not depend on many separate requests.

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
- Add, edit, hide, delete, and reorder experience entries.
- Add, edit, hide, delete, feature, and reorder talks.
- Add, edit, draft, publish, hide, delete, and feature writing entries.
- Add, edit, hide, delete, feature, and reorder projects.
- Upload media and copy the generated URL.
- Preview Markdown before saving article and project content.

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

Shared content fields:

- `id`
- `slug` where the item has a detail page
- `visible`
- `featured`
- `sort_order`
- `published_at`
- `created_at`
- `updated_at`

`profile` stores singleton personal information:

- `name`
- `headline`
- `summary`
- `bio`
- `avatar_url`
- `email`

`projects` stores:

- `title`
- `slug`
- `summary`
- `content_md`
- `cover_url`
- `demo_url`
- `repo_url`
- `featured`
- `visible`
- `sort_order`
- `published_at`

`writings` stores:

- `title`
- `slug`
- `excerpt`
- `content_md`
- `cover_url`
- `status` as `draft` or `published`
- `featured`
- `published_at`

`talks` stores:

- `title`
- `slug`
- `summary`
- `cover_url`
- `event_name`
- `video_url`
- `duration_minutes`
- `featured`
- `visible`
- `published_at`

`media_assets` stores uploaded file metadata:

- `file_name`
- `url`
- `mime_type`
- `size_bytes`
- `created_at`

## API Design

Public API:

```text
GET /api/site/home
GET /api/site/profile
GET /api/site/projects
GET /api/site/projects/:slug
GET /api/site/writing
GET /api/site/writing/:slug
GET /api/site/talks
GET /api/site/talks/:slug
```

Admin authentication API:

```text
POST /api/admin/login
POST /api/admin/logout
GET  /api/admin/me
```

Admin content API:

```text
GET   /api/admin/profile
PUT   /api/admin/profile
CRUD  /api/admin/experience
CRUD  /api/admin/projects
CRUD  /api/admin/writing
CRUD  /api/admin/talks
POST  /api/admin/media
PATCH /api/admin/:resource/reorder
```

All admin APIs require a valid session. Public APIs only return visible and published content.

## Authentication And Security

Use server-side sessions with an HttpOnly cookie.

Login flow:

```text
admin submits email/password
Go verifies bcrypt password hash
Go creates a session
browser receives HttpOnly cookie
admin API checks session on every request
```

Configuration:

```text
ADMIN_EMAIL
ADMIN_PASSWORD
SESSION_SECRET
DATABASE_PATH
UPLOADS_DIR
```

The first startup can create the administrator from `ADMIN_EMAIL` and `ADMIN_PASSWORD` if no admin exists. Passwords must be stored as bcrypt hashes.

Upload rules:

- Allow PNG, JPG, JPEG, and WebP uploads.
- Disable SVG uploads in version 1.
- Enforce maximum upload size.
- Store files under `data/uploads/`.
- Serve files under `/uploads/*`.

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

Public components should prioritize scanability, strong typography, stable card dimensions, and responsive behavior. Admin components should prioritize fast editing, clear validation, and predictable navigation.

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

Each content module should own its handlers, request validation, and repository queries. Shared middleware handles logging, session authentication, JSON responses, and errors.

## Error Handling

API errors should use consistent JSON:

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

Slug conflicts should return `409 conflict`. Missing public content should return `404 not_found`.

## Testing Strategy

Backend tests:

- Admin login and logout.
- Session-protected admin endpoints.
- CRUD behavior for projects, writing, talks, and experience.
- Slug uniqueness.
- Public APIs only returning visible and published content.
- Upload size and MIME restrictions.

Frontend tests:

- Public homepage renders key sections from API data.
- Admin login handles success and failure.
- Admin forms validate required fields.
- Markdown preview renders body content.
- Hidden or draft content is not shown on the public site.

End-to-end test path:

```text
login
create project
mark project featured and visible
confirm homepage shows project
hide project
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
