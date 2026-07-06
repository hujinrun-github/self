package profile

import (
	"context"
	"database/sql"

	"portfolio/internal/i18n"
)

type ProfileTranslationAdminDTO struct {
	Bio               string                          `json:"bio"`
	ETag              *string                         `json:"etag"`
	Exists            bool                            `json:"exists"`
	Headline          string                          `json:"headline"`
	Name              string                          `json:"name"`
	SEODescription    string                          `json:"seo_description"`
	SEOTitle          string                          `json:"seo_title"`
	SocialLinks       []SocialLinkTranslationAdminDTO `json:"social_links"`
	SourceVersion     int64                           `json:"source_version"`
	Stale             bool                            `json:"stale"`
	Summary           string                          `json:"summary"`
	TranslationStatus string                          `json:"translation_status"`
}

type SocialLinkTranslationAdminDTO struct {
	Icon        string `json:"icon"`
	ID          int64  `json:"id"`
	Label       string `json:"label"`
	SortOrder   int    `json:"sort_order"`
	SourceLabel string `json:"source_label"`
	URL         string `json:"url"`
}

func (r *Repository) profileAdminTranslations(ctx context.Context, currentSourceVersion int64, sourceLinks []SocialLinkDTO) map[string]ProfileTranslationAdminDTO {
	translations := map[string]ProfileTranslationAdminDTO{
		string(i18n.LocaleEN): emptyProfileTranslationAdmin(currentSourceVersion, sourceLinks),
		string(i18n.LocaleJA): emptyProfileTranslationAdmin(currentSourceVersion, sourceLinks),
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT locale, translation_status, source_version, name, headline, summary, bio, seo_title, seo_description, updated_at
		FROM profile_translations
		WHERE profile_id = $1
	`, int64(1))
	if err != nil {
		return translations
	}
	defer rows.Close()

	for rows.Next() {
		var (
			bio               string
			headline          string
			locale            string
			name              string
			seoTitle          sql.NullString
			seoDescription    sql.NullString
			sourceVersion     int64
			summary           string
			translationStatus string
			updatedAt         sql.NullTime
		)
		if err := rows.Scan(
			&locale,
			&translationStatus,
			&sourceVersion,
			&name,
			&headline,
			&summary,
			&bio,
			&seoTitle,
			&seoDescription,
			&updatedAt,
		); err != nil {
			continue
		}
		state := translations[locale]
		state.TranslationStatus = translationStatus
		state.SourceVersion = sourceVersion
		state.Name = name
		state.Headline = headline
		state.Summary = summary
		state.Bio = bio
		state.Exists = true
		state.Stale = state.SourceVersion != currentSourceVersion
		if seoTitle.Valid {
			state.SEOTitle = seoTitle.String
		}
		if seoDescription.Valid {
			state.SEODescription = seoDescription.String
		}
		if updatedAt.Valid {
			etag := translationETag(updatedAt.Time)
			state.ETag = &etag
		}
		translations[locale] = state
	}

	rows, err = r.db.QueryContext(ctx, `
		SELECT
			translations.locale,
			links.id,
			links.label,
			links.url,
			links.icon,
			links.sort_order,
			links.translation_source_version,
			translations.source_version,
			translations.label
		FROM social_link_translations translations
		JOIN social_links links ON links.id = translations.social_link_id
		WHERE links.profile_id = $1
		ORDER BY links.sort_order, links.id
	`, int64(1))
	if err != nil {
		return translations
	}
	defer rows.Close()

	for rows.Next() {
		var (
			currentVersion      int64
			locale              string
			sourceLabel         string
			sourceVersion       int64
			translatedLabel     string
			translatedLinkID    int64
			translatedSortOrder int
			url                 string
			icon                string
		)
		if err := rows.Scan(
			&locale,
			&translatedLinkID,
			&sourceLabel,
			&url,
			&icon,
			&translatedSortOrder,
			&currentVersion,
			&sourceVersion,
			&translatedLabel,
		); err != nil {
			continue
		}
		state, ok := translations[locale]
		if !ok {
			continue
		}
		for index := range state.SocialLinks {
			if state.SocialLinks[index].ID != translatedLinkID {
				continue
			}
			state.SocialLinks[index].Label = translatedLabel
			state.SocialLinks[index].SourceLabel = sourceLabel
			state.SocialLinks[index].URL = url
			state.SocialLinks[index].Icon = icon
			state.SocialLinks[index].SortOrder = translatedSortOrder
			break
		}
		if sourceVersion != currentVersion {
			state.Stale = true
		}
		translations[locale] = state
	}
	return translations
}

func emptyProfileTranslationAdmin(currentSourceVersion int64, sourceLinks []SocialLinkDTO) ProfileTranslationAdminDTO {
	return ProfileTranslationAdminDTO{
		Exists:            false,
		SocialLinks:       socialLinkTranslationAdminFromSource(sourceLinks),
		SourceVersion:     currentSourceVersion,
		Stale:             false,
		TranslationStatus: "empty",
	}
}

func socialLinkTranslationAdminFromSource(sourceLinks []SocialLinkDTO) []SocialLinkTranslationAdminDTO {
	translated := make([]SocialLinkTranslationAdminDTO, 0, len(sourceLinks))
	for _, link := range sourceLinks {
		translated = append(translated, SocialLinkTranslationAdminDTO{
			Icon:        link.Icon,
			ID:          link.ID,
			Label:       "",
			SortOrder:   link.SortOrder,
			SourceLabel: link.Label,
			URL:         link.URL,
		})
	}
	return translated
}
