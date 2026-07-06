package health

import (
	"context"
	"errors"
	"strings"
	"time"
)

var (
	errMissingDBProbe   = errors.New("health db probe is required")
	errMissingBlobProbe = errors.New("health blob probe is required")
)

const startupBlobProbeTimeout = 5 * time.Second

func RunStartupChecks(ctx context.Context, mediaBlobBackend string, blobProbe Probe) error {
	return runStartupChecks(ctx, mediaBlobBackend, blobProbe, startupBlobProbeTimeout)
}

func runStartupChecks(ctx context.Context, mediaBlobBackend string, blobProbe Probe, timeout time.Duration) error {
	if !IsHybridBlobBackend(mediaBlobBackend) {
		return nil
	}
	if blobProbe == nil {
		return errMissingBlobProbe
	}
	return runProbeWithTimeout(ctx, blobProbe, timeout)
}

func IsHybridBlobBackend(mediaBlobBackend string) bool {
	return strings.EqualFold(strings.TrimSpace(mediaBlobBackend), "hybrid")
}

func runProbeWithTimeout(ctx context.Context, probe Probe, timeout time.Duration) error {
	if timeout <= 0 {
		return probe(ctx)
	}
	probeCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return probe(probeCtx)
}
