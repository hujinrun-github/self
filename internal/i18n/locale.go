package i18n

import (
	"fmt"
	"strings"
)

type Locale string

const (
	LocaleZH Locale = "zh"
	LocaleEN Locale = "en"
	LocaleJA Locale = "ja"
)

func CoerceLocale(value string) Locale {
	switch normalizeLocale(value) {
	case LocaleEN:
		return LocaleEN
	case LocaleJA:
		return LocaleJA
	default:
		return LocaleZH
	}
}

func FallbackOrder(locale Locale) []Locale {
	switch locale {
	case LocaleJA:
		return []Locale{LocaleJA, LocaleEN, LocaleZH}
	case LocaleEN:
		return []Locale{LocaleEN, LocaleZH}
	default:
		return []Locale{LocaleZH}
	}
}

func ParseTranslationLocale(value string) (Locale, error) {
	switch normalizeLocale(value) {
	case LocaleEN:
		return LocaleEN, nil
	case LocaleJA:
		return LocaleJA, nil
	default:
		return "", fmt.Errorf("unsupported translation locale %q", value)
	}
}

func normalizeLocale(value string) Locale {
	return Locale(strings.ToLower(strings.TrimSpace(value)))
}
