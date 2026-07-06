package profile

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"portfolio/internal/content"
	"portfolio/internal/httpserver"
	"portfolio/internal/i18n"
	"portfolio/internal/media"
	"portfolio/internal/storage"
	"portfolio/internal/translation"
)

var (
	ErrPreconditionRequired = errors.New("if-match header is required")
	ErrConflict             = errors.New("profile has changed")
	ErrNotFound             = errors.New("profile not found")
)

const profileTimeFormat = "2006-01-02T15:04:05.000000Z07:00"

type Repository struct {
	db    *sql.DB
	clock func() time.Time
}

type SocialLinkInput struct {
	ID    *int64 `json:"id,omitempty"`
	Label string `json:"label"`
	URL   string `json:"url"`
	Icon  string `json:"icon"`
}

type SocialLinkDTO struct {
	ID        int64  `json:"id"`
	Label     string `json:"label"`
	URL       string `json:"url"`
	Icon      string `json:"icon"`
	SortOrder int    `json:"sort_order"`
}

type ProfileInput struct {
	Name           string            `json:"name"`
	Headline       string            `json:"headline"`
	Summary        string            `json:"summary"`
	Bio            string            `json:"bio"`
	AvatarMediaID  *int64            `json:"avatar_media_id"`
	Email          string            `json:"email"`
	SEOTitle       string            `json:"seo_title"`
	SEODescription string            `json:"seo_description"`
	OGImageMediaID *int64            `json:"og_image_media_id"`
	SocialLinks    []SocialLinkInput `json:"social_links"`
}

type ProfileAdminDTO struct {
	ID             int64                                 `json:"id"`
	Name           string                                `json:"name"`
	Headline       string                                `json:"headline"`
	Summary        string                                `json:"summary"`
	Bio            string                                `json:"bio"`
	AvatarMediaID  *int64                                `json:"avatar_media_id"`
	Email          string                                `json:"email"`
	SEOTitle       string                                `json:"seo_title"`
	SEODescription string                                `json:"seo_description"`
	OGImageMediaID *int64                                `json:"og_image_media_id"`
	UpdatedAt      string                                `json:"updated_at"`
	SocialLinks    []SocialLinkDTO                       `json:"social_links"`
	Translations   map[string]ProfileTranslationAdminDTO `json:"translations"`
}

type ProfilePublicDTO struct {
	Name          string          `json:"name"`
	Headline      string          `json:"headline"`
	Summary       string          `json:"summary"`
	Bio           string          `json:"bio"`
	AvatarMediaID *int64          `json:"avatar_media_id"`
	Email         string          `json:"email"`
	SocialLinks   []SocialLinkDTO `json:"social_links"`
}

func NewRepository(database *sql.DB) *Repository {
	return &Repository{
		db:    database,
		clock: func() time.Time { return time.Now().UTC() },
	}
}

func (r *Repository) GetAdmin(ctx context.Context) (ProfileAdminDTO, string, error) {
	profile, err := r.getProfile(ctx)
	if err != nil {
		return ProfileAdminDTO{}, "", err
	}
	var currentSourceVersion int64
	if err := r.db.QueryRowContext(ctx, `SELECT translation_source_version FROM profile WHERE id = $1`, int64(1)).Scan(&currentSourceVersion); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ProfileAdminDTO{}, "", ErrNotFound
		}
		return ProfileAdminDTO{}, "", err
	}
	links, err := r.getSocialLinks(ctx)
	if err != nil {
		return ProfileAdminDTO{}, "", err
	}
	profile.SocialLinks = links
	profile.Translations = r.profileAdminTranslations(ctx, currentSourceVersion, links)
	return profile, etagFor(profile.UpdatedAt), nil
}

func (r *Repository) SaveAdmin(ctx context.Context, input ProfileInput, ifMatch string) error {
	if ifMatch == "" {
		return ErrPreconditionRequired
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var updatedAt time.Time
	if err := tx.QueryRowContext(ctx, `SELECT updated_at FROM profile WHERE id = $1 FOR UPDATE`, 1).Scan(&updatedAt); err != nil {
		return err
	}
	current := storage.NormalizeTime(updatedAt)
	if etagForTime(current) != ifMatch {
		return ErrConflict
	}

	now := storage.NormalizeTime(r.clock())
	if !now.After(current) {
		now = current.Add(time.Microsecond)
	}
	_, err = tx.ExecContext(ctx, `UPDATE profile SET name = $1, headline = $2, summary = $3, bio = $4, avatar_media_id = $5, email = $6, seo_title = $7, seo_description = $8, og_image_media_id = $9, updated_at = $10,
		translation_source_version = translation_source_version + CASE
			WHEN name IS DISTINCT FROM $1
			  OR headline IS DISTINCT FROM $2
			  OR summary IS DISTINCT FROM $3
			  OR bio IS DISTINCT FROM $4
			  OR seo_title IS DISTINCT FROM $7
			  OR seo_description IS DISTINCT FROM $8
			THEN 1
			ELSE 0
		END
		WHERE id = $11`,
		input.Name,
		input.Headline,
		input.Summary,
		input.Bio,
		nullableInt64(input.AvatarMediaID),
		input.Email,
		input.SEOTitle,
		input.SEODescription,
		nullableInt64(input.OGImageMediaID),
		now,
		int64(1),
	)
	if err != nil {
		return err
	}
	keepIDs := make(map[int64]struct{}, len(input.SocialLinks))
	for index, link := range input.SocialLinks {
		sortOrder := (index + 1) * 10
		if link.ID != nil {
			result, err := tx.ExecContext(ctx, `
				UPDATE social_links
				SET label = $1, url = $2, icon = $3, sort_order = $4, updated_at = $5,
					translation_source_version = translation_source_version + CASE
						WHEN label IS DISTINCT FROM $1 THEN 1 ELSE 0
					END
				WHERE id = $6 AND profile_id = $7
			`,
				link.Label,
				link.URL,
				link.Icon,
				sortOrder,
				now,
				*link.ID,
				int64(1),
			)
			if err != nil {
				return err
			}
			rowsAffected, err := result.RowsAffected()
			if err != nil {
				return err
			}
			if rowsAffected == 0 {
				return ErrConflict
			}
			keepIDs[*link.ID] = struct{}{}
			continue
		}
		var insertedID int64
		if err := tx.QueryRowContext(ctx, `
			INSERT INTO social_links (profile_id, label, url, icon, sort_order, created_at, updated_at, translation_source_version)
			VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
			RETURNING id
		`,
			int64(1),
			link.Label,
			link.URL,
			link.Icon,
			sortOrder,
			now,
			now,
		).Scan(&insertedID); err != nil {
			return err
		}
		keepIDs[insertedID] = struct{}{}
	}
	rows, err := tx.QueryContext(ctx, `SELECT id FROM social_links WHERE profile_id = $1`, int64(1))
	if err != nil {
		return err
	}
	existingIDs := []int64{}
	for rows.Next() {
		var existingID int64
		if err := rows.Scan(&existingID); err != nil {
			rows.Close()
			return err
		}
		existingIDs = append(existingIDs, existingID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, existingID := range existingIDs {
		if _, ok := keepIDs[existingID]; ok {
			continue
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM social_links WHERE id = $1 AND profile_id = $2`, existingID, int64(1)); err != nil {
			return err
		}
	}
	refs := []media.Reference{}
	if input.AvatarMediaID != nil {
		refs = append(refs, media.Reference{MediaAssetID: *input.AvatarMediaID, Source: "avatar"})
	}
	if input.OGImageMediaID != nil {
		refs = append(refs, media.Reference{MediaAssetID: *input.OGImageMediaID, Source: "og_image"})
	}
	if err := media.RebuildReferences(ctx, tx, "profile", 1, refs); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *Repository) GetPublic(ctx context.Context) (ProfilePublicDTO, error) {
	profile, _, err := r.GetPublicByLocale(ctx, i18n.LocaleZH)
	if err != nil {
		return ProfilePublicDTO{}, err
	}
	return profile, nil
}

func (r *Repository) GetPublicByLocale(ctx context.Context, locale i18n.Locale) (ProfilePublicDTO, content.LocaleMeta, error) {
	admin, err := r.getProfile(ctx)
	if err != nil {
		return ProfilePublicDTO{}, content.LocaleMeta{}, err
	}
	sourceProfile := ProfilePublicDTO{
		Name:          admin.Name,
		Headline:      admin.Headline,
		Summary:       admin.Summary,
		Bio:           admin.Bio,
		AvatarMediaID: admin.AvatarMediaID,
		Email:         admin.Email,
	}
	if locale == i18n.LocaleZH {
		links, err := r.getSocialLinks(ctx)
		if err != nil {
			return ProfilePublicDTO{}, content.LocaleMeta{}, err
		}
		sourceProfile.SocialLinks = links
		return sourceProfile, content.LocaleMetaFor(locale, i18n.LocaleZH), nil
	}

	for _, candidate := range i18n.FallbackOrder(locale) {
		if candidate == i18n.LocaleZH {
			break
		}
		translation, ok, err := r.getProfileTranslation(ctx, candidate)
		if err != nil {
			return ProfilePublicDTO{}, content.LocaleMeta{}, err
		}
		if !ok {
			continue
		}
		links, err := r.getSocialLinksByLocale(ctx, candidate)
		if err != nil {
			return ProfilePublicDTO{}, content.LocaleMeta{}, err
		}
		sourceProfile.Name = translation.Name
		sourceProfile.Headline = translation.Headline
		sourceProfile.Summary = translation.Summary
		sourceProfile.Bio = translation.Bio
		sourceProfile.SocialLinks = links
		return sourceProfile, content.LocaleMetaFor(locale, candidate), nil
	}

	links, err := r.getSocialLinks(ctx)
	if err != nil {
		return ProfilePublicDTO{}, content.LocaleMeta{}, err
	}
	sourceProfile.SocialLinks = links
	return sourceProfile, content.LocaleMetaFor(locale, i18n.LocaleZH), nil
}

func (r *Repository) getProfile(ctx context.Context) (ProfileAdminDTO, error) {
	var profile ProfileAdminDTO
	var avatarID sql.NullInt64
	var ogID sql.NullInt64
	var updatedAt time.Time
	err := r.db.QueryRowContext(ctx, `SELECT id, name, headline, summary, bio, avatar_media_id, email, seo_title, seo_description, og_image_media_id, updated_at FROM profile WHERE id = $1`, 1).
		Scan(&profile.ID, &profile.Name, &profile.Headline, &profile.Summary, &profile.Bio, &avatarID, &profile.Email, &profile.SEOTitle, &profile.SEODescription, &ogID, &updatedAt)
	if err != nil {
		return ProfileAdminDTO{}, err
	}
	if avatarID.Valid {
		profile.AvatarMediaID = &avatarID.Int64
	}
	if ogID.Valid {
		profile.OGImageMediaID = &ogID.Int64
	}
	profile.UpdatedAt = formatProfileTime(updatedAt)
	profile.SocialLinks = []SocialLinkDTO{}
	return profile, nil
}

func (r *Repository) getSocialLinks(ctx context.Context) ([]SocialLinkDTO, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, label, url, icon, sort_order FROM social_links WHERE profile_id = $1 ORDER BY sort_order, id`, 1)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	links := []SocialLinkDTO{}
	for rows.Next() {
		var link SocialLinkDTO
		if err := rows.Scan(&link.ID, &link.Label, &link.URL, &link.Icon, &link.SortOrder); err != nil {
			return nil, err
		}
		links = append(links, link)
	}
	return links, rows.Err()
}

type profileTranslation struct {
	Name     string
	Headline string
	Summary  string
	Bio      string
}

func (r *Repository) getProfileTranslation(ctx context.Context, locale i18n.Locale) (profileTranslation, bool, error) {
	var translation profileTranslation
	err := r.db.QueryRowContext(ctx, `
		SELECT name, headline, summary, bio
		FROM profile_translations
		WHERE profile_id = $1
		  AND locale = $2
		  AND translation_status = 'reviewed'
		  AND source_version = (SELECT translation_source_version FROM profile WHERE id = $1)
	`, int64(1), locale).Scan(&translation.Name, &translation.Headline, &translation.Summary, &translation.Bio)
	if errors.Is(err, sql.ErrNoRows) {
		return profileTranslation{}, false, nil
	}
	if err != nil {
		return profileTranslation{}, false, err
	}
	return translation, true, nil
}

func (r *Repository) getSocialLinksByLocale(ctx context.Context, locale i18n.Locale) ([]SocialLinkDTO, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT links.id, COALESCE(translations.label, links.label), links.url, links.icon, links.sort_order
		FROM social_links links
		LEFT JOIN social_link_translations translations
		  ON translations.social_link_id = links.id
		 AND translations.locale = $2
		 AND translations.translation_status = 'reviewed'
		 AND translations.source_version = links.translation_source_version
		WHERE links.profile_id = $1
		ORDER BY links.sort_order, links.id
	`, int64(1), locale)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	links := []SocialLinkDTO{}
	for rows.Next() {
		var link SocialLinkDTO
		if err := rows.Scan(&link.ID, &link.Label, &link.URL, &link.Icon, &link.SortOrder); err != nil {
			return nil, err
		}
		links = append(links, link)
	}
	return links, rows.Err()
}

func RegisterAdminRoutes(r chi.Router, repo *Repository, generators ...TranslationGenerator) {
	var generator TranslationGenerator
	if len(generators) > 0 {
		generator = generators[0]
	}
	r.Get("/api/admin/profile", func(w http.ResponseWriter, req *http.Request) {
		profile, etag, err := repo.GetAdmin(req.Context())
		if err != nil {
			httpserver.WriteError(w, http.StatusInternalServerError, "internal_error", "Could not load profile", nil)
			return
		}
		w.Header().Set("ETag", etag)
		httpserver.WriteJSON(w, http.StatusOK, profile)
	})
	r.Put("/api/admin/profile", func(w http.ResponseWriter, req *http.Request) {
		var input ProfileInput
		if err := json.NewDecoder(req.Body).Decode(&input); err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Invalid profile payload", nil)
			return
		}
		err := repo.SaveAdmin(req.Context(), input, req.Header.Get("If-Match"))
		switch {
		case err == nil:
			w.WriteHeader(http.StatusNoContent)
		case errors.Is(err, ErrPreconditionRequired):
			httpserver.WriteError(w, http.StatusPreconditionRequired, "precondition_required", "If-Match header is required", nil)
		case errors.Is(err, ErrConflict):
			httpserver.WriteError(w, http.StatusConflict, "conflict", "Profile has changed", nil)
		default:
			httpserver.WriteError(w, http.StatusInternalServerError, "internal_error", "Could not save profile", nil)
		}
	})
	r.Put("/api/admin/profile/translations/{locale}", func(w http.ResponseWriter, req *http.Request) {
		locale, err := i18n.ParseTranslationLocale(chi.URLParam(req, "locale"))
		if err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Unsupported translation locale", nil)
			return
		}
		var input ProfileTranslationInput
		if err := json.NewDecoder(req.Body).Decode(&input); err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Invalid profile translation payload", nil)
			return
		}
		err = repo.SaveTranslation(req.Context(), locale, input, req.Header.Get("If-Match"), req.Header.Get("If-None-Match"))
		writeProfileTranslationResult(w, err)
	})
	if generator != nil {
		r.Post("/api/admin/profile/translations/{locale}/generate", generateTranslationHandler(repo, generator))
	}
	r.Post("/api/admin/profile/translations/{locale}/review", func(w http.ResponseWriter, req *http.Request) {
		locale, err := i18n.ParseTranslationLocale(chi.URLParam(req, "locale"))
		if err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Unsupported translation locale", nil)
			return
		}
		err = repo.MarkTranslationReviewed(req.Context(), locale, req.Header.Get("If-Match"))
		writeProfileTranslationResult(w, err)
	})
}

func RegisterSiteRoutes(r chi.Router, repo *Repository) {
	r.Get("/api/site/profile", func(w http.ResponseWriter, req *http.Request) {
		locale := i18n.CoerceLocale(req.URL.Query().Get("locale"))
		profile, meta, err := repo.GetPublicByLocale(req.Context(), locale)
		if err != nil {
			httpserver.WriteError(w, http.StatusInternalServerError, "internal_error", "Could not load profile", nil)
			return
		}
		httpserver.WriteJSON(w, http.StatusOK, struct {
			content.LocaleMeta
			ProfilePublicDTO
		}{
			LocaleMeta:       meta,
			ProfilePublicDTO: profile,
		})
	})
}

func etagFor(updatedAt string) string {
	sum := sha256.Sum256([]byte(updatedAt))
	return `"` + hex.EncodeToString(sum[:8]) + `"`
}

func etagForTime(updatedAt time.Time) string {
	return etagFor(formatProfileTime(updatedAt))
}

func formatProfileTime(updatedAt time.Time) string {
	return storage.NormalizeTime(updatedAt).Format(profileTimeFormat)
}

func nullableInt64(value *int64) sql.NullInt64 {
	if value == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: *value, Valid: true}
}

func writeProfileTranslationResult(w http.ResponseWriter, err error) {
	switch {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, ErrNotFound):
		httpserver.WriteError(w, http.StatusNotFound, "not_found", "Profile not found", nil)
	case errors.Is(err, ErrPreconditionRequired):
		httpserver.WriteError(w, http.StatusPreconditionRequired, "precondition_required", "Translation precondition header is required", nil)
	case errors.Is(err, ErrConflict), errors.Is(err, ErrTranslationStale), errors.Is(err, translation.ErrConflict):
		httpserver.WriteError(w, http.StatusConflict, "conflict", err.Error(), nil)
	case errors.Is(err, translation.ErrProviderUnavailable):
		httpserver.WriteError(w, http.StatusServiceUnavailable, "service_unavailable", err.Error(), nil)
	case errors.Is(err, translation.ErrProviderRequestFailed), errors.Is(err, translation.ErrInvalidResponse):
		httpserver.WriteError(w, http.StatusBadGateway, "provider_error", err.Error(), nil)
	default:
		httpserver.WriteError(w, http.StatusInternalServerError, "internal_error", "Could not save profile translation", nil)
	}
}
