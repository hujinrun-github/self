package content

import (
	"strings"
	"unicode"
)

var reservedSlugs = map[string]bool{
	"admin":       true,
	"api":         true,
	"uploads":     true,
	"sitemap.xml": true,
	"robots.txt":  true,
	"login":       true,
	"logout":      true,
	"preview":     true,
	"new":         true,
	"edit":        true,
}

func Slugify(input string) (string, error) {
	value := strings.TrimSpace(strings.ToLower(input))
	var builder strings.Builder
	lastHyphen := false
	for _, r := range value {
		switch {
		case r == '\'':
			continue
		case r >= 'a' && r <= 'z' || r >= '0' && r <= '9':
			builder.WriteRune(r)
			lastHyphen = false
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			if !lastHyphen && builder.Len() > 0 {
				builder.WriteByte('-')
				lastHyphen = true
			}
		default:
			if !lastHyphen && builder.Len() > 0 {
				builder.WriteByte('-')
				lastHyphen = true
			}
		}
	}
	slug := strings.Trim(builder.String(), "-")
	if slug == "" {
		return "", ErrEmptySlug
	}
	if len(slug) > 80 {
		return "", ErrSlugTooLong
	}
	if reservedSlugs[slug] {
		return "", ErrReservedSlug
	}
	return slug, nil
}
