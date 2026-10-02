package content

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"portfolio/internal/httpserver"
)

type SiteEngagementOptions struct {
	AllowedOrigins []string
	VisitorSecret  string
	SecureCookies  bool
}

const visitorCookieName = "writing_visitor"
const engagementBodyLimit = 8192

type engagementRateEntry struct {
	Count   int
	Expires time.Time
}
type siteEngagement struct {
	secret        []byte
	origins       map[string]bool
	secureCookies bool
	mu            sync.Mutex
	rates         map[string]engagementRateEntry
}

func newSiteEngagement(options []SiteEngagementOptions) *siteEngagement {
	var option SiteEngagementOptions
	if len(options) > 0 {
		option = options[0]
	}
	secret := []byte(option.VisitorSecret)
	if len(secret) == 0 {
		secret = make([]byte, 32)
		if _, err := rand.Read(secret); err != nil {
			panic("cannot generate visitor session key")
		}
	}
	s := &siteEngagement{secret: secret, origins: map[string]bool{}, secureCookies: option.SecureCookies, rates: map[string]engagementRateEntry{}}
	for _, origin := range option.AllowedOrigins {
		if parsed, err := url.Parse(strings.TrimSpace(origin)); err == nil && (parsed.Scheme == "https" || parsed.Scheme == "http") && parsed.Host != "" {
			s.origins[parsed.Scheme+"://"+parsed.Host] = true
		}
	}
	return s
}
func (s *siteEngagement) digest(value string) string {
	h := hmac.New(sha256.New, s.secret)
	h.Write([]byte(value))
	return hex.EncodeToString(h.Sum(nil))
}
func (s *siteEngagement) cookieVisitor(req *http.Request) (string, bool) {
	cookie, err := req.Cookie(visitorCookieName)
	if err != nil {
		return "", false
	}
	parts := strings.Split(cookie.Value, ".")
	if len(parts) != 3 {
		return "", false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || len(raw) != 32 {
		return "", false
	}
	expires, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || expires <= time.Now().Unix() {
		return "", false
	}
	expected := s.digest("cookie:" + parts[0] + "." + parts[1])
	if !hmac.Equal([]byte(expected), []byte(parts[2])) {
		return "", false
	}
	return s.digest("visitor:" + parts[0]), true
}
func (s *siteEngagement) establishVisitor(w http.ResponseWriter, req *http.Request) (string, error) {
	if visitor, ok := s.cookieVisitor(req); ok {
		return visitor, nil
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	id := base64.RawURLEncoding.EncodeToString(raw)
	expires := time.Now().Add(365 * 24 * time.Hour)
	value := id + "." + strconv.FormatInt(expires.Unix(), 10)
	secure := s.secureCookies || req.TLS != nil || s.origins["https://"+req.Host]
	http.SetCookie(w, &http.Cookie{Name: visitorCookieName, Value: value + "." + s.digest("cookie:"+value), Path: "/api/site/writing", HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode, Expires: expires, MaxAge: 365 * 24 * 3600})
	return s.digest("visitor:" + id), nil
}
func (s *siteEngagement) validOrigin(req *http.Request) bool {
	if req.Header.Get("Sec-Fetch-Site") == "cross-site" {
		return false
	}
	origin := req.Header.Get("Origin")
	if origin == "" && req.Referer() != "" {
		parsed, err := url.Parse(req.Referer())
		if err == nil {
			origin = parsed.Scheme + "://" + parsed.Host
		}
	}
	if origin == "" {
		return req.Header.Get("Sec-Fetch-Site") == "same-origin"
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return false
	}
	normalized := parsed.Scheme + "://" + parsed.Host
	if s.origins[normalized] {
		return true
	}
	scheme := "http"
	if req.TLS != nil {
		scheme = "https"
	}
	return normalized == scheme+"://"+req.Host
}
func (s *siteEngagement) allowWrite(visitor, remote, action string) bool {
	ip, _, err := net.SplitHostPort(remote)
	if err != nil {
		ip = remote
	}
	if parsed := net.ParseIP(ip); parsed != nil {
		ip = parsed.String()
	} else {
		ip = "unknown"
	}
	now := time.Now()
	window := time.Minute
	visitorMax, ipMax := 120, 600
	if action == "comments" {
		window = 10 * time.Minute
		visitorMax, ipMax = 5, 60
	}
	keys := []string{action + ":visitor:" + visitor, action + ":ip:" + s.digest("ip:"+ip)}
	limits := []int{visitorMax, ipMax}
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.rates) > 4000 {
		for key, entry := range s.rates {
			if !entry.Expires.After(now) {
				delete(s.rates, key)
			}
		}
	}
	newKeys := 0
	for i, key := range keys {
		entry, ok := s.rates[key]
		if !ok {
			newKeys++
		}
		if entry.Expires.After(now) && entry.Count >= limits[i] {
			return false
		}
	}
	if len(s.rates)+newKeys > 4096 {
		return false
	}
	for _, key := range keys {
		entry := s.rates[key]
		if !entry.Expires.After(now) {
			entry = engagementRateEntry{Expires: now.Add(window)}
		}
		entry.Count++
		s.rates[key] = entry
	}
	return true
}
func (s *siteEngagement) authorize(w http.ResponseWriter, req *http.Request, action string) (string, bool) {
	if !s.validOrigin(req) {
		httpserver.WriteError(w, 403, "forbidden", "Invalid request origin", nil)
		return "", false
	}
	mediaType, _, err := mime.ParseMediaType(req.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		httpserver.WriteError(w, 415, "unsupported_media_type", "JSON content type is required", nil)
		return "", false
	}
	visitor, ok := s.cookieVisitor(req)
	if !ok {
		httpserver.WriteError(w, 403, "visitor_required", "Load article engagement before posting", nil)
		return "", false
	}
	if !s.allowWrite(visitor, req.RemoteAddr, action) {
		retryAfter := "60"
		if action == "comments" {
			retryAfter = "600"
		}
		w.Header().Set("Retry-After", retryAfter)
		httpserver.WriteError(w, 429, "rate_limited", "Too many requests; please try again later", nil)
		return "", false
	}
	return visitor, true
}
func decodeEngagementJSON(w http.ResponseWriter, req *http.Request, target any) bool {
	mediaType, _, err := mime.ParseMediaType(req.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		httpserver.WriteError(w, 415, "unsupported_media_type", "JSON content type is required", nil)
		return false
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, req.Body, engagementBodyLimit))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			httpserver.WriteError(w, 413, "payload_too_large", "Request body is too large", nil)
		} else {
			httpserver.WriteError(w, 400, "validation_error", "Invalid request body", nil)
		}
		return false
	}
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || raw[0] != '{' {
		httpserver.WriteError(w, 400, "validation_error", "A JSON object is required", nil)
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(target); err == nil {
		var extra any
		err = decoder.Decode(&extra)
		if err == io.EOF {
			return true
		}
	}
	httpserver.WriteError(w, 400, "validation_error", "Invalid request payload", nil)
	return false
}
func engagementPage(req *http.Request, defaultLimit int) (int, int) {
	page, _ := strconv.Atoi(req.URL.Query().Get("page"))
	limit, _ := strconv.Atoi(req.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = defaultLimit
	}
	return normalizeEngagementPage(page, limit)
}

func registerSiteEngagement(router chi.Router, repo *Repository, options []SiteEngagementOptions) {
	service := newSiteEngagement(options)
	router.Get("/api/site/writing/{slug}/engagement", func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Add("Vary", "Cookie")
		writing, ok := publicWritingFromRequest(w, req, repo)
		if !ok {
			return
		}
		visitor, err := service.establishVisitor(w, req)
		if err != nil {
			writeError(w, err)
			return
		}
		page, limit := engagementPage(req, 10)
		output, err := repo.WritingEngagement(req.Context(), writing.ID, visitor, page, limit)
		writeResult(w, output, err)
	})
	router.Post("/api/site/writing/{slug}/like", func(w http.ResponseWriter, req *http.Request) {
		writing, ok := publicWritingFromRequest(w, req, repo)
		if !ok {
			return
		}
		visitor, ok := service.authorize(w, req, "like")
		if !ok {
			return
		}
		var input struct {
			Liked *bool `json:"liked"`
		}
		if !decodeEngagementJSON(w, req, &input) {
			return
		}
		if input.Liked == nil {
			httpserver.WriteError(w, 400, "validation_error", "liked must be a boolean", nil)
			return
		}
		output, err := repo.SetWritingLike(req.Context(), writing.ID, visitor, *input.Liked)
		writeResult(w, output, err)
	})
	router.Post("/api/site/writing/{slug}/view", func(w http.ResponseWriter, req *http.Request) {
		writing, ok := publicWritingFromRequest(w, req, repo)
		if !ok {
			return
		}
		visitor, ok := service.authorize(w, req, "view")
		if !ok {
			return
		}
		var input struct{}
		if !decodeEngagementJSON(w, req, &input) {
			return
		}
		output, err := repo.RecordWritingView(req.Context(), writing.ID, visitor)
		writeResult(w, output, err)
	})
	router.Post("/api/site/writing/{slug}/comments", func(w http.ResponseWriter, req *http.Request) {
		writing, ok := publicWritingFromRequest(w, req, repo)
		if !ok {
			return
		}
		_, ok = service.authorize(w, req, "comments")
		if !ok {
			return
		}
		var input WritingCommentInput
		if !decodeEngagementJSON(w, req, &input) {
			return
		}
		output, err := repo.CreateWritingComment(req.Context(), writing.ID, input)
		writeCreated(w, output, err)
	})
}

func registerAdminEngagement(router chi.Router, repo *Repository) {
	router.Get("/api/admin/comments", func(w http.ResponseWriter, req *http.Request) {
		page, limit := engagementPage(req, 20)
		var writingID int64
		if raw := req.URL.Query().Get("writing_id"); raw != "" {
			var err error
			writingID, err = strconv.ParseInt(raw, 10, 64)
			if err != nil || writingID <= 0 {
				httpserver.WriteError(w, 400, "validation_error", "Invalid writing id", nil)
				return
			}
		}
		output, err := repo.ListWritingComments(req.Context(), req.URL.Query().Get("status"), writingID, page, limit)
		writeResult(w, output, err)
	})
	router.Patch("/api/admin/comments/{id}", func(w http.ResponseWriter, req *http.Request) {
		id, ok := idParam(w, req)
		if !ok {
			return
		}
		var input struct {
			Status string `json:"status"`
		}
		if !decodeEngagementJSON(w, req, &input) {
			return
		}
		output, err := repo.SetWritingCommentStatus(req.Context(), id, input.Status)
		writeResult(w, output, err)
	})
	router.Delete("/api/admin/comments/{id}", func(w http.ResponseWriter, req *http.Request) {
		id, ok := idParam(w, req)
		if !ok {
			return
		}
		if err := repo.DeleteWritingComment(req.Context(), id); err != nil {
			writeError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	router.Get("/api/admin/writing/stats", func(w http.ResponseWriter, req *http.Request) {
		page, limit := engagementPage(req, 20)
		output, err := repo.WritingStats(req.Context(), page, limit)
		writeResult(w, output, err)
	})
}
