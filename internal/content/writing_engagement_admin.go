package content

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type AdminWritingComment struct {
	WritingComment
	WritingID    int64     `json:"writing_id"`
	WritingTitle string    `json:"writing_title"`
	WritingSlug  string    `json:"writing_slug"`
	Status       string    `json:"status"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type EngagementPage[T any] struct {
	Items   []T   `json:"items"`
	Total   int64 `json:"total"`
	Page    int   `json:"page"`
	Limit   int   `json:"limit"`
	HasMore bool  `json:"has_more"`
}

type EngagementTotals struct {
	ViewCount           int64 `json:"view_count"`
	VisitorCount        int64 `json:"visitor_count"`
	LikeCount           int64 `json:"like_count"`
	CommentCount        int64 `json:"comment_count"`
	PendingCommentCount int64 `json:"pending_comment_count"`
}

type WritingStatsItem struct {
	WritingID int64  `json:"writing_id"`
	Title     string `json:"title"`
	Slug      string `json:"slug"`
	Status    string `json:"status"`
	EngagementTotals
}

type WritingStatsResult struct {
	EngagementPage[WritingStatsItem]
	Summary EngagementTotals `json:"summary"`
}

func validCommentStatus(status string) bool {
	return status == "pending" || status == "published" || status == "hidden"
}

func (r *Repository) ListWritingComments(ctx context.Context, status string, writingID int64, page, limit int) (EngagementPage[AdminWritingComment], error) {
	page, limit = normalizeEngagementPage(page, limit)
	out := EngagementPage[AdminWritingComment]{Items: []AdminWritingComment{}, Page: page, Limit: limit}
	if status == "" {
		status = "pending"
	}
	if status != "all" && !validCommentStatus(status) {
		return out, ErrInvalidStatus
	}
	if writingID < 0 {
		return out, ErrNotFound
	}
	filter := ` WHERE ($1='all' OR c.status=$1) AND ($2::bigint=0 OR c.writing_id=$2)`
	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM writing_comments c`+filter, status, writingID).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := r.db.QueryContext(ctx, `SELECT c.id,c.author_name,c.body,c.created_at,c.writing_id,w.title,w.slug,c.status,c.updated_at FROM writing_comments c JOIN writings w ON w.id=c.writing_id`+filter+` ORDER BY c.created_at DESC,c.id DESC LIMIT $3 OFFSET $4`, status, writingID, limit, (page-1)*limit)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var c AdminWritingComment
		if err = rows.Scan(&c.ID, &c.AuthorName, &c.Body, &c.CreatedAt, &c.WritingID, &c.WritingTitle, &c.WritingSlug, &c.Status, &c.UpdatedAt); err != nil {
			return out, err
		}
		out.Items = append(out.Items, c)
	}
	out.HasMore = int64(page*limit) < out.Total
	return out, rows.Err()
}
func (r *Repository) SetWritingCommentStatus(ctx context.Context, id int64, status string) (AdminWritingComment, error) {
	var out AdminWritingComment
	if !validCommentStatus(status) {
		return out, ErrInvalidStatus
	}
	err := r.db.QueryRowContext(ctx, `UPDATE writing_comments c SET status=$2,updated_at=$3 FROM writings w WHERE c.id=$1 AND w.id=c.writing_id RETURNING c.id,c.author_name,c.body,c.created_at,c.writing_id,w.title,w.slug,c.status,c.updated_at`, id, status, normalizeTime(r.clock())).Scan(&out.ID, &out.AuthorName, &out.Body, &out.CreatedAt, &out.WritingID, &out.WritingTitle, &out.WritingSlug, &out.Status, &out.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	return out, err
}
func (r *Repository) DeleteWritingComment(ctx context.Context, id int64) error {
	result, err := r.db.ExecContext(ctx, `DELETE FROM writing_comments WHERE id=$1`, id)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

const writingStatsQuery = `SELECT w.id AS writing_id,w.title,w.slug,w.status,
 COALESCE(v.view_count,0) AS view_count,COALESCE(v.visitor_count,0) AS visitor_count,
 COALESCE(l.like_count,0) AS like_count,COALESCE(c.comment_count,0) AS comment_count,
 COALESCE(c.pending_comment_count,0) AS pending_comment_count
 FROM writings w LEFT JOIN writing_likes l ON l.writing_id=w.id
 LEFT JOIN (SELECT writing_id,SUM(view_count) AS view_count,COUNT(*) AS visitor_count FROM writing_visitors GROUP BY writing_id) v ON v.writing_id=w.id
 LEFT JOIN (SELECT writing_id,COUNT(*) FILTER(WHERE status='published') AS comment_count,COUNT(*) FILTER(WHERE status='pending') AS pending_comment_count FROM writing_comments GROUP BY writing_id) c ON c.writing_id=w.id`

func (r *Repository) WritingStats(ctx context.Context, page, limit int) (WritingStatsResult, error) {
	page, limit = normalizeEngagementPage(page, limit)
	out := WritingStatsResult{EngagementPage: EngagementPage[WritingStatsItem]{Items: []WritingStatsItem{}, Page: page, Limit: limit}}
	err := r.db.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(SUM(view_count),0),COALESCE(SUM(visitor_count),0),COALESCE(SUM(like_count),0),COALESCE(SUM(comment_count),0),COALESCE(SUM(pending_comment_count),0) FROM (`+writingStatsQuery+`) stats`).Scan(&out.Total, &out.Summary.ViewCount, &out.Summary.VisitorCount, &out.Summary.LikeCount, &out.Summary.CommentCount, &out.Summary.PendingCommentCount)
	if err != nil {
		return out, err
	}
	rows, err := r.db.QueryContext(ctx, writingStatsQuery+` ORDER BY w.id DESC LIMIT $1 OFFSET $2`, limit, (page-1)*limit)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var s WritingStatsItem
		if err = rows.Scan(&s.WritingID, &s.Title, &s.Slug, &s.Status, &s.ViewCount, &s.VisitorCount, &s.LikeCount, &s.CommentCount, &s.PendingCommentCount); err != nil {
			return out, err
		}
		out.Items = append(out.Items, s)
	}
	out.HasMore = int64(page*limit) < out.Total
	return out, rows.Err()
}
