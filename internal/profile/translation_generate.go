package profile

import (
	"context"
	"database/sql"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"portfolio/internal/httpserver"
	"portfolio/internal/i18n"
	"portfolio/internal/storage"
	"portfolio/internal/translation"
)

type TranslationGenerator interface {
	GenerateProfile(ctx context.Context, source translation.ProfileTranslationSource, locale i18n.Locale) (translation.GeneratedProfileTranslation, error)
}

func (r *Repository) LoadTranslationGeneration(ctx context.Context, locale i18n.Locale) (translation.TranslationSnapshot, translation.ProfileTranslationSource, error) {
	var (
		snapshot      translation.TranslationSnapshot
		source        translation.ProfileTranslationSource
		translationTS sql.NullTime
	)
	err := r.db.QueryRowContext(ctx, `
		SELECT
			profile.translation_source_version,
			translations.updated_at,
			profile.name,
			profile.headline,
			profile.summary,
			profile.bio,
			profile.seo_title,
			profile.seo_description
		FROM profile
		LEFT JOIN profile_translations translations
		  ON translations.profile_id = profile.id
		 AND translations.locale = $2
		WHERE profile.id = $1
	`, int64(1), locale).Scan(
		&snapshot.SourceVersion,
		&translationTS,
		&source.Name,
		&source.Headline,
		&source.Summary,
		&source.Bio,
		&source.SEOTitle,
		&source.SEODescription,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return translation.TranslationSnapshot{}, translation.ProfileTranslationSource{}, ErrNotFound
		}
		return translation.TranslationSnapshot{}, translation.ProfileTranslationSource{}, err
	}
	if translationTS.Valid {
		snapshot.LocaleETag = translationETag(translationTS.Time)
	}
	links, err := r.translationSourceSocialLinks(ctx)
	if err != nil {
		return translation.TranslationSnapshot{}, translation.ProfileTranslationSource{}, err
	}
	source.SocialLinks = links
	return snapshot, source, nil
}

func (r *Repository) SaveGeneratedTranslation(ctx context.Context, locale i18n.Locale, expected translation.TranslationSnapshot, generated translation.GeneratedProfileTranslation) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	current, err := profileTranslationSnapshotTx(ctx, tx, locale)
	if err != nil {
		return err
	}
	if current.CurrentSourceVersion != expected.SourceVersion || current.ETag != expected.LocaleETag {
		return translation.ErrConflict
	}

	now := storage.NormalizeTime(r.clock())
	err = saveTranslationWithExecer(ctx, tx, locale, current.CurrentSourceVersion, ProfileTranslationInput{
		Name:           generated.Name,
		Headline:       generated.Headline,
		Summary:        generated.Summary,
		Bio:            generated.Bio,
		SEOTitle:       generated.SEOTitle,
		SEODescription: generated.SEODescription,
		SocialLinks:    generatedSocialLinksToInput(generated.SocialLinks),
	}, now)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func generateTranslationHandler(repo *Repository, generator TranslationGenerator) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		locale, err := i18n.ParseTranslationLocale(chi.URLParam(req, "locale"))
		if err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Unsupported translation locale", nil)
			return
		}

		start, source, err := repo.LoadTranslationGeneration(req.Context(), locale)
		if err != nil {
			writeProfileTranslationResult(w, err)
			return
		}
		generated, err := generator.GenerateProfile(req.Context(), source, locale)
		if err != nil {
			writeProfileTranslationResult(w, err)
			return
		}
		err = repo.SaveGeneratedTranslation(req.Context(), locale, start, generated)
		writeProfileTranslationResult(w, err)
	}
}

func (r *Repository) translationSourceSocialLinks(ctx context.Context) ([]translation.ProfileSocialLinkTranslationSource, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, label, url, icon
		FROM social_links
		WHERE profile_id = $1
		ORDER BY sort_order, id
	`, int64(1))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	links := []translation.ProfileSocialLinkTranslationSource{}
	for rows.Next() {
		var link translation.ProfileSocialLinkTranslationSource
		if err := rows.Scan(&link.ID, &link.Label, &link.URL, &link.Icon); err != nil {
			return nil, err
		}
		links = append(links, link)
	}
	return links, rows.Err()
}

func generatedSocialLinksToInput(generated []translation.GeneratedProfileSocialLinkTranslation) []SocialLinkTranslationInput {
	input := make([]SocialLinkTranslationInput, 0, len(generated))
	for _, link := range generated {
		input = append(input, SocialLinkTranslationInput{
			ID:    link.ID,
			Label: link.Label,
		})
	}
	return input
}
