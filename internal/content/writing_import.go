package content

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"portfolio/internal/media"
	"portfolio/internal/storage"
)

const writingImportPreviewTTL = 2 * time.Hour

var (
	ErrImportTraversal = errors.New("import media path escapes markdown root")
	ErrImportExpired   = errors.New("writing import preview expired")

	localMarkdownMediaRefRE = regexp.MustCompile(`(!?\[[^\]]*\])\(([^)\s]+)\)`)
)

type ImportMode string

const (
	ImportModeCreate    ImportMode = "create"
	ImportModeOverwrite ImportMode = "overwrite"
)

type PreviewRequest struct {
	AdminSessionID   int64
	Mode             ImportMode
	TargetWritingID  *int64
	ParseFrontMatter bool
	MarkdownFileName string
	MarkdownContents []byte
	MediaFiles       []UploadedImportFile
}

type CommitRequest struct {
	ImportToken string               `json:"import_token"`
	Mode        ImportMode           `json:"mode"`
	TargetID    *int64               `json:"target_id,omitempty"`
	Payload     PreviewParsedPayload `json:"payload"`
}

type UploadedImportFile struct {
	RelativePath string
	FileName     string
	Contents     []byte
}

type PreviewParsedPayload struct {
	Title          string   `json:"title"`
	Excerpt        string   `json:"excerpt"`
	Tags           []string `json:"tags"`
	Slug           string   `json:"slug"`
	CoverMediaID   *int64   `json:"cover_media_id,omitempty"`
	SEOTitle       string   `json:"seo_title"`
	SEODescription string   `json:"seo_description"`
	ContentMD      string   `json:"content_md"`
}

type PreviewMedia struct {
	OriginalPath         string `json:"original_path"`
	MediaAssetID         int64  `json:"media_asset_id"`
	MediaKind            string `json:"media_kind"`
	Status               string `json:"status"`
	ReplacementRef       string `json:"replacement_ref"`
	normalizedSourcePath string
	asset                media.Asset
}

type PreviewResult struct {
	ImportToken string               `json:"import_token"`
	Mode        ImportMode           `json:"mode"`
	Parsed      PreviewParsedPayload `json:"parsed"`
	MediaMap    MediaMap             `json:"media_map"`
	Media       []PreviewMedia       `json:"media"`
}

type WritingImportCommitResult struct {
	Writing Writing `json:"writing"`
}

type WritingImportService struct {
	repo  *Repository
	media *media.Service
	clock func() time.Time
}

type parsedFrontMatter struct {
	Title          string
	Excerpt        string
	Tags           []string
	Slug           string
	Cover          string
	SEOTitle       string
	SEODescription string
	UsedKeys       []string
	IgnoredKeys    []string
	Raw            map[string]any
}

type importSessionRecord struct {
	ID                int64
	Mode              ImportMode
	TargetWritingID   *int64
	TargetWritingETag string
	ParsedPayload     PreviewParsedPayload
	Status            string
	ExpiresAt         time.Time
}

var ErrImportConflict = errors.New("writing import target changed")

func NewWritingImportService(repo *Repository, mediaService *media.Service, clock func() time.Time) *WritingImportService {
	if clock == nil {
		clock = func() time.Time { return time.Now().UTC() }
	}
	return &WritingImportService{
		repo:  repo,
		media: mediaService,
		clock: clock,
	}
}

func (s *WritingImportService) PreparePreview(ctx context.Context, req PreviewRequest) (PreviewResult, error) {
	frontMatter, body, err := parseFrontMatter(req.MarkdownContents, req.ParseFrontMatter)
	if err != nil {
		return PreviewResult{}, err
	}

	uploadedFiles, err := buildUploadedImportFileIndex(req.MarkdownFileName, req.MediaFiles)
	if err != nil {
		return PreviewResult{}, err
	}
	rewritten, preparedByPath, err := s.rewriteMarkdownMedia(ctx, req.MarkdownFileName, body, uploadedFiles)
	if err != nil {
		return PreviewResult{}, err
	}

	if strings.TrimSpace(frontMatter.Cover) != "" {
		normalizedCover, err := normalizeImportPath(req.MarkdownFileName, frontMatter.Cover)
		if err != nil {
			return PreviewResult{}, err
		}
		if _, err := s.ensurePreparedMedia(ctx, req.MarkdownFileName, uploadedFiles, preparedByPath, frontMatter.Cover, normalizedCover); err != nil {
			return PreviewResult{}, err
		}
	}

	prepared := flattenPreparedMedia(preparedByPath)
	payload, err := buildPreviewPayload(frontMatter, rewritten, req.MarkdownFileName, uploadedFiles, preparedByPath)
	if err != nil {
		return PreviewResult{}, err
	}
	mediaMap := previewMediaMap(prepared)
	token, err := s.persistPreviewSession(ctx, req, frontMatter, rewritten, payload, prepared)
	if err != nil {
		return PreviewResult{}, err
	}

	return PreviewResult{
		ImportToken: token,
		Mode:        req.Mode,
		Parsed:      payload,
		MediaMap:    mediaMap,
		Media:       prepared,
	}, nil
}

func (s *WritingImportService) RestorePreview(ctx context.Context, token string) (PreviewResult, error) {
	session, err := s.loadActiveSession(ctx, token)
	if err != nil {
		return PreviewResult{}, err
	}
	mediaItems, mediaMap, err := s.loadSessionMedia(ctx, session.ID)
	if err != nil {
		return PreviewResult{}, err
	}
	return PreviewResult{
		ImportToken: token,
		Mode:        session.Mode,
		Parsed:      session.ParsedPayload,
		MediaMap:    mediaMap,
		Media:       mediaItems,
	}, nil
}

func (s *WritingImportService) Commit(ctx context.Context, req CommitRequest) (WritingImportCommitResult, error) {
	session, err := s.loadActiveSession(ctx, req.ImportToken)
	if err != nil {
		return WritingImportCommitResult{}, err
	}
	if session.Mode == ImportModeOverwrite {
		if err := s.ensureOverwriteTargetUnchanged(ctx, session); err != nil {
			return WritingImportCommitResult{}, err
		}
	}

	payload := req.Payload
	if payload.ContentMD == "" {
		payload = session.ParsedPayload
	}
	writing, err := s.saveWriting(ctx, session, payload)
	if err != nil {
		return WritingImportCommitResult{}, err
	}
	if err := s.activatePreparedAssets(ctx, session.ID); err != nil {
		return WritingImportCommitResult{}, err
	}
	if err := s.markSessionCommitted(ctx, session.ID); err != nil {
		return WritingImportCommitResult{}, err
	}
	writing.Media, err = s.repo.buildMediaMap(ctx, writing.ContentMD)
	if err != nil {
		return WritingImportCommitResult{}, err
	}
	return WritingImportCommitResult{Writing: writing}, nil
}

func (s *WritingImportService) CleanupExpiredSessions(ctx context.Context) error {
	_, err := s.repo.db.ExecContext(ctx, `
UPDATE writing_import_sessions
SET status = 'expired', updated_at = $1
WHERE status = 'preview_ready'
  AND expires_at <= $1
`, storage.NormalizeTime(s.clock()))
	return err
}

func (s *WritingImportService) rewriteMarkdownMedia(
	ctx context.Context,
	markdownFileName string,
	body string,
	uploadedFiles map[string]UploadedImportFile,
) (string, map[string]PreviewMedia, error) {
	preparedByPath := map[string]PreviewMedia{}
	var rewriteErr error

	rewritten := localMarkdownMediaRefRE.ReplaceAllStringFunc(body, func(match string) string {
		if rewriteErr != nil {
			return match
		}
		parts := localMarkdownMediaRefRE.FindStringSubmatch(match)
		if len(parts) != 3 {
			return match
		}
		originalRef := parts[2]
		if !isRelativeImportPath(originalRef) {
			return match
		}
		normalizedPath, err := normalizeImportPath(markdownFileName, originalRef)
		if err != nil {
			rewriteErr = err
			return match
		}
		prepared, err := s.ensurePreparedMedia(ctx, markdownFileName, uploadedFiles, preparedByPath, originalRef, normalizedPath)
		if err != nil {
			rewriteErr = err
			return match
		}
		return parts[1] + "(" + prepared.ReplacementRef + ")"
	})
	if rewriteErr != nil {
		return "", nil, rewriteErr
	}
	return rewritten, preparedByPath, nil
}

func (s *WritingImportService) ensurePreparedMedia(
	ctx context.Context,
	markdownFileName string,
	uploadedFiles map[string]UploadedImportFile,
	preparedByPath map[string]PreviewMedia,
	originalRef string,
	normalizedPath string,
) (PreviewMedia, error) {
	if prepared, ok := preparedByPath[normalizedPath]; ok {
		return prepared, nil
	}

	file, ok := uploadedFiles[normalizedPath]
	if !ok {
		return PreviewMedia{}, fmt.Errorf("missing import media file for %s", originalRef)
	}
	mediaKind := detectImportMediaKind(file.FileName)
	asset, err := s.media.PrepareImportAsset(ctx, media.PrepareImportAssetInput{
		FileName:       file.FileName,
		MediaKind:      mediaKind,
		Contents:       file.Contents,
		OriginalPath:   file.RelativePath,
		StorageBackend: "minio",
	})
	if err != nil {
		return PreviewMedia{}, err
	}

	replacementVariant := "original"
	if mediaKind == "image" {
		replacementVariant = "content"
	}
	prepared := PreviewMedia{
		OriginalPath:         file.RelativePath,
		MediaAssetID:         asset.ID,
		MediaKind:            mediaKind,
		Status:               "prepared",
		ReplacementRef:       fmt.Sprintf("media://asset/%d/%s", asset.ID, replacementVariant),
		normalizedSourcePath: normalizedPath,
		asset:                asset,
	}
	preparedByPath[normalizedPath] = prepared
	return prepared, nil
}

func buildUploadedImportFileIndex(markdownFileName string, files []UploadedImportFile) (map[string]UploadedImportFile, error) {
	index := make(map[string]UploadedImportFile, len(files))
	for _, file := range files {
		normalizedPath, err := normalizeImportPath(markdownFileName, file.RelativePath)
		if err != nil {
			return nil, err
		}
		index[normalizedPath] = file
	}
	return index, nil
}

func buildPreviewPayload(
	frontMatter parsedFrontMatter,
	rewritten string,
	markdownFileName string,
	uploadedFiles map[string]UploadedImportFile,
	preparedByPath map[string]PreviewMedia,
) (PreviewParsedPayload, error) {
	payload := PreviewParsedPayload{
		Title:          frontMatter.Title,
		Excerpt:        frontMatter.Excerpt,
		Tags:           frontMatter.Tags,
		Slug:           frontMatter.Slug,
		SEOTitle:       frontMatter.SEOTitle,
		SEODescription: frontMatter.SEODescription,
		ContentMD:      rewritten,
	}
	if payload.Slug == "" && payload.Title != "" {
		slug, err := Slugify(payload.Title)
		if err != nil {
			return PreviewParsedPayload{}, err
		}
		payload.Slug = slug
	}

	if strings.TrimSpace(frontMatter.Cover) != "" {
		normalizedCover, err := normalizeImportPath(markdownFileName, frontMatter.Cover)
		if err != nil {
			return PreviewParsedPayload{}, err
		}
		if _, ok := uploadedFiles[normalizedCover]; ok {
			if prepared, ok := preparedByPath[normalizedCover]; ok && prepared.MediaKind == "image" {
				payload.CoverMediaID = &prepared.MediaAssetID
			}
		}
	}
	return payload, nil
}

func (s *WritingImportService) persistPreviewSession(
	ctx context.Context,
	req PreviewRequest,
	frontMatter parsedFrontMatter,
	rewritten string,
	payload PreviewParsedPayload,
	prepared []PreviewMedia,
) (string, error) {
	token, err := randomImportToken(32)
	if err != nil {
		return "", err
	}
	tokenHash := hashImportToken(token)
	frontMatterJSON, err := json.Marshal(frontMatter.Raw)
	if err != nil {
		return "", err
	}
	ignoredJSON, err := json.Marshal(frontMatter.IgnoredKeys)
	if err != nil {
		return "", err
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	checksum := sha256.Sum256(req.MarkdownContents)
	now := storage.NormalizeTime(s.clock())
	expiresAt := storage.NormalizeTime(now.Add(writingImportPreviewTTL))
	var targetETag *string
	if req.Mode == ImportModeOverwrite && req.TargetWritingID != nil {
		etag, err := s.currentWritingETag(ctx, *req.TargetWritingID)
		if err != nil {
			return "", err
		}
		targetETag = &etag
	}

	tx, err := s.repo.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	var sessionID int64
	err = tx.QueryRowContext(ctx, `
INSERT INTO writing_import_sessions (
	token_hash,
	admin_session_id,
	mode,
	target_writing_id,
	target_writing_etag,
	source_file_name,
	source_checksum_sha256,
	front_matter,
	ignored_front_matter_keys,
	original_markdown,
	rewritten_markdown,
	parsed_payload,
	status,
	expires_at,
	created_at,
	updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12::jsonb, 'preview_ready', $13, $14, $15)
RETURNING id
`,
		tokenHash,
		req.AdminSessionID,
		string(req.Mode),
		req.TargetWritingID,
		targetETag,
		filepath.Base(req.MarkdownFileName),
		hex.EncodeToString(checksum[:]),
		string(frontMatterJSON),
		string(ignoredJSON),
		string(req.MarkdownContents),
		rewritten,
		string(payloadJSON),
		expiresAt,
		now,
		now,
	).Scan(&sessionID)
	if err != nil {
		return "", err
	}

	for _, preparedMedia := range prepared {
		if _, err := tx.ExecContext(ctx, `
INSERT INTO writing_import_session_assets (
	session_id,
	media_asset_id,
	original_relative_path,
	normalized_source_path,
	replacement_ref,
	status,
	created_at
)
VALUES ($1, $2, $3, $4, $5, 'prepared', $6)
`,
			sessionID,
			preparedMedia.MediaAssetID,
			preparedMedia.OriginalPath,
			preparedMedia.normalizedSourcePath,
			preparedMedia.ReplacementRef,
			now,
		); err != nil {
			return "", err
		}
	}

	if err := tx.Commit(); err != nil {
		return "", err
	}
	committed = true
	return token, nil
}

func previewMediaMap(prepared []PreviewMedia) MediaMap {
	result := MediaMap{}
	for _, preparedMedia := range prepared {
		key := fmt.Sprintf("%d", preparedMedia.MediaAssetID)
		if _, ok := result[key]; !ok {
			result[key] = map[string]MediaVariant{}
		}
		for variantName, variant := range preparedMedia.asset.Variants {
			result[key][variantName] = MediaVariant{
				URL:      fmt.Sprintf("/media/%d/%s", preparedMedia.MediaAssetID, variantName),
				Width:    optionalPositiveInt(variant.Width),
				Height:   optionalPositiveInt(variant.Height),
				MimeType: variant.MimeType,
			}
		}
	}
	return result
}

func parseFrontMatter(contents []byte, enabled bool) (parsedFrontMatter, string, error) {
	text := strings.ReplaceAll(string(contents), "\r\n", "\n")
	if !enabled || !strings.HasPrefix(text, "---\n") {
		return parsedFrontMatter{Raw: map[string]any{}}, text, nil
	}

	rest := strings.TrimPrefix(text, "---\n")
	end := strings.Index(rest, "\n---\n")
	if end < 0 {
		return parsedFrontMatter{Raw: map[string]any{}}, text, nil
	}

	frontMatterText := rest[:end]
	body := rest[end+5:]
	parsed := parsedFrontMatter{Raw: map[string]any{}}
	currentListKey := ""

	for _, line := range strings.Split(frontMatterText, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, "- ") && currentListKey == "tags" {
			tag := strings.TrimSpace(strings.TrimPrefix(trimmed, "- "))
			if tag != "" {
				parsed.Tags = append(parsed.Tags, trimQuotes(tag))
			}
			continue
		}

		parts := strings.SplitN(trimmed, ":", 2)
		if len(parts) != 2 {
			currentListKey = ""
			continue
		}
		key := strings.TrimSpace(parts[0])
		value := trimQuotes(strings.TrimSpace(parts[1]))
		currentListKey = ""

		switch key {
		case "title":
			parsed.Title = value
			parsed.Raw[key] = value
			parsed.UsedKeys = appendUniqueString(parsed.UsedKeys, key)
		case "excerpt":
			parsed.Excerpt = value
			parsed.Raw[key] = value
			parsed.UsedKeys = appendUniqueString(parsed.UsedKeys, key)
		case "tags":
			parsed.UsedKeys = appendUniqueString(parsed.UsedKeys, key)
			if value != "" {
				for _, tag := range strings.Split(value, ",") {
					tag = trimQuotes(strings.TrimSpace(tag))
					if tag != "" {
						parsed.Tags = append(parsed.Tags, tag)
					}
				}
				parsed.Raw[key] = parsed.Tags
			} else {
				currentListKey = "tags"
				parsed.Raw[key] = []string{}
			}
		case "slug":
			parsed.Slug = value
			parsed.Raw[key] = value
			parsed.UsedKeys = appendUniqueString(parsed.UsedKeys, key)
		case "cover":
			parsed.Cover = value
			parsed.Raw[key] = value
			parsed.UsedKeys = appendUniqueString(parsed.UsedKeys, key)
		case "seo_title":
			parsed.SEOTitle = value
			parsed.Raw[key] = value
			parsed.UsedKeys = appendUniqueString(parsed.UsedKeys, key)
		case "seo_description":
			parsed.SEODescription = value
			parsed.Raw[key] = value
			parsed.UsedKeys = appendUniqueString(parsed.UsedKeys, key)
		default:
			parsed.IgnoredKeys = appendUniqueString(parsed.IgnoredKeys, key)
		}
	}

	return parsed, body, nil
}

func normalizeImportPath(markdownFileName string, relativePath string) (string, error) {
	normalized := strings.ReplaceAll(strings.TrimSpace(relativePath), "\\", "/")
	if normalized == "" {
		return "", fmt.Errorf("import media path is required")
	}
	bundleDir := strings.ReplaceAll(path.Dir(strings.ReplaceAll(strings.TrimSpace(markdownFileName), "\\", "/")), "\\", "/")
	root := "/bundle"
	if bundleDir != "." && bundleDir != "/" {
		root = path.Join(root, bundleDir)
	}
	resolved := path.Clean(path.Join(root, normalized))
	if resolved != root && !strings.HasPrefix(resolved, root+"/") {
		return "", ErrImportTraversal
	}
	return resolved, nil
}

func isRelativeImportPath(value string) bool {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return false
	}
	lower := strings.ToLower(trimmed)
	if strings.HasPrefix(lower, "http://") ||
		strings.HasPrefix(lower, "https://") ||
		strings.HasPrefix(lower, "mailto:") ||
		strings.HasPrefix(lower, "media://") ||
		strings.HasPrefix(trimmed, "/") {
		return false
	}
	if len(trimmed) >= 3 && (trimmed[1] == ':' && (trimmed[2] == '/' || trimmed[2] == '\\')) {
		return false
	}
	return true
}

func detectImportMediaKind(fileName string) string {
	switch strings.ToLower(filepath.Ext(fileName)) {
	case ".png", ".jpg", ".jpeg", ".webp":
		return "image"
	case ".mp3", ".wav", ".m4a", ".ogg":
		return "audio"
	default:
		return "video"
	}
}

func randomImportToken(byteCount int) (string, error) {
	buf := make([]byte, byteCount)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func hashImportToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func hashToken(raw string) string {
	return hashImportToken(raw)
}

func (s *WritingImportService) loadActiveSession(ctx context.Context, token string) (importSessionRecord, error) {
	var (
		session    importSessionRecord
		rawPayload []byte
		targetID   sql.NullInt64
		targetETag sql.NullString
		expiresAt  time.Time
	)
	err := s.repo.db.QueryRowContext(ctx, `
SELECT id, mode, target_writing_id, target_writing_etag, parsed_payload, status, expires_at
FROM writing_import_sessions
WHERE token_hash = $1
`, hashImportToken(token)).Scan(&session.ID, &session.Mode, &targetID, &targetETag, &rawPayload, &session.Status, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return importSessionRecord{}, ErrNotFound
	}
	if err != nil {
		return importSessionRecord{}, err
	}
	if err := json.Unmarshal(rawPayload, &session.ParsedPayload); err != nil {
		return importSessionRecord{}, err
	}
	if targetID.Valid {
		value := targetID.Int64
		session.TargetWritingID = &value
	}
	if targetETag.Valid {
		session.TargetWritingETag = targetETag.String
	}
	session.ExpiresAt = storage.NormalizeTime(expiresAt)
	now := storage.NormalizeTime(s.clock())
	if session.Status == "expired" || !now.Before(session.ExpiresAt) {
		return importSessionRecord{}, ErrImportExpired
	}
	if session.Status != "preview_ready" {
		return importSessionRecord{}, ErrNotFound
	}
	return session, nil
}

func (s *WritingImportService) currentWritingETag(ctx context.Context, writingID int64) (string, error) {
	var updatedAt time.Time
	err := s.repo.db.QueryRowContext(ctx, `SELECT updated_at FROM writings WHERE id = $1`, writingID).Scan(&updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return fmt.Sprintf(`"%s"`, storage.NormalizeTime(updatedAt).Format(time.RFC3339Nano)), nil
}

func (s *WritingImportService) ensureOverwriteTargetUnchanged(ctx context.Context, session importSessionRecord) error {
	if session.TargetWritingID == nil {
		return ErrImportConflict
	}
	currentETag, err := s.currentWritingETag(ctx, *session.TargetWritingID)
	if err != nil {
		return err
	}
	if currentETag != session.TargetWritingETag {
		return ErrImportConflict
	}
	return nil
}

func (s *WritingImportService) saveWriting(ctx context.Context, session importSessionRecord, payload PreviewParsedPayload) (Writing, error) {
	input := WritingInput{
		Title:          payload.Title,
		Slug:           payload.Slug,
		Excerpt:        payload.Excerpt,
		ContentMD:      payload.ContentMD,
		CoverMediaID:   payload.CoverMediaID,
		SEOTitle:       payload.SEOTitle,
		SEODescription: payload.SEODescription,
		Tags:           payload.Tags,
	}
	if session.Mode == ImportModeOverwrite && session.TargetWritingID != nil {
		return s.repo.UpdateWriting(ctx, *session.TargetWritingID, input)
	}
	return s.repo.CreateWriting(ctx, input)
}

func (s *WritingImportService) activatePreparedAssets(ctx context.Context, sessionID int64) error {
	_, err := s.repo.db.ExecContext(ctx, `
UPDATE media_assets
SET lifecycle_state = 'active'
WHERE id IN (
	SELECT media_asset_id
	FROM writing_import_session_assets
	WHERE session_id = $1
)
`, sessionID)
	if err != nil {
		return err
	}
	_, err = s.repo.db.ExecContext(ctx, `
UPDATE writing_import_session_assets
SET status = 'activated'
WHERE session_id = $1
`, sessionID)
	return err
}

func (s *WritingImportService) markSessionCommitted(ctx context.Context, sessionID int64) error {
	_, err := s.repo.db.ExecContext(ctx, `
UPDATE writing_import_sessions
SET status = 'committed', updated_at = $2
WHERE id = $1
`, sessionID, storage.NormalizeTime(s.clock()))
	return err
}

func (s *WritingImportService) loadSessionMedia(ctx context.Context, sessionID int64) ([]PreviewMedia, MediaMap, error) {
	rows, err := s.repo.db.QueryContext(ctx, `
SELECT
	a.original_relative_path,
	a.normalized_source_path,
	a.replacement_ref,
	a.status,
	m.id,
	m.file_name,
	m.storage_key,
	m.mime_type,
	m.width,
	m.height,
	m.variants,
	m.media_kind
FROM writing_import_session_assets a
JOIN media_assets m ON m.id = a.media_asset_id
WHERE a.session_id = $1
ORDER BY a.id
`, sessionID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	items := []PreviewMedia{}
	for rows.Next() {
		var (
			item        PreviewMedia
			asset       media.Asset
			width       sql.NullInt64
			height      sql.NullInt64
			rawVariants []byte
		)
		if err := rows.Scan(
			&item.OriginalPath,
			&item.normalizedSourcePath,
			&item.ReplacementRef,
			&item.Status,
			&asset.ID,
			&asset.FileName,
			&asset.StorageKey,
			&asset.MimeType,
			&width,
			&height,
			&rawVariants,
			&asset.MediaKind,
		); err != nil {
			return nil, nil, err
		}
		if width.Valid {
			asset.Width = int(width.Int64)
		}
		if height.Valid {
			asset.Height = int(height.Int64)
		}
		if err := json.Unmarshal(rawVariants, &asset.Variants); err != nil {
			return nil, nil, err
		}
		item.MediaAssetID = asset.ID
		item.MediaKind = asset.MediaKind
		item.asset = asset
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	return items, previewMediaMap(items), nil
}

func optionalPositiveInt(value int) *int {
	if value <= 0 {
		return nil
	}
	return &value
}

func appendUniqueString(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func trimQuotes(value string) string {
	return strings.Trim(value, `"'`)
}

func flattenPreparedMedia(preparedByPath map[string]PreviewMedia) []PreviewMedia {
	if len(preparedByPath) == 0 {
		return nil
	}

	paths := make([]string, 0, len(preparedByPath))
	for normalizedPath := range preparedByPath {
		paths = append(paths, normalizedPath)
	}
	sort.Strings(paths)

	flattened := make([]PreviewMedia, 0, len(paths))
	for _, normalizedPath := range paths {
		flattened = append(flattened, preparedByPath[normalizedPath])
	}
	return flattened
}
