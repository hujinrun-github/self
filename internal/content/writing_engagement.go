package content

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"
)

type WritingCommentInput struct {
	AuthorName  string `json:"author_name"`
	AuthorEmail string `json:"author_email"`
	Body        string `json:"body"`
}

type WritingComment struct {
	ID          int64     `json:"id"`
	AuthorName  string    `json:"author_name"`
	AuthorEmail string    `json:"author_email,omitempty"`
	Body        string    `json:"body"`
	CreatedAt   time.Time `json:"created_at"`
}

type WritingEngagement struct {
	LikeCount int              `json:"like_count"`
	Comments  []WritingComment `json:"comments"`
}

func (r *Repository) WritingEngagement(ctx context.Context, writingID int64) (WritingEngagement, error) {
	if err := r.ensureWritingExists(ctx, writingID); err != nil {
		return WritingEngagement{}, err
	}

	likeCount, err := r.writingLikeCount(ctx, writingID)
	if err != nil {
		return WritingEngagement{}, err
	}
	comments, err := r.writingComments(ctx, writingID, 50)
	if err != nil {
		return WritingEngagement{}, err
	}
	return WritingEngagement{LikeCount: likeCount, Comments: comments}, nil
}

func (r *Repository) LikeWriting(ctx context.Context, writingID int64) (int, error) {
	if err := r.ensureWritingExists(ctx, writingID); err != nil {
		return 0, err
	}
	now := normalizeTime(r.clock())
	var likeCount int
	err := r.db.QueryRowContext(ctx, `
INSERT INTO writing_likes (writing_id, like_count, updated_at)
VALUES ($1, 1, $2)
ON CONFLICT (writing_id) DO UPDATE
SET like_count = writing_likes.like_count + 1,
    updated_at = EXCLUDED.updated_at
RETURNING like_count
`, writingID, now).Scan(&likeCount)
	if err != nil {
		return 0, err
	}
	return likeCount, nil
}

func (r *Repository) CreateWritingComment(ctx context.Context, writingID int64, input WritingCommentInput) (WritingComment, error) {
	if err := r.ensureWritingExists(ctx, writingID); err != nil {
		return WritingComment{}, err
	}
	normalized, err := normalizeWritingCommentInput(input)
	if err != nil {
		return WritingComment{}, err
	}
	now := normalizeTime(r.clock())
	comment := WritingComment{}
	err = r.db.QueryRowContext(ctx, `
INSERT INTO writing_comments (writing_id, author_name, author_email, body, status, created_at)
VALUES ($1, $2, $3, $4, 'published', $5)
RETURNING id, author_name, author_email, body, created_at
`, writingID, normalized.AuthorName, normalized.AuthorEmail, normalized.Body, now).
		Scan(&comment.ID, &comment.AuthorName, &comment.AuthorEmail, &comment.Body, &comment.CreatedAt)
	if err != nil {
		return WritingComment{}, err
	}
	return comment, nil
}

func (r *Repository) writingLikeCount(ctx context.Context, writingID int64) (int, error) {
	var likeCount int
	err := r.db.QueryRowContext(ctx, `SELECT COALESCE((SELECT like_count FROM writing_likes WHERE writing_id = $1), 0)`, writingID).Scan(&likeCount)
	if err != nil {
		return 0, err
	}
	return likeCount, nil
}

func (r *Repository) writingComments(ctx context.Context, writingID int64, limit int) ([]WritingComment, error) {
	if limit <= 0 || limit > 50 {
		limit = 50
	}
	rows, err := r.db.QueryContext(ctx, `
SELECT id, author_name, author_email, body, created_at
FROM writing_comments
WHERE writing_id = $1
  AND status = 'published'
ORDER BY created_at DESC, id DESC
LIMIT $2
`, writingID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	comments := []WritingComment{}
	for rows.Next() {
		var comment WritingComment
		if err := rows.Scan(&comment.ID, &comment.AuthorName, &comment.AuthorEmail, &comment.Body, &comment.CreatedAt); err != nil {
			return nil, err
		}
		comments = append(comments, comment)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return comments, nil
}

func (r *Repository) ensureWritingExists(ctx context.Context, writingID int64) error {
	var exists bool
	err := r.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM writings WHERE id = $1)`, writingID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	return nil
}

func normalizeWritingCommentInput(input WritingCommentInput) (WritingCommentInput, error) {
	normalized := WritingCommentInput{
		AuthorName:  strings.TrimSpace(input.AuthorName),
		AuthorEmail: strings.TrimSpace(input.AuthorEmail),
		Body:        strings.TrimSpace(input.Body),
	}
	if normalized.AuthorName == "" || normalized.Body == "" {
		return WritingCommentInput{}, ErrInvalidComment
	}
	if utf8.RuneCountInString(normalized.AuthorName) > 80 || utf8.RuneCountInString(normalized.Body) > 1000 || len(normalized.AuthorEmail) > 254 {
		return WritingCommentInput{}, ErrInvalidComment
	}
	return normalized, nil
}
