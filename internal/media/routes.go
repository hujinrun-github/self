package media

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"portfolio/internal/httpserver"
)

func RegisterAdminRoutes(r chi.Router, service *Service) {
	r.Get("/api/admin/media", func(w http.ResponseWriter, req *http.Request) {
		page, _ := strconv.Atoi(req.URL.Query().Get("page"))
		limit, _ := strconv.Atoi(req.URL.Query().Get("limit"))
		items, err := service.List(req.Context(), page, limit, req.URL.Query().Get("q"))
		if err != nil {
			httpserver.WriteError(w, http.StatusInternalServerError, "internal_error", "Could not list media", nil)
			return
		}
		httpserver.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
	})
	r.Post("/api/admin/media", func(w http.ResponseWriter, req *http.Request) {
		if err := req.ParseMultipartForm(maxUploadBytes); err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "upload_error", "Invalid upload", nil)
			return
		}
		file, header, err := req.FormFile("file")
		if err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "upload_error", "Missing upload file", nil)
			return
		}
		defer file.Close()
		asset, err := service.Upload(req.Context(), header.Filename, file)
		if err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "upload_error", err.Error(), nil)
			return
		}
		httpserver.WriteJSON(w, http.StatusCreated, asset)
	})
	r.Delete("/api/admin/media/{id}", func(w http.ResponseWriter, req *http.Request) {
		id, err := strconv.ParseInt(chi.URLParam(req, "id"), 10, 64)
		if err != nil || id <= 0 {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Invalid media id", nil)
			return
		}
		if err := service.Delete(req.Context(), id); err != nil {
			status := http.StatusInternalServerError
			code := "internal_error"
			if errors.Is(err, ErrReferenced) {
				status = http.StatusConflict
				code = "conflict"
			}
			httpserver.WriteError(w, status, code, err.Error(), nil)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
