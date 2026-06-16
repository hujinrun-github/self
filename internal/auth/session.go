package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"portfolio/internal/storage"
)

const SessionCookieName = "portfolio_session"

type Session struct {
	ID        int64
	AdminID   int64
	CSRFHash  string
	CreatedAt time.Time
	LastSeen  time.Time
	ExpiresAt time.Time
}

type sessionContextKey struct{}

func (s *Service) createSession(ctx context.Context, adminID int64) (Session, string, error) {
	rawToken, err := randomToken(32)
	if err != nil {
		return Session{}, "", err
	}
	csrfToken, err := randomToken(32)
	if err != nil {
		return Session{}, "", err
	}
	now := storage.NormalizeTime(s.clock())
	session := Session{
		AdminID:   adminID,
		CSRFHash:  hashToken(csrfToken),
		CreatedAt: now,
		LastSeen:  now,
		ExpiresAt: storage.NormalizeTime(now.Add(s.cfg.SessionTTL)),
	}
	err = s.db.QueryRowContext(ctx, `INSERT INTO sessions (admin_id, session_token_hash, csrf_token_hash, created_at, last_seen_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		adminID,
		hashToken(rawToken),
		session.CSRFHash,
		storage.NormalizeTime(session.CreatedAt),
		storage.NormalizeTime(session.LastSeen),
		storage.NormalizeTime(session.ExpiresAt),
	).Scan(&session.ID)
	if err != nil {
		return Session{}, "", err
	}
	return session, rawToken, nil
}

func (s *Service) sessionFromRequest(w http.ResponseWriter, r *http.Request) (Session, bool) {
	cookie, err := r.Cookie(SessionCookieName)
	if err != nil || strings.TrimSpace(cookie.Value) == "" {
		return Session{}, false
	}
	session, err := s.findSession(r.Context(), cookie.Value)
	if err != nil {
		return Session{}, false
	}
	now := storage.NormalizeTime(s.clock())
	if now.After(session.ExpiresAt) || now.Sub(session.LastSeen) > s.cfg.SessionIdleTimeout {
		_ = s.revokeSession(r.Context(), session.ID)
		return Session{}, false
	}
	_, _ = s.db.ExecContext(r.Context(), `UPDATE sessions SET last_seen_at = $1 WHERE id = $2`, now, session.ID)
	return session, true
}

func (s *Service) findSession(ctx context.Context, rawToken string) (Session, error) {
	var session Session
	var revokedAt sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT id, admin_id, csrf_token_hash, created_at, last_seen_at, expires_at, revoked_at FROM sessions WHERE session_token_hash = $1`, hashToken(rawToken)).
		Scan(&session.ID, &session.AdminID, &session.CSRFHash, &session.CreatedAt, &session.LastSeen, &session.ExpiresAt, &revokedAt)
	if err != nil {
		return Session{}, err
	}
	if revokedAt.Valid {
		return Session{}, sql.ErrNoRows
	}
	session.CreatedAt = storage.NormalizeTime(session.CreatedAt)
	session.LastSeen = storage.NormalizeTime(session.LastSeen)
	session.ExpiresAt = storage.NormalizeTime(session.ExpiresAt)
	return session, nil
}

func (s *Service) revokeSession(ctx context.Context, sessionID int64) error {
	_, err := s.db.ExecContext(ctx, `UPDATE sessions SET revoked_at = $1 WHERE id = $2`, storage.NormalizeTime(s.clock()), sessionID)
	return err
}

func (s *Service) sessionCookie(rawToken string, expiresAt time.Time) *http.Cookie {
	return &http.Cookie{
		Name:     SessionCookieName,
		Value:    rawToken,
		Path:     "/",
		Expires:  expiresAt,
		HttpOnly: true,
		Secure:   strings.HasPrefix(s.cfg.PublicBaseURL, "https://"),
		SameSite: http.SameSiteLaxMode,
	}
}

func (s *Service) clearSessionCookie() *http.Cookie {
	return &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(0, 0).UTC(),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   strings.HasPrefix(s.cfg.PublicBaseURL, "https://"),
		SameSite: http.SameSiteLaxMode,
	}
}

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func randomToken(byteCount int) (string, error) {
	bytes := make([]byte, byteCount)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}
