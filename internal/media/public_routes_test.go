package media

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/minio/minio-go/v7"

	dbtest "portfolio/internal/testutil/postgres"
)

func TestServeVariantStreamsLegacyLocalAsset(t *testing.T) {
	service := newMediaService(t)
	asset, err := service.Upload(context.Background(), "cover.png", bytes.NewReader(testPNG(t, 64, 64)))
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}

	router := chi.NewRouter()
	RegisterPublicRoutes(router, service)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/media/%d/content", asset.ID), nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get("Content-Type"); got != "image/jpeg" {
		t.Fatalf("Content-Type = %q", got)
	}
	if recorder.Body.Len() == 0 {
		t.Fatal("expected streamed body")
	}
}

func TestServeVariantStreamsPreparedMinIOAsset(t *testing.T) {
	service := newImportReadyMediaService(t, stubBlobStore{
		keyBodies: map[string][]byte{"audio/2026/06/abc/original.mp3": []byte("mp3")},
	})
	assetID := insertPreparedAudioAsset(t, service.db)

	router := chi.NewRouter()
	RegisterPublicRoutes(router, service)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/media/%d/original", assetID), nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get("Content-Type"); got != "audio/mpeg" {
		t.Fatalf("Content-Type = %q", got)
	}
	if recorder.Body.String() != "mp3" {
		t.Fatalf("body = %q", recorder.Body.String())
	}
}

func TestServeVariantReturns404WhenPreparedMinIOObjectIsMissing(t *testing.T) {
	service := newImportReadyMediaService(t, stubBlobStore{
		keyErrors: map[string]error{
			"audio/2026/06/abc/original.mp3": minio.ErrorResponse{Code: "NoSuchKey"},
		},
	})
	assetID := insertPreparedAudioAsset(t, service.db)

	router := chi.NewRouter()
	RegisterPublicRoutes(router, service)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/media/%d/original", assetID), nil))

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
}

type stubBlobStore struct {
	keyBodies map[string][]byte
	keyErrors map[string]error
}

func (s stubBlobStore) Put(context.Context, string, io.Reader, string) error { return nil }
func (s stubBlobStore) Delete(context.Context, string) error                 { return nil }
func (s stubBlobStore) Open(_ context.Context, key string) (io.ReadCloser, error) {
	if err, ok := s.keyErrors[key]; ok {
		return nil, err
	}
	body, ok := s.keyBodies[key]
	if !ok {
		return nil, os.ErrNotExist
	}
	return io.NopCloser(bytes.NewReader(body)), nil
}

func newImportReadyMediaService(t *testing.T, minioStore BlobStore) *Service {
	t.Helper()
	database, _ := dbtest.OpenPostgres(t)
	root := t.TempDir()

	return NewService(
		database,
		filepath.Join(root, "uploads"),
		filepath.Join(root, "private_uploads"),
		NewLocalBlobStore(filepath.Join(root, "uploads")),
		minioStore,
	)
}

func insertPreparedAudioAsset(t *testing.T, database *sql.DB) int64 {
	t.Helper()

	var id int64
	err := database.QueryRow(`
INSERT INTO media_assets (file_name, storage_key, mime_type, size_bytes, width, height, variants, checksum_sha256, created_at, storage_backend, lifecycle_state, media_kind)
VALUES ('intro.mp3', 'audio-key-1', 'audio/mpeg', 3, NULL, NULL, '{"original":{"key":"audio/2026/06/abc/original.mp3","mime_type":"audio/mpeg","size_bytes":3}}'::jsonb, 'sum-audio-1', now(), 'minio', 'active', 'audio')
RETURNING id`).Scan(&id)
	if err != nil {
		t.Fatalf("insertPreparedAudioAsset: %v", err)
	}
	return id
}
