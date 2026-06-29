package media

import (
	"context"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

type LocalBlobStore struct {
	root string
}

func NewLocalBlobStore(root string) *LocalBlobStore {
	return &LocalBlobStore{root: root}
}

func (s *LocalBlobStore) Put(_ context.Context, key string, reader io.Reader, _ string) error {
	fullPath, err := s.resolvePath(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
		return err
	}

	file, err := os.Create(fullPath)
	if err != nil {
		return err
	}
	defer file.Close()

	_, err = io.Copy(file, reader)
	return err
}

func (s *LocalBlobStore) Open(_ context.Context, key string) (io.ReadCloser, error) {
	fullPath, err := s.resolvePath(key)
	if err != nil {
		return nil, err
	}
	return os.Open(fullPath)
}

func (s *LocalBlobStore) Delete(_ context.Context, key string) error {
	fullPath, err := s.resolvePath(key)
	if err != nil {
		return err
	}
	return os.Remove(fullPath)
}

func (s *LocalBlobStore) resolvePath(key string) (string, error) {
	cleanKey := path.Clean("/" + strings.TrimSpace(key))
	if cleanKey == "/" {
		return "", fmt.Errorf("blob key is required")
	}
	return filepath.Join(s.root, filepath.FromSlash(strings.TrimPrefix(cleanKey, "/"))), nil
}

func localVariantObjectKey(storageKey string, variantName string, variantPath string) (string, error) {
	if len(storageKey) < 4 {
		return "", fmt.Errorf("invalid storage key %q", storageKey)
	}

	if fileName, ok := map[string]string{
		"content": "content.jpg",
		"cover":   "cover.jpg",
		"card":    "card.jpg",
		"avatar":  "avatar.png",
	}[variantName]; ok {
		return path.Join(storageKey[:2], storageKey[2:4], fileName), nil
	}

	trimmedPath := strings.TrimSpace(variantPath)
	if strings.HasPrefix(trimmedPath, "/uploads/") {
		return strings.TrimPrefix(trimmedPath, "/uploads/"), nil
	}
	if trimmedPath != "" {
		return path.Join(storageKey[:2], storageKey[2:4], path.Base(trimmedPath)), nil
	}

	return "", fmt.Errorf("unsupported local variant %q", variantName)
}
