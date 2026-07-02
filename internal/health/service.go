package health

import (
	"context"
	"net/http"
	"strings"
	"time"

	"portfolio/internal/httpserver"
)

type Probe func(context.Context) error

const serviceBlobProbeTimeout = 3 * time.Second

type Service struct {
	mediaBlobBackend string
	dbProbe          Probe
	blobProbe        Probe
	blobProbeTimeout time.Duration
}

func NewService(mediaBlobBackend string, dbProbe Probe, blobProbe Probe) *Service {
	return &Service{
		mediaBlobBackend: strings.TrimSpace(mediaBlobBackend),
		dbProbe:          dbProbe,
		blobProbe:        blobProbe,
		blobProbeTimeout: serviceBlobProbeTimeout,
	}
}

func (s *Service) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := s.runChecks(r.Context()); err != nil {
			httpserver.WriteError(w, http.StatusServiceUnavailable, "service_unavailable", "Health checks failed", nil)
			return
		}
		httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
}

func (s *Service) runChecks(ctx context.Context) error {
	if s.dbProbe == nil {
		return errMissingDBProbe
	}
	if err := s.dbProbe(ctx); err != nil {
		return err
	}
	if !IsHybridBlobBackend(s.mediaBlobBackend) {
		return nil
	}
	if s.blobProbe == nil {
		return errMissingBlobProbe
	}
	return runProbeWithTimeout(ctx, s.blobProbe, s.probeTimeout())
}

func (s *Service) probeTimeout() time.Duration {
	if s.blobProbeTimeout <= 0 {
		return serviceBlobProbeTimeout
	}
	return s.blobProbeTimeout
}
