package media

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"portfolio/internal/storage"

	_ "golang.org/x/image/webp"
)

const maxUploadBytes = 5 * 1024 * 1024

var (
	ErrUploadInvalid = errors.New("invalid upload")
	ErrReferenced    = errors.New("media asset is referenced")
)

type Service struct {
	db                *sql.DB
	uploadsDir        string
	privateUploadsDir string
	storageKeyFunc    func() (string, error)
}

type Asset struct {
	ID         int64              `json:"id"`
	FileName   string             `json:"file_name"`
	StorageKey string             `json:"storage_key"`
	MimeType   string             `json:"mime_type"`
	Width      int                `json:"width"`
	Height     int                `json:"height"`
	Variants   map[string]Variant `json:"variants"`
	Referenced bool               `json:"referenced"`
}

func NewService(database *sql.DB, uploadsDir string, privateUploadsDir string) *Service {
	_ = os.MkdirAll(uploadsDir, 0o755)
	_ = os.MkdirAll(privateUploadsDir, 0o755)
	return &Service{
		db:                database,
		uploadsDir:        uploadsDir,
		privateUploadsDir: privateUploadsDir,
		storageKeyFunc:    randomStorageKey,
	}
}

func (s *Service) Upload(ctx context.Context, fileName string, reader io.Reader) (Asset, error) {
	if err := os.MkdirAll(s.uploadsDir, 0o755); err != nil {
		return Asset{}, err
	}
	if err := os.MkdirAll(s.privateUploadsDir, 0o755); err != nil {
		return Asset{}, err
	}
	if strings.EqualFold(filepath.Ext(fileName), ".svg") {
		return Asset{}, ErrUploadInvalid
	}

	rawPath, rawBytes, checksum, err := s.storeRaw(ctx, reader)
	if err != nil {
		return Asset{}, err
	}
	defer os.Remove(rawPath)

	mimeType := http.DetectContentType(rawBytes[:min(len(rawBytes), 512)])
	format, err := validateExtensionAndMime(fileName, mimeType)
	if err != nil {
		return Asset{}, err
	}
	img, decodedFormat, err := image.Decode(bytes.NewReader(rawBytes))
	if err != nil {
		return Asset{}, ErrUploadInvalid
	}
	if decodedFormat != format {
		return Asset{}, ErrUploadInvalid
	}
	bounds := img.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()
	if width > 6000 || height > 6000 || width*height > 24_000_000 {
		return Asset{}, ErrUploadInvalid
	}

	storageKey, err := s.storageKeyFunc()
	if err != nil {
		return Asset{}, err
	}
	stagingDir := filepath.Join(s.uploadsDir, ".staging-"+storageKey)
	finalDir := storageKeyDir(s.uploadsDir, storageKey)
	variants, err := s.generateVariants(storageKey, img, stagingDir)
	if err != nil {
		_ = os.RemoveAll(stagingDir)
		return Asset{}, err
	}
	variantsJSON, err := json.Marshal(variants)
	if err != nil {
		_ = os.RemoveAll(stagingDir)
		return Asset{}, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		_ = os.RemoveAll(stagingDir)
		return Asset{}, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	var id int64
	now := storage.NormalizeTime(time.Now())
	err = tx.QueryRowContext(ctx, `INSERT INTO media_assets (file_name, storage_key, mime_type, size_bytes, width, height, variants, checksum_sha256, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9) RETURNING id`,
		filepath.Base(fileName),
		storageKey,
		mimeType,
		len(rawBytes),
		width,
		height,
		string(variantsJSON),
		checksum,
		now,
	).Scan(&id)
	if err != nil {
		_ = os.RemoveAll(stagingDir)
		return Asset{}, err
	}
	if err := os.MkdirAll(filepath.Dir(finalDir), 0o755); err != nil {
		_ = os.RemoveAll(stagingDir)
		return Asset{}, err
	}
	if err := os.Rename(stagingDir, finalDir); err != nil {
		_ = tx.Rollback()
		_ = os.RemoveAll(stagingDir)
		return Asset{}, err
	}
	if err := tx.Commit(); err != nil {
		_ = os.RemoveAll(finalDir)
		return Asset{}, err
	}
	committed = true
	return Asset{
		ID:         id,
		FileName:   filepath.Base(fileName),
		StorageKey: storageKey,
		MimeType:   mimeType,
		Width:      width,
		Height:     height,
		Variants:   variants,
	}, nil
}

func (s *Service) storeRaw(ctx context.Context, reader io.Reader) (string, []byte, string, error) {
	temp, err := os.CreateTemp(s.privateUploadsDir, "upload-*")
	if err != nil {
		return "", nil, "", err
	}
	defer temp.Close()

	limited := io.LimitReader(reader, maxUploadBytes+1)
	rawBytes, err := io.ReadAll(limited)
	if err != nil {
		os.Remove(temp.Name())
		return "", nil, "", err
	}
	if len(rawBytes) > maxUploadBytes {
		os.Remove(temp.Name())
		return "", nil, "", ErrUploadInvalid
	}
	if err := ctx.Err(); err != nil {
		os.Remove(temp.Name())
		return "", nil, "", err
	}
	if _, err := temp.Write(rawBytes); err != nil {
		os.Remove(temp.Name())
		return "", nil, "", err
	}
	sum := sha256.Sum256(rawBytes)
	return temp.Name(), rawBytes, hex.EncodeToString(sum[:]), nil
}

func validateExtensionAndMime(fileName string, mimeType string) (string, error) {
	ext := strings.ToLower(filepath.Ext(fileName))
	switch ext {
	case ".png":
		if mimeType == "image/png" {
			return "png", nil
		}
	case ".jpg", ".jpeg":
		if mimeType == "image/jpeg" {
			return "jpeg", nil
		}
	case ".webp":
		if mimeType == "image/webp" {
			return "webp", nil
		}
	}
	return "", ErrUploadInvalid
}

func randomStorageKey() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes[:]), nil
}

func min(a int, b int) int {
	if a < b {
		return a
	}
	return b
}

func (s *Service) CleanupPrivateUploads(ctx context.Context, olderThan time.Duration) error {
	if err := os.MkdirAll(s.privateUploadsDir, 0o755); err != nil {
		return err
	}
	cutoff := time.Now().Add(-olderThan)
	return filepath.WalkDir(s.privateUploadsDir, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.ModTime().Before(cutoff) {
			return os.Remove(path)
		}
		return nil
	})
}

func (s *Service) Delete(ctx context.Context, mediaID int64) error {
	referenced, err := s.IsReferenced(ctx, mediaID)
	if err != nil {
		return err
	}
	if referenced {
		return ErrReferenced
	}
	_, err = s.db.ExecContext(ctx, `DELETE FROM media_assets WHERE id = $1`, mediaID)
	if storage.IsSQLState(err, storage.CodeForeignKeyViolation) {
		return ErrReferenced
	}
	return err
}

func (s *Service) List(ctx context.Context, page int, limit int, query string) ([]Asset, error) {
	if page <= 0 {
		page = 1
	}
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	offset := (page - 1) * limit
	pattern := "%" + query + "%"
	rows, err := s.db.QueryContext(ctx, `SELECT id, file_name, storage_key, mime_type, width, height, variants,
		EXISTS (SELECT 1 FROM media_references WHERE media_asset_id = media_assets.id) AS referenced
		FROM media_assets
		WHERE file_name ILIKE $1
		ORDER BY id DESC
		LIMIT $2 OFFSET $3`, pattern, limit, offset)
	if err != nil {
		return nil, err
	}
	assets := []Asset{}
	for rows.Next() {
		var asset Asset
		var rawVariants []byte
		if err := rows.Scan(&asset.ID, &asset.FileName, &asset.StorageKey, &asset.MimeType, &asset.Width, &asset.Height, &rawVariants, &asset.Referenced); err != nil {
			rows.Close()
			return nil, err
		}
		if err := json.Unmarshal(rawVariants, &asset.Variants); err != nil {
			rows.Close()
			return nil, fmt.Errorf("decode variants: %w", err)
		}
		assets = append(assets, asset)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	return assets, nil
}
