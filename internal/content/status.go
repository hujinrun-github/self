package content

import "errors"

type Status string

const (
	StatusDraft     Status = "draft"
	StatusPublished Status = "published"
	StatusArchived  Status = "archived"
)

var (
	ErrEmptySlug           = errors.New("slug is required")
	ErrReservedSlug        = errors.New("slug is reserved")
	ErrSlugTooLong         = errors.New("slug is too long")
	ErrSlugConflict        = errors.New("slug is already in use")
	ErrConflict            = errors.New("content has changed")
	ErrImmutableSlug       = errors.New("published slug is immutable")
	ErrInvalidStatus       = errors.New("invalid status")
	ErrDeleteBlocked       = errors.New("only never-published drafts can be deleted")
	ErrInvalidReorder      = errors.New("reorder must include all resource ids")
	ErrUnsafeMarkdownMedia = errors.New("markdown image references must use media assets instead of raw uploads paths")
	ErrNotFound            = errors.New("content not found")
)

func validStatus(status Status) bool {
	return status == StatusDraft || status == StatusPublished || status == StatusArchived
}
