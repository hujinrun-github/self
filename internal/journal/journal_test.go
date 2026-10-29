package journal

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"portfolio/internal/auth"
	"portfolio/internal/config"
	"portfolio/internal/testutil/postgres"
)

func setup(t *testing.T) (*Service, http.Handler, *sql.DB) {
	t.Helper()
	db, _ := postgres.OpenPostgres(t)
	s := NewService(db, config.Config{AppOrigin: "http://localhost:5173", PublicBaseURL: "https://example.test"})
	router := chi.NewRouter()
	s.RegisterAdminRoutes(router)
	s.RegisterPublicRoutes(router)
	return s, router, db
}
func request(t *testing.T, h http.Handler, method, path string, body any, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	var b io.Reader
	if body != nil {
		b = bytes.NewReader(encoded(body))
	}
	r := httptest.NewRequest(method, path, b)
	r.Header.Set("Origin", "http://localhost:5173")
	r.RemoteAddr = "127.0.0.1:4000"
	for _, c := range cookies {
		r.AddCookie(c)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("missing no-store on %s: %v", path, w.Header())
	}
	return w
}
func decode[T any](t *testing.T, w *httptest.ResponseRecorder, status int) T {
	t.Helper()
	if w.Code != status {
		t.Fatalf("status=%d want=%d body=%s", w.Code, status, w.Body.String())
	}
	var value T
	if err := json.Unmarshal(w.Body.Bytes(), &value); err != nil {
		t.Fatal(err)
	}
	return value
}
func book(t *testing.T, h http.Handler, name string, public bool) Notebook {
	t.Helper()
	input := map[string]any{"name": name, "public_title": "Public " + name, "paper": "dots", "cover_color": "#d9e5ee", "public_enabled": public}
	if public {
		input["password"] = "secret-password"
	}
	return decode[Notebook](t, request(t, h, "POST", "/api/admin/journal/notebooks", input), 201)
}
func page() Entry {
	return Entry{Title: "Private title", EntryDate: "2026-10-02", Mood: "happy", Weather: "cloudy", Tags: []string{"secret-tag"}, Scene: Scene{SchemaVersion: 1, Width: 800, Height: 1100, Paper: "dots", Elements: []Element{{ID: "t1", Type: "text", X: 40, Y: 40, Width: 300, Height: 100, Text: "Private body from canvas", FontSize: 24}}}}
}
func entry(t *testing.T, h http.Handler, b Notebook, e Entry) Entry {
	t.Helper()
	return decode[Entry](t, request(t, h, "POST", fmt.Sprintf("/api/admin/journal/notebooks/%d/entries", b.ID), e), 201)
}
func unlocked(t *testing.T, h http.Handler, id int64) *http.Cookie {
	t.Helper()
	w := request(t, h, "POST", fmt.Sprintf("/api/site/journal/notebooks/%d/unlock", id), map[string]string{"password": "secret-password"})
	decode[map[string]any](t, w, 200)
	for _, c := range w.Result().Cookies() {
		if c.Name == cookieName(id) {
			if !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteLaxMode {
				t.Fatalf("insecure cookie %+v", c)
			}
			return c
		}
	}
	t.Fatal("no session cookie")
	return nil
}
func updateBook(t *testing.T, h http.Handler, b Notebook, fields map[string]any) Notebook {
	t.Helper()
	raw := encoded(b)
	var input map[string]any
	_ = json.Unmarshal(raw, &input)
	for k, v := range fields {
		input[k] = v
	}
	return decode[Notebook](t, request(t, h, "PUT", fmt.Sprintf("/api/admin/journal/notebooks/%d", b.ID), input), 200)
}

func TestPublicContentRequiresOwnBookSession(t *testing.T) {
	_, h, db := setup(t)
	privateBook := book(t, h, "Private notebook", false)
	a := book(t, h, "A", true)
	b := book(t, h, "B", true)
	e := entry(t, h, a, page())
	entry(t, h, privateBook, page())
	directory := request(t, h, "GET", "/api/site/journal/notebooks", nil)
	decode[map[string]any](t, directory, 200)
	for _, secret := range []string{"Private notebook", "Private title", "Private body", "secret-tag", "has_password", "password_hash", "created_at"} {
		if strings.Contains(directory.Body.String(), secret) {
			t.Fatalf("directory leaks %s: %s", secret, directory.Body.String())
		}
	}
	path := fmt.Sprintf("/api/site/journal/notebooks/%d/entries", a.ID)
	if w := request(t, h, "GET", path, nil); w.Code != 401 || !strings.Contains(w.Body.String(), "journal_locked") {
		t.Fatalf("unlocked data available: %s", w.Body.String())
	}
	c := unlocked(t, h, a.ID)
	var token string
	if err := db.QueryRow(`SELECT token_hash FROM journal_view_sessions WHERE notebook_id=$1`, a.ID).Scan(&token); err != nil {
		t.Fatal(err)
	}
	if token == c.Value || token != tokenHash(c.Value) {
		t.Fatal("session token not stored as hash")
	}
	w := request(t, h, "GET", path, nil, c)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "Private body") {
		t.Fatalf("valid read failed: %s", w.Body.String())
	}
	renamed := *c
	renamed.Name = cookieName(b.ID)
	if w := request(t, h, "GET", fmt.Sprintf("/api/site/journal/notebooks/%d/entries", b.ID), nil, &renamed); w.Code != 401 {
		t.Fatalf("cross-book session accepted: %d", w.Code)
	}
	bc := unlocked(t, h, b.ID)
	if w := request(t, h, "GET", fmt.Sprintf("/api/site/journal/notebooks/%d/entries/%d", b.ID, e.ID), nil, bc); w.Code != 404 {
		t.Fatalf("cross-book entry exposed: %d", w.Code)
	}
	if w := request(t, h, "GET", fmt.Sprintf("/api/site/journal/notebooks/%d/entries", privateBook.ID), nil, c); w.Code != 404 {
		t.Fatalf("private notebook visible: %d", w.Code)
	}
	// Management requests are independent from the visitor password and still read private books.
	if w := request(t, h, "GET", fmt.Sprintf("/api/admin/journal/notebooks/%d/entries", privateBook.ID), nil); w.Code != 200 {
		t.Fatal("admin requires visitor password")
	}
}

func TestRevocationIdleAndAbsoluteDeadline(t *testing.T) {
	s, h, _ := setup(t)
	now := time.Date(2026, 10, 2, 1, 0, 0, 0, time.UTC)
	s.clock = func() time.Time { return now }
	b := book(t, h, "A", true)
	c := unlocked(t, h, b.ID)
	path := fmt.Sprintf("/api/site/journal/notebooks/%d", b.ID)
	now = now.Add(14 * time.Minute)
	if w := request(t, h, "GET", path+"/entries", nil, c); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	now = now.Add(time.Minute)
	if w := request(t, h, "GET", path+"/entries", nil, c); w.Code != 401 {
		t.Fatal("GET refreshed idle timeout")
	}
	c = unlocked(t, h, b.ID)
	start := now
	for i := 0; i < 4; i++ {
		now = now.Add(14 * time.Minute)
		decode[map[string]any](t, request(t, h, "POST", path+"/touch", nil, c), 200)
	}
	now = start.Add(time.Hour)
	if w := request(t, h, "GET", path+"/entries", nil, c); w.Code != 401 {
		t.Fatal("touch bypassed absolute expiry")
	}
	c = unlocked(t, h, b.ID)
	b = updateBook(t, h, b, map[string]any{"password": "different-password"})
	if w := request(t, h, "GET", path+"/entries", nil, c); w.Code != 401 {
		t.Fatal("old credential survived password change")
	}
	b = updateBook(t, h, b, map[string]any{"password": "secret-password"})
	c = unlocked(t, h, b.ID)
	b = updateBook(t, h, b, map[string]any{"public_enabled": false})
	if w := request(t, h, "GET", path+"/entries", nil, c); w.Code != 404 {
		t.Fatal("disabled book readable")
	}
	b = updateBook(t, h, b, map[string]any{"public_enabled": true})
	if w := request(t, h, "GET", path+"/entries", nil, c); w.Code != 401 {
		t.Fatal("re-enabling restored old credential")
	}
	c = unlocked(t, h, b.ID)
	b = updateBook(t, h, b, map[string]any{"clear_password": true})
	if b.PublicEnabled || b.HasPassword {
		t.Fatal("clear password did not disable sharing")
	}
	if w := request(t, h, "GET", path+"/entries", nil, c); w.Code != 404 {
		t.Fatal("cleared-password book readable")
	}
}
func TestOriginAndRateLimits(t *testing.T) {
	_, h, _ := setup(t)
	b := book(t, h, "A", true)
	path := fmt.Sprintf("/api/site/journal/notebooks/%d/unlock", b.ID)
	for _, origin := range []string{"", "https://evil.test", "null", "http://localhost:5173@evil.test", "http://localhost:5173/path"} {
		r := httptest.NewRequest("POST", path, strings.NewReader(`{"password":"secret-password"}`))
		r.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatalf("accepted origin %q: %d", origin, w.Code)
		}
	}
	for i := 0; i < 10; i++ {
		w := request(t, h, "POST", path, map[string]string{"password": "wrong-password"})
		if w.Code != 401 {
			t.Fatalf("attempt %d status %d", i, w.Code)
		}
	}
	w := request(t, h, "POST", path, map[string]string{"password": "secret-password"})
	if w.Code != 429 || w.Header().Get("Retry-After") == "" {
		t.Fatal("password brute force not limited")
	}
}
func TestEntryVersionTrashAndFilters(t *testing.T) {
	_, h, db := setup(t)
	b := book(t, h, "A", false)
	e := entry(t, h, b, page())
	old := e
	e.Title = "Updated"
	e.Favorite = true
	e = decode[Entry](t, request(t, h, "PUT", fmt.Sprintf("/api/admin/journal/entries/%d", e.ID), e), 200)
	w := request(t, h, "PUT", fmt.Sprintf("/api/admin/journal/entries/%d", e.ID), old)
	if w.Code != 409 || !strings.Contains(w.Body.String(), "version_conflict") {
		t.Fatal("stale write accepted")
	}
	w = request(t, h, "GET", fmt.Sprintf("/api/admin/journal/notebooks/%d/entries?q=canvas&from=2026-10-02&to=2026-10-02&tag=secret-tag&mood=happy&favorite=true", b.ID), nil)
	list := decode[struct {
		Items []Entry `json:"items"`
		Total int     `json:"total"`
	}](t, w, 200)
	if len(list.Items) != 1 || list.Total != 1 || list.Items[0].Title != "Updated" {
		t.Fatal("filters or search text incorrect")
	}
	if w = request(t, h, "DELETE", fmt.Sprintf("/api/admin/journal/entries/%d?permanent=true", e.ID), nil); w.Code != 400 {
		t.Fatal("live entry purged without trash")
	}
	if w = request(t, h, "DELETE", fmt.Sprintf("/api/admin/journal/entries/%d", e.ID), nil); w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	w = request(t, h, "DELETE", fmt.Sprintf("/api/admin/journal/notebooks/%d", b.ID), nil)
	if w.Code != 409 {
		t.Fatal("notebook deleted with trashed entry")
	}
	e = decode[Entry](t, request(t, h, "POST", fmt.Sprintf("/api/admin/journal/entries/%d/restore", e.ID), nil), 200)
	if e.DeletedAt != nil || e.Version <= old.Version {
		t.Fatal("restore incorrect")
	}
	_, err := db.Exec(`UPDATE journal_entries SET deleted_at=now()-interval '31 days' WHERE id=$1`, e.ID)
	if err != nil {
		t.Fatal(err)
	}
	if w = request(t, h, "POST", fmt.Sprintf("/api/admin/journal/entries/%d/restore", e.ID), nil); w.Code != 404 {
		t.Fatal("expired trash restored")
	}
}
func testImage() []byte {
	im := image.NewNRGBA(image.Rect(0, 0, 20, 30))
	im.Set(1, 1, color.NRGBA{255, 40, 60, 255})
	var b bytes.Buffer
	_ = png.Encode(&b, im)
	return b.Bytes()
}
func multipartRequest(t *testing.T, h http.Handler, path, field, name string, data []byte) *httptest.ResponseRecorder {
	t.Helper()
	var b bytes.Buffer
	m := multipart.NewWriter(&b)
	f, err := m.CreateFormFile(field, name)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = f.Write(data)
	_ = m.Close()
	r := httptest.NewRequest("POST", path, &b)
	r.Header.Set("Content-Type", m.FormDataContentType())
	r.Header.Set("Origin", "http://localhost:5173")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func upload(t *testing.T, h http.Handler, id int64) Asset {
	t.Helper()
	return decode[Asset](t, multipartRequest(t, h, fmt.Sprintf("/api/admin/journal/notebooks/%d/assets", id), "file", "private.png", testImage()), 201)
}
func TestPhotoUploadAllowsFiveMegabytesAndRejectsLargerFiles(t *testing.T) {
	_, h, _ := setup(t)
	b := book(t, h, "Upload limit", false)
	valid := testImage()
	valid = append(valid, make([]byte, maxImageBytes-len(valid))...)
	if w := multipartRequest(t, h, fmt.Sprintf("/api/admin/journal/notebooks/%d/assets", b.ID), "file", "limit.png", valid); w.Code != http.StatusCreated {
		t.Fatalf("5 MB image status=%d body=%s", w.Code, w.Body.String())
	}
	tooLarge := append(valid, 0)
	w := multipartRequest(t, h, fmt.Sprintf("/api/admin/journal/notebooks/%d/assets", b.ID), "file", "too-large.png", tooLarge)
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "Image must be at most 5 MB") {
		t.Fatalf("oversized image status=%d body=%s", w.Code, w.Body.String())
	}
}
func TestPrivatePhotosReferenceChecksAndArchiveRoundTrip(t *testing.T) {
	_, h, db := setup(t)
	a := book(t, h, "A", true)
	b := book(t, h, "B", false)
	asset := upload(t, h, a.ID)
	c := unlocked(t, h, a.ID)
	path := fmt.Sprintf("/api/site/journal/notebooks/%d/assets/%d", a.ID, asset.ID)
	if w := request(t, h, "GET", path, nil, c); w.Code != 404 {
		t.Fatal("unattached photo exposed")
	}
	e := page()
	e.Scene.Elements = append(e.Scene.Elements, Element{ID: "photo", Type: "photo", X: 20, Y: 200, Width: 200, Height: 300, AssetID: asset.ID})
	if w := request(t, h, "POST", fmt.Sprintf("/api/admin/journal/notebooks/%d/entries", b.ID), e); w.Code != 400 {
		t.Fatal("cross-book photo reference accepted")
	}
	e = entry(t, h, a, e)
	if w := request(t, h, "GET", path, nil, c); w.Code != 200 || w.Header().Get("Content-Type") != "image/png" {
		t.Fatal("saved photo inaccessible")
	}
	zipResponse := request(t, h, "GET", fmt.Sprintf("/api/admin/journal/notebooks/%d/export.zip", a.ID), nil)
	if zipResponse.Code != 200 {
		t.Fatal(zipResponse.Body.String())
	}
	z, err := zip.NewReader(bytes.NewReader(zipResponse.Body.Bytes()), int64(zipResponse.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	if len(z.File) != 2 {
		t.Fatalf("archive members=%d", len(z.File))
	}
	for _, f := range z.File {
		if f.Name == "journal.json" {
			raw, err := readZipFile(f, 2<<20)
			if err != nil {
				t.Fatal(err)
			}
			if bytes.Contains(raw, []byte("password")) || bytes.Contains(raw, []byte("public_enabled")) {
				t.Fatal("archive contains viewing credentials or policy")
			}
		}
	}
	imported := decode[map[string]int](t, multipartRequest(t, h, fmt.Sprintf("/api/admin/journal/notebooks/%d/import", b.ID), "archive", "journal.zip", zipResponse.Body.Bytes()), 201)
	if imported["imported"] != 1 {
		t.Fatal("archive not imported")
	}
	var newAsset int64
	var sceneRaw []byte
	if err = db.QueryRow(`SELECT scene FROM journal_entries WHERE notebook_id=$1`, b.ID).Scan(&sceneRaw); err != nil {
		t.Fatal(err)
	}
	var scene Scene
	_ = json.Unmarshal(sceneRaw, &scene)
	newAsset = scene.Elements[1].AssetID
	if newAsset == asset.ID || newAsset == 0 {
		t.Fatal("import did not remap photo ID")
	}
	var storedBook int64
	if err = db.QueryRow(`SELECT notebook_id FROM journal_assets WHERE id=$1`, newAsset).Scan(&storedBook); err != nil || storedBook != b.ID {
		t.Fatal("imported photo belongs to wrong book")
	}
	if w := request(t, h, "DELETE", fmt.Sprintf("/api/admin/journal/entries/%d", e.ID), nil); w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	if w := request(t, h, "GET", path, nil, c); w.Code != 404 {
		t.Fatal("trashed photo exposed")
	}
	if w := request(t, h, "DELETE", fmt.Sprintf("/api/admin/journal/entries/%d?permanent=true", e.ID), nil); w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	var count int
	if err = db.QueryRow(`SELECT count(*) FROM journal_assets WHERE id=$1`, asset.ID).Scan(&count); err != nil || count != 0 {
		t.Fatal("purged unique photo not removed")
	}
}
func TestSceneValidationAndImageSafety(t *testing.T) {
	for _, mutate := range []func(*Entry){func(e *Entry) { e.Scene.Elements[0].Color = "url(https://evil.test)" }, func(e *Entry) { e.Scene.Elements[0].Width = math.Inf(1) }, func(e *Entry) { e.Scene.Elements[0].FontSize = 1000 }, func(e *Entry) { e.Scene.Elements[0].AssetID = 9 }, func(e *Entry) { e.EntryDate = "2026-02-30" }, func(e *Entry) { e.Scene.Elements = append(e.Scene.Elements, e.Scene.Elements[0]) }, func(e *Entry) { e.Scene.SchemaVersion = 2 }} {
		e := page()
		mutate(&e)
		if _, _, err := e.validate(); err == nil {
			t.Fatal("unsafe scene accepted")
		}
	}
	e := page()
	e.Scene.Elements = append(e.Scene.Elements, Element{ID: "placeholder", Type: "photo", Width: 100, Height: 100})
	if _, _, err := e.validate(); err != nil {
		t.Fatal("empty template photo rejected")
	}
	if _, _, err := prepareImage([]byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`), "x.svg"); err == nil {
		t.Fatal("SVG accepted")
	}
	a, processed, err := prepareImage(testImage(), "../../private.png")
	if err != nil || a.FileName != "private.png" || a.Width != 20 || len(processed) == 0 {
		t.Fatalf("safe image conversion failed %+v %v", a, err)
	}
}
func TestLimiterReservesConcurrentAttempts(t *testing.T) {
	var limiter attemptLimiter
	now := time.Now()
	var mu sync.Mutex
	allowed := 0
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if limiter.allow(map[string]int{"pair": 10}, now) {
				mu.Lock()
				allowed++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if allowed != 10 {
		t.Fatalf("allowed %d parallel attempts", allowed)
	}
	if !limiter.allow(map[string]int{"pair": 10}, now.Add(10*time.Minute)) {
		t.Fatal("rate window did not reset")
	}
}

func TestMoveCopiesPhotosAcrossPrivateBoundaries(t *testing.T) {
	_, h, db := setup(t)
	a := book(t, h, "Source", true)
	b := book(t, h, "Destination", true)
	photo := upload(t, h, a.ID)
	source := page()
	source.Scene.Elements = append(source.Scene.Elements, Element{ID: "photo", Type: "photo", X: 10, Y: 10, Width: 200, Height: 300, AssetID: photo.ID})
	moved := entry(t, h, a, source)
	shared := entry(t, h, a, source)
	aCookie := unlocked(t, h, a.ID)
	bCookie := unlocked(t, h, b.ID)
	moved.NotebookID = b.ID
	moved = decode[Entry](t, request(t, h, "PUT", fmt.Sprintf("/api/admin/journal/entries/%d", moved.ID), moved), 200)
	if moved.NotebookID != b.ID || moved.Scene.Elements[1].AssetID == photo.ID {
		t.Fatal("move did not reassign private assets")
	}
	if w := request(t, h, "GET", fmt.Sprintf("/api/site/journal/notebooks/%d/entries/%d", a.ID, moved.ID), nil, aCookie); w.Code != 404 {
		t.Fatal("source visitor can read moved entry")
	}
	if w := request(t, h, "GET", fmt.Sprintf("/api/site/journal/notebooks/%d/assets/%d", a.ID, moved.Scene.Elements[1].AssetID), nil, aCookie); w.Code != 404 {
		t.Fatal("source visitor can read copied destination photo")
	}
	if w := request(t, h, "GET", fmt.Sprintf("/api/site/journal/notebooks/%d/entries/%d", b.ID, moved.ID), nil, bCookie); w.Code != 200 {
		t.Fatal("destination visitor cannot read moved entry")
	}
	if w := request(t, h, "GET", fmt.Sprintf("/api/site/journal/notebooks/%d/assets/%d", a.ID, photo.ID), nil, aCookie); w.Code != 200 {
		t.Fatal("move broke another entry's shared source photo")
	}
	if w := request(t, h, "DELETE", fmt.Sprintf("/api/admin/journal/entries/%d", shared.ID), nil); w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	if w := request(t, h, "DELETE", fmt.Sprintf("/api/admin/journal/entries/%d?permanent=true", shared.ID), nil); w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	var copies int
	if err := db.QueryRow(`SELECT count(*) FROM journal_assets WHERE id=$1`, moved.Scene.Elements[1].AssetID).Scan(&copies); err != nil || copies != 1 {
		t.Fatal("purging source removed destination photo")
	}
	// Selected export must include exactly the requested destination entry, and
	// cannot silently omit a source or missing ID.
	if w := request(t, h, "GET", fmt.Sprintf("/api/admin/journal/notebooks/%d/export.zip?entry_ids=%d", b.ID, moved.ID), nil); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := request(t, h, "GET", fmt.Sprintf("/api/admin/journal/notebooks/%d/export.zip?entry_ids=%d,%d", b.ID, moved.ID, shared.ID), nil); w.Code != 404 {
		t.Fatal("selected export silently skipped missing item")
	}
}

func TestImportFailureRollsBackAndPreservesSharingPolicy(t *testing.T) {
	_, h, db := setup(t)
	b := book(t, h, "Target", false)
	manifest := archiveManifest{Format: "portfolio-journal", Version: 1, Entries: []Entry{page()}, Assets: []archiveAsset{{Asset: Asset{ID: 1, MIMEType: "image/png", FileName: "valid.png"}, Path: "assets/1.png"}, {Asset: Asset{ID: 2, MIMEType: "image/png", FileName: "bad.png"}, Path: "assets/2.png"}}}
	manifest.Entries[0].Scene.Elements = append(manifest.Entries[0].Scene.Elements, Element{ID: "p", Type: "photo", Width: 100, Height: 100, AssetID: 1})
	var archive bytes.Buffer
	z := zip.NewWriter(&archive)
	mf, _ := z.Create("journal.json")
	_, _ = mf.Write(encoded(manifest))
	valid, _ := z.Create("assets/1.png")
	_, _ = valid.Write(testImage())
	invalid, _ := z.Create("assets/2.png")
	_, _ = invalid.Write([]byte("broken image"))
	_ = z.Close()
	w := multipartRequest(t, h, fmt.Sprintf("/api/admin/journal/notebooks/%d/import", b.ID), "archive", "bad.zip", archive.Bytes())
	if w.Code != 400 {
		t.Fatalf("invalid archive status %d: %s", w.Code, w.Body.String())
	}
	for _, table := range []string{"journal_entries", "journal_assets"} {
		var count int
		if err := db.QueryRow(`SELECT count(*) FROM `+table+` WHERE notebook_id=$1`, b.ID).Scan(&count); err != nil || count != 0 {
			t.Fatalf("partial archive left %d rows in %s: %v", count, table, err)
		}
	}
	var public bool
	var hash string
	if err := db.QueryRow(`SELECT public_enabled,password_hash FROM journal_notebooks WHERE id=$1`, b.ID).Scan(&public, &hash); err != nil || public || hash != "" {
		t.Fatal("import changed security policy")
	}
}

func TestAdminSessionDeadlineRequiresAdminAndCapsIdleAtAbsoluteExpiry(t *testing.T) {
	s, _, db := setup(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	s.clock = func() time.Time { return now }
	s.cfg.SessionIdleTimeout = 15 * time.Minute
	authService := auth.NewService(db, s.cfg)
	router := chi.NewRouter()
	router.Use(private)
	router.Group(func(r chi.Router) { r.Use(authService.RequireAdmin); s.RegisterAdminRoutes(r) })
	const path = "/api/admin/journal/session"
	for _, cookies := range [][]*http.Cookie{nil, {{Name: cookieName(1), Value: "visitor-cookie"}}} {
		w := request(t, router, "GET", path, nil, cookies...)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("guest session endpoint status %d", w.Code)
		}
	}
	var adminID int64
	if err := db.QueryRow(`INSERT INTO admins(email,password_hash,created_at,updated_at) VALUES($1,'unused',$2,$2) RETURNING id`, "journal-session-test@example.test", now).Scan(&adminID); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name               string
		absolute, expected time.Duration
	}{{"idle", time.Hour, 15 * time.Minute}, {"absolute", 10 * time.Minute, 10 * time.Minute}} {
		t.Run(test.name, func(t *testing.T) {
			token := "admin-session-token-" + test.name
			if _, err := db.Exec(`INSERT INTO sessions(admin_id,session_token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) VALUES($1,$2,'unused',$3,$3,$4)`, adminID, tokenHash(token), now, now.Add(test.absolute)); err != nil {
				t.Fatal(err)
			}
			response := decode[struct {
				ExpiresAt  time.Time `json:"expires_at"`
				ServerTime time.Time `json:"server_time"`
			}](t, request(t, router, "GET", path, nil, &http.Cookie{Name: auth.SessionCookieName, Value: token}), http.StatusOK)
			if !response.ServerTime.Equal(now) || !response.ExpiresAt.Equal(now.Add(test.expected)) {
				t.Fatalf("unexpected session deadline %+v", response)
			}
			var visitorSessions int
			if err := db.QueryRow(`SELECT count(*) FROM journal_view_sessions`).Scan(&visitorSessions); err != nil || visitorSessions != 0 {
				t.Fatal("admin deadline endpoint created a visitor grant")
			}
		})
	}
}
