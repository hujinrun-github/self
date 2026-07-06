package health

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestRunStartupChecksRequiresBlobStoreProbeInHybridMode(t *testing.T) {
	t.Run("mixed-case hybrid mode with nil probe", func(t *testing.T) {
		err := RunStartupChecks(context.Background(), "Hybrid", nil)
		if !errors.Is(err, errMissingBlobProbe) {
			t.Fatalf("error = %v, want %v", err, errMissingBlobProbe)
		}
	})

	t.Run("hybrid mode", func(t *testing.T) {
		calls := 0
		probeErr := errors.New("blob store unavailable")

		err := RunStartupChecks(context.Background(), "hybrid", func(context.Context) error {
			calls++
			return probeErr
		})
		if !errors.Is(err, probeErr) {
			t.Fatalf("error = %v, want wrapped probe error", err)
		}
		if calls != 1 {
			t.Fatalf("probe calls = %d, want 1", calls)
		}
	})

	t.Run("non-hybrid mode with nil probe", func(t *testing.T) {
		err := RunStartupChecks(context.Background(), "local", nil)
		if err != nil {
			t.Fatalf("RunStartupChecks returned error: %v", err)
		}
	})

	t.Run("non-hybrid mode with probe", func(t *testing.T) {
		calls := 0

		err := RunStartupChecks(context.Background(), "local", func(context.Context) error {
			calls++
			return errors.New("should not run")
		})
		if err != nil {
			t.Fatalf("RunStartupChecks returned error: %v", err)
		}
		if calls != 0 {
			t.Fatalf("probe calls = %d, want 0", calls)
		}
	})
}

func TestRunStartupChecksUsesBoundedProbeContext(t *testing.T) {
	var deadline time.Time

	err := RunStartupChecks(context.Background(), "Hybrid", func(ctx context.Context) error {
		var ok bool
		deadline, ok = ctx.Deadline()
		if !ok {
			t.Fatal("expected blob probe context to have a deadline")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("RunStartupChecks returned error: %v", err)
	}
	if deadline.IsZero() {
		t.Fatal("expected blob probe deadline to be captured")
	}
	if remaining := time.Until(deadline); remaining <= 0 || remaining > startupBlobProbeTimeout {
		t.Fatalf("probe deadline remaining = %v, want between 0 and %v", remaining, startupBlobProbeTimeout)
	}
}

func TestRunStartupChecksTimesOutStalledHybridBlobProbe(t *testing.T) {
	err := runStartupChecks(context.Background(), "Hybrid", func(ctx context.Context) error {
		<-ctx.Done()
		return ctx.Err()
	}, 5*time.Millisecond)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("error = %v, want %v", err, context.DeadlineExceeded)
	}
}
