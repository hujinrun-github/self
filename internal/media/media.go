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
	"path"
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
	ErrNotFound      = errors.New("media asset not found")
)

type Service struct {
	db                *sql.DB
	uploadsDir        string
	privateUploadsDir string
	localStore        BlobStore
	minioStore        BlobStore
	storageKeyFunc    func() (string, error)
}

type Asset struct {
	ID             int64              `json:"id"`
	FileName       string             `json:"file_name"`
	StorageKey     string             `json:"storage_key"`
	MimeType       string             `json:"mime_type"`
	Width          int                `json:"width"`
	Height         int                `json:"height"`
	Variants       map[string]Variant `json:"variants"`
	Referenced     bool               `json:"referenced"`
	LifecycleState string             `json:"lifecycle_state,omitempty"`
	MediaKind      string             `json:"media_kind,omitempty"`
}

type PrepareImportAssetInput struct {
	FileName       string
	MediaKind      string
	Contents       []byte
	OriginalPath   string
	StorageBackend string
}

func NewService(database *sql.DB, uploadsDir string, privateUploadsDir string, localStore BlobStore, minioStore BlobStore) *Service {
	_ = os.MkdirAll(uploadsDir, 0o755)
	_ = os.MkdirAll(privateUploadsDir, 0o755)
	if localStore == nil {
		localStore = NewLocalBlobStore(uploadsDir)
	}
	return &Service{
		db:                database,
		uploadsDir:        uploadsDir,
		privateUploadsDir: privateUploadsDir,
		localStore:        localStore,
		minioStore:        minioStore,
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

func (s *Service) PrepareImportAsset(ctx context.Context, input PrepareImportAssetInput) (Asset, error) {
	switch strings.TrimSpace(input.MediaKind) {
	case "image":
		return s.prepareImportImage(ctx, input)
	case "audio", "video":
		return s.prepareImportBinary(ctx, input)
	default:
		return Asset{}, ErrUploadInvalid
	}
}

func (s *Service) OpenVariant(ctx context.Context, mediaID int64, variantName string) (io.ReadCloser, string, error) {
	asset, err := s.loadVariantAsset(ctx, mediaID)
	if err != nil {
		return nil, "", err
	}

	variant, ok := asset.Variants[variantName]
	if !ok {
		return nil, "", ErrNotFound
	}

	mimeType := variant.MimeType
	if mimeType == "" {
		mimeType = asset.MimeType
	}

	switch asset.StorageBackend {
	case "", "local":
		if s.localStore == nil {
			return nil, "", fmt.Errorf("local blob store is not configured")
		}
		key, err := localVariantObjectKey(asset.StorageKey, variantName, variant.Path)
		if err != nil {
			return nil, "", err
		}
		stream, err := s.localStore.Open(ctx, key)
		if err != nil {
			return nil, "", err
		}
		return stream, mimeType, nil
	case "minio":
		if s.minioStore == nil {
			return nil, "", fmt.Errorf("minio blob store is not configured")
		}
		if strings.TrimSpace(variant.Key) == "" {
			return nil, "", ErrNotFound
		}
		stream, err := s.minioStore.Open(ctx, variant.Key)
		if err != nil {
			return nil, "", err
		}
		return stream, mimeType, nil
	default:
		return nil, "", ErrNotFound
	}
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
		  AND lifecycle_state = 'active'
		ORDER BY id DESC
		LIMIT $2 OFFSET $3`, pattern, limit, offset)
	if err != nil {
		return nil, err
	}
	assets := []Asset{}
	for rows.Next() {
		var asset Asset
		var rawVariants []byte
		var width sql.NullInt64
		var height sql.NullInt64
		if err := rows.Scan(&asset.ID, &asset.FileName, &asset.StorageKey, &asset.MimeType, &width, &height, &rawVariants, &asset.Referenced); err != nil {
			rows.Close()
			return nil, err
		}
		if width.Valid {
			asset.Width = int(width.Int64)
		}
		if height.Valid {
			asset.Height = int(height.Int64)
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

type preparedVariantRecord struct {
	Key       string `json:"key,omitempty"`
	MimeType  string `json:"mime_type"`
	Width     *int   `json:"width,omitempty"`
	Height    *int   `json:"height,omitempty"`
	SizeBytes int64  `json:"size_bytes"`
}

func (s *Service) prepareImportBinary(ctx context.Context, input PrepareImportAssetInput) (Asset, error) {
	if len(input.Contents) == 0 || len(input.Contents) > maxUploadBytes {
		return Asset{}, ErrUploadInvalid
	}
	backend := strings.TrimSpace(input.StorageBackend)
	if backend == "" {
		backend = "minio"
	}
	store, err := s.storeForBackend(backend)
	if err != nil {
		return Asset{}, err
	}

	storageKey, err := s.storageKeyFunc()
	if err != nil {
		return Asset{}, err
	}
	mimeType := detectPreparedMimeType(input.FileName, input.MediaKind, input.Contents)
	objectKey := preparedObjectKey(input.MediaKind, storageKey, filepath.Base(input.FileName))
	if err := store.Put(ctx, objectKey, bytes.NewReader(input.Contents), mimeType); err != nil {
		return Asset{}, err
	}

	variants := map[string]preparedVariantRecord{
		"original": {
			Key:       objectKey,
			MimeType:  mimeType,
			SizeBytes: int64(len(input.Contents)),
		},
	}
	return s.insertPreparedAsset(ctx, input, backend, storageKey, mimeType, nil, nil, variants, map[string]Variant{
		"original": {
			MimeType:  mimeType,
			SizeBytes: int64(len(input.Contents)),
		},
	})
}

func (s *Service) prepareImportImage(ctx context.Context, input PrepareImportAssetInput) (Asset, error) {
	if len(input.Contents) == 0 || len(input.Contents) > maxUploadBytes {
		return Asset{}, ErrUploadInvalid
	}
	if strings.EqualFold(filepath.Ext(input.FileName), ".svg") {
		return Asset{}, ErrUploadInvalid
	}

	mimeType := http.DetectContentType(input.Contents[:min(len(input.Contents), 512)])
	format, err := validateExtensionAndMime(input.FileName, mimeType)
	if err != nil {
		return Asset{}, err
	}
	img, decodedFormat, err := image.Decode(bytes.NewReader(input.Contents))
	if err != nil || decodedFormat != format {
		return Asset{}, ErrUploadInvalid
	}
	bounds := img.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()
	if width > 6000 || height > 6000 || width*height > 24_000_000 {
		return Asset{}, ErrUploadInvalid
	}

	backend := strings.TrimSpace(input.StorageBackend)
	if backend == "" {
		backend = "minio"
	}
	store, err := s.storeForBackend(backend)
	if err != nil {
		return Asset{}, err
	}
	storageKey, err := s.storageKeyFunc()
	if err != nil {
		return Asset{}, err
	}

	stagingDir := filepath.Join(s.privateUploadsDir, ".import-"+storageKey)
	variants, err := s.generateVariants(storageKey, img, stagingDir)
	if err != nil {
		_ = os.RemoveAll(stagingDir)
		return Asset{}, err
	}
	defer os.RemoveAll(stagingDir)

	rawVariants := make(map[string]preparedVariantRecord, len(variants))
	for variantName, variant := range variants {
		fileName := path.Base(variant.Path)
		objectKey := preparedObjectKey("image", storageKey, fileName)
		file, err := os.Open(filepath.Join(stagingDir, fileName))
		if err != nil {
			return Asset{}, err
		}
		putErr := store.Put(ctx, objectKey, file, variant.MimeType)
		closeErr := file.Close()
		if putErr != nil {
			return Asset{}, putErr
		}
		if closeErr != nil {
			return Asset{}, closeErr
		}
		rawVariants[variantName] = preparedVariantRecord{
			Key:       objectKey,
			MimeType:  variant.MimeType,
			Width:     intPtr(variant.Width),
			Height:    intPtr(variant.Height),
			SizeBytes: variant.SizeBytes,
		}
	}

	return s.insertPreparedAsset(ctx, input, backend, storageKey, mimeType, intPtr(width), intPtr(height), rawVariants, variants)
}

func (s *Service) insertPreparedAsset(
	ctx context.Context,
	input PrepareImportAssetInput,
	backend string,
	storageKey string,
	mimeType string,
	width *int,
	height *int,
	rawVariants map[string]preparedVariantRecord,
	returnVariants map[string]Variant,
) (Asset, error) {
	checksum := sha256.Sum256(input.Contents)
	variantsJSON, err := json.Marshal(rawVariants)
	if err != nil {
		return Asset{}, err
	}

	var id int64
	now := storage.NormalizeTime(time.Now())
	err = s.db.QueryRowContext(ctx, `
INSERT INTO media_assets (file_name, storage_key, mime_type, size_bytes, width, height, variants, checksum_sha256, created_at, storage_backend, lifecycle_state, media_kind)
VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, 'pending_import', $11)
RETURNING id
`,
		filepath.Base(input.FileName),
		storageKey,
		mimeType,
		len(input.Contents),
		width,
		height,
		string(variantsJSON),
		hex.EncodeToString(checksum[:]),
		now,
		backend,
		input.MediaKind,
	).Scan(&id)
	if err != nil {
		return Asset{}, err
	}

	asset := Asset{
		ID:             id,
		FileName:       filepath.Base(input.FileName),
		StorageKey:     storageKey,
		MimeType:       mimeType,
		Variants:       returnVariants,
		LifecycleState: "pending_import",
		MediaKind:      input.MediaKind,
	}
	if width != nil {
		asset.Width = *width
	}
	if height != nil {
		asset.Height = *height
	}
	return asset, nil
}

func (s *Service) storeForBackend(backend string) (BlobStore, error) {
	switch backend {
	case "", "local":
		if s.localStore == nil {
			return nil, fmt.Errorf("local blob store is not configured")
		}
		return s.localStore, nil
	case "minio":
		if s.minioStore == nil {
			return nil, fmt.Errorf("minio blob store is not configured")
		}
		return s.minioStore, nil
	default:
		return nil, ErrUploadInvalid
	}
}

func preparedObjectKey(mediaKind string, storageKey string, fileName string) string {
	return path.Join(mediaKind, storageKey, fileName)
}

func detectPreparedMimeType(fileName string, mediaKind string, contents []byte) string {
	switch strings.ToLower(filepath.Ext(fileName)) {
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".m4a":
		return "audio/mp4"
	case ".ogg":
		return "audio/ogg"
	case ".mp4":
		return "video/mp4"
	case ".mov":
		return "video/quicktime"
	case ".webm":
		if mediaKind == "audio" {
			return "audio/webm"
		}
		return "video/webm"
	}

	mimeType := http.DetectContentType(contents[:min(len(contents), 512)])
	if mimeType == "text/plain; charset=utf-8" || mimeType == "application/octet-stream" {
		if mediaKind == "audio" {
			return "audio/mpeg"
		}
		if mediaKind == "video" {
			return "video/mp4"
		}
	}
	return mimeType
}

func intPtr(value int) *int {
	return &value
}

type variantAsset struct {
	StorageKey     string
	MimeType       string
	StorageBackend string
	Variants       map[string]blobVariant
}

type blobVariant struct {
	Key      string `json:"key"`
	Path     string `json:"path"`
	MimeType string `json:"mime_type"`
}

func (s *Service) loadVariantAsset(ctx context.Context, mediaID int64) (variantAsset, error) {
	var (
		asset       variantAsset
		rawVariants []byte
	)
	err := s.db.QueryRowContext(ctx, `
SELECT storage_key, mime_type, storage_backend, variants
FROM media_assets
WHERE id = $1
  AND lifecycle_state = 'active'
`, mediaID).Scan(&asset.StorageKey, &asset.MimeType, &asset.StorageBackend, &rawVariants)
	if errors.Is(err, sql.ErrNoRows) {
		return variantAsset{}, ErrNotFound
	}
	if err != nil {
		return variantAsset{}, err
	}
	if err := json.Unmarshal(rawVariants, &asset.Variants); err != nil {
		return variantAsset{}, fmt.Errorf("decode blob variants: %w", err)
	}
	return asset, nil
}
