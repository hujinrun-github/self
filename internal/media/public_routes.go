package media

import (
	"errors"
	"io"
	"net/http"
	"os"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/minio/minio-go/v7"

	"portfolio/internal/httpserver"
)

func RegisterPublicRoutes(r chi.Router, service *Service) {
	r.Get("/media/{id}/{variant}", func(w http.ResponseWriter, req *http.Request) {
		mediaID, err := strconv.ParseInt(chi.URLParam(req, "id"), 10, 64)
		if err != nil || mediaID <= 0 {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Invalid media id", nil)
			return
		}

		stream, mimeType, err := service.OpenVariant(req.Context(), mediaID, chi.URLParam(req, "variant"))
		if err != nil {
			status := http.StatusInternalServerError
			code := "internal_error"
			message := "Could not load media"
			if isMediaNotFound(err) {
				status = http.StatusNotFound
				code = "not_found"
				message = "Media not found"
			}
			httpserver.WriteError(w, status, code, message, nil)
			return
		}
		defer stream.Close()

		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		w.Header().Set("Content-Type", mimeType)
		_, _ = io.Copy(w, stream)
	})
}

func isMediaNotFound(err error) bool {
	if errors.Is(err, ErrNotFound) || errors.Is(err, os.ErrNotExist) {
		return true
	}

	response := minio.ToErrorResponse(err)
	return response.StatusCode == http.StatusNotFound ||
		response.Code == "NoSuchKey" ||
		response.Code == "NoSuchBucket"
}
