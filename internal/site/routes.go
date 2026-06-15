package site

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"portfolio/internal/httpserver"
)

func RegisterRoutes(r chi.Router, repo *HomeRepository) {
	r.Get("/api/site/home", func(w http.ResponseWriter, req *http.Request) {
		home, err := repo.GetHome(req.Context())
		if err != nil {
			httpserver.WriteError(w, http.StatusInternalServerError, "internal_error", "Could not load home", nil)
			return
		}
		httpserver.WriteJSON(w, http.StatusOK, home)
	})
}
