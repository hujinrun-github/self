package storage

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestRetryTransientRetriesSerializationFailure(t *testing.T) {
	attempts := 0
	err := RetryTransient(context.Background(), 2, func() error {
		attempts++
		if attempts == 1 {
			return &pgconn.PgError{Code: CodeSerializationFailure}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("RetryTransient() error = %v, want nil", err)
	}
	if attempts != 2 {
		t.Fatalf("attempts = %d, want 2", attempts)
	}
}

func TestRetryTransientDoesNotRetryPermanentError(t *testing.T) {
	permanent := errors.New("permanent")
	attempts := 0
	err := RetryTransient(context.Background(), 3, func() error {
		attempts++
		return permanent
	})
	if !errors.Is(err, permanent) {
		t.Fatalf("RetryTransient() error = %v, want permanent", err)
	}
	if attempts != 1 {
		t.Fatalf("attempts = %d, want 1", attempts)
	}
}

func TestRetryTransientRespectsCanceledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	attempts := 0
	err := RetryTransient(ctx, 2, func() error {
		attempts++
		return &pgconn.PgError{Code: CodeDeadlockDetected}
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("RetryTransient() error = %v, want context canceled", err)
	}
	if attempts != 1 {
		t.Fatalf("attempts = %d, want 1", attempts)
	}
}
