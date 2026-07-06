# Writing Markdown Import Design

Date: 2026-06-29
Status: Draft for review

## Goal

Add a Markdown import workflow for the admin writing area so an administrator can import a local `.md` file into the existing `writings` content model, preview the parsed result, and then either create a new writing entry or overwrite an existing draft.

The imported article must keep the current storage model:

- article metadata stays in `writings`
- article body stays in `writings.content_md`
- localized writing flows continue to work on top of the saved Chinese source row

Only referenced local media files are expanded into object storage. Local images, audio, and video discovered during import are added to the media library in MinIO-backed storage, and the Markdown body is rewritten to use system-managed media references instead of raw local file paths.

## Confirmed Decisions

- Support both `create new writing from import` and `overwrite current draft`.
- Support optional YAML front matter. If a file has front matter, parse supported fields. If it does not, import body only.
- Import local media files referenced by the Markdown instead of blocking the import.
- Imported media should enter the media library, not a writing-specific private storage area.
- Media categories in scope are images, video, and audio.
- The article itself remains stored exactly as the current writing feature stores it.
- The admin flow must be preview-first: parse and inspect the result before any writing row is committed.
- `cover` is supported as an optional front matter key. It maps to `cover_media_id` only when it resolves to a successfully prepared imported image asset.
- The importer does not auto-promote the first Markdown image to cover in v1. Cover assignment must be explicit to avoid surprising overwrites.

## Current Context

The existing system already has these relevant boundaries:

- Writing create and update are handled by the current admin routes under `/api/admin/writing` with `WritingInput`.
- Writing body content is stored as raw Markdown in `writings.content_md`.
- Markdown currently rejects unsafe direct upload paths and remote images through `validateMarkdownMedia`.
- The media service already has a clean responsibility boundary around metadata, variants, and `storage_key`.
- Previous storage design work explicitly called out a future `BlobStore` boundary for MinIO without requiring the whole app to migrate at once.

This feature should build on those boundaries instead of replacing them.

The current frontend and public-detail contract also has gaps that must be fixed as part of this feature:

- the shared Markdown renderer currently rewrites inline images only when resolved URLs begin with `/uploads/`
- the shared safe-link logic does not recognize `media://asset/...` references
- the public writing detail response does not currently guarantee an attached `media` map for Markdown resolution
- the frontend `MediaVariant` type assumes `width` and `height` are always present

The writing-import feature must close those gaps instead of working around them with a writing-only exception.

## Non-Goals

The first version does not include:

- bulk import of multiple Markdown articles in one action
- full repository import from a folder or zip archive
- automatic import of PDFs, DOCX, or HTML
- AI cleanup or summarization of imported content
- video transcoding, audio transcoding, waveform generation, or poster extraction
- inline audio or video player rendering on public pages
- full migration of all existing media assets from local filesystem storage to MinIO
- changing the public writing page structure
- changing the multilingual translation workflow
- preserving the old `/uploads/...`-only assumption in Markdown rendering

## User Experience

### Entry Points

UI copy for this workflow should stay Chinese-first in the product, but this spec records each label with an English identifier to avoid ambiguity in implementation and review.

The import feature should be visible in two places:

1. On `/admin/writing` list page as a new primary action labeled `Import Markdown` (`导入 Markdown`).
2. On `/admin/writing/:id` draft edit page as a contextual action labeled `Import Local Markdown` (`导入本地 Markdown`).

The list-page entry is optimized for creating a new writing from a local file.

The draft edit-page entry is optimized for replacing the current draft body and metadata with imported content while keeping the draft identity, translation rows, and admin route intact.

Published and archived writings must not expose the overwrite flow. Only drafts may be overwritten.

### Import Surface

The import UI should be a two-step modal or drawer workflow, not a direct file input inside the existing form.

Step 1: `Choose Files` (`选择文件`)

- Select one `.md` file.
- Optionally drag in or pick local media files that live beside the Markdown file or in its subdirectories.
- Show the intended mode:
  - `Create Writing` (`新建写作`)
  - `Overwrite Draft` (`覆盖当前草稿`)
- If the entry point is the draft edit page, `Overwrite Draft` is preselected and the target draft is shown read-only.
- If the entry point is the writing list page, default to `Create Writing`.

Step 2: `Import Preview` (`导入预览`)

The preview is split into two regions.

Left side:

- parsed title
- parsed excerpt
- parsed tags
- parsed slug
- parsed cover mapping
- parsed SEO fields
- import mode
- media import summary
- unresolved warnings

Right side:

- original Markdown summary
- rewritten Markdown preview
- rendered content preview
- media replacement list showing original relative path and final system-managed media reference

Footer actions:

- `Back` (`返回修改`)
- `Create And Import` (`新建写作并导入`)
- `Overwrite Draft` (`覆盖当前草稿`)

The confirm button label changes with the selected mode.

### Editing Rules During Preview

The preview step is not read-only. It should allow editing the final fields before commit:

- title
- excerpt
- tags
- slug
- SEO title
- SEO description
- final body Markdown

This matters because imported files may have incomplete front matter, duplicate slugs, or titles that need a quick correction before save.

The raw source file is not changed. Only the preview draft state is editable.

### Media Presentation In Preview

Each detected local media file should show:

- original relative path from the Markdown
- matched uploaded file name
- detected media type: image, video, or audio
- validation result
- resulting system media reference
- resulting public delivery type

When an asset fails validation, the preview must keep the item visible with a clear blocking reason instead of silently skipping it.

When an asset succeeds, preview should also show the resolved same-origin delivery route that the public site will use, for example `/media/201/content`.

### Empty, Warning, and Blocking States

Warnings that still allow commit:

- unsupported front matter keys were ignored
- front matter was missing and only body content was imported
- slug was auto-generated because the file did not provide one
- overwrite will mark existing translated writing variants as stale after commit

Blocking errors:

- Markdown file is missing or invalid
- referenced local media path was not supplied
- a referenced local media path escapes the Markdown directory via `../`
- referenced media file type is unsupported
- target draft is no longer a draft
- overwrite target changed after preview generation
- any media upload or pending asset activation failed

If blocking errors exist, the commit button remains disabled.

## Markdown Parsing Rules

### Accepted File Shape

The import workflow accepts one UTF-8 `.md` file per session.

Supported front matter keys in v1:

- `title`
- `excerpt`
- `tags`
- `slug`
- `cover`
- `seo_title`
- `seo_description`

Front matter examples that should parse:

```yaml
---
title: Example
excerpt: Short summary
tags:
  - AI
  - Notes
slug: example-post
cover: ./images/cover.png
seo_title: Example SEO Title
seo_description: Example SEO Description
---
```

```yaml
---
title: Example
tags: AI, Notes, Engineering
---
```

Unsupported keys are ignored but surfaced back in the preview warnings.

`cover` is interpreted as a local relative image path only. If it resolves successfully during preview, the importer sets `cover_media_id` in the parsed payload. If it is missing, invalid, or points to a non-image asset, commit is blocked until the issue is fixed or the cover mapping is cleared in preview.

### Body Rules

- If front matter exists, the remaining document body becomes `content_md`.
- If front matter does not exist, the full file becomes `content_md`.
- The import pipeline does not render or sanitize HTML at import time beyond existing Markdown validation rules. Public rendering remains the existing markdown-renderer responsibility.

### Media Reference Detection

The importer scans the Markdown body for local relative file references.

Supported patterns:

- Markdown image syntax, for example `![cover](./images/cover.png)`
- Markdown link syntax, for example `[demo video](./clips/demo.mp4)` or `[podcast](./audio/intro.mp3)`

The importer does not fetch or rewrite:

- `http://`
- `https://`
- `mailto:`
- already-saved `media://asset/...`
- absolute Windows paths
- absolute POSIX paths

### Safe Local Path Resolution

Each local relative path is resolved against the directory containing the selected `.md` file.

Rules:

- normalized path must stay inside that directory root
- `../` traversal outside the root is rejected
- duplicate references to the same normalized file path should map to one imported media asset inside the same import session
- path matching is normalized to forward-slash form and then compared case-sensitively on every platform

This intentionally prefers deterministic Linux-style behavior over platform-specific case folding. If the Markdown says `./Images/Cover.png` and the uploaded file is `./images/cover.png`, preview should surface an explicit unresolved-media error instead of guessing.

## Media Library And MinIO Design

### Scope

This feature introduces MinIO-backed storage for imported media library assets discovered during Markdown import. It does not move article storage itself into MinIO.

Existing writing rows remain database-backed. Existing local media assets may continue to resolve from local storage. New imported media assets for this workflow are MinIO-backed.

This means the media subsystem must temporarily support mixed backends.

### Supported Media Types

Images:

- `.png`
- `.jpg`
- `.jpeg`
- `.webp`

Video:

- `.mp4`
- `.webm`
- `.mov`

Audio:

- `.mp3`
- `.m4a`
- `.wav`
- `.ogg`

Any future additions should happen centrally in the media service type allowlist, not only in the writing importer.

### Storage Shape

Use one logical MinIO media bucket for public library assets:

```text
portfolio-media
```

Use type-based key prefixes instead of separate buckets:

```text
images/YYYY/MM/{storage-key}/...
videos/YYYY/MM/{storage-key}/...
audio/YYYY/MM/{storage-key}/...
```

This keeps permissions, lifecycle policy, and public URL configuration simpler while still preserving type boundaries.

If strict physical bucket separation is required later, the `BlobStore` layer can change without changing writing-import API contracts or stored Markdown.

### Public Media URL Architecture

This feature should standardize on a backend-resolved same-origin public media route:

```text
/media/{assetID}/{variant}
```

Examples:

- `/media/201/content`
- `/media/201/card`
- `/media/301/original`

This route is the canonical public delivery path for all API-provided media references, regardless of whether the underlying asset lives on local disk or in MinIO.

Reasons:

- it removes the frontend dependency on `/uploads/...`
- it keeps MinIO endpoints private to the server if desired
- it lets the backend resolve delivery by `storage_backend`
- it gives one stable URL contract for local, hybrid, and future fully-remote storage

Legacy `/uploads/*` static serving may remain for backward compatibility with older stored or cached URLs, but newly returned `MediaMap` entries for markdown-rendered content should use `/media/{id}/{variant}`.

This means frontend rendering no longer depends on the backend object URL format. Whether the bytes ultimately come from local disk or MinIO is hidden behind the same-origin route contract.

### BlobStore Evolution

The system should formalize the storage abstraction that previous storage work already anticipated:

```go
type BlobStore interface {
    Put(ctx context.Context, key string, reader io.Reader, contentType string) error
    Open(ctx context.Context, key string) (io.ReadCloser, error)
    Delete(ctx context.Context, key string) error
    PublicURL(ctx context.Context, key string) string
}
```

Implementations in scope after this design:

- `LocalBlobStore` for existing local filesystem-backed assets
- `MinIOBlobStore` for imported media assets

The media read path must resolve by asset backend, not by a single global assumption.

`BlobStore.Open()` becomes part of the public media delivery path. The new `/media/{assetID}/{variant}` handler should:

1. load `media_assets`
2. validate the requested variant exists
3. derive a stable blob key for the requested backend and variant
4. inspect `storage_backend`
5. stream bytes through the matching blob store implementation
6. set exact `Content-Type`
7. set immutable cache headers

For `LocalBlobStore`, the `Open(ctx, key)` argument should mean a blob key relative to the local uploads root, not a public path such as `/uploads/ab/cd/content.jpg`.

The handler should therefore avoid trusting legacy JSONB `variants.path` for filesystem lookup. For legacy local assets it should derive the local blob key from stable metadata:

- `storage_key`
- requested variant name
- the known local derivative naming convention, for example `content.jpg`, `cover.jpg`, `card.jpg`, `avatar.png`

Then `LocalBlobStore` can resolve the physical file from its configured `uploadsDir` root plus that relative key.

This keeps public routing independent from possibly stale historical `variants.path` values and matches the broader rule that `storage_key` is the stable identifier while delivery paths are derived.

This replaces the old assumption that all public media can be served directly from `http.FileServer(http.Dir(uploadsDir))`.

`BlobStore.PublicURL(...)` may still exist for internal tooling or future signed-object workflows, but Markdown and public detail APIs should not expose backend object URLs directly. Their stable contract is the same-origin `/media/{assetID}/{variant}` route.

### Media Metadata Model

Extend `media_assets` so new MinIO-backed assets can coexist with old local assets.

New columns:

- `storage_backend TEXT NOT NULL DEFAULT 'local'`
  - allowed values: `local`, `minio`
- `lifecycle_state TEXT NOT NULL DEFAULT 'active'`
  - allowed values: `active`, `pending_import`
- `media_kind TEXT NOT NULL DEFAULT 'image'`
  - allowed values: `image`, `video`, `audio`

Keep `storage_key` as the stable blob identifier.

Existing schema constraints need a compatibility migration before audio or video assets can be stored. The current table requires `width` and `height` to be non-null positive integers, which is only valid for images.

Schema rule after migration:

- image assets must have `width` and `height`
- audio and video assets must store `NULL` for `width` and `height`

Recommended constraint shape:

```sql
CHECK (
  (media_kind = 'image' AND width IS NOT NULL AND width > 0 AND height IS NOT NULL AND height > 0)
  OR
  (media_kind IN ('audio', 'video') AND width IS NULL AND height IS NULL)
)
```

Keep `variants JSONB`, but allow mixed payloads during the transition:

- local assets may keep `path`-oriented entries
- minio assets should use `key`-oriented entries

Example image asset variants for MinIO:

```json
{
  "content": {
    "key": "images/2026/06/abc123/content.jpg",
    "mime_type": "image/jpeg",
    "width": 1600,
    "height": 900,
    "size_bytes": 123456
  },
  "cover": {
    "key": "images/2026/06/abc123/cover.jpg",
    "mime_type": "image/jpeg",
    "width": 1200,
    "height": 675,
    "size_bytes": 45678
  },
  "card": {
    "key": "images/2026/06/abc123/card.jpg",
    "mime_type": "image/jpeg",
    "width": 800,
    "height": 450,
    "size_bytes": 23456
  }
}
```

Example video asset variants for MinIO:

```json
{
  "original": {
    "key": "videos/2026/06/def456/original.mp4",
    "mime_type": "video/mp4",
    "size_bytes": 24567890
  }
}
```

Example audio asset variants for MinIO:

```json
{
  "original": {
    "key": "audio/2026/06/ghi789/original.mp3",
    "mime_type": "audio/mpeg",
    "size_bytes": 5678901
  }
}
```

Frontend type impact:

- image variants keep `width` and `height`
- audio and video `original` variants omit `width` and `height`

The shared frontend `MediaVariant` type must therefore change to:

```ts
type MediaVariant = {
  url: string;
  width?: number;
  height?: number;
  mime_type: string;
};
```

### Markdown Reference Strategy

Imported content must not persist raw MinIO URLs inside `writings.content_md`.

Instead, the importer should rewrite local references into system-managed media references:

- images become `![alt](media://asset/{id}/content)`
- video or audio links become `[label](media://asset/{id}/original)`

This preserves the existing product principle that Markdown stores stable internal references instead of mutable delivery URLs.

Consequences:

- writing rows remain portable across storage backend changes
- MinIO endpoint changes do not require rewriting stored Markdown
- `media_references` can remain asset-based
- the renderer and API can resolve final public URLs consistently

### Markdown Rendering Extension

The existing Markdown system already knows how to resolve `media://asset/{id}/{variant}` for images.

Extend it so Markdown links with `href=media://asset/{id}/{variant}` are also resolved through the media map:

- image syntax continues to render image output
- link syntax resolves to a safe public URL anchor

Public pages do not need embedded media players in v1. A standard link is acceptable for imported audio and video references.

Required frontend renderer changes:

- remove the hardcoded `/uploads/` gate from image rewrite logic
- resolve any `media://asset/{id}/{variant}` reference through the provided `MediaMap`
- only trust resolved URLs that point to the canonical same-origin `/media/` route
- for anchor tags, resolve `media://asset/...` before applying generic safe-link checks

Recommended rendering flow:

1. parse Markdown
2. when encountering `media://asset/{id}/{variant}`, call a shared `resolveMediaURL(...)`
3. if resolution succeeds, replace the href or img src with the resolved same-origin `/media/...` URL
4. only after resolution, apply link safety checks to non-media links

This keeps raw `media://` values from ever reaching the browser as final href or src values.

## Schema Migration

Add a dedicated migration file:

```text
internal/db/migrations/003_writing_import.sql
```

The migration should:

1. alter `media_assets`
2. create `writing_import_sessions`
3. create `writing_import_session_assets`
4. add indexes needed for cleanup and lookup

Minimum `media_assets` migration actions:

```sql
ALTER TABLE media_assets
  ADD COLUMN storage_backend TEXT NOT NULL DEFAULT 'local' CHECK (storage_backend IN ('local', 'minio')),
  ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_state IN ('active', 'pending_import')),
  ADD COLUMN media_kind TEXT NOT NULL DEFAULT 'image' CHECK (media_kind IN ('image', 'video', 'audio'));

ALTER TABLE media_assets
  ALTER COLUMN width DROP NOT NULL,
  ALTER COLUMN height DROP NOT NULL;
```

The migration must then replace the old unconditional `width > 0` and `height > 0` checks with the conditional image-only rule above.

Because the original checks were created inline without explicit names, the migration must first discover and drop the generated PostgreSQL constraint names before adding the new composite constraint. The migration cannot rely on a fixed legacy constraint name.

Recommended migration shape:

- drop `NOT NULL` from `width` and `height`
- run a `DO $$ ... $$` block that locates the legacy width and height check constraints in `pg_constraint`
- drop those discovered constraints
- add the new named composite constraint, for example `media_assets_kind_dimensions_check`

`writing_import_sessions` should index:

- `token_hash`
- `expires_at`
- `status`
- `admin_session_id`

`writing_import_session_assets` should index:

- `session_id`
- `media_asset_id`
- `status`

## Import Session Design

The feature needs explicit session state because preview and commit are separate operations.

Add:

```text
writing_import_sessions
writing_import_session_assets
```

### `writing_import_sessions`

Fields:

- `id`
- `token_hash`
- `admin_session_id`
- `mode`
- `target_writing_id`
- `target_writing_etag`
- `source_file_name`
- `source_checksum_sha256`
- `front_matter JSONB`
- `ignored_front_matter_keys JSONB`
- `original_markdown`
- `rewritten_markdown`
- `parsed_payload JSONB`
- `status`
- `expires_at`
- `created_at`
- `updated_at`

Allowed `mode` values:

- `create`
- `overwrite`

Allowed `status` values:

- `preview_ready`
- `committed`
- `expired`
- `failed`

### `writing_import_session_assets`

Fields:

- `id`
- `session_id`
- `media_asset_id`
- `original_relative_path`
- `normalized_source_path`
- `replacement_ref`
- `status`
- `error_message`
- `created_at`

Allowed `status` values:

- `prepared`
- `failed`
- `activated`
- `cleaned`

The session tables own preview-stage imported media before the writing row is committed.

### Session Lifetime

Import sessions expire after 2 hours by default.

The cleanup mechanism should be explicit:

- run one startup cleanup pass so abandoned sessions from a previous process do not survive a restart
- run an in-process periodic sweeper every 15 minutes while the single Go instance is alive

This project already assumes a single running Go instance for admin writes, so an in-process sweeper is acceptable in v1 and avoids waiting for a restart before stale preview assets are reclaimed.

Expired sessions must be cleaned by the sweeper and startup cleanup path:

- deletes pending MinIO objects for uncommitted session assets
- deletes `media_assets` rows still marked `pending_import`
- deletes session rows or marks them expired

## Preview And Commit API

Keep the existing writing CRUD routes unchanged. Add a dedicated import API.

### `POST /api/admin/writing/imports/preview`

Purpose:

- parse the Markdown file
- detect front matter
- validate and prepare local media imports
- create pending media assets
- rewrite Markdown to final internal media references
- return a preview snapshot plus import token

Request type:

- `multipart/form-data`

Request parts:

- `markdown_file`
- `media_files[]`
- `mode`
- `target_id`
- `parse_front_matter`

Behavior:

- `target_id` is required only for `overwrite`
- if overwrite mode is selected, target writing must exist and be `draft`
- target writing `ETag` or version snapshot is captured into the session at preview time
- if the target draft already has locale translations, preview returns a warning that commit will increment `translation_source_version` and make those translations stale

Token rules:

- generate a 256-bit random token with `crypto/rand`
- return the opaque token to the frontend once
- store only `sha256(token)` as `token_hash`
- bind the session row to the current authenticated admin session via `admin_session_id`
- require normal admin auth middleware on preview, recovery, and commit
- require normal CSRF protection on commit because it is a write endpoint

Preview response shape:

```json
{
  "import_token": "opaque-token",
  "mode": "create",
  "target": null,
  "parsed": {
    "title": "Example title",
    "excerpt": "Example excerpt",
    "tags": ["AI", "Notes"],
    "slug": "example-title",
    "cover_media_id": 201,
    "seo_title": "",
    "seo_description": "",
    "content_md": "![cover](media://asset/201/content)"
  },
  "media_map": {
    "201": {
      "content": {
        "url": "/media/201/content",
        "width": 1600,
        "height": 900,
        "mime_type": "image/jpeg"
      },
      "card": {
        "url": "/media/201/card",
        "width": 800,
        "height": 450,
        "mime_type": "image/jpeg"
      }
    }
  },
  "front_matter": {
    "used_keys": ["title", "tags"],
    "ignored_keys": ["date"]
  },
  "media": [
    {
      "original_path": "./images/cover.png",
      "media_asset_id": 201,
      "media_kind": "image",
      "status": "prepared",
      "replacement_ref": "media://asset/201/content"
    }
  ],
  "warnings": [],
  "blocking_errors": []
}
```

### `GET /api/admin/writing/imports/preview/{token}`

Purpose:

- restore an existing preview after refresh or accidental navigation

Rules:

- same admin session ownership check as commit
- returns `404` if the token is unknown or not owned by the current session
- returns `410` if the preview session is expired
- requires only normal authenticated admin GET semantics, not CSRF
- returns the same `media_map` contract as the preview response so the frontend can fully restore the import preview surface after refresh

### `POST /api/admin/writing/imports/commit`

Purpose:

- finalize the preview payload as a real writing save
- either create a new writing or overwrite the target draft
- activate all pending media assets prepared by the import session
- refresh `media_references` through the normal writing save logic

Request body:

```json
{
  "import_token": "opaque-token",
  "mode": "overwrite",
  "target_id": 12,
  "payload": {
    "title": "Edited title",
    "excerpt": "Edited excerpt",
    "slug": "edited-title",
    "cover_media_id": 201,
    "seo_title": "",
    "seo_description": "",
    "content_md": "![cover](media://asset/201/content)",
    "tags": ["AI", "Notes"]
  }
}
```

Payload mapping to the existing save path is direct:

- `payload.title` -> `WritingInput.Title`
- `payload.excerpt` -> `WritingInput.Excerpt`
- `payload.slug` -> `WritingInput.Slug`
- `payload.cover_media_id` -> `WritingInput.CoverMediaID`
- `payload.seo_title` -> `WritingInput.SEOTitle`
- `payload.seo_description` -> `WritingInput.SEODescription`
- `payload.content_md` -> `WritingInput.ContentMD`
- `payload.tags` -> `WritingInput.Tags`

Commit response shape:

```json
{
  "writing": {
    "id": 12,
    "title": "Edited title",
    "slug": "edited-title",
    "excerpt": "Edited excerpt",
    "content_md": "![cover](media://asset/201/content)",
    "status": "draft",
    "media": {
      "201": {
        "content": {
          "url": "/media/201/content",
          "width": 1600,
          "height": 900,
          "mime_type": "image/jpeg"
        }
      }
    }
  },
  "import_summary": {
    "mode": "overwrite",
    "media_prepared": 1,
    "media_activated": 1,
    "warnings": []
  }
}
```

### Route Naming

Use singular resource naming to stay consistent with the existing admin API:

- `/api/admin/writing/imports/preview`
- `/api/admin/writing/imports/commit`

Do not introduce `/api/admin/writings/...`.

## Service Responsibilities

Add a dedicated import orchestration service, for example:

```text
internal/content/writing_import.go
internal/content/writing_import_routes.go
```

Responsibilities:

- parse Markdown and front matter
- resolve local relative media references
- validate imported media types
- prepare pending media assets through the media subsystem
- rewrite Markdown references
- persist and validate import sessions
- commit through existing `CreateWriting` or `UpdateWriting`

Keep it separate from the regular writing repository methods. Normal writing create and update should not grow preview-session concerns.

## Media Service Changes

The media service must grow in these ways:

- support `image`, `video`, and `audio`
- support `local` and `minio` backends
- support `active` and `pending_import` lifecycle states
- expose an internal prepare/activate/cleanup workflow for import sessions

Validation paths must split by `media_kind` instead of forcing every asset through the current image upload path.

Suggested internal service shape:

- `PrepareImportAsset(...)`
- `ActivatePreparedAsset(...)`
- `CleanupPreparedAsset(...)`

`Upload(...)` for the existing media page can remain, but the new writing import flow should not fake itself through the existing generic single-file upload endpoint.

Validation rules by kind:

- image:
  - use the existing image sniff + decode path
  - keep current dimension and megapixel checks
  - generate image variants
- video:
  - validate by extension plus sniffed MIME type
  - do not call `image.Decode`
  - do not generate image variants
  - store one `original` variant entry only
- audio:
  - validate by extension plus sniffed MIME type
  - do not call `image.Decode`
  - do not generate image variants
  - store one `original` variant entry only

Expected MIME families:

- image: `image/png`, `image/jpeg`, `image/webp`
- video: `video/mp4`, `video/webm`, `video/quicktime`
- audio: `audio/mpeg`, `audio/mp4`, `audio/wav`, `audio/wave`, `audio/ogg`

The current `Upload(...)` path remains image-only unless and until the media page is explicitly extended for manual audio/video uploads. `PrepareImportAsset(...)` must be a separate validation and storage path rather than an alias to the existing image uploader.

## Write-Path Consistency

### Preview Phase

During preview:

1. validate `.md`
2. parse front matter
3. detect local media references
4. prepare MinIO-backed assets as `pending_import`
5. create `media_assets` rows as `pending_import`
6. rewrite Markdown using final `media://asset/{id}/{variant}` refs
7. persist import session
8. return preview payload

Prepared assets must not appear in the normal `/api/admin/media` list until activated.

`created_at` for prepared media rows is set during preview creation. Commit only flips `lifecycle_state` from `pending_import` to `active`; it does not rewrite `created_at`.

### Commit Phase

During commit:

1. load session by token
2. verify not expired and not already committed
3. verify overwrite target has not changed
4. verify no blocking media failures remain
5. save writing through the existing repository path
6. activate all pending media assets for the session
7. rebuild `media_references`
8. mark session committed

For overwrite mode, the commit path intentionally reuses the existing `UpdateWriting` behavior. If `title`, `slug`, `excerpt`, `content_md`, `seo_title`, or `seo_description` changed, `translation_source_version` increments and any existing writing translations become stale. This is expected behavior and must already have been disclosed in preview warnings.

Writing save and media activation should happen within one coordinated transaction boundary as far as database state is concerned.

If MinIO activation cleanup cannot be done atomically with the database write, the failure strategy must prefer:

- no visible writing commit
- no active media rows
- session left in recoverable failed state

### Abandonment And Cleanup

If the user never commits:

- session expires
- pending media rows are deleted
- corresponding MinIO objects are deleted
- no writing row is created or changed

This prevents orphaned preview artifacts from becoming visible library assets.

## Validation Rules

### Markdown File

- required
- extension must be `.md`
- size cap: 1 MB
- decode as UTF-8 text

### Referenced Local Media

- must be explicitly supplied in `media_files[]`
- must resolve inside the Markdown directory root
- duplicate logical paths are deduplicated

### Media Size Caps

Images:

- keep existing image upload limits

Audio:

- max 50 MB per file

Video:

- max 200 MB per file

Overall preview request:

- max 300 MB

The preview endpoint must stream large multipart files to temp storage instead of reading every file fully into memory.

### Overwrite Safety

Overwrite is allowed only when:

- target writing exists
- target writing status is `draft`
- target writing version matches the preview snapshot

If the draft changed after preview generation, commit returns `409 conflict` and asks the user to regenerate preview.

## Writing Repository And Markdown Validation Changes

`CreateWriting` and `UpdateWriting` should continue to own the final save.

The Markdown validation layer needs a narrow extension:

- continue rejecting raw `/uploads/*`
- continue rejecting remote images
- continue rejecting unsafe media references
- allow internal `media://asset/{id}/{variant}` links for image, audio, and video references

Do not broaden the write path to allow arbitrary vendor URLs from MinIO or elsewhere.

When the writing save rebuilds `media_references`, imported article assets continue to use:

- `resource_type = 'writing'`
- `source = 'markdown'`

No new `media_references.source` enum is required for this feature.

## Public API Enrichment For Markdown Media

This feature requires a real `MediaMap` contract on public writing detail responses.

Add `media` to the writing detail item shape:

```go
type Writing struct {
    ...
    Media map[string]map[string]MediaVariant `json:"media,omitempty"`
}
```

The public writing detail read path must:

1. load the writing row or localized writing row
2. scan `content_md` for `media://asset/{id}/{variant}` references
3. fetch the corresponding `media_assets` rows
4. build a `MediaMap`
5. attach that map to `item.media`

The same enrichment rule should apply for:

- source-locale writing detail
- translated writing detail
- writing import preview response
- writing import recovery response
- commit response when the returned writing includes `content_md`

This scan-and-enrich step is required for imported writing media to render at all.

To avoid contract drift, the same approach should also be applied to any other long-body resource that uses `MarkdownView`, especially projects.

Performance note:

- for a single public detail page, scanning `content_md` on read is acceptable in v1 even for moderately long articles
- the enrichment step should deduplicate referenced asset IDs before the metadata lookup so it performs one batched query, not one query per match
- if this later becomes hot, the extension point is to precompute referenced media IDs at write time, for example into a dedicated join table or a cached `BIGINT[]` column, without changing the public `item.media` response contract

Public detail response example:

```json
{
  "item": {
    "id": 12,
    "title": "Example",
    "slug": "example",
    "content_md": "![cover](media://asset/201/content)\n\n[podcast](media://asset/301/original)",
    "media": {
      "201": {
        "content": {
          "url": "/media/201/content",
          "width": 1600,
          "height": 900,
          "mime_type": "image/jpeg"
        }
      },
      "301": {
        "original": {
          "url": "/media/301/original",
          "mime_type": "audio/mpeg"
        }
      }
    }
  },
  "locale": {
    "requested": "zh",
    "resolved": "zh"
  }
}
```

List responses do not need to attach `media` unless that page actually renders full Markdown bodies. The required contract is on any response consumed by `MarkdownView`.

## Frontend Contract Changes

The shared markdown and public-detail frontend contract must be updated in these ways:

- `MediaVariant.width` and `MediaVariant.height` become optional
- image rendering only supplies width and height attributes when present
- `MarkdownView` resolves media references through `MediaMap`, not through a hardcoded `/uploads/` prefix
- `MarkdownView` resolves media links as anchors before generic safe-link validation
- detail responses continue to use `detail.item.media` so the existing page composition stays stable

`isSafeLink(...)` should not become a blanket whitelist for raw `media://` values across the app. Instead, the markdown renderer should resolve known `media://asset/...` references first, then pass the resolved same-origin `/media/...` URL through normal safety checks.

Concretely:

- `rewriteMediaImages(...)` should stop checking `variant.url.startsWith("/uploads/")`
- image rewrites should succeed when the resolved URL is the canonical `/media/...` route
- anchor rendering should detect `media://asset/...`, resolve it through `resolveMediaURL(...)`, and then render the resolved `/media/...` href
- unresolved `media://asset/...` references should degrade safely instead of emitting a broken browser link

## Admin Media Library Changes

The media page must evolve enough to represent imported non-image assets:

- show media type badge: image, video, audio
- render image thumbnails when available
- render placeholder tiles for audio and video
- keep delete behavior based on reference state
- keep `accept` rules aligned with the allowed upload kinds for the surface in question
- stop assuming every media card has an image-style `variants.card` thumbnail

Recommended placeholder presentation for non-image media cards:

- keep the same card frame and sizing as image cards so the grid remains stable
- replace the thumbnail area with a themed placeholder panel
- video uses a play icon plus `VIDEO` badge
- audio uses a waveform or speaker icon plus `AUDIO` badge
- show filename and MIME type in the body
- copy helper should emit `[label](media://asset/{id}/original)` for audio or video assets instead of image syntax

For image assets, the card may still preview `variants.card` when available and copy an image-oriented markdown helper.

If the media page later supports direct manual audio or video upload, its file input must expand beyond the current image-only accept list. That UI change is not a hidden side effect of the writing-import release; it should be implemented deliberately if included in scope.

Direct manual upload of audio and video from `/admin/media` is a compatible follow-up, but it is not required for the first Markdown-import release.

Imported assets from writing import must still appear in the media library after activation.

`GET /api/admin/media` should return only `active` assets in normal mode. Pending import assets remain hidden from the regular media library until the import is committed.

## Security Considerations

- Import is admin-authenticated only.
- Server never reads arbitrary local filesystem paths directly from the client.
- Client-supplied relative paths are only used to match uploaded multipart files within the import session.
- No remote fetch is allowed during import.
- Markdown import does not weaken existing public Markdown sanitization.
- Internal `media://asset/...` references remain the only durable asset syntax saved to writing bodies.
- Public delivery URLs are resolved at read time through media metadata and storage backend logic.

## Operational Considerations

- MinIO configuration becomes a required runtime dependency only for this feature path.
- Existing deployments without MinIO should either disable the import feature or fail startup with a clear message once the feature is enabled.
- Add startup validation for:
  - MinIO endpoint
  - access key
  - secret key
  - bucket existence or auto-create policy
  - ability for the application server to read stored objects back through the configured credentials so `/media/{assetID}/{variant}` can stream them

Recommended runtime config additions:

```text
MEDIA_BLOB_BACKEND
MINIO_ENDPOINT
MINIO_ACCESS_KEY
MINIO_SECRET_KEY
MINIO_BUCKET
MINIO_USE_SSL
```

The public site does not need a MinIO public base URL for this feature because browser-facing media delivery is standardized on same-origin `/media/{assetID}/{variant}`.

`MEDIA_BLOB_BACKEND` should allow `local` and `hybrid`.

Suggested meaning:

- `local`: existing behavior only
- `hybrid`: existing local assets remain valid, imported writing media uses MinIO

## Testing Strategy

### Backend

Unit tests:

- front matter parsing with and without YAML
- tag normalization from array and comma-separated string
- local path normalization and traversal rejection
- Markdown rewrite for image links
- Markdown rewrite for audio or video links
- duplicate local media reference deduplication
- unsupported media type rejection
- overwrite draft conflict after version change
- public media-map enrichment for `media://asset/...` references in writing content
- frontend media URL resolution from `media://asset/...` to `/media/{id}/{variant}`
- renderer behavior when image variants have width and height but audio or video variants do not

Repository or integration tests:

- preview creates pending import session
- preview creates pending media assets not visible in normal media list
- commit creates new writing successfully
- commit overwrites draft successfully
- commit activates pending assets
- expired session cleanup removes pending rows and MinIO objects
- commit failure leaves no active media rows and no visible writing change
- public writing detail returns `item.media` when `content_md` references internal media
- `/media/{assetID}/{variant}` streams both legacy local assets and MinIO-backed assets

Blob store tests:

- `MinIOBlobStore` put and public URL resolution
- cleanup delete for prepared assets
- mixed local and minio asset read resolution

### Frontend

- writing list page shows `导入 Markdown`
- draft editor shows `导入本地 Markdown`
- preview step renders parsed metadata
- preview step renders blocking errors
- confirm button state matches create or overwrite mode
- overwrite mode unavailable for non-drafts
- Markdown image rendering works from resolved `/media/...` URLs instead of `/uploads/...`
- Markdown media links render clickable anchors after `media://asset/...` resolution

### Browser Verification

End-to-end checks once implemented:

- import Markdown with front matter and one image
- import Markdown without front matter
- overwrite existing draft
- import Markdown with missing local media and verify commit is blocked
- verify imported image appears as media library asset after commit
- verify imported audio or video links resolve to clickable `/media/...` URLs on the public writing page

## Rollout Plan

Implement in these slices:

1. formalize blob-store backend boundary and hybrid asset resolution
2. add MinIO-backed pending media asset support
3. add writing import preview and commit APIs
4. add admin writing import UI and preview workflow
5. add media library support for non-image asset representation
6. verify create and overwrite flows end-to-end

Each slice should remain shippable behind a feature flag if MinIO is not universally available yet.

## Open Design Decision Recorded Here

This design intentionally uses one logical media bucket with type prefixes instead of separate buckets per type. That is the recommended first version because it keeps the operational model simple while preserving type separation at the key level.

If strict per-type buckets later become necessary, the storage abstraction should absorb that change without requiring Markdown or writing schema changes.

Another recorded trade-off: public detail reads enrich Markdown media by scanning `content_md` on demand. That is the right first implementation because it keeps the write path simple and the API contract explicit. If future performance data shows this is too expensive for very long documents or very high traffic, the likely next step is cached referenced-media IDs at write time, not a change to the `/media/...` route or `item.media` response shape.
