package site

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"portfolio/internal/storage"
)

type HomeRepository struct {
	db    *sql.DB
	clock func() time.Time
}

type HomePayload struct {
	Experiences []ExperienceSummary `json:"experiences"`
	Talks       []ContentSummary    `json:"talks"`
	Writing     []ContentSummary    `json:"writing"`
	Projects    []ContentSummary    `json:"projects"`
}

type ExperienceSummary struct {
	ID           int64  `json:"id"`
	Period       string `json:"period"`
	Title        string `json:"title"`
	Organization string `json:"organization"`
	Description  string `json:"description"`
	SortOrder    int    `json:"sort_order"`
}

type ContentSummary struct {
	ID          int64  `json:"id"`
	Title       string `json:"title"`
	Slug        string `json:"slug"`
	Summary     string `json:"summary"`
	Featured    bool   `json:"featured"`
	SortOrder   int    `json:"sort_order"`
	PublishedAt string `json:"published_at"`
}

func NewHomeRepository(database *sql.DB, clock func() time.Time) *HomeRepository {
	if clock == nil {
		clock = func() time.Time { return time.Now().UTC() }
	}
	return &HomeRepository{db: database, clock: clock}
}

func (r *HomeRepository) GetHome(ctx context.Context) (HomePayload, error) {
	experiences, err := r.homeExperiences(ctx)
	if err != nil {
		return HomePayload{}, err
	}
	talks, err := r.homeContent(ctx, "talks", "summary", 4)
	if err != nil {
		return HomePayload{}, err
	}
	writing, err := r.homeContent(ctx, "writings", "excerpt", 5)
	if err != nil {
		return HomePayload{}, err
	}
	projects, err := r.homeContent(ctx, "projects", "summary", 4)
	if err != nil {
		return HomePayload{}, err
	}
	return HomePayload{
		Experiences: experiences,
		Talks:       talks,
		Writing:     writing,
		Projects:    projects,
	}, nil
}

func (r *HomeRepository) homeExperiences(ctx context.Context) ([]ExperienceSummary, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, period, title, organization, description, sort_order FROM experiences WHERE status = 'published' AND published_at <= $1 ORDER BY sort_order ASC, published_at DESC LIMIT 4`, r.now())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []ExperienceSummary{}
	for rows.Next() {
		var item ExperienceSummary
		if err := rows.Scan(&item.ID, &item.Period, &item.Title, &item.Organization, &item.Description, &item.SortOrder); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *HomeRepository) homeContent(ctx context.Context, table string, summaryColumn string, limit int) ([]ContentSummary, error) {
	if summaryColumn != homeSummaryColumn(table) {
		return nil, fmt.Errorf("unknown summary column %s for table %s", summaryColumn, table)
	}
	query := `SELECT id, title, slug, ` + summaryColumn + `, featured, sort_order, published_at FROM ` + table + ` WHERE status = 'published' AND published_at <= $1 ORDER BY featured DESC, published_at DESC, sort_order ASC LIMIT $2`
	rows, err := r.db.QueryContext(ctx, query, r.now(), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []ContentSummary{}
	for rows.Next() {
		var item ContentSummary
		var publishedAt time.Time
		if err := rows.Scan(&item.ID, &item.Title, &item.Slug, &item.Summary, &item.Featured, &item.SortOrder, &publishedAt); err != nil {
			return nil, err
		}
		item.PublishedAt = storage.NormalizeTime(publishedAt).Format(time.RFC3339Nano)
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *HomeRepository) now() time.Time {
	return storage.NormalizeTime(r.clock())
}

func homeSummaryColumn(table string) string {
	switch table {
	case "talks":
		return "summary"
	case "writings":
		return "excerpt"
	case "projects":
		return "summary"
	default:
		return ""
	}
}
