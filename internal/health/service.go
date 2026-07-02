package health

import (
	"context"
	"net/http"
	"strings"

	"portfolio/internal/httpserver"
)

type Probe func(context.Context) error

type Service struct {
	mediaBlobBackend string
	dbProbe          Probe
	blobProbe        Probe
}

func NewService(mediaBlobBackend string, dbProbe Probe, blobProbe Probe) *Service {
	return &Service{
		mediaBlobBackend: strings.TrimSpace(mediaBlobBackend),
		dbProbe:          dbProbe,
		blobProbe:        blobProbe,
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
	if !isHybridBackend(s.mediaBlobBackend) {
		return nil
	}
	if s.blobProbe == nil {
		return errMissingBlobProbe
	}
	return s.blobProbe(ctx)
}
