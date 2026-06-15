package auth

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"portfolio/internal/config"
	appdb "portfolio/internal/db"
)

func TestLoginRequiresOriginButNotSessionOrCSRF(t *testing.T) {
	service, _ := newTestService(t)
	handler := adminTestRouter(service)

	withoutOrigin := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/admin/login", loginBody())
	handler.ServeHTTP(withoutOrigin, req)
	if withoutOrigin.Code != http.StatusForbidden {
		t.Fatalf("login without Origin status = %d", withoutOrigin.Code)
	}

	withOrigin := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/admin/login", loginBody())
	req.Header.Set("Origin", "http://localhost:8080")
	handler.ServeHTTP(withOrigin, req)
	if withOrigin.Code != http.StatusOK {
		t.Fatalf("login with Origin status = %d body=%s", withOrigin.Code, withOrigin.Body.String())
	}
	if len(withOrigin.Result().Cookies()) == 0 {
		t.Fatal("expected login to set session cookie")
	}
}

func TestLogoutAndUnsafeAdminRequireSessionAndCSRF(t *testing.T) {
	service, _ := newTestService(t)
	handler := adminTestRouter(service)
	sessionCookie, csrfToken := loginAndFetchCSRF(t, handler)

	noCSRF := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/admin/logout", nil)
	req.Header.Set("Origin", "http://localhost:8080")
	req.AddCookie(sessionCookie)
	handler.ServeHTTP(noCSRF, req)
	if noCSRF.Code != http.StatusForbidden {
		t.Fatalf("logout without csrf status = %d", noCSRF.Code)
	}

	unsafeNoSession := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/admin/protected", nil)
	req.Header.Set("Origin", "http://localhost:8080")
	req.Header.Set("X-CSRF-Token", csrfToken)
	handler.ServeHTTP(unsafeNoSession, req)
	if unsafeNoSession.Code != http.StatusUnauthorized {
		t.Fatalf("unsafe without session status = %d", unsafeNoSession.Code)
	}

	unsafeOK := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/admin/protected", nil)
	req.Header.Set("Origin", "http://localhost:8080")
	req.Header.Set("X-CSRF-Token", csrfToken)
	req.AddCookie(sessionCookie)
	handler.ServeHTTP(unsafeOK, req)
	if unsafeOK.Code != http.StatusNoContent {
		t.Fatalf("unsafe with session/csrf status = %d body=%s", unsafeOK.Code, unsafeOK.Body.String())
	}

	logoutOK := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/admin/logout", nil)
	req.Header.Set("Origin", "http://localhost:8080")
	req.Header.Set("X-CSRF-Token", csrfToken)
	req.AddCookie(sessionCookie)
	handler.ServeHTTP(logoutOK, req)
	if logoutOK.Code != http.StatusNoContent {
		t.Fatalf("logout with csrf status = %d", logoutOK.Code)
	}
}

func TestSessionStoresOnlyTokenHash(t *testing.T) {
	service, database := newTestService(t)
	handler := adminTestRouter(service)
	sessionCookie, _ := loginAndFetchCSRF(t, handler)

	var storedHash string
	if err := database.QueryRow(`SELECT session_token_hash FROM sessions LIMIT 1`).Scan(&storedHash); err != nil {
		t.Fatalf("query session hash: %v", err)
	}
	if storedHash == sessionCookie.Value {
		t.Fatal("raw session token was stored in database")
	}
	if storedHash != hashToken(sessionCookie.Value) {
		t.Fatalf("stored hash %q does not match cookie hash", storedHash)
	}
}

func newTestService(t *testing.T) (*Service, *sql.DB) {
	t.Helper()
	database, err := appdb.Open(filepath.Join(t.TempDir(), "portfolio.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	cfg := config.Config{
		AppOrigin:          "http://localhost:8080",
		PublicBaseURL:      "http://localhost:8080",
		SiteName:           "Portfolio",
		AdminEmail:         "admin@example.com",
		AdminPassword:      "1234567890abcdef",
		SessionSecret:      "0123456789abcdef0123456789abcdef",
		SessionTTL:         12 * time.Hour,
		SessionIdleTimeout: 2 * time.Hour,
	}
	service := NewService(database, cfg)
	if err := service.BootstrapAdmin(context.Background()); err != nil {
		t.Fatalf("BootstrapAdmin: %v", err)
	}
	return service, database
}

func adminTestRouter(service *Service) http.Handler {
	router := chi.NewRouter()
	router.Mount("/api/admin", service.Routes())
	router.With(service.RequireAdmin).Post("/api/admin/protected", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	return router
}

func loginAndFetchCSRF(t *testing.T, handler http.Handler) (*http.Cookie, string) {
	t.Helper()
	login := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/admin/login", loginBody())
	req.Header.Set("Origin", "http://localhost:8080")
	handler.ServeHTTP(login, req)
	if login.Code != http.StatusOK {
		t.Fatalf("login status = %d body=%s", login.Code, login.Body.String())
	}
	var sessionCookie *http.Cookie
	for _, cookie := range login.Result().Cookies() {
		if cookie.Name == SessionCookieName {
			sessionCookie = cookie
			break
		}
	}
	if sessionCookie == nil {
		t.Fatal("missing session cookie")
	}

	csrf := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/admin/csrf", nil)
	req.AddCookie(sessionCookie)
	handler.ServeHTTP(csrf, req)
	if csrf.Code != http.StatusOK {
		t.Fatalf("csrf status = %d body=%s", csrf.Code, csrf.Body.String())
	}
	var body struct {
		CSRFToken string `json:"csrf_token"`
	}
	if err := json.Unmarshal(csrf.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode csrf: %v", err)
	}
	if strings.TrimSpace(body.CSRFToken) == "" {
		t.Fatal("empty csrf token")
	}
	return sessionCookie, body.CSRFToken
}

func loginBody() *bytes.Reader {
	return bytes.NewReader([]byte(`{"email":"admin@example.com","password":"1234567890abcdef"}`))
}
