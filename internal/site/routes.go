package site

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"portfolio/internal/httpserver"
	"portfolio/internal/i18n"
)

func RegisterRoutes(r chi.Router, repo *HomeRepository) {
	r.Get("/api/site/home", func(w http.ResponseWriter, req *http.Request) {
		locale := i18n.CoerceLocale(req.URL.Query().Get("locale"))
		home, err := repo.GetHomeByLocale(req.Context(), locale)
		if err != nil {
			httpserver.WriteError(w, http.StatusInternalServerError, "internal_error", "Could not load home", nil)
			return
		}
		httpserver.WriteJSON(w, http.StatusOK, home)
	})
}
