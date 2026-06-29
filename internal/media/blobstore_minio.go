package media

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type MinIOConfig struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	Bucket    string
	UseSSL    bool
}

type MinIOBlobStore struct {
	client *minio.Client
	bucket string
}

func NewMinIOBlobStore(cfg MinIOConfig) (BlobStore, error) {
	if strings.TrimSpace(cfg.Endpoint) == "" {
		return nil, fmt.Errorf("minio endpoint is required")
	}
	if strings.TrimSpace(cfg.AccessKey) == "" {
		return nil, fmt.Errorf("minio access key is required")
	}
	if strings.TrimSpace(cfg.SecretKey) == "" {
		return nil, fmt.Errorf("minio secret key is required")
	}
	if strings.TrimSpace(cfg.Bucket) == "" {
		return nil, fmt.Errorf("minio bucket is required")
	}

	endpoint, secure, err := normalizeMinIOEndpoint(cfg.Endpoint, cfg.UseSSL)
	if err != nil {
		return nil, err
	}

	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: secure,
	})
	if err != nil {
		return nil, err
	}

	return &MinIOBlobStore{
		client: client,
		bucket: cfg.Bucket,
	}, nil
}

func (s *MinIOBlobStore) Put(ctx context.Context, key string, reader io.Reader, contentType string) error {
	_, err := s.client.PutObject(ctx, s.bucket, key, reader, -1, minio.PutObjectOptions{
		ContentType: contentType,
	})
	return err
}

func (s *MinIOBlobStore) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	object, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	if _, err := object.Stat(); err != nil {
		_ = object.Close()
		return nil, err
	}
	return object, nil
}

func (s *MinIOBlobStore) Delete(ctx context.Context, key string) error {
	return s.client.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{})
}

func normalizeMinIOEndpoint(raw string, useSSL bool) (string, bool, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", false, fmt.Errorf("minio endpoint is required")
	}
	if !strings.Contains(raw, "://") {
		return raw, useSSL, nil
	}

	parsed, err := url.Parse(raw)
	if err != nil {
		return "", false, fmt.Errorf("parse minio endpoint: %w", err)
	}
	if parsed.Host == "" {
		return "", false, fmt.Errorf("minio endpoint %q is missing host", raw)
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return "", false, fmt.Errorf("minio endpoint %q must not include a path prefix", raw)
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", false, fmt.Errorf("minio endpoint %q must not include query or fragment", raw)
	}
	secure := useSSL || strings.EqualFold(parsed.Scheme, "https")
	return parsed.Host, secure, nil
}
