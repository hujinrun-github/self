package health

import (
	"context"
	"errors"
	"testing"
)

func TestRunStartupChecksRequiresBlobStoreProbeInHybridMode(t *testing.T) {
	t.Run("hybrid mode with nil probe", func(t *testing.T) {
		err := RunStartupChecks(context.Background(), "hybrid", nil)
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
