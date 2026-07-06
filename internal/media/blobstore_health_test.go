package media

import (
	"bytes"
	"context"
	"errors"
	"io"
	"io/fs"
	"path/filepath"
	"testing"
	"time"
)

func TestCheckBlobStoreRoundTrip(t *testing.T) {
	t.Run("shared contract", func(t *testing.T) {
		store := &probeBlobStore{}

		if err := CheckBlobStoreRoundTrip(context.Background(), store, "_healthchecks"); err != nil {
			t.Fatalf("CheckBlobStoreRoundTrip returned error: %v", err)
		}
		if len(store.putKeys) != 1 {
			t.Fatalf("put count = %d, want 1", len(store.putKeys))
		}
		if len(store.openKeys) != 1 {
			t.Fatalf("open count = %d, want 1", len(store.openKeys))
		}
		if len(store.deletedKeys) != 1 {
			t.Fatalf("delete count = %d, want 1", len(store.deletedKeys))
		}
		if store.putKeys[0] != store.openKeys[0] {
			t.Fatalf("opened key = %q, want %q", store.openKeys[0], store.putKeys[0])
		}
		if store.putKeys[0] != store.deletedKeys[0] {
			t.Fatalf("deleted key = %q, want %q", store.deletedKeys[0], store.putKeys[0])
		}
		if got := string(store.putBodies[store.putKeys[0]]); got != "healthcheck" {
			t.Fatalf("probe body = %q, want %q", got, "healthcheck")
		}
	})

	t.Run("local blob store", func(t *testing.T) {
		root := t.TempDir()

		if err := CheckBlobStoreRoundTrip(context.Background(), NewLocalBlobStore(root), "_healthchecks"); err != nil {
			t.Fatalf("CheckBlobStoreRoundTrip returned error: %v", err)
		}

		fileCount := 0
		if err := filepath.WalkDir(root, func(_ string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if !d.IsDir() {
				fileCount++
			}
			return nil
		}); err != nil {
			t.Fatalf("walk probe root: %v", err)
		}
		if fileCount != 0 {
			t.Fatalf("file count = %d, want 0", fileCount)
		}
	})
}

func TestCheckBlobStoreRoundTripDeletesProbeOnOpenFailure(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	openErr := errors.New("open boom")
	deleteErr := errors.New("delete boom")
	store := &probeBlobStore{
		openErr:   openErr,
		deleteErr: deleteErr,
	}

	err := CheckBlobStoreRoundTrip(ctx, store, "_healthchecks")
	if err == nil {
		t.Fatal("expected CheckBlobStoreRoundTrip to fail")
	}
	if !errors.Is(err, openErr) {
		t.Fatalf("error = %v, want wrapped open error", err)
	}
	if errors.Is(err, deleteErr) {
		t.Fatalf("error = %v, did not expect delete error to replace primary error", err)
	}
	if len(store.putKeys) != 1 {
		t.Fatalf("put count = %d, want 1", len(store.putKeys))
	}
	if len(store.deletedKeys) != 1 {
		t.Fatalf("delete count = %d, want 1", len(store.deletedKeys))
	}
	if store.putKeys[0] != store.deletedKeys[0] {
		t.Fatalf("deleted key = %q, want %q", store.deletedKeys[0], store.putKeys[0])
	}
	assertDeleteCleanupContext(t, store)
}

func TestCheckBlobStoreRoundTripDeletesProbeOnReadFailure(t *testing.T) {
	readErr := errors.New("read boom")
	deleteErr := errors.New("delete boom")
	reader := &failingReadCloser{readErr: readErr}
	store := &probeBlobStore{
		openReader: reader,
		deleteErr:  deleteErr,
	}

	err := CheckBlobStoreRoundTrip(context.Background(), store, "_healthchecks")
	if err == nil {
		t.Fatal("expected CheckBlobStoreRoundTrip to fail")
	}
	if !errors.Is(err, readErr) {
		t.Fatalf("error = %v, want wrapped read error", err)
	}
	if errors.Is(err, deleteErr) {
		t.Fatalf("error = %v, did not expect delete error to replace primary error", err)
	}
	if len(store.putKeys) != 1 {
		t.Fatalf("put count = %d, want 1", len(store.putKeys))
	}
	if len(store.deletedKeys) != 1 {
		t.Fatalf("delete count = %d, want 1", len(store.deletedKeys))
	}
	if store.putKeys[0] != store.deletedKeys[0] {
		t.Fatalf("deleted key = %q, want %q", store.deletedKeys[0], store.putKeys[0])
	}
	if !reader.closed {
		t.Fatal("expected failing reader to be closed")
	}
	assertDeleteCleanupContext(t, store)
}

func TestCheckBlobStoreRoundTripReturnsDeleteError(t *testing.T) {
	deleteErr := errors.New("delete boom")
	store := &probeBlobStore{
		deleteErr: deleteErr,
	}

	err := CheckBlobStoreRoundTrip(context.Background(), store, "_healthchecks")
	if err == nil {
		t.Fatal("expected CheckBlobStoreRoundTrip to fail")
	}
	if !errors.Is(err, deleteErr) {
		t.Fatalf("error = %v, want wrapped delete error", err)
	}
	assertDeleteCleanupContext(t, store)
}

type probeBlobStore struct {
	putKeys           []string
	openKeys          []string
	deletedKeys       []string
	bodies            map[string][]byte
	putBodies         map[string][]byte
	openErr           error
	openReader        io.ReadCloser
	deleteErr         error
	deleteCtxErr      error
	deleteDeadline    time.Time
	deleteHasDeadline bool
}

func (s *probeBlobStore) Put(_ context.Context, key string, reader io.Reader, _ string) error {
	body, err := io.ReadAll(reader)
	if err != nil {
		return err
	}
	if s.bodies == nil {
		s.bodies = map[string][]byte{}
	}
	if s.putBodies == nil {
		s.putBodies = map[string][]byte{}
	}
	s.putKeys = append(s.putKeys, key)
	s.bodies[key] = body
	s.putBodies[key] = append([]byte(nil), body...)
	return nil
}

func (s *probeBlobStore) Open(_ context.Context, key string) (io.ReadCloser, error) {
	s.openKeys = append(s.openKeys, key)
	if s.openErr != nil {
		return nil, s.openErr
	}
	if s.openReader != nil {
		return s.openReader, nil
	}
	return io.NopCloser(bytes.NewReader(s.bodies[key])), nil
}

func (s *probeBlobStore) Delete(ctx context.Context, key string) error {
	s.deletedKeys = append(s.deletedKeys, key)
	s.deleteCtxErr = ctx.Err()
	s.deleteDeadline, s.deleteHasDeadline = ctx.Deadline()
	delete(s.bodies, key)
	return s.deleteErr
}

type failingReadCloser struct {
	readErr error
	closed  bool
}

func (r *failingReadCloser) Read([]byte) (int, error) {
	return 0, r.readErr
}

func (r *failingReadCloser) Close() error {
	r.closed = true
	return nil
}

func assertDeleteCleanupContext(t *testing.T, store *probeBlobStore) {
	t.Helper()

	if !store.deleteHasDeadline {
		t.Fatal("expected cleanup delete context to have a deadline")
	}
	if store.deleteCtxErr != nil {
		t.Fatalf("cleanup delete context err = %v, want nil", store.deleteCtxErr)
	}
	if remaining := time.Until(store.deleteDeadline); remaining <= 0 {
		t.Fatalf("cleanup delete deadline should be in the future, remaining = %v", remaining)
	}
}
