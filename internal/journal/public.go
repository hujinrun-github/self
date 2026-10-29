package journal

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const idleTTL = 15 * time.Minute
const absoluteTTL = time.Hour

type attemptWindow struct {
	started time.Time
	count   int
}
type attemptLimiter struct {
	mu      sync.Mutex
	windows map[string]attemptWindow
}

// Reserve attempts atomically, including in-flight checks, so parallel requests
// cannot bypass the password work limit. Periodic pruning bounds memory use.
func (l *attemptLimiter) allow(keys map[string]int, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.windows == nil {
		l.windows = map[string]attemptWindow{}
	}
	if len(l.windows) > 10000 {
		for k, v := range l.windows {
			if now.Sub(v.started) >= 10*time.Minute {
				delete(l.windows, k)
			}
		}
		if len(l.windows) > 10000 {
			return false
		}
	}
	for k, max := range keys {
		v := l.windows[k]
		if now.Sub(v.started) < 10*time.Minute && v.count >= max {
			return false
		}
	}
	for k := range keys {
		v := l.windows[k]
		if now.Sub(v.started) >= 10*time.Minute {
			v = attemptWindow{started: now}
		}
		v.count++
		l.windows[k] = v
	}
	return true
}
func tokenHash(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
func randomToken() (string, error) {
	var b [32]byte
	_, err := rand.Read(b[:])
	return hex.EncodeToString(b[:]), err
}
func cookieName(id int64) string { return "journal_view_" + strconv.FormatInt(id, 10) }
func (s *Service) cookie(r *http.Request, id int64, token string, expires time.Time) *http.Cookie {
	c := &http.Cookie{Name: cookieName(id), Value: token, Path: "/api/site/journal/notebooks/" + strconv.FormatInt(id, 10), Expires: expires, HttpOnly: true, Secure: r.TLS != nil || strings.HasPrefix(strings.ToLower(s.cfg.PublicBaseURL), "https://"), SameSite: http.SameSiteLaxMode}
	if token == "" {
		c.MaxAge = -1
	}
	return c
}
func (s *Service) requireOrigin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.validOrigin(r) {
			writeError(w, 403, "forbidden", "Invalid request origin")
			return
		}
		next.ServeHTTP(w, r)
	})
}
func (s *Service) validOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	fromReferer := false
	if origin == "" {
		origin = r.Header.Get("Referer")
		fromReferer = true
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" || u.User != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return false
	}
	if !fromReferer && (u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/")) {
		return false
	}
	actual := u.Scheme + "://" + u.Host
	for _, allowed := range append(append([]string{}, s.cfg.AllowedOrigins...), s.cfg.AppOrigin) {
		if actual == strings.TrimRight(strings.TrimSpace(allowed), "/") {
			return true
		}
	}
	return false
}
func (s *Service) publicBook(r *http.Request, id int64) (string, int64, error) {
	var hash string
	var version int64
	err := s.db.QueryRowContext(r.Context(), `SELECT password_hash,password_version FROM journal_notebooks WHERE id=$1 AND public_enabled AND NOT archived AND password_hash<>''`, id).Scan(&hash, &version)
	return hash, version, err
}

type viewSession struct {
	TokenHash string
	ExpiresAt time.Time
	LastSeen  time.Time
}

func (v viewSession) deadline() time.Time {
	idle := v.LastSeen.Add(idleTTL)
	if idle.Before(v.ExpiresAt) {
		return idle
	}
	return v.ExpiresAt
}
func (s *Service) session(r *http.Request, id int64, version int64) (viewSession, error) {
	var v viewSession
	c, err := r.Cookie(cookieName(id))
	if err != nil || len(c.Value) != 64 {
		return v, sql.ErrNoRows
	}
	v.TokenHash = tokenHash(c.Value)
	err = s.db.QueryRowContext(r.Context(), `SELECT expires_at,last_seen_at FROM journal_view_sessions WHERE token_hash=$1 AND notebook_id=$2 AND password_version=$3`, v.TokenHash, id, version).Scan(&v.ExpiresAt, &v.LastSeen)
	if err != nil {
		return v, err
	}
	if !s.clock().Before(v.deadline()) {
		return v, sql.ErrNoRows
	}
	return v, nil
}
func sessionJSON(v viewSession) map[string]any {
	return map[string]any{"unlocked": true, "expires_at": v.deadline()}
}
func (s *Service) getSession(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	_, version, err := s.publicBook(r, id)
	if err != nil {
		dbError(w, err)
		return
	}
	v, err := s.session(r, id, version)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, 200, map[string]bool{"unlocked": false})
		return
	}
	if err != nil {
		internal(w)
		return
	}
	writeJSON(w, 200, sessionJSON(v))
}
func (s *Service) authorize(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id := idParam(r, "id")
	_, version, err := s.publicBook(r, id)
	if err != nil {
		dbError(w, err)
		return 0, false
	}
	if _, err = s.session(r, id, version); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, 401, "journal_locked", "Enter the viewing password to unlock this notebook")
		} else {
			internal(w)
		}
		return 0, false
	}
	return id, true
}
func (s *Service) unlock(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	hash, version, err := s.publicBook(r, id)
	if err != nil {
		dbError(w, err)
		return
	}
	var input struct {
		Password string `json:"password"`
	}
	if !readJSON(w, r, &input) {
		return
	}
	if len(input.Password) > 72 || len(input.Password) < 8 {
		writeError(w, 401, "invalid_password", "Incorrect viewing password")
		return
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	keys := map[string]int{"book:" + strconv.FormatInt(id, 10): 100, "source:" + host: 50, "pair:" + host + ":" + strconv.FormatInt(id, 10): 10}
	if c, err := r.Cookie(cookieName(id)); err == nil && len(c.Value) == 64 {
		keys["session:"+tokenHash(c.Value)] = 10
	}
	if !s.limiter.allow(keys, s.clock()) {
		w.Header().Set("Retry-After", "600")
		writeError(w, 429, "too_many_requests", "Too many attempts. Try again in 10 minutes.")
		return
	}
	select {
	case s.passwords <- struct{}{}:
		defer func() { <-s.passwords }()
	default:
		w.Header().Set("Retry-After", "2")
		writeError(w, 429, "too_many_requests", "Please try again shortly")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(input.Password)) != nil {
		writeError(w, 401, "invalid_password", "Incorrect viewing password")
		return
	}
	token, err := randomToken()
	if err != nil {
		internal(w)
		return
	}
	now := s.clock()
	expires := now.Add(absoluteTTL)
	// Repeat the policy/version check in the write statement: changing a password
	// during bcrypt verification must never issue a usable stale credential.
	result, err := s.db.ExecContext(r.Context(), `INSERT INTO journal_view_sessions(token_hash,notebook_id,password_version,created_at,last_seen_at,expires_at) SELECT $1,id,password_version,$2,$2,$3 FROM journal_notebooks WHERE id=$4 AND password_version=$5 AND public_enabled AND NOT archived AND password_hash<>''`, tokenHash(token), now, expires, id, version)
	if err != nil {
		internal(w)
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		writeError(w, 401, "journal_locked", "Viewing settings changed. Enter the password again.")
		return
	}
	if old, err := r.Cookie(cookieName(id)); err == nil {
		_, _ = s.db.ExecContext(r.Context(), `DELETE FROM journal_view_sessions WHERE token_hash=$1 AND notebook_id=$2`, tokenHash(old.Value), id)
	}
	http.SetCookie(w, s.cookie(r, id, token, expires))
	writeJSON(w, 200, sessionJSON(viewSession{ExpiresAt: expires, LastSeen: now}))
}
func (s *Service) lock(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	if c, err := r.Cookie(cookieName(id)); err == nil {
		if _, err = s.db.ExecContext(r.Context(), `DELETE FROM journal_view_sessions WHERE token_hash=$1 AND notebook_id=$2`, tokenHash(c.Value), id); err != nil {
			internal(w)
			return
		}
	}
	http.SetCookie(w, s.cookie(r, id, "", time.Unix(0, 0)))
	w.WriteHeader(204)
}
func (s *Service) touch(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	_, version, err := s.publicBook(r, id)
	if err != nil {
		dbError(w, err)
		return
	}
	v, err := s.session(r, id, version)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, 401, "journal_locked", "Notebook is locked")
		} else {
			internal(w)
		}
		return
	}
	now := s.clock()
	result, err := s.db.ExecContext(r.Context(), `UPDATE journal_view_sessions v SET last_seen_at=$1 FROM journal_notebooks n WHERE v.token_hash=$2 AND n.id=v.notebook_id AND n.public_enabled AND NOT n.archived AND n.password_version=v.password_version AND v.expires_at>$1 AND v.last_seen_at>$3`, now, v.TokenHash, now.Add(-idleTTL))
	if err != nil {
		internal(w)
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		writeError(w, 401, "journal_locked", "Notebook is locked")
		return
	}
	v.LastSeen = now
	writeJSON(w, 200, sessionJSON(v))
}
func (s *Service) listPublicEntries(w http.ResponseWriter, r *http.Request) {
	id, ok := s.authorize(w, r)
	if !ok {
		return
	}
	s.listEntries(w, r, id, true)
}
func (s *Service) getPublicEntry(w http.ResponseWriter, r *http.Request) {
	id, ok := s.authorize(w, r)
	if !ok {
		return
	}
	e, err := scanEntry(s.db.QueryRowContext(r.Context(), `SELECT `+entryColumns+` FROM journal_entries WHERE notebook_id=$1 AND id=$2 AND deleted_at IS NULL`, id, idParam(r, "entryId")))
	if err != nil {
		dbError(w, err)
		return
	}
	writeJSON(w, 200, e)
}
