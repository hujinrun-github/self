package content

import (
	"bytes"
	"database/sql"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

func TestPreviewRouteCreatesImportSessionAndReturnsMediaMap(t *testing.T) {
	repo := newContentRepo(t)
	mediaService := newPreparedImportMediaService(t, repo)
	imports := NewWritingImportService(repo, mediaService, func() time.Time {
		return time.Date(2026, 6, 29, 8, 0, 0, 0, time.UTC)
	})
	router := chi.NewRouter()
	RegisterWritingImportRoutes(router, imports)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	markdownPart, _ := writer.CreateFormFile("markdown_file", "article.md")
	_, _ = markdownPart.Write([]byte("![cover](./images/cover.png)"))
	mediaPart, _ := writer.CreateFormFile("media_files[]", "cover.png")
	_, _ = mediaPart.Write(testPNG(t, 1280, 720))
	_ = writer.WriteField("media_paths[]", "./images/cover.png")
	_ = writer.WriteField("mode", "create")
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/admin/writing/imports/preview", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), `"media_map"`) {
		t.Fatalf("response missing media_map: %s", recorder.Body.String())
	}
}

func TestCommitRouteRejectsChangedOverwriteTarget(t *testing.T) {
	repo := newContentRepo(t)
	writing, err := repo.CreateWriting(t.Context(), WritingInput{Title: "Draft", ContentMD: "Body"})
	if err != nil {
		t.Fatalf("CreateWriting: %v", err)
	}
	mediaService := newPreparedImportMediaService(t, repo)
	imports := NewWritingImportService(repo, mediaService, func() time.Time {
		return time.Date(2026, 6, 29, 8, 0, 0, 0, time.UTC)
	})

	session := createPreviewSession(t, repo.db, writing.ID, `"etag-1"`)
	if _, err := repo.UpdateWriting(t.Context(), writing.ID, WritingInput{Title: "Changed", ContentMD: "Changed body"}); err != nil {
		t.Fatalf("UpdateWriting: %v", err)
	}

	router := chi.NewRouter()
	RegisterWritingImportRoutes(router, imports)

	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(
		http.MethodPost,
		"/api/admin/writing/imports/commit",
		strings.NewReader(fmt.Sprintf(`{"import_token":"%s","mode":"overwrite","target_id":%d,"payload":{"title":"Edited","content_md":"Body"}}`, session.Token, writing.ID)),
	)
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusConflict {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestRestorePreviewReturnsGoneAfterExpiry(t *testing.T) {
	repo := newContentRepo(t)
	mediaService := newPreparedImportMediaService(t, repo)
	imports := NewWritingImportService(repo, mediaService, func() time.Time {
		return time.Date(2026, 6, 29, 8, 0, 0, 0, time.UTC)
	})
	session := createExpiredPreviewSession(t, repo.db)

	router := chi.NewRouter()
	RegisterWritingImportRoutes(router, imports)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/admin/writing/imports/preview/"+session.Token, nil))

	if recorder.Code != http.StatusGone {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func createPreviewSession(t *testing.T, database *sql.DB, writingID int64, etag string) struct{ Token string } {
	t.Helper()

	token := "preview-token-1"
	if _, err := database.Exec(`
INSERT INTO writing_import_sessions (token_hash, admin_session_id, mode, target_writing_id, target_writing_etag, source_file_name, source_checksum_sha256, original_markdown, rewritten_markdown, parsed_payload, status, expires_at, created_at, updated_at)
VALUES ($1, 11, 'overwrite', $2, $3, 'article.md', 'checksum-1', 'Body', 'Body', '{}'::jsonb, 'preview_ready', now() + interval '2 hours', now(), now())
`, hashImportToken(token), writingID, etag); err != nil {
		t.Fatalf("createPreviewSession: %v", err)
	}
	return struct{ Token string }{Token: token}
}

func createExpiredPreviewSession(t *testing.T, database *sql.DB) struct{ Token string } {
	t.Helper()

	token := "expired-preview-token"
	if _, err := database.Exec(`
INSERT INTO writing_import_sessions (token_hash, admin_session_id, mode, source_file_name, source_checksum_sha256, original_markdown, rewritten_markdown, parsed_payload, status, expires_at, created_at, updated_at)
VALUES ($1, 11, 'create', 'expired.md', 'checksum-expired', 'Body', 'Body', '{}'::jsonb, 'preview_ready', now() - interval '1 minute', now(), now())
`, hashImportToken(token)); err != nil {
		t.Fatalf("createExpiredPreviewSession: %v", err)
	}
	return struct{ Token string }{Token: token}
}
