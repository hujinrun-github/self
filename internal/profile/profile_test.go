package profile

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	appdb "portfolio/internal/db"
)

func TestAdminProfileReturnsSocialLinksAndETag(t *testing.T) {
	repo, handler := newProfileTestServer(t)
	seedProfile(t, repo, ProfileInput{
		Name:     "Ada Lovelace",
		Headline: "Computing pioneer",
		Summary:  "Analytical engine notes",
		Bio:      "Longer bio",
		Email:    "ada@example.com",
		SocialLinks: []SocialLinkInput{
			{Label: "GitHub", URL: "https://github.com/ada", Icon: "github"},
		},
	})

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/admin/profile", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	if recorder.Header().Get("ETag") == "" {
		t.Fatal("missing ETag")
	}
	var body ProfileAdminDTO
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Name != "Ada Lovelace" || len(body.SocialLinks) != 1 || body.SocialLinks[0].Label != "GitHub" {
		t.Fatalf("unexpected profile body: %+v", body)
	}
}

func TestSaveAdminRequiresIfMatchAndRejectsStaleETag(t *testing.T) {
	_, handler := newProfileTestServer(t)

	missing := httptest.NewRecorder()
	handler.ServeHTTP(missing, httptest.NewRequest(http.MethodPut, "/api/admin/profile", profileJSON(ProfileInput{Name: "Ada"})))
	if missing.Code != http.StatusPreconditionRequired {
		t.Fatalf("missing If-Match status = %d", missing.Code)
	}

	get := httptest.NewRecorder()
	handler.ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/api/admin/profile", nil))
	etag := get.Header().Get("ETag")

	ok := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/admin/profile", profileJSON(ProfileInput{Name: "Ada"}))
	req.Header.Set("If-Match", etag)
	handler.ServeHTTP(ok, req)
	if ok.Code != http.StatusNoContent {
		t.Fatalf("update status = %d body=%s", ok.Code, ok.Body.String())
	}

	stale := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPut, "/api/admin/profile", profileJSON(ProfileInput{Name: "Grace"}))
	req.Header.Set("If-Match", etag)
	handler.ServeHTTP(stale, req)
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale update status = %d body=%s", stale.Code, stale.Body.String())
	}
}

func TestSocialLinkReplacementBumpsProfileUpdatedAt(t *testing.T) {
	repo, _ := newProfileTestServer(t)
	admin, etag, err := repo.GetAdmin(t.Context())
	if err != nil {
		t.Fatalf("GetAdmin: %v", err)
	}
	before := admin.UpdatedAt

	repo.clock = func() time.Time { return time.Date(2026, 6, 15, 1, 2, 3, 0, time.UTC) }
	err = repo.SaveAdmin(t.Context(), ProfileInput{
		Name:        "Ada",
		SocialLinks: []SocialLinkInput{{Label: "GitHub", URL: "https://github.com/ada", Icon: "github"}},
	}, etag)
	if err != nil {
		t.Fatalf("SaveAdmin insert link: %v", err)
	}
	afterInsert, etag, err := repo.GetAdmin(t.Context())
	if err != nil {
		t.Fatalf("GetAdmin after insert: %v", err)
	}
	if afterInsert.UpdatedAt == before {
		t.Fatalf("updated_at did not change after social link insert")
	}
	if len(afterInsert.SocialLinks) != 1 {
		t.Fatalf("social links after insert = %d", len(afterInsert.SocialLinks))
	}

	repo.clock = func() time.Time { return time.Date(2026, 6, 15, 2, 2, 3, 0, time.UTC) }
	err = repo.SaveAdmin(t.Context(), ProfileInput{Name: "Ada", SocialLinks: nil}, etag)
	if err != nil {
		t.Fatalf("SaveAdmin delete link: %v", err)
	}
	afterDelete, _, err := repo.GetAdmin(t.Context())
	if err != nil {
		t.Fatalf("GetAdmin after delete: %v", err)
	}
	if afterDelete.UpdatedAt == afterInsert.UpdatedAt {
		t.Fatalf("updated_at did not change after social link delete")
	}
	if len(afterDelete.SocialLinks) != 0 {
		t.Fatalf("social links after delete = %d", len(afterDelete.SocialLinks))
	}
}

func TestPublicProfileReturnsPublicFieldsAndLinks(t *testing.T) {
	repo, handler := newProfileTestServer(t)
	seedProfile(t, repo, ProfileInput{
		Name:     "Ada",
		Headline: "Computing pioneer",
		Summary:  "Summary",
		Bio:      "Bio",
		Email:    "ada@example.com",
		SocialLinks: []SocialLinkInput{
			{Label: "Website", URL: "https://example.com", Icon: "link"},
		},
	})

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/site/profile", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	var body ProfilePublicDTO
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Name != "Ada" || body.Email != "ada@example.com" || len(body.SocialLinks) != 1 {
		t.Fatalf("unexpected public profile: %+v", body)
	}
}

func newProfileTestServer(t *testing.T) (*Repository, http.Handler) {
	t.Helper()
	database, err := appdb.Open(filepath.Join(t.TempDir(), "portfolio.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	repo := NewRepository(database)
	router := chi.NewRouter()
	RegisterAdminRoutes(router, repo)
	RegisterSiteRoutes(router, repo)
	return repo, router
}

func seedProfile(t *testing.T, repo *Repository, input ProfileInput) {
	t.Helper()
	_, etag, err := repo.GetAdmin(t.Context())
	if err != nil {
		t.Fatalf("GetAdmin: %v", err)
	}
	if err := repo.SaveAdmin(t.Context(), input, etag); err != nil {
		t.Fatalf("SaveAdmin seed: %v", err)
	}
}

func profileJSON(input ProfileInput) *bytes.Reader {
	payload, _ := json.Marshal(input)
	return bytes.NewReader(payload)
}
