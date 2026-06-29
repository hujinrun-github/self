package content

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"portfolio/internal/httpserver"
	"portfolio/internal/i18n"
)

func RegisterAdminRoutes(r chi.Router, repo *Repository, generators ...ContentTranslationGenerator) {
	var generator ContentTranslationGenerator
	if len(generators) > 0 {
		generator = generators[0]
	}
	r.Get("/api/admin/projects", listHandler(repo.ListProjects))
	r.Post("/api/admin/projects", createHandler(repo.CreateProject))
	r.Get("/api/admin/projects/{id}", getHandler(repo.GetProjectAdmin))
	r.Put("/api/admin/projects/{id}", updateProjectHandler(repo))
	r.Put("/api/admin/projects/{id}/translations/{locale}", saveProjectTranslationHandler(repo))
	if generator != nil {
		r.Post("/api/admin/projects/{id}/translations/{locale}/generate", generateProjectTranslationHandler(repo, generator))
	}
	r.Post("/api/admin/projects/{id}/translations/{locale}/review", reviewProjectTranslationHandler(repo))
	r.Delete("/api/admin/projects/{id}", deleteProjectHandler(repo))
	r.Patch("/api/admin/projects/{id}/status", statusHandler(repo.SetProjectStatus))
	r.Patch("/api/admin/projects/reorder", reorderHandler(repo.ReorderProjects))

	r.Get("/api/admin/writing", listHandler(repo.ListWriting))
	r.Post("/api/admin/writing", createHandler(repo.CreateWriting))
	r.Get("/api/admin/writing/{id}", getHandler(repo.GetWritingAdmin))
	r.Put("/api/admin/writing/{id}", updateWritingHandler(repo))
	r.Put("/api/admin/writing/{id}/translations/{locale}", saveWritingTranslationHandler(repo))
	if generator != nil {
		r.Post("/api/admin/writing/{id}/translations/{locale}/generate", generateWritingTranslationHandler(repo, generator))
	}
	r.Post("/api/admin/writing/{id}/translations/{locale}/review", reviewWritingTranslationHandler(repo))
	r.Patch("/api/admin/writing/{id}/status", statusHandler(repo.SetWritingStatus))
	r.Patch("/api/admin/writing/reorder", reorderHandler(repo.ReorderWritings))

	r.Get("/api/admin/talks", listHandler(repo.ListTalks))
	r.Post("/api/admin/talks", createHandler(repo.CreateTalk))
	r.Get("/api/admin/talks/{id}", getHandler(repo.GetTalkAdmin))
	r.Put("/api/admin/talks/{id}", updateTalkHandler(repo))
	r.Put("/api/admin/talks/{id}/translations/{locale}", saveTalkTranslationHandler(repo))
	if generator != nil {
		r.Post("/api/admin/talks/{id}/translations/{locale}/generate", generateTalkTranslationHandler(repo, generator))
	}
	r.Post("/api/admin/talks/{id}/translations/{locale}/review", reviewTalkTranslationHandler(repo))
	r.Patch("/api/admin/talks/{id}/status", statusHandler(repo.SetTalkStatus))
	r.Patch("/api/admin/talks/reorder", reorderHandler(repo.ReorderTalks))

	r.Get("/api/admin/experience", listHandler(repo.ListExperiences))
	r.Post("/api/admin/experience", createHandler(repo.CreateExperience))
	r.Get("/api/admin/experience/{id}", getHandler(repo.GetExperienceAdmin))
	r.Put("/api/admin/experience/{id}", updateExperienceHandler(repo))
	r.Put("/api/admin/experience/{id}/translations/{locale}", saveExperienceTranslationHandler(repo))
	if generator != nil {
		r.Post("/api/admin/experience/{id}/translations/{locale}/generate", generateExperienceTranslationHandler(repo, generator))
	}
	r.Post("/api/admin/experience/{id}/translations/{locale}/review", reviewExperienceTranslationHandler(repo))
	r.Patch("/api/admin/experience/{id}/status", statusHandler(repo.SetExperienceStatus))
	r.Patch("/api/admin/experience/reorder", reorderHandler(repo.ReorderExperiences))
}

func listHandler[O any](fn func(ctx context.Context, limit int) ([]O, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		items, err := fn(req.Context(), limitFromRequest(req))
		writeResult(w, items, err)
	}
}

func getHandler[O any](fn func(ctx context.Context, id int64) (O, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		id, ok := idParam(w, req)
		if !ok {
			return
		}
		item, err := fn(req.Context(), id)
		writeResult(w, item, err)
	}
}

func RegisterSiteRoutes(r chi.Router, repo *Repository) {
	r.Get("/api/site/projects", func(w http.ResponseWriter, req *http.Request) {
		locale := i18n.CoerceLocale(req.URL.Query().Get("locale"))
		items, meta, err := repo.PublicProjectsByLocale(req.Context(), locale, limitFromRequest(req))
		writeResult(w, LocalizedListResponse[Project]{LocaleMeta: meta, Items: items}, err)
	})
	r.Get("/api/site/projects/{slug}", func(w http.ResponseWriter, req *http.Request) {
		locale := i18n.CoerceLocale(req.URL.Query().Get("locale"))
		item, meta, alternates, err := repo.PublicProjectByLocaleSlug(req.Context(), locale, chi.URLParam(req, "slug"))
		writeResult(w, LocalizedDetailResponse[Project]{LocaleMeta: meta, Item: item, Alternates: alternates}, err)
	})
	r.Get("/api/site/writing", func(w http.ResponseWriter, req *http.Request) {
		locale := i18n.CoerceLocale(req.URL.Query().Get("locale"))
		items, meta, err := repo.PublicWritingByLocale(req.Context(), locale, limitFromRequest(req))
		writeResult(w, LocalizedListResponse[Writing]{LocaleMeta: meta, Items: items}, err)
	})
	r.Get("/api/site/writing/{slug}", func(w http.ResponseWriter, req *http.Request) {
		locale := i18n.CoerceLocale(req.URL.Query().Get("locale"))
		item, meta, alternates, err := repo.PublicWritingByLocaleSlug(req.Context(), locale, chi.URLParam(req, "slug"))
		writeResult(w, LocalizedDetailResponse[Writing]{LocaleMeta: meta, Item: item, Alternates: alternates}, err)
	})
	r.Get("/api/site/talks", func(w http.ResponseWriter, req *http.Request) {
		locale := i18n.CoerceLocale(req.URL.Query().Get("locale"))
		items, meta, err := repo.PublicTalksByLocale(req.Context(), locale, limitFromRequest(req))
		writeResult(w, LocalizedListResponse[Talk]{LocaleMeta: meta, Items: items}, err)
	})
	r.Get("/api/site/talks/{slug}", func(w http.ResponseWriter, req *http.Request) {
		locale := i18n.CoerceLocale(req.URL.Query().Get("locale"))
		item, meta, alternates, err := repo.PublicTalkByLocaleSlug(req.Context(), locale, chi.URLParam(req, "slug"))
		writeResult(w, LocalizedDetailResponse[Talk]{LocaleMeta: meta, Item: item, Alternates: alternates}, err)
	})
}

func createHandler[I any, O any](fn func(ctx context.Context, input I) (O, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		var input I
		if err := json.NewDecoder(req.Body).Decode(&input); err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Invalid request payload", nil)
			return
		}
		output, err := fn(req.Context(), input)
		writeCreated(w, output, err)
	}
}

func updateProjectHandler(repo *Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		id, ok := idParam(w, req)
		if !ok {
			return
		}
		var input ProjectInput
		if err := json.NewDecoder(req.Body).Decode(&input); err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Invalid request payload", nil)
			return
		}
		project, err := repo.UpdateProject(req.Context(), id, input)
		writeResult(w, project, err)
	}
}

func updateWritingHandler(repo *Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		id, ok := idParam(w, req)
		if !ok {
			return
		}
		var input WritingInput
		if err := json.NewDecoder(req.Body).Decode(&input); err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Invalid request payload", nil)
			return
		}
		writing, err := repo.UpdateWriting(req.Context(), id, input)
		writeResult(w, writing, err)
	}
}

func updateTalkHandler(repo *Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		id, ok := idParam(w, req)
		if !ok {
			return
		}
		var input TalkInput
		if err := json.NewDecoder(req.Body).Decode(&input); err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Invalid request payload", nil)
			return
		}
		talk, err := repo.UpdateTalk(req.Context(), id, input)
		writeResult(w, talk, err)
	}
}

func updateExperienceHandler(repo *Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		id, ok := idParam(w, req)
		if !ok {
			return
		}
		var input ExperienceInput
		if err := json.NewDecoder(req.Body).Decode(&input); err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Invalid request payload", nil)
			return
		}
		experience, err := repo.UpdateExperience(req.Context(), id, input)
		writeResult(w, experience, err)
	}
}

func deleteProjectHandler(repo *Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		id, ok := idParam(w, req)
		if !ok {
			return
		}
		err := repo.DeleteProject(req.Context(), id)
		if err == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		writeError(w, err)
	}
}

func statusHandler(fn func(ctx context.Context, id int64, status Status, publishedAt *time.Time) error) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		id, ok := idParam(w, req)
		if !ok {
			return
		}
		var input struct {
			Status      Status     `json:"status"`
			PublishedAt *time.Time `json:"published_at"`
		}
		if err := json.NewDecoder(req.Body).Decode(&input); err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Invalid request payload", nil)
			return
		}
		err := fn(req.Context(), id, input.Status, input.PublishedAt)
		if err == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		writeError(w, err)
	}
}

func reorderHandler(fn func(ctx context.Context, orderedIDs []int64) error) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		var input struct {
			OrderedIDs []int64 `json:"ordered_ids"`
		}
		if err := json.NewDecoder(req.Body).Decode(&input); err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Invalid request payload", nil)
			return
		}
		err := fn(req.Context(), input.OrderedIDs)
		if err == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		writeError(w, err)
	}
}

func idParam(w http.ResponseWriter, req *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(req, "id"), 10, 64)
	if err != nil || id <= 0 {
		httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Invalid id", nil)
		return 0, false
	}
	return id, true
}

func writeCreated(w http.ResponseWriter, value any, err error) {
	if err != nil {
		writeError(w, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, value)
}

func writeResult(w http.ResponseWriter, value any, err error) {
	if err != nil {
		writeError(w, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, value)
}

func writeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		httpserver.WriteError(w, http.StatusNotFound, "not_found", "Content not found", nil)
	case errors.Is(err, ErrImmutableSlug), errors.Is(err, ErrDeleteBlocked), errors.Is(err, ErrSlugConflict):
		httpserver.WriteError(w, http.StatusConflict, "conflict", err.Error(), nil)
	case errors.Is(err, ErrInvalidReorder), errors.Is(err, ErrInvalidStatus), errors.Is(err, ErrEmptySlug), errors.Is(err, ErrReservedSlug), errors.Is(err, ErrSlugTooLong), errors.Is(err, ErrUnsafeMarkdownMedia):
		httpserver.WriteError(w, http.StatusBadRequest, "validation_error", err.Error(), nil)
	default:
		httpserver.WriteError(w, http.StatusInternalServerError, "internal_error", "Content operation failed", nil)
	}
}

func limitFromRequest(req *http.Request) int {
	limit, err := strconv.Atoi(req.URL.Query().Get("limit"))
	if err != nil || limit <= 0 {
		return 12
	}
	if limit > 50 {
		return 50
	}
	return limit
}
