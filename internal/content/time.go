package content

import "time"

func formatTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339Nano)
}

func formatTimeNow() string {
	return formatTime(time.Now().UTC())
}

func parseTime(value string) (time.Time, error) {
	if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return parsed, nil
	}
	return time.Parse("2006-01-02 15:04:05", value)
}

func timePtrString(value *time.Time) any {
	if value == nil {
		return nil
	}
	formatted := formatTime(*value)
	return formatted
}
