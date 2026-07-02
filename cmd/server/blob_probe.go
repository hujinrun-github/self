package main

import (
	"context"

	"portfolio/internal/health"
	"portfolio/internal/media"
)

func usesHybridBlobBackend(mediaBlobBackend string) bool {
	return health.IsHybridBlobBackend(mediaBlobBackend)
}

func newBlobStoreProbe(mediaBlobBackend string, store media.BlobStore, prefix string) health.Probe {
	if !usesHybridBlobBackend(mediaBlobBackend) || store == nil {
		return nil
	}
	return func(ctx context.Context) error {
		return media.CheckBlobStoreRoundTrip(ctx, store, prefix)
	}
}
