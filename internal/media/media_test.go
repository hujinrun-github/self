package media

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"

	appdb "portfolio/internal/db"
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

	var rawJSON string
	if err := service.db.QueryRow(`SELECT variants_json FROM media_assets WHERE id = ?`, asset.ID).Scan(&rawJSON); err != nil {
		t.Fatalf("query variants json: %v", err)
	}
	var variants map[string]Variant
	if err := json.Unmarshal([]byte(rawJSON), &variants); err != nil {
		t.Fatalf("decode variants json: %v", err)
	}
	if _, ok := variants["content"]; !ok {
		t.Fatalf("variants json missing content: %s", rawJSON)
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
	if err := service.Delete(context.Background(), asset.ID); err == nil {
		t.Fatal("expected delete to be blocked")
	}
	items, err := service.List(context.Background(), 1, 10, "")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(items) != 1 || !items[0].Referenced {
		t.Fatalf("picker referenced state = %+v", items)
	}
}

func newMediaService(t *testing.T) *Service {
	t.Helper()
	database, err := appdb.Open(filepath.Join(t.TempDir(), "portfolio.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	root := t.TempDir()
	service := NewService(database, filepath.Join(root, "uploads"), filepath.Join(root, "private_uploads"))
	return service
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
