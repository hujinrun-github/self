# Multilingual Site and AI Translation Design

Date: 2026-06-24
Status: Draft for review

## Goal

Add multilingual support for the public portfolio site with Chinese as the source language, English and Japanese as translation layers, locale-prefixed public URLs, and an admin workflow that can generate translation drafts through a provided DeepSeek API and then let an editor review or adjust them manually.

This design covers architecture, data model, API shape, admin workflow, SEO behavior, and migration strategy only. It does not implement code changes.

## Confirmed Decisions

- Public language support is required for Chinese, English, and Japanese.
- Public URLs use explicit locale prefixes: `/zh`, `/en`, `/ja`.
- Chinese is the default and authoritative source content stored in the existing main tables.
- English and Japanese are stored as translations instead of replacing the Chinese source fields.
- Translation generation is manual, not automatic on every save.
- Translation generation uses a provided DeepSeek API.
- Slugs are localized per language instead of shared globally.
- The admin experience manages one content record with three language views instead of three independent records.
- Shared publishing state, sort order, media selection, and external links remain attached to the base content record.
- Missing content should fall back toward Chinese where possible, but locale-specific routed detail pages must still preserve per-locale slug rules.

## Current Project Constraints

The current repository shape already suggests a clean multilingual evolution path:

- Public routing is frontend-driven in [routes.tsx](D:/MyGitProject/self/web/src/app/routes.tsx) with direct `/projects`, `/writing`, `/talks`, `/bio`, and `/contact` routes.
- Public fixed copy is hard-coded in React components such as [HomePage.tsx](D:/MyGitProject/self/web/src/features/public/HomePage.tsx), [PublicLayout.tsx](D:/MyGitProject/self/web/src/features/public/PublicLayout.tsx), and [PublicListPage.tsx](D:/MyGitProject/self/web/src/features/public/PublicListPage.tsx).
- Public content data comes from domain-specific Go repositories under `internal/profile`, `internal/content`, and `internal/site`.
- Existing database tables store a single language directly in the main row shape, for example `projects.title`, `projects.slug`, `writings.content_md`, and `profile.summary`.
- The admin UI is currently strongest at create/list flows. A full multilingual feature requires stronger edit flows for existing content before translation generation becomes useful.

The design below keeps the existing Go domain boundaries and extends them rather than replacing them with a generic CMS layer.

## Non-Goals

- Do not redesign the overall visual identity of the public site.
- Do not translate the admin chrome itself in this stage. Admin controls can remain English while editing multilingual content.
- Do not add more locales beyond `zh`, `en`, and `ja`.
- Do not introduce background queues, workers, or webhook-based translation jobs in the first release.
- Do not auto-regenerate translations every time Chinese content changes.
- Do not make DeepSeek runtime configuration mandatory for boot. The app should still start when translation generation is not configured.
- Do not add public taxonomy pages for tags or tech stacks in this stage.
- Do not add machine-generated audio, speech, or automatic locale detection beyond a simple default redirect.

## Recommended Architecture

The backend remains a Go monolith with React as the public/admin frontend. Multilingual support is added through four layers:

- Locale-aware public routing and fixed-copy dictionaries in the React app.
- Locale-aware public read paths in the Go repositories and site services.
- Translation tables beside the current Chinese source tables in PostgreSQL.
- Admin translation endpoints plus a translation service wrapper around the DeepSeek API.

Chinese remains the source of truth in the existing main tables. English and Japanese live in translation tables that reference the source rows. Shared publication state and media choices remain on the main rows so one project, article, talk, or profile can be published once while exposing language-specific copy where available.

This keeps the current repository shapes understandable and avoids overloading each source table with large JSON translation blobs.

## Locale Model

Supported locales:

- `zh`
- `en`
- `ja`

Public locale behavior:

- `/` redirects to `/zh`.
- Unsupported locale prefixes redirect to `/zh`.
- Public routes always carry a locale prefix.
- The current locale becomes part of React route state, public API read behavior, SEO metadata, sitemap generation, and HTML `<html lang>` output.

HTML language mapping:

- `zh` -> `zh-CN`
- `en` -> `en`
- `ja` -> `ja`

## Source and Translation Ownership

Chinese is stored directly in the existing source tables and remains editable as the base version. English and Japanese are derived translations that can be:

- missing
- AI-generated but unreviewed
- manually reviewed or manually authored

Public visibility rules:

- Chinese source content is public whenever the base record itself is public.
- English and Japanese content are public only when a locale translation row exists with `translation_status = 'reviewed'` and `source_version = source.translation_source_version`.
- A `reviewed` translation that later becomes stale stays visible in admin, but it is no longer treated as public content until it is regenerated or manually resaved against the latest Chinese source version.
- `ai_draft` translations are admin-only and preview-only. They must not appear in public list pages, public detail pages, `hreflang`, sitemap output, or locale switchers.

Throughout this document, "publishable translation" means a non-Chinese translation row that is both:

- `translation_status = 'reviewed'`
- `source_version = source.translation_source_version`

The source version always wins for shared operational state:

- publish status
- featured flag
- sort order
- published timestamp
- cover/avatar/OG media selections
- external URLs such as demo, repo, and video URLs

Translation versions own locale-specific text:

- public titles
- slugs
- summaries and excerpts
- long-form Markdown
- public SEO title and description
- any locale-facing labels that appear publicly

## Data Model

### Guiding Rule

For every source record that currently stores public text in the main row, Chinese stays in place and non-Chinese text moves to a translation table.

### Translation Tables

Add these tables:

- `profile_translations`
- `social_link_translations`
- `experience_translations`
- `project_translations`
- `writing_translations`
- `talk_translations`

`tag_translations` and `tech_translations` are explicitly deferred from this stage. Current public pages do not render tags or tech labels, so v1 keeps those taxonomy names shared. If the public UI later exposes localized tag or tech labels, add translation tables in a follow-up change instead of expanding the first delivery.

### Common Translation Columns

Every translation table should include these core fields:

```text
id
<resource>_id
locale
translation_status
source_version
translated_at
updated_at
```

Where:

- `locale` is constrained to `en` or `ja`
- `translation_status` is constrained to `ai_draft` or `reviewed`
- `source_version` records the Chinese source text version the translation was based on
- `translated_at` records when AI generation last wrote the row
- `updated_at` records the last manual or generated write to the translation row

There is intentionally no `zh` translation row. Chinese stays in the source tables.

Every translation table must also enforce one translation row per locale for one source row:

```text
UNIQUE (<resource>_id, locale)
```

Examples:

- `UNIQUE (project_id, locale)`
- `UNIQUE (writing_id, locale)`
- `UNIQUE (talk_id, locale)`
- `UNIQUE (experience_id, locale)`
- `UNIQUE (profile_id, locale)`
- `UNIQUE (social_link_id, locale)`

### Resource-Specific Translation Fields

`profile_translations`

- `name`
- `headline`
- `summary`
- `bio`
- `seo_title`
- `seo_description`

`social_link_translations`

- `label`

`experience_translations`

- `period`
- `title`
- `organization`
- `description`

`project_translations`

- `title`
- `slug`
- `summary`
- `content_md`
- `seo_title`
- `seo_description`

`writing_translations`

- `title`
- `slug`
- `excerpt`
- `content_md`
- `seo_title`
- `seo_description`

`talk_translations`

- `title`
- `slug`
- `summary`
- `event_name`
- `seo_title`
- `seo_description`

### Shared Source Fields That Stay on Main Tables

`profile`

- `avatar_media_id`
- `email`
- `og_image_media_id`

`social_links`

- `url`
- `icon`
- `sort_order`

`experiences`

- `status`
- `sort_order`
- `published_at`

`projects`

- `cover_media_id`
- `demo_url`
- `repo_url`
- `og_image_media_id`
- `featured`
- `status`
- `sort_order`
- `published_at`

`writings`

- `cover_media_id`
- `og_image_media_id`
- `featured`
- `status`
- `sort_order`
- `published_at`

`talks`

- `cover_media_id`
- `video_url`
- `duration_minutes`
- `og_image_media_id`
- `featured`
- `status`
- `sort_order`
- `published_at`

### Source Text Versioning

The current source-table `updated_at` fields cannot drive translation staleness because they already change for non-text events such as publish/archive transitions and shared-field updates.

Each source table that owns translations must therefore gain a dedicated version field:

```text
translation_source_version BIGINT NOT NULL DEFAULT 1
```

This field is required on:

- `profile`
- `social_links`
- `experiences`
- `projects`
- `writings`
- `talks`

Rules:

- increment `translation_source_version` only when Chinese locale-owned text fields change
- do not increment it for shared operational changes such as status, featured, media selection, publish time, or external links
- write the current source row version into `translation.source_version` whenever a translation row is generated or manually saved

This keeps staleness tied to source-text drift instead of general row churn.

### Uniqueness Rules

Chinese source slugs remain unique in:

- `projects.slug`
- `writings.slug`
- `talks.slug`

Localized translation slugs must be unique per locale and resource table:

```text
UNIQUE (locale, slug)
```

for:

- `project_translations`
- `writing_translations`
- `talk_translations`

This guarantees `/en/projects/about-me` and `/ja/projects/jiko-shokai` can coexist independently.

### Staleness Detection

Translations should not store a separate boolean `stale` column. Staleness is a derived property:

```text
translation is stale when source.translation_source_version > translation.source_version
```

This keeps the schema simple and avoids false stale markers during publish, archive, featured, media, and other shared-field updates.

Public gating rule in v1:

- a stale translation is never treated as a publishable translation, even if its stored `translation_status` is still `reviewed`
- stale profile-style pages fall back to the next locale according to the fallback order and become non-indexable fallback pages
- stale routable detail locales disappear from locale lists, homepage cards, alternates, `hreflang`, sitemap output, and language switchers until the locale is current again

## Public URL Strategy

Public routes become:

- `/zh`
- `/en`
- `/ja`
- `/:locale/bio`
- `/:locale/contact`
- `/:locale/projects`
- `/:locale/projects/:slug`
- `/:locale/writing`
- `/:locale/writing/:slug`
- `/:locale/talks`
- `/:locale/talks/:slug`

Legacy routes without locale prefixes should redirect to the Chinese version:

- `/projects` -> `/zh/projects`
- `/projects/:slug` -> `/zh/projects/:slug`
- same pattern for `writing`, `talks`, `bio`, and `contact`

The redirect is important both for user bookmarks and for preserving existing links while the multilingual rollout lands.

Legacy redirect handling must be enabled in the same release as locale-prefixed routing. Redirect logic must explicitly exclude these reserved paths and prefixes:

- `/admin`
- `/api`
- `/uploads`
- `/assets`
- `/favicon.svg`
- `/icons.svg`
- `/sitemap.xml`
- `/robots.txt`

## Fallback Rules

### General Fallback Order

When text fallback is allowed, the order is:

1. requested locale
2. English
3. Chinese source

Chinese is always the final fallback.

### Where Fallback Is Allowed

Fallback is allowed for:

- homepage hero and fixed copy
- profile and biography pages
- contact page
- experience summaries on the homepage
- field-level fallback inside an already existing locale translation row

### Where Fallback Is Not Allowed

Fallback is not allowed to synthesize a missing locale-specific routed detail page when the route requires a locale-specific slug and that locale has no translation row.

That means:

- `/en/projects/:slug`
- `/ja/writing/:slug`
- `/en/talks/:slug`

require a publishable translation row for that locale because the localized slug itself is part of the public contract.

### Consequence for Lists and Homepage Cards

For routable collections with locale-specific slugs:

- a locale list page only includes entries that have a publishable translation row for that locale
- the locale homepage card sections for projects, writing, and talks only include entries that have a publishable translation row for that locale
- untranslated or stale entries remain visible in Chinese and become visible in English or Japanese only after a current reviewed translation exists

This is the necessary tradeoff for keeping per-language slugs clean and stable.

### Consequence for Non-Routable Profile Content

Profile, bio, contact, and homepage fixed copy may safely fall back because they do not depend on a locale-specific content slug.

However, fallback renderability does not imply indexability. SEO behavior for fallback pages is defined separately below.

### Field-Level Fallback Semantics

Field-level fallback is intentionally narrow in v1. It applies only when a locale translation row already exists and only for fallback-enabled optional fields:

- `profile_translations.seo_title`
- `profile_translations.seo_description`
- `project_translations.seo_title`
- `project_translations.seo_description`
- `writing_translations.seo_title`
- `writing_translations.seo_description`
- `talk_translations.seo_title`
- `talk_translations.seo_description`
- `talk_translations.event_name`
- `social_link_translations.label`

Field-level fallback is not allowed for page-defining localized fields. These fields must carry explicit locale content before the locale can be treated as publishable:

- `profile_translations.name`
- `profile_translations.headline`
- `profile_translations.summary`
- `profile_translations.bio`
- `experience_translations.period`
- `experience_translations.title`
- `experience_translations.organization`
- `experience_translations.description`
- `project_translations.title`
- `project_translations.slug`
- `project_translations.summary`
- `writing_translations.title`
- `writing_translations.slug`
- `writing_translations.excerpt`
- `talk_translations.title`
- `talk_translations.slug`
- `talk_translations.summary`

Validation and fallback rules:

- translation save and generation endpoints must enforce non-empty values for the page-defining localized fields listed above
- `project_translations.content_md` and `writing_translations.content_md` are locale-owned long-body fields but may intentionally be empty strings in v1
- `NULL` means "missing" and may trigger fallback only for the fallback-enabled optional fields listed above
- empty string is treated as an intentional authored value and never triggers fallback

## Public API Design

The internal API paths can remain under `/api/site/*`, but they must become locale-aware. To avoid tripling the backend route registry, locale should be passed as a validated query parameter from the frontend router.

HTTP resource path naming must preserve the current project's existing singular/plural mix:

- `/api/site/projects`
- `/api/site/talks`
- `/api/site/writing`
- `/api/site/profile`
- `/api/site/home`

The same rule applies to admin paths:

- `/api/admin/projects`
- `/api/admin/talks`
- `/api/admin/writing`
- `/api/admin/experience`
- `/api/admin/profile`

Admin translation path rules:

- translation endpoints under `/api/admin/*/translations/{locale}` accept only `en` and `ja`
- `zh` is not a valid translation path locale because Chinese stays in the source tables
- unknown or unsupported translation path locales must return `400 validation_error` instead of silently coercing to another locale

Examples:

- `/api/site/home?locale=zh`
- `/api/site/profile?locale=en`
- `/api/site/projects?locale=ja`
- `/api/site/projects/about-me?locale=en`

If `locale` is omitted, backend defaults to `zh` for backward compatibility during rollout.

Recommended response metadata for locale-aware endpoints:

```json
{
  "requested_locale": "ja",
  "resolved_locale": "en",
  "fallback_from": "ja"
}
```

For list responses, this metadata can sit beside `items`. For detail responses, it can sit beside the content object.

If a routable detail page is requested with a locale slug that does not exist for the locale, return `404` instead of silently serving another locale's slug content.

Locale-routable detail APIs must also return alternate-locale routing data so the frontend switcher, SEO layer, and sitemap generator can all use one source of truth:

```json
{
  "requested_locale": "en",
  "resolved_locale": "en",
  "item": {
    "...": "..."
  },
  "alternates": [
    { "locale": "zh", "kind": "source", "slug": "zi-ji-jie-shao", "path": "/zh/projects/zi-ji-jie-shao", "reviewed": true },
    { "locale": "en", "kind": "translation", "slug": "about-me", "path": "/en/projects/about-me", "reviewed": true }
  ]
}
```

Rules for `alternates`:

- `zh` alternate comes from the source row, not from a translation table row
- `en` and `ja` alternates come only from publishable translation rows
- never synthesize alternates through text fallback
- include `kind: "source" | "translation"` so callers can distinguish source-backed and translation-backed alternates
- include `reviewed` so the UI and SEO layer can distinguish reviewed translations from draft-only states when needed

## Admin Workflow

### Admin Editing Foundation

Multilingual work depends on being able to edit existing content records, not just create and publish them.

Before or alongside translation features, admin content workflows must support:

- open an existing project, writing, talk, or experience record by ID
- edit shared fields on an existing record
- edit localized fields by language tab
- save translations independently from publication status changes

This is a prerequisite because the current UI emphasizes creation and listing more than full edit cycles.

### Shared and Localized Editing Areas

Each content editor should split into two sections:

Shared fields:

- publication state
- featured flag
- sort order if exposed
- publish date
- cover/avatar/OG media
- demo/repo/video URLs
- duration minutes

Localized fields:

- Chinese
- English
- Japanese

Each localized tab should show:

- title
- slug
- summary or excerpt
- long body where applicable
- SEO title
- SEO description
- other public text fields specific to the resource

### Translation Controls

English and Japanese tabs should provide:

- `Generate translation`
- `Regenerate translation`
- `Mark reviewed`
- `Unpublish locale to edit slug`

Behavior:

- `Generate translation` is available when the Chinese source has been saved.
- `Regenerate translation` asks for confirmation because it overwrites the target locale draft fields.
- `Mark reviewed` changes `translation_status` from `ai_draft` to `reviewed`, but only when `translation.source_version == source.translation_source_version`.
- if the source version has advanced and the locale row is stale, `Mark reviewed` must fail with `409 conflict` and prompt the editor to regenerate or manually resave against the latest Chinese source first.
- `Unpublish locale to edit slug` is shown for reviewed routable locales because slug edits are blocked while a locale is public.
- `Unpublish locale to edit slug` keeps the localized fields, sets `translation_status` back to `ai_draft`, and warns that the locale will immediately disappear from public routing, sitemap, `hreflang`, and language switchers until it is reviewed again.
- manual edits to a translated locale keep the row in `reviewed` once explicitly marked, except slug changes must go through the unpublish flow first.

### Translation Status Visibility

Admin list views should surface per-locale status summaries for each row:

- `ZH source`
- `EN empty`
- `EN ai_draft`
- `EN reviewed current`
- `EN reviewed stale`
- same for `JA`

The list page does not need full translation editing, but it should show enough state to identify which entries still need translation work.

### Profile Workflow

Profile editing needs the same language-tab model:

- shared: email, avatar, OG image, social link URLs/icons
- localized: name, headline, summary, bio, SEO text, social link labels

This allows a single public identity record to expose language-specific copy without duplicating operational profile data.

### Social Link Persistence Prerequisite

`social_link_translations` cannot be added on top of a delete-and-recreate social link save path because translation rows would either be deleted on every profile save or block saves through referential constraints.

Before social link label translation lands, profile persistence must switch to a stable-ID save model:

- existing social link rows are updated in place
- new rows are inserted with new IDs
- removed rows are explicitly deleted
- sort order changes are applied through stable row IDs instead of row recreation

Only after that change should `social_link_translations` use a normal foreign key to `social_links`.

## Admin API Design

The admin API should grow explicit read, write, and generate endpoints for translations.

Recommended patterns:

- `GET /api/admin/profile`
- `PUT /api/admin/profile`
- `PUT /api/admin/profile/translations/{locale}`
- `POST /api/admin/profile/translations/{locale}/generate`
- `POST /api/admin/profile/translations/{locale}/review`

- `GET /api/admin/projects/{id}`
- `PUT /api/admin/projects/{id}`
- `PUT /api/admin/projects/{id}/translations/{locale}`
- `POST /api/admin/projects/{id}/translations/{locale}/generate`
- `POST /api/admin/projects/{id}/translations/{locale}/review`

- same shape for `writing`, `talks`, and `experience`

Admin detail payloads should return:

- shared source fields
- Chinese source fields
- `translations.en`
- `translations.ja`
- per-locale `exists`
- per-locale `translation_status`
- per-locale `stale`
- per-locale `source_version`
- per-locale `etag`

Create endpoints should continue creating Chinese source records only. Translation rows are generated or saved later.

All translation save and review endpoints must use optimistic concurrency. The recommended shape matches the existing profile save pattern:

- admin detail reads return locale-specific ETags for existing rows plus `exists = false` and `etag = null` for missing locales
- first-time locale creation uses `PUT /translations/{locale}` with `If-None-Match: *`
- updates to an existing locale row use `PUT /translations/{locale}` with `If-Match`
- `POST /translations/{locale}/review` also requires `If-Match`
- stale or mismatched preconditions return `409 conflict`

## DeepSeek Translation Integration

### Service Boundary

Add a dedicated translation service package, for example:

```text
internal/translation
```

This package owns:

- runtime configuration
- prompt construction
- HTTP client behavior
- response validation
- provider-specific error mapping

The rest of the app should not know DeepSeek request formats directly.

### Runtime Configuration

Recommended optional environment variables:

```text
TRANSLATION_PROVIDER=deepseek
TRANSLATION_API_KEY
TRANSLATION_BASE_URL
TRANSLATION_MODEL
TRANSLATION_TIMEOUT_SECONDS
```

These values are optional at startup. If they are missing:

- the application still starts
- translation generation endpoints return a controlled configuration error
- the admin UI disables translation buttons or shows translation as unavailable

### Translation Request Shape

The service should send structured translation prompts that include:

- resource type
- source locale `zh`
- target locale `en` or `ja`
- resource-specific fields
- style instructions
- slug generation instructions
- Markdown preservation instructions

The prompt must explicitly require:

- preserve Markdown headings and lists
- preserve inline links and code fences
- do not invent media URLs
- do not translate external URLs
- return ASCII romanized slug candidates only
- return structured JSON, not free-form prose

### Translation Output Fields

For each resource, the AI response should provide only the locale-owned fields. Example for a project:

```json
{
  "title": "...",
  "slug": "...",
  "summary": "...",
  "content_md": "...",
  "seo_title": "...",
  "seo_description": "..."
}
```

After receiving the response, backend must:

- validate required fields
- run slug normalization and uniqueness checks
- reject malformed Markdown payloads only when they violate existing app rules
- write the translation row in one transaction

Generation and manual save validation must follow the same localized field policy:

- page-defining localized fields must be non-empty
- fallback-enabled optional fields may be `NULL`
- empty string is stored as-is and must not be rewritten into fallback behavior

Localized slugs must follow the same backend slug rules as source slugs:

- lowercase ASCII only after normalization
- allowed characters are `a-z`, `0-9`, and `-`
- maximum length is 80 characters
- reserved words remain disallowed

DeepSeek is asked to provide romanized ASCII slugs, but backend remains the final authority. If normalization empties the slug or collides after retry bounds, the generation request fails with a validation error and the editor must provide a manual slug.

### Translation Slug Stability

Translation slugs are editable only while the locale row is still an `ai_draft`.

Once a locale translation is marked `reviewed` and therefore becomes publicly routable:

- its slug becomes immutable in v1
- changing the slug requires explicitly moving the locale row back to `ai_draft`
- while the locale row is back in `ai_draft`, that locale disappears from public routing, sitemap, `hreflang`, and language switchers until it is reviewed again

Admin UX must make this state change explicit:

- the button label should communicate the consequence, for example `Unpublish locale to edit slug`
- the confirmation copy should state that the locale URL will stop resolving publicly until the locale is reviewed again
- the transition must preserve the current localized text so the editor is editing a draft copy rather than starting from empty state

Slug aliases or redirect history for translated detail pages are intentionally out of scope for v1.

### Generation Flow

Generation should be synchronous in v1:

1. admin saves Chinese source
2. admin opens target locale tab
3. admin clicks `Generate translation`
4. backend loads current Chinese source
5. backend calls DeepSeek
6. backend validates and stores target locale row
7. translation row becomes `ai_draft`
8. admin reviews and optionally edits
9. admin marks translation as `reviewed`

This keeps the first version simple. If long writing bodies later make synchronous calls too slow, the adapter can move behind a job queue in a future stage.

### Generation Concurrency Protection

Translation generation must not overwrite newer manual edits made while the DeepSeek request is in flight.

Recommended generation algorithm:

1. read the source row `translation_source_version`
2. read the target locale translation row `etag` and `updated_at`, if it exists
3. call DeepSeek
4. before writing, re-read the target locale row and compare its ETag
5. if the locale row changed during generation, abort the write with `409 conflict`
6. if the source row `translation_source_version` changed during generation, abort the write with `409 conflict`
7. only write the generated translation if both checks still match the generation start snapshot

This keeps manual edits and newly updated Chinese source content from being silently overwritten by stale AI results.

### Regeneration Rules

Regeneration is explicit and destructive:

- only the targeted locale row is overwritten
- Chinese source is never touched
- the admin must confirm regeneration before write
- regeneration sets `translation_status` back to `ai_draft`
- `source_version` refreshes to the current source row `translation_source_version`

## SEO and Sitemap Design

### Canonical and hreflang

Each public locale page should render:

- locale-specific canonical URL
- `hreflang` links only for eligible alternates that actually resolve to public locale URLs

For routable detail pages, only emit `hreflang` alternates for locales that actually have publishable translation rows and therefore real locale-specific URLs.

The same `alternates` resolver used by detail APIs should drive:

- detail-page language switchers
- `hreflang` tags
- sitemap entries for routable content

### Fallback Page Indexing Policy

For non-routable pages that are allowed to render through fallback, such as locale-specific profile/bio/contact views:

- if `resolved_locale == requested_locale`, the page is indexable
- if `resolved_locale != requested_locale`, the page is renderable for users but must be treated as a fallback page

Fallback pages must:

- emit `noindex,follow`
- set canonical to the resolved locale path instead of the requested fallback path
- omit the missing locale from `hreflang` output
- stay out of sitemap output for that locale until a publishable translation exists

This prevents `/ja/bio` from being indexed as Japanese when it is actually rendering English or Chinese fallback content.

### Sitemap

Sitemap generation should emit:

- `/zh` routes that are public from source content
- `/en` and `/ja` non-routable pages only when their locale content resolves to publishable same-locale content
- localized collection list pages only when that locale has at least one publishable routable item
- localized routable detail URLs only for locales that have publishable translation rows

This avoids advertising locale pages that cannot actually be resolved by slug.

Indexing rules by page class:

- source Chinese pages are indexable whenever the underlying source record is public
- English and Japanese profile-driven pages such as home, bio, and contact are indexable only when profile-backed locale content is publishable and `resolved_locale == requested_locale`
- English and Japanese collection list pages are indexable only when the list contains at least one publishable locale item
- English and Japanese detail pages are indexable only when the detail route resolves through a publishable locale translation row

Renderable fallback pages are intentionally excluded from sitemap until their own-locale content exists.

### Route Metadata

`site.RouteMeta` should become locale-aware:

- fixed-copy titles per locale
- locale-specific canonical path
- locale-aware default description

Localized content pages should prefer translated SEO fields, then English translation SEO, then Chinese source SEO according to the same fallback rules already chosen for each route type.

## Frontend Routing and Copy

React routing should move from direct root pages to a locale-grouped structure:

- root redirect route
- locale layout route
- nested `bio`, `contact`, `projects`, `writing`, `talks`

Frontend should gain:

- a locale context or router-derived locale helper
- public fixed-copy dictionaries for `zh`, `en`, and `ja`
- a locale switcher in the public layout
- locale-aware links that preserve the current locale prefix

The public language switcher behavior should be:

- on static pages, switch to the same page under the other locale
- on detail pages, switch only to locales that have publishable alternates
- if the current detail page lacks a corresponding target locale translation, disable that target instead of guessing a slug or redirecting to a different detail URL

## Migration Strategy

### Database Migration

The schema migration should:

1. create translation tables
2. add foreign keys and uniqueness constraints
3. leave existing Chinese source data untouched
4. backfill no translation rows initially

There is no data copy from Chinese source into a `zh` translation table because Chinese remains in the base tables by design.

### Application Rollout

Recommended rollout order:

1. canonicalize public source routes to `/zh`, add fixed-copy dictionaries, and redirect legacy or unsupported locale prefixes to `/zh` equivalents without activating `/en` or `/ja` public shells yet
2. add translation tables and locale-aware repository reads
3. activate real `/en` and `/ja` public routes only after locale-aware publishable gating is in place
4. add admin detail editing for existing records
5. change profile social link persistence to stable-ID upsert/reorder semantics
6. add multilingual admin tabs and manual translation saves
7. add DeepSeek generation endpoints plus generation concurrency checks
8. add locale-aware SEO and sitemap behavior that only exposes publishable locale content

This order keeps the system shippable at every stage and avoids blocking on AI integration before the core content model is ready.

## Testing Strategy

Required backend coverage:

- translation table migrations and constraints
- per-table `UNIQUE (<resource>_id, locale)` behavior
- locale-aware slug uniqueness
- Chinese source reads remain unchanged
- locale read fallback behavior for profile and static-copy-backed content
- routable detail pages return `404` when locale translation slug is missing
- translated detail pages resolve correctly by locale slug
- stale translation detection from `translation_source_version`
- shared-field updates do not mark translations stale
- DeepSeek-disabled runtime behavior when config is absent
- translation generation validation and overwrite confirmation paths
- translation generation aborts on source-version or locale-row concurrency conflicts
- social link translations survive profile edits because stable IDs are preserved
- `ai_draft` translations are excluded from public reads, switchers, `hreflang`, and sitemap output
- stale reviewed translations are excluded from public reads, alternates, switchers, `hreflang`, and sitemap output until resaved or regenerated against the latest source version

Required frontend coverage:

- `/` redirects to `/zh`
- locale switcher preserves correct paths
- public links keep locale prefixes
- locale dictionary copy renders correctly
- list/detail views handle translated vs unavailable locale pages correctly

Required admin coverage:

- shared field editing remains stable
- locale tab save behavior
- translation status badges
- generate and regenerate flows
- stale indicator after Chinese source changes

## Delivery Sequence

1. Add locale routing and public fixed-copy dictionaries.
2. Add legacy redirects together with locale routing, excluding `/admin`, `/api`, `/uploads`, `/assets`, `/favicon.svg`, `/icons.svg`, `/sitemap.xml`, and `/robots.txt`.
3. Add translation tables, per-table uniqueness constraints, and locale-aware repository helpers.
4. Preserve Chinese source reads as the fallback backbone and add `translation_source_version` to translatable source tables.
5. Add admin detail routes for existing records across projects, writings, talks, and experiences.
6. Change profile social link persistence to stable-ID upsert and reorder semantics.
7. Split admin editors into shared fields plus locale tabs.
8. Add translation save endpoints, detail `alternates`, and per-locale status reporting.
9. Add the DeepSeek translation service adapter, manual generation endpoints, and generation concurrency guards.
10. Add locale-aware SEO, canonical, `hreflang`, `noindex` fallback handling, and sitemap output that only exposes publishable locale content.
