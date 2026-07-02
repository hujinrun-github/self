package media

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"path"
	"strings"

	"github.com/google/uuid"
)

func CheckBlobStoreRoundTrip(ctx context.Context, store BlobStore, prefix string) (err error) {
	key := path.Join(strings.TrimSpace(prefix), uuid.NewString()+".txt")
	payload := []byte("healthcheck")

	if err := store.Put(ctx, key, bytes.NewReader(payload), "text/plain"); err != nil {
		return fmt.Errorf("put probe object: %w", err)
	}
	defer func() {
		if deleteErr := store.Delete(context.Background(), key); deleteErr != nil && err == nil {
			err = fmt.Errorf("delete probe object: %w", deleteErr)
		}
	}()

	reader, err := store.Open(ctx, key)
	if err != nil {
		return fmt.Errorf("open probe object: %w", err)
	}
	defer reader.Close()

	body, err := io.ReadAll(reader)
	if err != nil {
		return fmt.Errorf("read probe object: %w", err)
	}
	if !bytes.Equal(body, payload) {
		return fmt.Errorf("read probe object: unexpected payload")
	}

	return nil
}
