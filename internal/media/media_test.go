package media

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"

	dbtest "portfolio/internal/testutil/postgres"
)

func TestUploadRejectsInvalidFiles(t *testing.T) {
	service := newMediaService(t)
	if _, err := service.Upload(context.Background(), "icon.svg", bytes.NewReader([]byte(`<svg></svg>`))); err == nil {
		t.Fatal("expected SVG rejection")
	}
	if _, err := service.Upload(context.Background(), "large.png", bytes.NewReader(bytes.Repeat([]byte("x"), maxUploadBytes+1))); err == nil {
		t.Fatal("expected oversized file rejection")
	}
	if _, err := service.Upload(context.Background(), "wrong.jpg", bytes.NewReader(testPNG(t, 8, 8))); err == nil {
		t.Fatal("expected MIME mismatch rejection")
	}
	if _, err := service.Upload(context.Background(), "huge.png", bytes.NewReader(testPNG(t, 6001, 1))); err == nil {
		t.Fatal("expected pixel dimension rejection")
	}
}

func TestUploadGeneratesDerivativesAndDeletesRawTemp(t *testing.T) {
	service := newMediaService(t)
	asset, err := service.Upload(context.Background(), "avatar.png", bytes.NewReader(testPNG(t, 640, 360)))
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}
	if asset.ID == 0 || asset.StorageKey == "" {
		t.Fatalf("asset not persisted: %+v", asset)
	}
	for _, key := range []string{"content", "cover", "card", "avatar"} {
		variant, ok := asset.Variants[key]
		if !ok {
			t.Fatalf("missing variant %s in %+v", key, asset.Variants)
		}
		if variant.MimeType != "image/jpeg" && variant.MimeType != "image/png" {
			t.Fatalf("variant %s mime = %s", key, variant.MimeType)
		}
		if _, err := os.Stat(filepath.Join(service.uploadsDir, filepath.FromSlash(variant.Path[len("/uploads/"):]))); err != nil {
			t.Fatalf("variant %s file missing: %v", key, err)
		}
	}
	entries, err := os.ReadDir(service.privateUploadsDir)
	if err != nil {
		t.Fatalf("read private uploads: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("raw temp files were not deleted: %v", entries)
	}

	var rawJSON []byte
	if err := service.db.QueryRow(`SELECT variants FROM media_assets WHERE id = $1`, asset.ID).Scan(&rawJSON); err != nil {
		t.Fatalf("query variants json: %v", err)
	}
	var variants map[string]Variant
	if err := json.Unmarshal(rawJSON, &variants); err != nil {
		t.Fatalf("decode variants json: %v", err)
	}
	if _, ok := variants["content"]; !ok {
		t.Fatalf("variants json missing content: %s", string(rawJSON))
	}
}

func TestUploadRemovesGeneratedFilesWhenInsertFails(t *testing.T) {
	service := newMediaService(t)
	key := "aabbccddeeff00112233445566778899"
	service.storageKeyFunc = func() (string, error) {
		return key, nil
	}
	insertMediaAsset(t, service.db, key, "existing.png")

	if _, err := service.Upload(context.Background(), "avatar.png", bytes.NewReader(testPNG(t, 640, 360))); err == nil {
		t.Fatal("expected upload error")
	}

	finalDir := filepath.Join(service.uploadsDir, key[:2], key[2:4])
	if _, err := os.Stat(finalDir); !os.IsNotExist(err) {
		t.Fatalf("final upload directory should be removed, stat err = %v", err)
	}
}

func TestCleanupRemovesOldPrivateTempFiles(t *testing.T) {
	service := newMediaService(t)
	oldFile := filepath.Join(service.privateUploadsDir, "old.tmp")
	if err := os.WriteFile(oldFile, []byte("raw"), 0o644); err != nil {
		t.Fatalf("write old tmp: %v", err)
	}
	oldTime := time.Now().Add(-25 * time.Hour)
	if err := os.Chtimes(oldFile, oldTime, oldTime); err != nil {
		t.Fatalf("chtimes: %v", err)
	}
	if err := service.CleanupPrivateUploads(context.Background(), 24*time.Hour); err != nil {
		t.Fatalf("CleanupPrivateUploads: %v", err)
	}
	if _, err := os.Stat(oldFile); !os.IsNotExist(err) {
		t.Fatalf("old temp should be removed, stat err = %v", err)
	}
}

func TestReferencesBlockDeleteAndPickerShowsReferenced(t *testing.T) {
	service := newMediaService(t)
	asset, err := service.Upload(context.Background(), "cover.png", bytes.NewReader(testPNG(t, 64, 64)))
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}
	tx, err := service.db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	if err := service.RebuildReferences(context.Background(), tx, "project", 42, []Reference{{MediaAssetID: asset.ID, Source: "cover"}}); err != nil {
		t.Fatalf("RebuildReferences: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit refs: %v", err)
	}

	referenced, err := service.IsReferenced(context.Background(), asset.ID)
	if err != nil {
		t.Fatalf("IsReferenced: %v", err)
	}
	if !referenced {
		t.Fatal("expected media to be referenced")
	}
	if err := service.Delete(context.Background(), asset.ID); !errors.Is(err, ErrReferenced) {
		t.Fatalf("Delete() error = %v, want %v", err, ErrReferenced)
	}
	items, err := service.List(context.Background(), 1, 10, "")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(items) != 1 || !items[0].Referenced {
		t.Fatalf("picker referenced state = %+v", items)
	}
}

func TestListHidesPendingImportAssets(t *testing.T) {
	service := newMediaService(t)
	insertPendingImportAsset(t, service.db, "pending-audio.mp3")

	items, err := service.List(context.Background(), 1, 20, "")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	for _, item := range items {
		if item.FileName == "pending-audio.mp3" {
			t.Fatalf("pending import asset leaked into admin list: %+v", item)
		}
	}
}

func TestListIncludesActiveAudioAssets(t *testing.T) {
	service := newMediaService(t)
	insertActiveAudioAsset(t, service.db, "published-audio.mp3")

	items, err := service.List(context.Background(), 1, 20, "")
	if err != nil {
		t.Fatalf("List: %v", err)
	}

	for _, item := range items {
		if item.FileName != "published-audio.mp3" {
			continue
		}
		if item.Width != 0 || item.Height != 0 {
			t.Fatalf("audio dimensions = (%d, %d), want zero values", item.Width, item.Height)
		}
		return
	}

	t.Fatal("expected active audio asset in media list")
}

func TestPrepareImportAssetStoresAudioAsPendingImport(t *testing.T) {
	service := newImportReadyMediaService(t, stubBlobStore{})
	asset, err := service.PrepareImportAsset(context.Background(), PrepareImportAssetInput{
		FileName:       "intro.mp3",
		MediaKind:      "audio",
		Contents:       []byte("fake-mp3"),
		OriginalPath:   "./audio/intro.mp3",
		StorageBackend: "minio",
	})
	if err != nil {
		t.Fatalf("PrepareImportAsset: %v", err)
	}
	if asset.LifecycleState != "pending_import" {
		t.Fatalf("LifecycleState = %q", asset.LifecycleState)
	}
	if _, ok := asset.Variants["original"]; !ok {
		t.Fatalf("variants = %+v", asset.Variants)
	}
}

func TestDeleteMapsForeignKeyViolationToErrReferenced(t *testing.T) {
	service := newMediaService(t)
	assetID := insertMediaAsset(t, service.db, "deadbeef00112233445566778899aabb", "cover.png")

	if _, err := service.db.Exec(`
CREATE OR REPLACE FUNCTION media_delete_add_reference() RETURNS trigger AS $$
BEGIN
	INSERT INTO media_references (media_asset_id, resource_type, resource_id, source, created_at)
	VALUES (OLD.id, 'project', 99, 'cover', now());
	RETURN OLD;
END;
$$ LANGUAGE plpgsql;
`); err != nil {
		t.Fatalf("create trigger function: %v", err)
	}
	if _, err := service.db.Exec(`
CREATE TRIGGER media_assets_delete_add_reference
BEFORE DELETE ON media_assets
FOR EACH ROW
EXECUTE PROCEDURE media_delete_add_reference();
`); err != nil {
		t.Fatalf("create trigger: %v", err)
	}

	err := service.Delete(context.Background(), assetID)
	if !errors.Is(err, ErrReferenced) {
		t.Fatalf("Delete() error = %v, want %v", err, ErrReferenced)
	}
}

func newMediaService(t *testing.T) *Service {
	t.Helper()
	database, _ := dbtest.OpenPostgres(t)

	root := t.TempDir()
	uploadsDir := filepath.Join(root, "uploads")
	service := NewService(
		database,
		uploadsDir,
		filepath.Join(root, "private_uploads"),
		NewLocalBlobStore(uploadsDir),
		nil,
	)
	return service
}

func insertMediaAsset(t *testing.T, database *sql.DB, storageKey string, fileName string) int64 {
	t.Helper()

	var id int64
	err := database.QueryRow(
		`INSERT INTO media_assets (file_name, storage_key, mime_type, size_bytes, width, height, variants, checksum_sha256, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, now())
		 RETURNING id`,
		fileName,
		storageKey,
		"image/png",
		10,
		1,
		1,
		`{"content":{"path":"/uploads/test/content.jpg","width":1,"height":1,"mime_type":"image/jpeg","size_bytes":10}}`,
		"checksum-"+storageKey,
	).Scan(&id)
	if err != nil {
		t.Fatalf("insert media asset: %v", err)
	}
	return id
}

func insertPendingImportAsset(t *testing.T, database *sql.DB, fileName string) {
	t.Helper()

	if _, err := database.Exec(`
INSERT INTO media_assets (file_name, storage_key, mime_type, size_bytes, width, height, variants, checksum_sha256, created_at, storage_backend, lifecycle_state, media_kind)
VALUES ($1, 'pending-audio-key', 'audio/mpeg', 4, NULL, NULL, '{"original":{"key":"audio/2026/06/pending/original.mp3","mime_type":"audio/mpeg","size_bytes":4}}'::jsonb, 'sum-pending-audio', now(), 'minio', 'pending_import', 'audio')
`, fileName); err != nil {
		t.Fatalf("insertPendingImportAsset: %v", err)
	}
}

func insertActiveAudioAsset(t *testing.T, database *sql.DB, fileName string) {
	t.Helper()

	if _, err := database.Exec(`
INSERT INTO media_assets (file_name, storage_key, mime_type, size_bytes, width, height, variants, checksum_sha256, created_at, storage_backend, lifecycle_state, media_kind)
VALUES ($1, 'active-audio-key', 'audio/mpeg', 4, NULL, NULL, '{"original":{"key":"audio/2026/06/active/original.mp3","mime_type":"audio/mpeg","size_bytes":4}}'::jsonb, 'sum-active-audio', now(), 'minio', 'active', 'audio')
`, fileName); err != nil {
		t.Fatalf("insertActiveAudioAsset: %v", err)
	}
}

func testPNG(t *testing.T, width int, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: 20, G: 120, B: 200, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return buf.Bytes()
}

func testJPEG(t *testing.T, width int, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 80}); err != nil {
		t.Fatalf("encode jpeg: %v", err)
	}
	return buf.Bytes()
}

var _ *sql.DB
