package content

import (
	"time"

	"portfolio/internal/storage"
)

func normalizeTime(value time.Time) time.Time {
	return storage.NormalizeTime(value)
}

func normalizedTimePtr(value *time.Time) any {
	return storage.TimePtrValue(value)
}
