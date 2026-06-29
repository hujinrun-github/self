package content

import "portfolio/internal/i18n"

type LocaleMeta struct {
	RequestedLocale string `json:"requested_locale"`
	ResolvedLocale  string `json:"resolved_locale"`
	FallbackFrom    string `json:"fallback_from,omitempty"`
}

type AlternateRoute struct {
	Locale   string `json:"locale"`
	Kind     string `json:"kind"`
	Slug     string `json:"slug"`
	Path     string `json:"path"`
	Reviewed bool   `json:"reviewed"`
}

type LocalizedListResponse[T any] struct {
	LocaleMeta
	Items []T `json:"items"`
}

type LocalizedDetailResponse[T any] struct {
	LocaleMeta
	Item       T                `json:"item"`
	Alternates []AlternateRoute `json:"alternates,omitempty"`
}

func LocaleMetaFor(requested i18n.Locale, resolved i18n.Locale) LocaleMeta {
	meta := LocaleMeta{
		RequestedLocale: string(requested),
		ResolvedLocale:  string(resolved),
	}
	if requested != resolved {
		meta.FallbackFrom = string(requested)
	}
	return meta
}

func sourceAlternate(resourcePath string, slug string) AlternateRoute {
	return AlternateRoute{
		Locale:   string(i18n.LocaleZH),
		Kind:     "source",
		Slug:     slug,
		Path:     "/" + string(i18n.LocaleZH) + "/" + resourcePath + "/" + slug,
		Reviewed: true,
	}
}

func translationAlternate(locale i18n.Locale, resourcePath string, slug string) AlternateRoute {
	return AlternateRoute{
		Locale:   string(locale),
		Kind:     "translation",
		Slug:     slug,
		Path:     "/" + string(locale) + "/" + resourcePath + "/" + slug,
		Reviewed: true,
	}
}
