package storage

import (
	"context"
	"time"
)

func RetryTransient(ctx context.Context, attempts int, fn func() error) error {
	if attempts <= 0 {
		attempts = 1
	}

	var last error
	for attempt := 1; attempt <= attempts; attempt++ {
		if err := fn(); err != nil {
			last = err
			if !IsSQLState(err, CodeSerializationFailure) && !IsSQLState(err, CodeDeadlockDetected) {
				return err
			}
			if attempt == attempts {
				break
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(attempt) * 10 * time.Millisecond):
			}
			continue
		}
		return nil
	}
	return last
}
