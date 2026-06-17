package media

import (
	"context"
	"database/sql"
	"time"

	"portfolio/internal/storage"
)

type Reference struct {
	MediaAssetID int64  `json:"media_asset_id"`
	Source       string `json:"source"`
}

func (s *Service) RebuildReferences(ctx context.Context, tx *sql.Tx, resourceType string, resourceID int64, refs []Reference) error {
	return RebuildReferences(ctx, tx, resourceType, resourceID, refs)
}

func RebuildReferences(ctx context.Context, tx *sql.Tx, resourceType string, resourceID int64, refs []Reference) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM media_references WHERE resource_type = $1 AND resource_id = $2`, resourceType, resourceID); err != nil {
		return err
	}
	now := storage.NormalizeTime(time.Now())
	for _, ref := range refs {
		if _, err := tx.ExecContext(ctx, `INSERT INTO media_references (media_asset_id, resource_type, resource_id, source, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`, ref.MediaAssetID, resourceType, resourceID, ref.Source, now); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) IsReferenced(ctx context.Context, mediaID int64) (bool, error) {
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM media_references WHERE media_asset_id = $1`, mediaID).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}
