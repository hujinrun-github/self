package storage

import "time"

func NormalizeTime(value time.Time) time.Time {
	return value.UTC().Truncate(time.Microsecond)
}

func TimePtrValue(value *time.Time) any {
	if value == nil {
		return nil
	}
	normalized := NormalizeTime(*value)
	return normalized
}
