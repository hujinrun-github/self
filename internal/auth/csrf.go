package auth

import (
	"context"
	"net/http"
	"net/url"
	"strings"
)

func (s *Service) issueCSRF(ctx context.Context, sessionID int64) (string, error) {
	token, err := randomToken(32)
	if err != nil {
		return "", err
	}
	_, err = s.db.ExecContext(ctx, `UPDATE sessions SET csrf_token_hash = ? WHERE id = ?`, hashToken(token), sessionID)
	return token, err
}

func (s *Service) validCSRF(ctx context.Context, sessionID int64, rawToken string) bool {
	if strings.TrimSpace(rawToken) == "" {
		return false
	}
	var storedHash string
	if err := s.db.QueryRowContext(ctx, `SELECT csrf_token_hash FROM sessions WHERE id = ? AND revoked_at IS NULL`, sessionID).Scan(&storedHash); err != nil {
		return false
	}
	return storedHash == hashToken(rawToken)
}

func (s *Service) validOriginOrReferer(r *http.Request) bool {
	if origin := r.Header.Get("Origin"); origin != "" {
		return origin == s.cfg.AppOrigin
	}
	referer := r.Header.Get("Referer")
	if referer == "" {
		return false
	}
	parsed, err := url.Parse(referer)
	if err != nil {
		return false
	}
	return parsed.Scheme+"://"+parsed.Host == s.cfg.AppOrigin
}
