package content

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/png"
	"io"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"portfolio/internal/media"
)

func TestPreparePreviewParsesFrontMatterAndRewritesLocalMedia(t *testing.T) {
	repo := newContentRepo(t)
	mediaService := newPreparedImportMediaService(t, repo)
	service := NewWritingImportService(repo, mediaService, func() time.Time {
		return time.Date(2026, 6, 29, 8, 0, 0, 0, time.UTC)
	})

	result, err := service.PreparePreview(t.Context(), PreviewRequest{
		AdminSessionID:   11,
		Mode:             ImportModeCreate,
		ParseFrontMatter: true,
		MarkdownFileName: "article.md",
		MarkdownContents: []byte(`---
title: Imported title
tags: AI, Notes
cover: ./images/cover.png
---
![cover](./images/cover.png)
`),
		MediaFiles: []UploadedImportFile{
			{RelativePath: "./images/cover.png", FileName: "cover.png", Contents: testPNG(t, 1280, 720)},
		},
	})
	if err != nil {
		t.Fatalf("PreparePreview: %v", err)
	}
	if result.Parsed.Title != "Imported title" {
		t.Fatalf("title = %q", result.Parsed.Title)
	}
	if len(result.Parsed.Tags) != 2 || result.Parsed.Tags[0] != "AI" || result.Parsed.Tags[1] != "Notes" {
		t.Fatalf("tags = %#v", result.Parsed.Tags)
	}
	if !strings.Contains(result.Parsed.ContentMD, "media://asset/") {
		t.Fatalf("content_md not rewritten: %q", result.Parsed.ContentMD)
	}
	if result.Parsed.CoverMediaID == nil {
		t.Fatal("expected cover_media_id to be set")
	}
	if result.ImportToken == "" {
		t.Fatal("expected import token")
	}

	var (
		sourceFileName string
		status         string
	)
	if err := repo.db.QueryRowContext(
		t.Context(),
		`SELECT source_file_name, status FROM writing_import_sessions WHERE token_hash = $1`,
		hashImportToken(result.ImportToken),
	).Scan(&sourceFileName, &status); err != nil {
		t.Fatalf("load preview session: %v", err)
	}
	if sourceFileName != "article.md" || status != "preview_ready" {
		t.Fatalf("session = file:%q status:%q", sourceFileName, status)
	}
}

func TestPreparePreviewRejectsTraversalOutsideMarkdownRoot(t *testing.T) {
	repo := newContentRepo(t)
	mediaService := newPreparedImportMediaService(t, repo)
	service := NewWritingImportService(repo, mediaService, func() time.Time {
		return time.Date(2026, 6, 29, 8, 0, 0, 0, time.UTC)
	})

	_, err := service.PreparePreview(t.Context(), PreviewRequest{
		AdminSessionID:   11,
		Mode:             ImportModeCreate,
		MarkdownFileName: "article.md",
		MarkdownContents: []byte(`![bad](../secret/cover.png)`),
	})
	if !errors.Is(err, ErrImportTraversal) {
		t.Fatalf("PreparePreview err = %v, want %v", err, ErrImportTraversal)
	}
}

type stubImportBlobStore struct{}

func (stubImportBlobStore) Put(context.Context, string, io.Reader, string) error { return nil }
func (stubImportBlobStore) Open(context.Context, string) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader("")), nil
}
func (stubImportBlobStore) Delete(context.Context, string) error { return nil }

func newPreparedImportMediaService(t *testing.T, repo *Repository) *media.Service {
	t.Helper()

	root := t.TempDir()
	uploadsDir := filepath.Join(root, "uploads")
	return media.NewService(
		repo.db,
		uploadsDir,
		filepath.Join(root, "private_uploads"),
		media.NewLocalBlobStore(uploadsDir),
		stubImportBlobStore{},
	)
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
