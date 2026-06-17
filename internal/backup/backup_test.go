package backup

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRunSnapshotsDatabaseAndCopiesUploads(t *testing.T) {
	ctx := context.Background()

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

	var commandPath string
	var args []string
	var env []string
	stubPGDump(t, func(_ context.Context, path string, commandArgs []string, commandEnv []string) error {
		commandPath = path
		args = append([]string(nil), commandArgs...)
		env = append([]string(nil), commandEnv...)
		return os.WriteFile(flagValue(t, commandArgs, "--file"), []byte("dump"), 0o644)
	})

	destinationDir := filepath.Join(t.TempDir(), "backup")
	sourceURL := "postgres://postgres:secret@db.example.test:5432/portfolio?sslmode=disable"
	if err := Run(ctx, sourceURL, uploadsDir, destinationDir); err != nil {
		t.Fatalf("Run: %v", err)
	}

	if commandPath != "pg_dump-test" {
		t.Fatalf("pg_dump path = %q", commandPath)
	}
	for _, required := range []string{"--format=custom", "--no-owner", "--no-acl"} {
		if !containsArg(args, required) {
			t.Fatalf("pg_dump args missing %q: %v", required, args)
		}
	}
	if args[len(args)-1] != "postgres://postgres@db.example.test:5432/portfolio?sslmode=disable" {
		t.Fatalf("database argument = %q", args[len(args)-1])
	}
	for _, value := range args {
		if strings.Contains(value, "secret") {
			t.Fatalf("pg_dump args leaked password: %v", args)
		}
	}
	if !containsArg(env, "PGPASSWORD=secret") {
		t.Fatalf("pg_dump env missing password: %v", env)
	}

	if _, err := os.Stat(filepath.Join(destinationDir, "database.dump")); err != nil {
		t.Fatalf("expected database dump in backup: %v", err)
	}
	if _, err := os.Stat(filepath.Join(destinationDir, "uploads", "ab", "cd", "card.jpg")); err != nil {
		t.Fatalf("expected upload derivative in backup: %v", err)
	}
	if _, err := os.Stat(filepath.Join(destinationDir, "private_uploads", "raw.tmp")); !os.IsNotExist(err) {
		t.Fatalf("private upload should not be backed up, stat err = %v", err)
	}
}

func TestRunBlocksApplicationWritesWithMutex(t *testing.T) {
	uploadsDir := filepath.Join(t.TempDir(), "uploads")
	if err := os.MkdirAll(uploadsDir, 0o755); err != nil {
		t.Fatalf("create uploads: %v", err)
	}

	stubPGDump(t, func(_ context.Context, _ string, args []string, _ []string) error {
		return os.WriteFile(flagValue(t, args, "--file"), []byte("dump"), 0o644)
	})

	locked := make(chan struct{})
	release := make(chan struct{})
	afterLock = func() {
		close(locked)
		<-release
	}
	t.Cleanup(func() { afterLock = nil })

	done := make(chan error, 1)
	go func() {
		done <- Run(context.Background(), "postgres://postgres:secret@db.example.test:5432/portfolio?sslmode=disable", uploadsDir, filepath.Join(t.TempDir(), "backup"))
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

func stubPGDump(t *testing.T, fn func(context.Context, string, []string, []string) error) {
	t.Helper()

	originalLookup := lookupPGDumpPath
	originalRun := runPGDump
	lookupPGDumpPath = func() (string, error) { return "pg_dump-test", nil }
	runPGDump = fn
	t.Cleanup(func() {
		lookupPGDumpPath = originalLookup
		runPGDump = originalRun
	})
}

func containsArg(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func flagValue(t *testing.T, values []string, flag string) string {
	t.Helper()

	for i := 0; i < len(values)-1; i++ {
		if values[i] == flag {
			return values[i+1]
		}
	}
	t.Fatalf("flag %s missing from %v", flag, values)
	return ""
}
