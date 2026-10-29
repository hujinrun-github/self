package journal

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func (s *Service) listAdminEntries(w http.ResponseWriter, r *http.Request) {
	s.cleanup(r.Context())
	id := idParam(r, "id")
	if err := s.notebookExists(r.Context(), id); err != nil {
		dbError(w, err)
		return
	}
	s.listEntries(w, r, id, false)
}
func (s *Service) listEntries(w http.ResponseWriter, r *http.Request, id int64, public bool) {
	q := r.URL.Query()
	where := []string{"notebook_id=$1"}
	args := []any{id}
	add := func(clause string, v any) {
		args = append(args, v)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}
	if !public && q.Get("trash") == "true" {
		where = append(where, "deleted_at IS NOT NULL")
	} else {
		where = append(where, "deleted_at IS NULL")
	}
	for _, k := range []string{"from", "to"} {
		if value := q.Get(k); value != "" {
			if _, err := time.Parse("2006-01-02", value); err != nil {
				bad(w, "Invalid date filter")
				return
			}
			op := ">="
			if k == "to" {
				op = "<="
			}
			add("entry_date "+op+" $%d::date", value)
		}
	}
	if v := q.Get("q"); v != "" {
		if !validText(v, 200) {
			bad(w, "Search is too long")
			return
		}
		add(`strpos(lower(search_text),lower($%d))>0`, v)
	}
	if v := q.Get("tag"); v != "" {
		add("tags ? $%d", v)
	}
	if v := q.Get("mood"); v != "" {
		add("mood=$%d", v)
	}
	if q.Get("favorite") == "true" {
		where = append(where, "favorite")
	}
	limit := 100
	offset := 0
	var err error
	if q.Get("limit") != "" {
		limit, err = strconv.Atoi(q.Get("limit"))
		if err != nil || limit < 1 || limit > 500 {
			bad(w, "Limit must be between 1 and 500")
			return
		}
	}
	if q.Get("offset") != "" {
		offset, err = strconv.Atoi(q.Get("offset"))
		if err != nil || offset < 0 || offset > 1000000 {
			bad(w, "Invalid offset")
			return
		}
	}
	clause := strings.Join(where, " AND ")
	var total int
	if err = s.db.QueryRowContext(r.Context(), `SELECT count(*) FROM journal_entries WHERE `+clause, args...).Scan(&total); err != nil {
		internal(w)
		return
	}
	args = append(args, limit, offset)
	rows, err := s.db.QueryContext(r.Context(), `SELECT `+entryColumns+` FROM journal_entries WHERE `+clause+fmt.Sprintf(` ORDER BY entry_date DESC,id DESC LIMIT $%d OFFSET $%d`, len(args)-1, len(args)), args...)
	if err != nil {
		internal(w)
		return
	}
	defer rows.Close()
	items := []Entry{}
	for rows.Next() {
		entry, err := scanEntry(rows)
		if err != nil {
			internal(w)
			return
		}
		items = append(items, entry)
	}
	if rows.Err() != nil {
		internal(w)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "total": total})
}
func (s *Service) getAdminEntry(w http.ResponseWriter, r *http.Request) {
	e, err := scanEntry(s.db.QueryRowContext(r.Context(), `SELECT `+entryColumns+` FROM journal_entries WHERE id=$1`, idParam(r, "id")))
	if err != nil {
		dbError(w, err)
		return
	}
	writeJSON(w, 200, e)
}
func (s *Service) createEntry(w http.ResponseWriter, r *http.Request) {
	var e Entry
	if !readJSON(w, r, &e) {
		return
	}
	e.NotebookID = idParam(r, "id")
	text, assets, err := e.validate()
	if err != nil {
		bad(w, err.Error())
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		internal(w)
		return
	}
	defer tx.Rollback()
	var found int64
	if err = tx.QueryRowContext(r.Context(), `SELECT id FROM journal_notebooks WHERE id=$1 FOR KEY SHARE`, e.NotebookID).Scan(&found); err != nil {
		dbError(w, err)
		return
	}
	if err = validateAssetIDs(r.Context(), tx, e.NotebookID, assets); err != nil {
		bad(w, "Canvas photos must belong to this notebook")
		return
	}
	result, err := insertEntry(r.Context(), tx, e, text)
	if err != nil {
		internal(w)
		return
	}
	if err = saveReferences(r.Context(), tx, result.ID, e.NotebookID, assets); err != nil {
		internal(w)
		return
	}
	if err = tx.Commit(); err != nil {
		internal(w)
		return
	}
	writeJSON(w, 201, result)
}
func insertEntry(ctx context.Context, tx *sql.Tx, e Entry, text string) (Entry, error) {
	return scanEntry(tx.QueryRowContext(ctx, `INSERT INTO journal_entries(notebook_id,title,entry_date,mood,weather,tags,favorite,scene,search_text) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING `+entryColumns, e.NotebookID, e.Title, e.EntryDate, e.Mood, e.Weather, encoded(e.Tags), e.Favorite, encoded(e.Scene), text))
}
func (s *Service) updateEntry(w http.ResponseWriter, r *http.Request) {
	var in Entry
	if !readJSON(w, r, &in) {
		return
	}
	if in.Version < 1 {
		bad(w, "Version is required")
		return
	}
	text, assets, err := in.validate()
	if err != nil {
		bad(w, err.Error())
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		internal(w)
		return
	}
	defer tx.Rollback()
	current, err := scanEntry(tx.QueryRowContext(r.Context(), `SELECT `+entryColumns+` FROM journal_entries WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, idParam(r, "id")))
	if err != nil {
		dbError(w, err)
		return
	}
	if current.Version != in.Version {
		conflict(w)
		return
	}
	if err = validateAssetIDs(r.Context(), tx, current.NotebookID, assets); err != nil {
		bad(w, "Canvas photos must belong to this notebook")
		return
	}
	targetBook := current.NotebookID
	if in.NotebookID != 0 && in.NotebookID != current.NotebookID {
		targetBook = in.NotebookID
		var found int64
		if err = tx.QueryRowContext(r.Context(), `SELECT id FROM journal_notebooks WHERE id=$1 FOR KEY SHARE`, targetBook).Scan(&found); err != nil {
			dbError(w, err)
			return
		}
		// Clone bytes into the destination's private boundary. Existing source
		// references remain valid and cannot expose the moved page's new assets.
		remapped := map[int64]int64{}
		for i, oldID := range assets {
			var newID int64
			if err = tx.QueryRowContext(r.Context(), `INSERT INTO journal_assets(notebook_id,mime_type,width,height,file_name,size_bytes,data) SELECT $1,mime_type,width,height,file_name,size_bytes,data FROM journal_assets WHERE id=$2 AND notebook_id=$3 RETURNING id`, targetBook, oldID, current.NotebookID).Scan(&newID); err != nil {
				internal(w)
				return
			}
			remapped[oldID] = newID
			assets[i] = newID
		}
		for i := range in.Scene.Elements {
			if old := in.Scene.Elements[i].AssetID; old > 0 {
				in.Scene.Elements[i].AssetID = remapped[old]
			}
		}
		if _, err = tx.ExecContext(r.Context(), `DELETE FROM journal_entry_assets WHERE entry_id=$1`, current.ID); err != nil {
			internal(w)
			return
		}
	}
	result, err := scanEntry(tx.QueryRowContext(r.Context(), `UPDATE journal_entries SET title=$2,entry_date=$3,mood=$4,weather=$5,tags=$6,favorite=$7,scene=$8,search_text=$9,notebook_id=$10,version=version+1,updated_at=now() WHERE id=$1 RETURNING `+entryColumns, current.ID, in.Title, in.EntryDate, in.Mood, in.Weather, encoded(in.Tags), in.Favorite, encoded(in.Scene), text, targetBook))
	if err != nil {
		internal(w)
		return
	}
	if err = saveReferences(r.Context(), tx, current.ID, targetBook, assets); err != nil {
		internal(w)
		return
	}
	if err = tx.Commit(); err != nil {
		internal(w)
		return
	}
	writeJSON(w, 200, result)
}
func validateAssetIDs(ctx context.Context, tx *sql.Tx, book int64, ids []int64) error {
	for _, id := range ids {
		var found int64
		if err := tx.QueryRowContext(ctx, `SELECT id FROM journal_assets WHERE id=$1 AND notebook_id=$2 FOR KEY SHARE`, id, book).Scan(&found); err != nil {
			return err
		}
	}
	return nil
}
func saveReferences(ctx context.Context, tx *sql.Tx, entry, book int64, ids []int64) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM journal_entry_assets WHERE entry_id=$1`, entry); err != nil {
		return err
	}
	for _, id := range ids {
		if _, err := tx.ExecContext(ctx, `INSERT INTO journal_entry_assets(entry_id,asset_id,notebook_id) VALUES($1,$2,$3)`, entry, id, book); err != nil {
			return err
		}
	}
	return nil
}
func (s *Service) deleteEntry(w http.ResponseWriter, r *http.Request) {
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		internal(w)
		return
	}
	defer tx.Rollback()
	id := idParam(r, "id")
	var deleted *time.Time
	if err = tx.QueryRowContext(r.Context(), `SELECT deleted_at FROM journal_entries WHERE id=$1 FOR UPDATE`, id).Scan(&deleted); err != nil {
		dbError(w, err)
		return
	}
	if r.URL.Query().Get("permanent") == "true" {
		if deleted == nil {
			bad(w, "Move this entry to trash before deleting permanently")
			return
		}
		var ids []int64
		rows, err := tx.QueryContext(r.Context(), `SELECT asset_id FROM journal_entry_assets WHERE entry_id=$1`, id)
		if err != nil {
			internal(w)
			return
		}
		for rows.Next() {
			var asset int64
			if err = rows.Scan(&asset); err != nil {
				rows.Close()
				internal(w)
				return
			}
			ids = append(ids, asset)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			internal(w)
			return
		}
		if _, err = tx.ExecContext(r.Context(), `DELETE FROM journal_entries WHERE id=$1`, id); err != nil {
			internal(w)
			return
		}
		for _, asset := range ids {
			if _, err = tx.ExecContext(r.Context(), `DELETE FROM journal_assets a WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM journal_entry_assets r WHERE r.asset_id=a.id)`, asset); err != nil {
				internal(w)
				return
			}
		}
	} else {
		if _, err = tx.ExecContext(r.Context(), `UPDATE journal_entries SET deleted_at=COALESCE(deleted_at,now()),version=version+1,updated_at=now() WHERE id=$1`, id); err != nil {
			internal(w)
			return
		}
	}
	if err = tx.Commit(); err != nil {
		internal(w)
		return
	}
	w.WriteHeader(204)
}
func (s *Service) restoreEntry(w http.ResponseWriter, r *http.Request) {
	e, err := scanEntry(s.db.QueryRowContext(r.Context(), `UPDATE journal_entries SET deleted_at=NULL,version=version+1,updated_at=now() WHERE id=$1 AND deleted_at IS NOT NULL AND deleted_at>=$2 RETURNING `+entryColumns, idParam(r, "id"), s.clock().Add(-30*24*time.Hour)))
	if err != nil {
		dbError(w, err)
		return
	}
	writeJSON(w, 200, e)
}
