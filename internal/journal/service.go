package journal

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"portfolio/internal/auth"
	"portfolio/internal/config"
	"portfolio/internal/httpserver"
)

type Service struct {
	db          *sql.DB
	cfg         config.Config
	clock       func() time.Time
	limiter     attemptLimiter
	passwords   chan struct{}
	cleanupMu   sync.Mutex
	lastCleanup time.Time
}

func NewService(database *sql.DB, cfg config.Config) *Service {
	return &Service{db: database, cfg: cfg, clock: func() time.Time { return time.Now().UTC() }, passwords: make(chan struct{}, 4)}
}
func private(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}
func (s *Service) RegisterAdminRoutes(r chi.Router) {
	r.Route("/api/admin/journal", func(r chi.Router) {
		r.Use(private)
		r.Get("/session", s.getAdminSession)
		r.Get("/notebooks", s.listNotebooks)
		r.Post("/notebooks", s.createNotebook)
		r.Put("/notebooks/{id}", s.updateNotebook)
		r.Delete("/notebooks/{id}", s.deleteNotebook)
		r.Get("/notebooks/{id}/entries", s.listAdminEntries)
		r.Post("/notebooks/{id}/entries", s.createEntry)
		r.Get("/entries/{id}", s.getAdminEntry)
		r.Put("/entries/{id}", s.updateEntry)
		r.Delete("/entries/{id}", s.deleteEntry)
		r.Post("/entries/{id}/restore", s.restoreEntry)
		r.Post("/notebooks/{id}/assets", s.uploadAsset)
		r.Get("/assets/{id}", s.getAdminAsset)
		r.Get("/notebooks/{id}/export.zip", s.exportNotebook)
		r.Post("/notebooks/{id}/import", s.importNotebook)
	})
}

// The enclosing RequireAdmin middleware refreshes last_seen_at for this explicit
// interaction. Report its new idle deadline without issuing any visitor grant.
func (s *Service) getAdminSession(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized", "Authentication required")
		return
	}
	now := s.clock()
	deadline := now.Add(s.cfg.SessionIdleTimeout)
	if session.ExpiresAt.Before(deadline) {
		deadline = session.ExpiresAt
	}
	writeJSON(w, http.StatusOK, map[string]time.Time{"expires_at": deadline, "server_time": now})
}

func (s *Service) RegisterPublicRoutes(r chi.Router) {
	r.Route("/api/site/journal", func(r chi.Router) {
		r.Use(private)
		r.Get("/notebooks", s.listPublicNotebooks)
		r.Get("/notebooks/{id}/session", s.getSession)
		r.With(s.requireOrigin).Post("/notebooks/{id}/unlock", s.unlock)
		r.With(s.requireOrigin).Post("/notebooks/{id}/lock", s.lock)
		r.With(s.requireOrigin).Post("/notebooks/{id}/touch", s.touch)
		r.Get("/notebooks/{id}/entries", s.listPublicEntries)
		r.Get("/notebooks/{id}/entries/{entryId}", s.getPublicEntry)
		r.Get("/notebooks/{id}/assets/{assetId}", s.getPublicAsset)
	})
}
func writeJSON(w http.ResponseWriter, status int, value any) { httpserver.WriteJSON(w, status, value) }
func writeError(w http.ResponseWriter, status int, code, msg string) {
	httpserver.WriteError(w, status, code, msg, nil)
}
func bad(w http.ResponseWriter, msg string) { writeError(w, 400, "validation_error", msg) }
func internal(w http.ResponseWriter) {
	writeError(w, 500, "internal_error", "Journal operation failed")
}
func notFound(w http.ResponseWriter) { writeError(w, 404, "not_found", "Journal item not found") }
func conflict(w http.ResponseWriter) {
	writeError(w, 409, "version_conflict", "This item changed. Keep your draft and reload the latest version.")
}
func idParam(r *http.Request, name string) int64 {
	id, _ := strconv.ParseInt(chi.URLParam(r, name), 10, 64)
	return id
}
func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	d := json.NewDecoder(r.Body)
	if err := d.Decode(v); err != nil {
		bad(w, "Invalid JSON request")
		return false
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		bad(w, "Unexpected trailing JSON")
		return false
	}
	return true
}

type scanner interface{ Scan(...any) error }

const notebookColumns = `id,name,public_title,cover_color,paper,public_enabled,(password_hash<>''),archived,version,created_at,updated_at`

func scanNotebook(row scanner) (Notebook, error) {
	var n Notebook
	err := row.Scan(&n.ID, &n.Name, &n.PublicTitle, &n.CoverColor, &n.Paper, &n.PublicEnabled, &n.HasPassword, &n.Archived, &n.Version, &n.CreatedAt, &n.UpdatedAt)
	return n, err
}

const entryColumns = `id,notebook_id,title,to_char(entry_date,'YYYY-MM-DD'),mood,weather,tags,favorite,scene,version,deleted_at,created_at,updated_at`

func scanEntry(row scanner) (Entry, error) {
	var e Entry
	var tags, scene []byte
	err := row.Scan(&e.ID, &e.NotebookID, &e.Title, &e.EntryDate, &e.Mood, &e.Weather, &tags, &e.Favorite, &scene, &e.Version, &e.DeletedAt, &e.CreatedAt, &e.UpdatedAt)
	if err != nil {
		return e, err
	}
	if err = json.Unmarshal(tags, &e.Tags); err != nil {
		return e, err
	}
	err = json.Unmarshal(scene, &e.Scene)
	return e, err
}
func (s *Service) notebookExists(ctx context.Context, id int64) error {
	var found int64
	return s.db.QueryRowContext(ctx, `SELECT id FROM journal_notebooks WHERE id=$1`, id).Scan(&found)
}
func dbError(w http.ResponseWriter, err error) {
	if errors.Is(err, sql.ErrNoRows) {
		notFound(w)
	} else {
		internal(w)
	}
}

// Cleanup is throttled and runs on authenticated management requests. Photos live in
// PostgreSQL, so one pg_dump includes metadata, layouts and private image bytes.
func (s *Service) cleanup(ctx context.Context) {
	s.cleanupMu.Lock()
	defer s.cleanupMu.Unlock()
	now := s.clock()
	if now.Sub(s.lastCleanup) < time.Hour {
		return
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `DELETE FROM journal_entries WHERE deleted_at < $1`, now.Add(-30*24*time.Hour)); err != nil {
		return
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM journal_assets a WHERE created_at < $1 AND NOT EXISTS(SELECT 1 FROM journal_entry_assets r WHERE r.asset_id=a.id)`, now.Add(-24*time.Hour)); err != nil {
		return
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM journal_view_sessions WHERE expires_at <= $1`, now); err != nil {
		return
	}
	if tx.Commit() == nil {
		s.lastCleanup = now
	}
}
