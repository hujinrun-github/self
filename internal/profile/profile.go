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

	"portfolio/internal/httpserver"
	"portfolio/internal/media"
	"portfolio/internal/storage"
)

var (
	ErrPreconditionRequired = errors.New("if-match header is required")
	ErrConflict             = errors.New("profile has changed")
)

const profileTimeFormat = "2006-01-02T15:04:05.000000Z07:00"

type Repository struct {
	db    *sql.DB
	clock func() time.Time
}

type SocialLinkInput struct {
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
	ID             int64           `json:"id"`
	Name           string          `json:"name"`
	Headline       string          `json:"headline"`
	Summary        string          `json:"summary"`
	Bio            string          `json:"bio"`
	AvatarMediaID  *int64          `json:"avatar_media_id"`
	Email          string          `json:"email"`
	SEOTitle       string          `json:"seo_title"`
	SEODescription string          `json:"seo_description"`
	OGImageMediaID *int64          `json:"og_image_media_id"`
	UpdatedAt      string          `json:"updated_at"`
	SocialLinks    []SocialLinkDTO `json:"social_links"`
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
	links, err := r.getSocialLinks(ctx)
	if err != nil {
		return ProfileAdminDTO{}, "", err
	}
	profile.SocialLinks = links
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
	if etagForTime(updatedAt) != ifMatch {
		return ErrConflict
	}

	now := storage.NormalizeTime(r.clock())
	_, err = tx.ExecContext(ctx, `UPDATE profile SET name = $1, headline = $2, summary = $3, bio = $4, avatar_media_id = $5, email = $6, seo_title = $7, seo_description = $8, og_image_media_id = $9, updated_at = $10 WHERE id = $11`,
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
	if _, err := tx.ExecContext(ctx, `DELETE FROM social_links WHERE profile_id = $1`, 1); err != nil {
		return err
	}
	for index, link := range input.SocialLinks {
		_, err := tx.ExecContext(ctx, `INSERT INTO social_links (profile_id, label, url, icon, sort_order, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			int64(1),
			link.Label,
			link.URL,
			link.Icon,
			(index+1)*10,
			now,
			now,
		)
		if err != nil {
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
	admin, _, err := r.GetAdmin(ctx)
	if err != nil {
		return ProfilePublicDTO{}, err
	}
	return ProfilePublicDTO{
		Name:          admin.Name,
		Headline:      admin.Headline,
		Summary:       admin.Summary,
		Bio:           admin.Bio,
		AvatarMediaID: admin.AvatarMediaID,
		Email:         admin.Email,
		SocialLinks:   admin.SocialLinks,
	}, nil
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

func RegisterAdminRoutes(r chi.Router, repo *Repository) {
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
}

func RegisterSiteRoutes(r chi.Router, repo *Repository) {
	r.Get("/api/site/profile", func(w http.ResponseWriter, req *http.Request) {
		profile, err := repo.GetPublic(req.Context())
		if err != nil {
			httpserver.WriteError(w, http.StatusInternalServerError, "internal_error", "Could not load profile", nil)
			return
		}
		httpserver.WriteJSON(w, http.StatusOK, profile)
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
