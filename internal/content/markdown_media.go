package content

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
)

type MediaVariant struct {
	URL      string `json:"url"`
	Width    *int   `json:"width,omitempty"`
	Height   *int   `json:"height,omitempty"`
	MimeType string `json:"mime_type"`
}

type MediaMap map[string]map[string]MediaVariant

type mediaVariantRecord struct {
	Width    *int   `json:"width"`
	Height   *int   `json:"height"`
	MimeType string `json:"mime_type"`
}

var mediaRefPattern = regexp.MustCompile(`media://asset/(\d+)/([a-zA-Z0-9_-]+)`)

func (r *Repository) buildMediaMap(ctx context.Context, markdown string) (MediaMap, error) {
	matches := mediaRefPattern.FindAllStringSubmatch(markdown, -1)
	if len(matches) == 0 {
		return MediaMap{}, nil
	}

	seen := make(map[int64]struct{}, len(matches))
	ids := make([]int64, 0, len(matches))
	for _, match := range matches {
		id, err := strconv.ParseInt(match[1], 10, 64)
		if err != nil || id <= 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}

	if len(ids) == 0 {
		return MediaMap{}, nil
	}
	return r.loadMediaMap(ctx, ids)
}

func (r *Repository) loadMediaMap(ctx context.Context, ids []int64) (MediaMap, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT id, variants
FROM media_assets
WHERE id = ANY($1)
  AND lifecycle_state = 'active'
ORDER BY id
`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := MediaMap{}
	for rows.Next() {
		var (
			id          int64
			rawVariants []byte
		)
		if err := rows.Scan(&id, &rawVariants); err != nil {
			return nil, err
		}

		var decoded map[string]mediaVariantRecord
		if err := json.Unmarshal(rawVariants, &decoded); err != nil {
			return nil, fmt.Errorf("decode content media variants: %w", err)
		}

		key := strconv.FormatInt(id, 10)
		result[key] = make(map[string]MediaVariant, len(decoded))
		for variantName, variant := range decoded {
			result[key][variantName] = MediaVariant{
				URL:      fmt.Sprintf("/media/%d/%s", id, variantName),
				Width:    variant.Width,
				Height:   variant.Height,
				MimeType: variant.MimeType,
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}
