package content

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

type WritingCommentInput struct {
	AuthorName string `json:"author_name"`
	Body       string `json:"body"`
}

type WritingComment struct {
	ID         int64     `json:"id"`
	AuthorName string    `json:"author_name"`
	Body       string    `json:"body"`
	CreatedAt  time.Time `json:"created_at"`
}

type WritingCommentSubmission struct {
	WritingComment
	Status string `json:"status"`
}

type WritingEngagement struct {
	LikeCount    int64            `json:"like_count"`
	Liked        bool             `json:"liked"`
	ViewCount    int64            `json:"view_count"`
	VisitorCount int64            `json:"visitor_count"`
	CommentCount int64            `json:"comment_count"`
	Comments     []WritingComment `json:"comments"`
	Page         int              `json:"page"`
	Limit        int              `json:"limit"`
	HasMore      bool             `json:"has_more"`
}

type WritingLikeResult struct {
	LikeCount int64 `json:"like_count"`
	Liked     bool  `json:"liked"`
}

type WritingViewResult struct {
	ViewCount    int64 `json:"view_count"`
	VisitorCount int64 `json:"visitor_count"`
}

func normalizeEngagementPage(page, limit int) (int, int) {
	if page < 1 {
		page = 1
	}
	if page > 1000000 {
		page = 1000000
	}
	if limit < 1 {
		limit = 10
	}
	if limit > 50 {
		limit = 50
	}
	return page, limit
}

func (r *Repository) WritingEngagement(ctx context.Context, writingID int64, visitor string, page, limit int) (WritingEngagement, error) {
	if err := r.ensurePublicWriting(ctx, writingID); err != nil {
		return WritingEngagement{}, err
	}
	page, limit = normalizeEngagementPage(page, limit)
	output := WritingEngagement{Comments: []WritingComment{}, Page: page, Limit: limit}
	err := r.db.QueryRowContext(ctx, `SELECT
 COALESCE((SELECT like_count FROM writing_likes WHERE writing_id=$1),0),
 EXISTS(SELECT 1 FROM writing_visitor_likes WHERE writing_id=$1 AND visitor_hash=$2),
 COALESCE((SELECT SUM(view_count) FROM writing_visitors WHERE writing_id=$1),0),
 (SELECT COUNT(*) FROM writing_visitors WHERE writing_id=$1),
 (SELECT COUNT(*) FROM writing_comments WHERE writing_id=$1 AND status='published')`, writingID, visitor).
		Scan(&output.LikeCount, &output.Liked, &output.ViewCount, &output.VisitorCount, &output.CommentCount)
	if err != nil {
		return output, err
	}
	rows, err := r.db.QueryContext(ctx, `SELECT id,author_name,body,created_at FROM writing_comments WHERE writing_id=$1 AND status='published' ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`, writingID, limit, (page-1)*limit)
	if err != nil {
		return output, err
	}
	defer rows.Close()
	for rows.Next() {
		var c WritingComment
		if err = rows.Scan(&c.ID, &c.AuthorName, &c.Body, &c.CreatedAt); err != nil {
			return output, err
		}
		output.Comments = append(output.Comments, c)
	}
	output.HasMore = int64(page*limit) < output.CommentCount
	return output, rows.Err()
}

func (r *Repository) SetWritingLike(ctx context.Context, writingID int64, visitor string, liked bool) (WritingLikeResult, error) {
	output := WritingLikeResult{Liked: liked}
	if len(visitor) != 64 {
		return output, ErrInvalidVisitor
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return output, err
	}
	defer tx.Rollback()
	if err = r.lockPublicWriting(ctx, tx, writingID); err != nil {
		return output, err
	}
	now := normalizeTime(r.clock())
	if _, err = tx.ExecContext(ctx, `INSERT INTO writing_likes(writing_id,like_count,updated_at) VALUES($1,0,$2) ON CONFLICT(writing_id) DO NOTHING`, writingID, now); err != nil {
		return output, err
	}
	// Lock the aggregate before changing membership, making repeated concurrent desired states idempotent.
	if err = tx.QueryRowContext(ctx, `SELECT like_count FROM writing_likes WHERE writing_id=$1 FOR UPDATE`, writingID).Scan(&output.LikeCount); err != nil {
		return output, err
	}
	var result sql.Result
	delta := int64(1)
	if liked {
		result, err = tx.ExecContext(ctx, `INSERT INTO writing_visitor_likes(writing_id,visitor_hash,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, writingID, visitor, now)
	} else {
		delta = -1
		result, err = tx.ExecContext(ctx, `DELETE FROM writing_visitor_likes WHERE writing_id=$1 AND visitor_hash=$2`, writingID, visitor)
	}
	if err != nil {
		return output, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return output, err
	}
	if changed > 0 {
		if err = tx.QueryRowContext(ctx, `UPDATE writing_likes SET like_count=like_count+$2,updated_at=$3 WHERE writing_id=$1 RETURNING like_count`, writingID, delta, now).Scan(&output.LikeCount); err != nil {
			return output, err
		}
	}
	return output, tx.Commit()
}

func (r *Repository) RecordWritingView(ctx context.Context, writingID int64, visitor string) (WritingViewResult, error) {
	var output WritingViewResult
	if len(visitor) != 64 {
		return output, ErrInvalidVisitor
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return output, err
	}
	defer tx.Rollback()
	if err = r.lockPublicWriting(ctx, tx, writingID); err != nil {
		return output, err
	}
	now := normalizeTime(r.clock())
	_, err = tx.ExecContext(ctx, `INSERT INTO writing_visitors(writing_id,visitor_hash,first_seen_at,last_viewed_at,view_count) VALUES($1,$2,$3,$3,1)
 ON CONFLICT(writing_id,visitor_hash) DO UPDATE SET
 view_count=writing_visitors.view_count+1,last_viewed_at=EXCLUDED.last_viewed_at
 WHERE writing_visitors.last_viewed_at <= EXCLUDED.last_viewed_at - INTERVAL '24 hours'`, writingID, visitor, now)
	if err != nil {
		return output, err
	}
	if err = tx.QueryRowContext(ctx, `SELECT COALESCE(SUM(view_count),0),COUNT(*) FROM writing_visitors WHERE writing_id=$1`, writingID).Scan(&output.ViewCount, &output.VisitorCount); err != nil {
		return output, err
	}
	return output, tx.Commit()
}

func (r *Repository) CreateWritingComment(ctx context.Context, writingID int64, input WritingCommentInput) (WritingCommentSubmission, error) {
	var output WritingCommentSubmission
	input, err := normalizeWritingCommentInput(input)
	if err != nil {
		return output, err
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return output, err
	}
	defer tx.Rollback()
	if err = r.lockPublicWriting(ctx, tx, writingID); err != nil {
		return output, err
	}
	now := normalizeTime(r.clock())
	err = tx.QueryRowContext(ctx, `INSERT INTO writing_comments(writing_id,author_name,body,status,created_at,updated_at) VALUES($1,$2,$3,'pending',$4,$4) RETURNING id,author_name,body,created_at,status`, writingID, input.AuthorName, input.Body, now).
		Scan(&output.ID, &output.AuthorName, &output.Body, &output.CreatedAt, &output.Status)
	if err != nil {
		return output, err
	}
	return output, tx.Commit()
}

func (r *Repository) lockPublicWriting(ctx context.Context, tx *sql.Tx, id int64) error {
	var found int64
	err := tx.QueryRowContext(ctx, `SELECT id FROM writings WHERE id=$1 AND status='published' AND published_at <= $2 FOR SHARE`, id, normalizeTime(r.clock())).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}
func (r *Repository) ensurePublicWriting(ctx context.Context, id int64) error {
	var exists bool
	err := r.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM writings WHERE id=$1 AND status='published' AND published_at <= $2)`, id, normalizeTime(r.clock())).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	return nil
}
func normalizeWritingCommentInput(input WritingCommentInput) (WritingCommentInput, error) {
	input.AuthorName = strings.TrimSpace(input.AuthorName)
	input.Body = strings.TrimSpace(input.Body)
	if input.AuthorName == "" || input.Body == "" || !utf8.ValidString(input.AuthorName) || !utf8.ValidString(input.Body) || strings.ContainsRune(input.AuthorName, 0) || strings.ContainsRune(input.Body, 0) || utf8.RuneCountInString(input.AuthorName) > 80 || utf8.RuneCountInString(input.Body) > 1000 {
		return WritingCommentInput{}, ErrInvalidComment
	}
	return input, nil
}
