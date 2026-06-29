package profile

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"portfolio/internal/i18n"
	dbtest "portfolio/internal/testutil/postgres"
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

func TestSaveAdminConcurrentWithSameETagAllowsOneWrite(t *testing.T) {
	repo, _ := newProfileTestServer(t)
	_, etag, err := repo.GetAdmin(t.Context())
	if err != nil {
		t.Fatalf("GetAdmin: %v", err)
	}

	repo.clock = func() time.Time { return time.Date(2026, 6, 15, 3, 2, 1, 987654000, time.UTC) }
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			errs <- repo.SaveAdmin(t.Context(), ProfileInput{Name: "Concurrent"}, etag)
		}()
	}

	var success int
	var conflicts int
	for i := 0; i < 2; i++ {
		err := <-errs
		switch {
		case err == nil:
			success++
		case errors.Is(err, ErrConflict):
			conflicts++
		default:
			t.Fatalf("SaveAdmin concurrent err = %v", err)
		}
	}
	if success != 1 || conflicts != 1 {
		t.Fatalf("success=%d conflicts=%d, want 1 and 1", success, conflicts)
	}
}

func TestSaveAdminRejectsStaleETagWhenClockDoesNotAdvance(t *testing.T) {
	repo, _ := newProfileTestServer(t)
	admin, etag, err := repo.GetAdmin(t.Context())
	if err != nil {
		t.Fatalf("GetAdmin: %v", err)
	}
	current, err := time.Parse(profileTimeFormat, admin.UpdatedAt)
	if err != nil {
		t.Fatalf("parse current updated_at: %v", err)
	}

	repo.clock = func() time.Time { return current }
	if err := repo.SaveAdmin(t.Context(), ProfileInput{Name: "First"}, etag); err != nil {
		t.Fatalf("SaveAdmin first: %v", err)
	}
	if err := repo.SaveAdmin(t.Context(), ProfileInput{Name: "Second"}, etag); !errors.Is(err, ErrConflict) {
		t.Fatalf("SaveAdmin stale err = %v, want ErrConflict", err)
	}
}

func TestSaveAdminPreservesStableSocialLinkIDs(t *testing.T) {
	repo, _ := newProfileTestServer(t)
	seedProfile(t, repo, ProfileInput{
		Name: "Ada",
		SocialLinks: []SocialLinkInput{
			{Label: "GitHub", URL: "https://github.com/ada", Icon: "github"},
		},
	})

	admin, etag, err := repo.GetAdmin(t.Context())
	if err != nil {
		t.Fatalf("GetAdmin: %v", err)
	}
	linkID := admin.SocialLinks[0].ID

	err = repo.SaveAdmin(t.Context(), ProfileInput{
		Name: "Ada",
		SocialLinks: []SocialLinkInput{
			{ID: &linkID, Label: "GitHub", URL: "https://github.com/ada", Icon: "github"},
		},
	}, etag)
	if err != nil {
		t.Fatalf("SaveAdmin: %v", err)
	}

	after, _, err := repo.GetAdmin(t.Context())
	if err != nil {
		t.Fatalf("GetAdmin after save: %v", err)
	}
	if len(after.SocialLinks) != 1 {
		t.Fatalf("social links = %d", len(after.SocialLinks))
	}
	if after.SocialLinks[0].ID != linkID {
		t.Fatalf("social link id = %d, want %d", after.SocialLinks[0].ID, linkID)
	}
}

func TestSaveAdminBumpsTranslationSourceVersionOnlyForTranslatableProfileFields(t *testing.T) {
	repo, _ := newProfileTestServer(t)
	seedProfile(t, repo, ProfileInput{
		Name:     "Ada",
		Headline: "Engineer",
		Summary:  "Summary",
		Bio:      "Bio",
		Email:    "ada@example.com",
	})

	_, etag, err := repo.GetAdmin(t.Context())
	if err != nil {
		t.Fatalf("GetAdmin: %v", err)
	}
	if version := profileTranslationSourceVersion(t, repo); version != 2 {
		t.Fatalf("seed version = %d, want 2", version)
	}

	if err := repo.SaveAdmin(t.Context(), ProfileInput{
		Name:     "Ada",
		Headline: "Engineer",
		Summary:  "Summary",
		Bio:      "Bio",
		Email:    "grace@example.com",
	}, etag); err != nil {
		t.Fatalf("SaveAdmin shared fields: %v", err)
	}
	if version := profileTranslationSourceVersion(t, repo); version != 2 {
		t.Fatalf("shared-field version = %d, want 2", version)
	}

	_, etag, err = repo.GetAdmin(t.Context())
	if err != nil {
		t.Fatalf("GetAdmin after shared update: %v", err)
	}
	if err := repo.SaveAdmin(t.Context(), ProfileInput{
		Name:     "Ada",
		Headline: "Engineer",
		Summary:  "Updated Summary",
		Bio:      "Bio",
		Email:    "grace@example.com",
	}, etag); err != nil {
		t.Fatalf("SaveAdmin translatable fields: %v", err)
	}
	if version := profileTranslationSourceVersion(t, repo); version != 3 {
		t.Fatalf("translatable-field version = %d, want 3", version)
	}
}

func TestSaveAdminBumpsSocialLinkTranslationSourceVersionOnLabelChangeOnly(t *testing.T) {
	repo, _ := newProfileTestServer(t)
	seedProfile(t, repo, ProfileInput{
		Name: "Ada",
		SocialLinks: []SocialLinkInput{
			{Label: "GitHub", URL: "https://github.com/ada", Icon: "github"},
		},
	})

	admin, etag, err := repo.GetAdmin(t.Context())
	if err != nil {
		t.Fatalf("GetAdmin: %v", err)
	}
	linkID := admin.SocialLinks[0].ID
	if version := socialLinkTranslationSourceVersion(t, repo, linkID); version != 1 {
		t.Fatalf("initial social link version = %d, want 1", version)
	}

	if err := repo.SaveAdmin(t.Context(), ProfileInput{
		Name: "Ada",
		SocialLinks: []SocialLinkInput{
			{ID: &linkID, Label: "GitHub", URL: "https://github.com/grace", Icon: "github"},
		},
	}, etag); err != nil {
		t.Fatalf("SaveAdmin shared social link fields: %v", err)
	}
	if version := socialLinkTranslationSourceVersion(t, repo, linkID); version != 1 {
		t.Fatalf("shared social link version = %d, want 1", version)
	}

	admin, etag, err = repo.GetAdmin(t.Context())
	if err != nil {
		t.Fatalf("GetAdmin after shared social link update: %v", err)
	}
	linkID = admin.SocialLinks[0].ID
	if err := repo.SaveAdmin(t.Context(), ProfileInput{
		Name: "Ada",
		SocialLinks: []SocialLinkInput{
			{ID: &linkID, Label: "Code", URL: "https://github.com/grace", Icon: "github"},
		},
	}, etag); err != nil {
		t.Fatalf("SaveAdmin label update: %v", err)
	}
	if version := socialLinkTranslationSourceVersion(t, repo, linkID); version != 2 {
		t.Fatalf("label-change social link version = %d, want 2", version)
	}
}

func TestSaveAdminRebuildsProfileMediaReferences(t *testing.T) {
	repo, _ := newProfileTestServer(t)
	avatarID := insertProfileMediaAsset(t, repo, "avatar.png", "profile-avatar", "sum-profile-avatar")
	ogImageID := insertProfileMediaAsset(t, repo, "og.png", "profile-og-image", "sum-profile-og-image")

	_, etag, err := repo.GetAdmin(t.Context())
	if err != nil {
		t.Fatalf("GetAdmin: %v", err)
	}
	if err := repo.SaveAdmin(t.Context(), ProfileInput{Name: "Ada", AvatarMediaID: &avatarID, OGImageMediaID: &ogImageID}, etag); err != nil {
		t.Fatalf("SaveAdmin: %v", err)
	}

	assertProfileMediaReference(t, repo, avatarID, "avatar")
	assertProfileMediaReference(t, repo, ogImageID, "og_image")
}

func insertProfileMediaAsset(t *testing.T, repo *Repository, fileName string, storageKey string, checksum string) int64 {
	t.Helper()
	var mediaID int64
	err := repo.db.QueryRowContext(t.Context(), `INSERT INTO media_assets (file_name, storage_key, mime_type, size_bytes, width, height, variants, checksum_sha256, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, now()) RETURNING id`,
		fileName,
		storageKey,
		"image/png",
		10,
		1,
		1,
		`{}`,
		checksum,
	).Scan(&mediaID)
	if err != nil {
		t.Fatalf("insert media asset: %v", err)
	}
	return mediaID
}

func assertProfileMediaReference(t *testing.T, repo *Repository, mediaID int64, source string) {
	t.Helper()
	var count int
	err := repo.db.QueryRowContext(t.Context(), `SELECT COUNT(*) FROM media_references WHERE resource_type = $1 AND resource_id = $2 AND source = $3 AND media_asset_id = $4`,
		"profile",
		int64(1),
		source,
		mediaID,
	).Scan(&count)
	if err != nil {
		t.Fatalf("count media references: %v", err)
	}
	if count != 1 {
		t.Fatalf("%s media reference count = %d, want 1", source, count)
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

func TestPublicProfileFallsBackWhenRequestedLocaleIsMissing(t *testing.T) {
	repo, _ := newProfileTestServer(t)
	seedProfile(t, repo, ProfileInput{
		Name:     "Chinese Name",
		Headline: "Chinese Headline",
		Summary:  "Chinese Summary",
		Bio:      "Chinese Bio",
	})

	public, meta, err := repo.GetPublicByLocale(t.Context(), i18n.LocaleJA)
	if err != nil {
		t.Fatalf("GetPublicByLocale: %v", err)
	}
	if public.Name != "Chinese Name" {
		t.Fatalf("public = %+v", public)
	}
	if meta.RequestedLocale != "ja" || meta.ResolvedLocale != "zh" || meta.FallbackFrom != "ja" {
		t.Fatalf("meta = %+v", meta)
	}
}

func TestProfileTranslationRouteRejectsUnsupportedLocalePath(t *testing.T) {
	_, handler := newProfileTestServer(t)
	for _, path := range []string{
		"/api/admin/profile/translations/zh",
		"/api/admin/profile/translations/fr",
	} {
		t.Run(path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPut, path, bytes.NewBufferString(`{"name":"English Name"}`))
			req.Header.Set("If-None-Match", "*")
			handler.ServeHTTP(recorder, req)
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("%s status = %d body=%s", path, recorder.Code, recorder.Body.String())
			}
		})
	}
}

func TestAdminProfileIncludesTranslationState(t *testing.T) {
	repo, handler := newProfileTestServer(t)
	seedProfile(t, repo, ProfileInput{
		Name:     "Chinese Name",
		Headline: "Chinese Headline",
		Summary:  "Chinese Summary",
		Bio:      "Chinese Bio",
	})
	if _, err := repo.db.ExecContext(t.Context(), `
		INSERT INTO profile_translations
			(profile_id, locale, translation_status, source_version, name, headline, summary, bio, updated_at)
		VALUES ($1, 'en', 'reviewed', 1, 'English Name', 'English Headline', 'English Summary', 'English Bio', now())
	`, int64(1)); err != nil {
		t.Fatalf("seed translation: %v", err)
	}

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/admin/profile", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	translations, ok := body["translations"].(map[string]any)
	if !ok {
		t.Fatalf("translations = %#v", body["translations"])
	}
	en, ok := translations["en"].(map[string]any)
	if !ok {
		t.Fatalf("translations.en = %#v", translations["en"])
	}
	if en["exists"] != true || en["translation_status"] != "reviewed" {
		t.Fatalf("translations.en = %#v", en)
	}
	if _, ok := en["etag"].(string); !ok {
		t.Fatalf("translations.en.etag = %#v", en["etag"])
	}
}

func TestAdminProfileIncludesSocialLinkTranslationState(t *testing.T) {
	repo, handler := newProfileTestServer(t)
	seedProfile(t, repo, ProfileInput{
		Name: "Chinese Name",
		SocialLinks: []SocialLinkInput{
			{Label: "GitHub", URL: "https://github.com/ada", Icon: "github"},
		},
	})

	admin, _, err := repo.GetAdmin(t.Context())
	if err != nil {
		t.Fatalf("GetAdmin: %v", err)
	}
	linkID := admin.SocialLinks[0].ID

	if _, err := repo.db.ExecContext(t.Context(), `
		INSERT INTO profile_translations
			(profile_id, locale, translation_status, source_version, name, headline, summary, bio, updated_at)
		VALUES ($1, 'en', 'reviewed', 1, 'English Name', 'English Headline', 'English Summary', 'English Bio', now())
	`, int64(1)); err != nil {
		t.Fatalf("seed profile translation: %v", err)
	}
	if _, err := repo.db.ExecContext(t.Context(), `
		INSERT INTO social_link_translations
			(social_link_id, locale, translation_status, source_version, label, updated_at)
		VALUES ($1, 'en', 'reviewed', 1, 'Code', now())
	`, linkID); err != nil {
		t.Fatalf("seed social link translation: %v", err)
	}

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/admin/profile", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	translations := body["translations"].(map[string]any)
	en := translations["en"].(map[string]any)
	socialLinks, ok := en["social_links"].([]any)
	if !ok || len(socialLinks) != 1 {
		t.Fatalf("translations.en.social_links = %#v", en["social_links"])
	}
	link, ok := socialLinks[0].(map[string]any)
	if !ok {
		t.Fatalf("translations.en.social_links[0] = %#v", socialLinks[0])
	}
	if link["label"] != "Code" || link["source_label"] != "GitHub" || int64(link["id"].(float64)) != linkID {
		t.Fatalf("unexpected translated social link = %#v", link)
	}
}

func TestProfileTranslationReviewPublishesSocialLinkLabels(t *testing.T) {
	repo, _ := newProfileTestServer(t)
	seedProfile(t, repo, ProfileInput{
		Name:     "Chinese Name",
		Headline: "Chinese Headline",
		Summary:  "Chinese Summary",
		Bio:      "Chinese Bio",
		SocialLinks: []SocialLinkInput{
			{Label: "GitHub", URL: "https://github.com/ada", Icon: "github"},
		},
	})

	admin, _, err := repo.GetAdmin(t.Context())
	if err != nil {
		t.Fatalf("GetAdmin: %v", err)
	}
	linkID := admin.SocialLinks[0].ID

	if err := repo.SaveTranslation(t.Context(), i18n.LocaleEN, ProfileTranslationInput{
		Name:     "English Name",
		Headline: "English Headline",
		Summary:  "English Summary",
		Bio:      "English Bio",
		SocialLinks: []SocialLinkTranslationInput{
			{ID: linkID, Label: "Code"},
		},
	}, "", "*"); err != nil {
		t.Fatalf("SaveTranslation: %v", err)
	}

	admin, _, err = repo.GetAdmin(t.Context())
	if err != nil {
		t.Fatalf("GetAdmin after save: %v", err)
	}
	translation := admin.Translations[string(i18n.LocaleEN)]
	if translation.ETag == nil {
		t.Fatal("missing locale etag")
	}

	if err := repo.MarkTranslationReviewed(t.Context(), i18n.LocaleEN, *translation.ETag); err != nil {
		t.Fatalf("MarkTranslationReviewed: %v", err)
	}

	public, meta, err := repo.GetPublicByLocale(t.Context(), i18n.LocaleEN)
	if err != nil {
		t.Fatalf("GetPublicByLocale: %v", err)
	}
	if meta.ResolvedLocale != "en" {
		t.Fatalf("meta = %+v", meta)
	}
	if len(public.SocialLinks) != 1 || public.SocialLinks[0].Label != "Code" {
		t.Fatalf("public social links = %+v", public.SocialLinks)
	}
}

func newProfileTestServer(t *testing.T) (*Repository, http.Handler) {
	t.Helper()
	database, _ := dbtest.OpenPostgres(t)

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

func profileTranslationSourceVersion(t *testing.T, repo *Repository) int64 {
	t.Helper()
	var version int64
	if err := repo.db.QueryRowContext(t.Context(), `SELECT translation_source_version FROM profile WHERE id = $1`, int64(1)).Scan(&version); err != nil {
		t.Fatalf("load profile translation_source_version: %v", err)
	}
	return version
}

func socialLinkTranslationSourceVersion(t *testing.T, repo *Repository, linkID int64) int64 {
	t.Helper()
	var version int64
	if err := repo.db.QueryRowContext(t.Context(), `SELECT translation_source_version FROM social_links WHERE id = $1`, linkID).Scan(&version); err != nil {
		t.Fatalf("load social link translation_source_version: %v", err)
	}
	return version
}
