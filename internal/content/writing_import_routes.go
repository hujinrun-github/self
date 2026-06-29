package content

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"portfolio/internal/auth"
	"portfolio/internal/httpserver"
	"portfolio/internal/media"
)

const writingImportMultipartLimit = 20 * 1024 * 1024

func RegisterWritingImportRoutes(r chi.Router, service *WritingImportService) {
	r.Post("/api/admin/writing/imports/preview", service.previewHandler())
	r.Get("/api/admin/writing/imports/preview/{token}", service.restoreHandler())
	r.Post("/api/admin/writing/imports/commit", service.commitHandler())
}

func (s *WritingImportService) previewHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		if err := req.ParseMultipartForm(writingImportMultipartLimit); err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Invalid multipart payload", nil)
			return
		}

		markdownFile, markdownHeader, err := req.FormFile("markdown_file")
		if err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "markdown_file is required", nil)
			return
		}
		defer markdownFile.Close()

		markdownContents, err := io.ReadAll(markdownFile)
		if err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Could not read markdown file", nil)
			return
		}

		mediaFiles, err := readUploadedImportFiles(req)
		if err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Could not read media files", nil)
			return
		}

		mode := ImportMode(strings.TrimSpace(req.FormValue("mode")))
		if mode == "" {
			mode = ImportModeCreate
		}
		parseFrontMatter := true
		if raw := strings.TrimSpace(req.FormValue("parse_front_matter")); raw != "" {
			parseFrontMatter = !strings.EqualFold(raw, "false") && raw != "0"
		}

		var targetWritingID *int64
		if rawTarget := strings.TrimSpace(req.FormValue("target_id")); rawTarget != "" {
			targetID, err := strconv.ParseInt(rawTarget, 10, 64)
			if err != nil || targetID <= 0 {
				httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Invalid target_id", nil)
				return
			}
			targetWritingID = &targetID
		}

		session, _ := auth.SessionFromContext(req.Context())
		result, err := s.PreparePreview(req.Context(), PreviewRequest{
			AdminSessionID:   session.ID,
			Mode:             mode,
			TargetWritingID:  targetWritingID,
			ParseFrontMatter: parseFrontMatter,
			MarkdownFileName: markdownHeader.Filename,
			MarkdownContents: markdownContents,
			MediaFiles:       mediaFiles,
		})
		if err != nil {
			writeWritingImportError(w, err)
			return
		}
		httpserver.WriteJSON(w, http.StatusOK, result)
	}
}

func (s *WritingImportService) restoreHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		result, err := s.RestorePreview(req.Context(), chi.URLParam(req, "token"))
		if err != nil {
			writeWritingImportError(w, err)
			return
		}
		httpserver.WriteJSON(w, http.StatusOK, result)
	}
}

func (s *WritingImportService) commitHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		var input CommitRequest
		if err := json.NewDecoder(req.Body).Decode(&input); err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Invalid request payload", nil)
			return
		}
		result, err := s.Commit(req.Context(), input)
		if err != nil {
			writeWritingImportError(w, err)
			return
		}
		httpserver.WriteJSON(w, http.StatusOK, result)
	}
}

func readUploadedImportFiles(req *http.Request) ([]UploadedImportFile, error) {
	form := req.MultipartForm
	if form == nil {
		return nil, nil
	}
	headers := form.File["media_files[]"]
	paths := form.Value["media_paths[]"]
	files := make([]UploadedImportFile, 0, len(headers))
	for idx, header := range headers {
		file, err := header.Open()
		if err != nil {
			return nil, err
		}
		contents, readErr := io.ReadAll(file)
		closeErr := file.Close()
		if readErr != nil {
			return nil, readErr
		}
		if closeErr != nil {
			return nil, closeErr
		}
		relativePath := header.Filename
		if idx < len(paths) && strings.TrimSpace(paths[idx]) != "" {
			relativePath = paths[idx]
		}
		files = append(files, UploadedImportFile{
			RelativePath: relativePath,
			FileName:     header.Filename,
			Contents:     contents,
		})
	}
	return files, nil
}

func writeWritingImportError(w http.ResponseWriter, err error) {
	switch {
	case err == nil:
		return
	case errors.Is(err, ErrNotFound):
		httpserver.WriteError(w, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrImportTraversal), errors.Is(err, media.ErrUploadInvalid):
		httpserver.WriteError(w, http.StatusBadRequest, "validation_error", err.Error(), nil)
	case errors.Is(err, ErrImmutableSlug), errors.Is(err, ErrDeleteBlocked), errors.Is(err, ErrSlugConflict), errors.Is(err, ErrImportConflict):
		httpserver.WriteError(w, http.StatusConflict, "conflict", err.Error(), nil)
	default:
		httpserver.WriteError(w, http.StatusInternalServerError, "internal_error", "Writing import failed", nil)
	}
}
