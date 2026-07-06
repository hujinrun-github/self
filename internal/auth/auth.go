package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/crypto/bcrypt"

	"portfolio/internal/config"
	"portfolio/internal/storage"
)

const bootstrapAdminLockKey int64 = 710203992

type Service struct {
	db      *sql.DB
	cfg     config.Config
	clock   func() time.Time
	limiter *RateLimiter
}

func NewService(database *sql.DB, cfg config.Config) *Service {
	return &Service{
		db:      database,
		cfg:     cfg,
		clock:   func() time.Time { return time.Now().UTC() },
		limiter: NewRateLimiter(5, 10*time.Minute),
	}
}

func (s *Service) BootstrapAdmin(ctx context.Context) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1)`, bootstrapAdminLockKey); err != nil {
		return err
	}

	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM admins`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		if s.cfg.AdminPassword != "" && strings.HasPrefix(s.cfg.PublicBaseURL, "https://") {
			log.Printf("warning: ADMIN_PASSWORD remains set after admin bootstrap")
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		committed = true
		return nil
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(s.cfg.AdminPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	now := storage.NormalizeTime(s.clock())
	if _, err := tx.ExecContext(ctx, `INSERT INTO admins (email, password_hash, created_at, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING`, s.cfg.AdminEmail, string(hash), now, now); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	committed = true
	return nil
}

func (s *Service) Routes() http.Handler {
	r := chi.NewRouter()
	r.Post("/login", s.handleLogin)
	r.With(s.RequireAdmin).Post("/logout", s.handleLogout)
	r.With(s.RequireAdmin).Get("/me", s.handleMe)
	r.With(s.RequireAdmin).Get("/csrf", s.handleCSRF)
	return r
}

func (s *Service) RegisterRoutes(r chi.Router) {
	r.Post("/api/admin/login", s.handleLogin)
	r.With(s.RequireAdmin).Post("/api/admin/logout", s.handleLogout)
	r.With(s.RequireAdmin).Get("/api/admin/me", s.handleMe)
	r.With(s.RequireAdmin).Get("/api/admin/csrf", s.handleCSRF)
}

func (s *Service) RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session, ok := s.sessionFromRequest(w, r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized", "Authentication required")
			return
		}
		if isUnsafe(r.Method) {
			if !s.validOriginOrReferer(r) {
				writeError(w, http.StatusForbidden, "forbidden", "Invalid request origin")
				return
			}
			if !s.validCSRF(r.Context(), session.ID, r.Header.Get("X-CSRF-Token")) {
				writeError(w, http.StatusForbidden, "forbidden", "Invalid CSRF token")
				return
			}
		}
		ctx := context.WithValue(r.Context(), sessionContextKey{}, session)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Service) handleLogin(w http.ResponseWriter, r *http.Request) {
	if !s.validOriginOrReferer(r) {
		writeError(w, http.StatusForbidden, "forbidden", "Invalid request origin")
		return
	}
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "validation_error", "Invalid login request")
		return
	}
	key := loginKey(r, input.Email)
	if !s.limiter.Allow(key, s.clock()) {
		writeError(w, http.StatusTooManyRequests, "too_many_requests", "Too many login attempts")
		return
	}

	adminID, passwordHash, err := s.lookupAdmin(r.Context(), input.Email)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(input.Password)) != nil {
		s.limiter.RecordFailure(key, s.clock())
		writeError(w, http.StatusUnauthorized, "unauthorized", "Invalid email or password")
		return
	}
	s.limiter.Reset(key)
	session, rawToken, err := s.createSession(r.Context(), adminID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Could not create session")
		return
	}
	http.SetCookie(w, s.sessionCookie(rawToken, session.ExpiresAt, r))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) handleLogout(w http.ResponseWriter, r *http.Request) {
	session, _ := r.Context().Value(sessionContextKey{}).(Session)
	if err := s.revokeSession(r.Context(), session.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Could not revoke session")
		return
	}
	http.SetCookie(w, s.clearSessionCookie(r))
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handleMe(w http.ResponseWriter, r *http.Request) {
	session, _ := r.Context().Value(sessionContextKey{}).(Session)
	csrfToken, err := s.issueCSRF(r.Context(), session.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Could not issue CSRF token")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"admin":      map[string]any{"id": session.AdminID},
		"csrf_token": csrfToken,
	})
}

func (s *Service) handleCSRF(w http.ResponseWriter, r *http.Request) {
	session, _ := r.Context().Value(sessionContextKey{}).(Session)
	csrfToken, err := s.issueCSRF(r.Context(), session.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Could not issue CSRF token")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"csrf_token": csrfToken})
}

func (s *Service) lookupAdmin(ctx context.Context, email string) (int64, string, error) {
	var id int64
	var passwordHash string
	err := s.db.QueryRowContext(ctx, `SELECT id, password_hash FROM admins WHERE email = $1`, strings.TrimSpace(email)).Scan(&id, &passwordHash)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, "", err
	}
	return id, passwordHash, err
}

func isUnsafe(method string) bool {
	return method != http.MethodGet && method != http.MethodHead && method != http.MethodOptions
}
