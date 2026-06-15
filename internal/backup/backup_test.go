package backup

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"

	appdb "portfolio/internal/db"
)

func TestRunSnapshotsDatabaseAndCopiesUploads(t *testing.T) {
	ctx := context.Background()
	sourceDB, err := appdb.Open(filepath.Join(t.TempDir(), "portfolio.db"))
	if err != nil {
		t.Fatalf("open source db: %v", err)
	}
	defer sourceDB.Close()

	if _, err := sourceDB.Exec(`INSERT INTO media_assets (file_name, storage_key, mime_type, size_bytes, width, height, variants_json, checksum_sha256, created_at) VALUES ('avatar.png', 'key-1', 'image/png', 10, 1, 1, '{}', 'sum-1', CURRENT_TIMESTAMP)`); err != nil {
		t.Fatalf("seed db: %v", err)
	}

	root := t.TempDir()
	uploadsDir := filepath.Join(root, "uploads")
	privateUploadsDir := filepath.Join(root, "private_uploads")
	if err := os.MkdirAll(filepath.Join(uploadsDir, "ab", "cd"), 0o755); err != nil {
		t.Fatalf("create uploads: %v", err)
	}
	if err := os.MkdirAll(privateUploadsDir, 0o755); err != nil {
		t.Fatalf("create private uploads: %v", err)
	}
	if err := os.WriteFile(filepath.Join(uploadsDir, "ab", "cd", "card.jpg"), []byte("public derivative"), 0o644); err != nil {
		t.Fatalf("write upload: %v", err)
	}
	if err := os.WriteFile(filepath.Join(privateUploadsDir, "raw.tmp"), []byte("private raw"), 0o644); err != nil {
		t.Fatalf("write private upload: %v", err)
	}

	destinationDir := filepath.Join(t.TempDir(), "backup")
	if err := Run(ctx, sourceDB, uploadsDir, destinationDir); err != nil {
		t.Fatalf("Run: %v", err)
	}

	snapshot, err := sql.Open("sqlite", filepath.Join(destinationDir, "portfolio.db"))
	if err != nil {
		t.Fatalf("open snapshot: %v", err)
	}
	defer snapshot.Close()
	var count int
	if err := snapshot.QueryRow(`SELECT COUNT(*) FROM media_assets WHERE storage_key = 'key-1'`).Scan(&count); err != nil {
		t.Fatalf("query snapshot: %v", err)
	}
	if count != 1 {
		t.Fatalf("snapshot media count = %d", count)
	}

	if _, err := os.Stat(filepath.Join(destinationDir, "uploads", "ab", "cd", "card.jpg")); err != nil {
		t.Fatalf("expected upload derivative in backup: %v", err)
	}
	if _, err := os.Stat(filepath.Join(destinationDir, "private_uploads", "raw.tmp")); !os.IsNotExist(err) {
		t.Fatalf("private upload should not be backed up, stat err = %v", err)
	}
}

func TestRunBlocksApplicationWritesWithMutex(t *testing.T) {
	sourceDB, err := appdb.Open(filepath.Join(t.TempDir(), "portfolio.db"))
	if err != nil {
		t.Fatalf("open source db: %v", err)
	}
	defer sourceDB.Close()

	uploadsDir := filepath.Join(t.TempDir(), "uploads")
	if err := os.MkdirAll(uploadsDir, 0o755); err != nil {
		t.Fatalf("create uploads: %v", err)
	}

	locked := make(chan struct{})
	release := make(chan struct{})
	afterLock = func() {
		close(locked)
		<-release
	}
	defer func() { afterLock = nil }()

	done := make(chan error, 1)
	go func() {
		done <- Run(context.Background(), sourceDB, uploadsDir, filepath.Join(t.TempDir(), "backup"))
	}()

	select {
	case <-locked:
	case <-time.After(time.Second):
		t.Fatal("backup did not acquire write mutex")
	}

	writeEntered := make(chan struct{})
	writeDone := make(chan error, 1)
	go func() {
		writeDone <- WithWriteLock(func() error {
			close(writeEntered)
			return nil
		})
	}()

	select {
	case <-writeEntered:
		t.Fatal("application write entered while backup lock was held")
	case <-time.After(50 * time.Millisecond):
	}

	close(release)

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Run returned error: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("backup did not finish")
	}

	select {
	case err := <-writeDone:
		if err != nil {
			t.Fatalf("WithWriteLock returned error: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("write did not resume after backup")
	}
}
