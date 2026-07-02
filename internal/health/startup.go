package health

import (
	"context"
	"errors"
	"strings"
)

var (
	errMissingDBProbe   = errors.New("health db probe is required")
	errMissingBlobProbe = errors.New("health blob probe is required")
)

func RunStartupChecks(ctx context.Context, mediaBlobBackend string, blobProbe Probe) error {
	if !isHybridBackend(mediaBlobBackend) {
		return nil
	}
	if blobProbe == nil {
		return errMissingBlobProbe
	}
	return blobProbe(ctx)
}

func isHybridBackend(mediaBlobBackend string) bool {
	return strings.EqualFold(strings.TrimSpace(mediaBlobBackend), "hybrid")
}
