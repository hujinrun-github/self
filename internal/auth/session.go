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
	now := s.clock()
	session := Session{
		AdminID:   adminID,
		CSRFHash:  hashToken(csrfToken),
		CreatedAt: now,
		LastSeen:  now,
		ExpiresAt: now.Add(s.cfg.SessionTTL),
	}
	result, err := s.db.ExecContext(ctx, `INSERT INTO sessions (admin_id, session_token_hash, csrf_token_hash, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
		adminID,
		hashToken(rawToken),
		session.CSRFHash,
		formatTime(session.CreatedAt),
		formatTime(session.LastSeen),
		formatTime(session.ExpiresAt),
	)
	if err != nil {
		return Session{}, "", err
	}
	session.ID, err = result.LastInsertId()
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
	now := s.clock()
	if now.After(session.ExpiresAt) || now.Sub(session.LastSeen) > s.cfg.SessionIdleTimeout {
		_ = s.revokeSession(r.Context(), session.ID)
		return Session{}, false
	}
	_, _ = s.db.ExecContext(r.Context(), `UPDATE sessions SET last_seen_at = ? WHERE id = ?`, formatTime(now), session.ID)
	return session, true
}

func (s *Service) findSession(ctx context.Context, rawToken string) (Session, error) {
	var session Session
	var createdAt string
	var lastSeen string
	var expiresAt string
	var revokedAt sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT id, admin_id, csrf_token_hash, created_at, last_seen_at, expires_at, revoked_at FROM sessions WHERE session_token_hash = ?`, hashToken(rawToken)).
		Scan(&session.ID, &session.AdminID, &session.CSRFHash, &createdAt, &lastSeen, &expiresAt, &revokedAt)
	if err != nil {
		return Session{}, err
	}
	if revokedAt.Valid {
		return Session{}, sql.ErrNoRows
	}
	session.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return Session{}, err
	}
	session.LastSeen, err = time.Parse(time.RFC3339Nano, lastSeen)
	if err != nil {
		return Session{}, err
	}
	session.ExpiresAt, err = time.Parse(time.RFC3339Nano, expiresAt)
	if err != nil {
		return Session{}, err
	}
	return session, nil
}

func (s *Service) revokeSession(ctx context.Context, sessionID int64) error {
	_, err := s.db.ExecContext(ctx, `UPDATE sessions SET revoked_at = ? WHERE id = ?`, formatTime(s.clock()), sessionID)
	return err
}

func (s *Service) sessionCookie(rawToken string, expiresAt time.Time, r *http.Request) *http.Cookie {
	return &http.Cookie{
		Name:     SessionCookieName,
		Value:    rawToken,
		Path:     "/",
		Expires:  expiresAt,
		HttpOnly: true,
		Secure:   s.secureCookieForRequest(r),
		SameSite: http.SameSiteLaxMode,
	}
}

func (s *Service) clearSessionCookie(r *http.Request) *http.Cookie {
	return &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(0, 0).UTC(),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   s.secureCookieForRequest(r),
		SameSite: http.SameSiteLaxMode,
	}
}

func (s *Service) secureCookieForRequest(r *http.Request) bool {
	if r != nil {
		if r.TLS != nil {
			return true
		}
		if strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https") {
			return true
		}
		if strings.Contains(strings.ToLower(r.Header.Get("Forwarded")), "proto=https") {
			return true
		}
		requestOrigin := strings.TrimSpace(r.Header.Get("Origin"))
		if requestOrigin == "" {
			requestOrigin = strings.TrimSpace(r.Header.Get("Referer"))
		}
		if requestOrigin != "" {
			return strings.HasPrefix(strings.ToLower(requestOrigin), "https://")
		}
	}
	return strings.HasPrefix(strings.ToLower(s.cfg.PublicBaseURL), "https://")
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

func formatTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339Nano)
}
