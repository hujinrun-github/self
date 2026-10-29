package journal

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
)

type archiveAsset struct {
	Asset
	Path string `json:"path"`
}
type archiveManifest struct {
	Format   string `json:"format"`
	Version  int    `json:"version"`
	Notebook struct {
		Name       string `json:"name"`
		Paper      string `json:"paper"`
		CoverColor string `json:"cover_color"`
	} `json:"notebook"`
	Entries []Entry        `json:"entries"`
	Assets  []archiveAsset `json:"assets"`
}
type boundedBuffer struct {
	bytes.Buffer
	limit int
}

func (b *boundedBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > b.limit {
		return 0, errors.New("Archive is too large")
	}
	return b.Buffer.Write(p)
}
func (s *Service) exportNotebook(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	tx, err := s.db.BeginTx(r.Context(), &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		internal(w)
		return
	}
	defer tx.Rollback()
	n, err := scanNotebook(tx.QueryRowContext(r.Context(), `SELECT `+notebookColumns+` FROM journal_notebooks WHERE id=$1`, id))
	if err != nil {
		dbError(w, err)
		return
	}
	manifest := archiveManifest{Format: "portfolio-journal", Version: 1, Entries: []Entry{}, Assets: []archiveAsset{}}
	manifest.Notebook.Name = n.Name
	manifest.Notebook.Paper = n.Paper
	manifest.Notebook.CoverColor = n.CoverColor
	query := `SELECT ` + entryColumns + ` FROM journal_entries WHERE notebook_id=$1 AND deleted_at IS NULL`
	args := []any{id}
	selected := map[int64]bool{}
	param := r.URL.Query().Get("entry_ids")
	if param == "" {
		param = r.URL.Query().Get("entry_id")
	}
	if param != "" {
		parts := strings.Split(param, ",")
		if len(parts) > 1000 {
			bad(w, "Select up to 1000 entries")
			return
		}
		placeholders := []string{}
		for _, part := range parts {
			entryID, err := strconv.ParseInt(part, 10, 64)
			if err != nil || entryID <= 0 {
				bad(w, "Invalid entry ID")
				return
			}
			if selected[entryID] {
				continue
			}
			selected[entryID] = true
			args = append(args, entryID)
			placeholders = append(placeholders, fmt.Sprintf("$%d", len(args)))
		}
		query += " AND id IN (" + strings.Join(placeholders, ",") + ")"
	}
	query += ` ORDER BY entry_date,id LIMIT 1001`
	rows, err := tx.QueryContext(r.Context(), query, args...)
	if err != nil {
		internal(w)
		return
	}
	assetIDs := map[int64]bool{}
	for rows.Next() {
		e, err := scanEntry(rows)
		if err != nil {
			rows.Close()
			internal(w)
			return
		}
		manifest.Entries = append(manifest.Entries, e)
		for _, el := range e.Scene.Elements {
			if el.AssetID > 0 {
				assetIDs[el.AssetID] = true
			}
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		internal(w)
		return
	}
	if len(manifest.Entries) > 1000 || len(assetIDs) > 500 {
		bad(w, "Export up to 1000 entries and 500 images at a time")
		return
	}
	if len(selected) > 0 && len(manifest.Entries) != len(selected) {
		notFound(w)
		return
	}
	out := &boundedBuffer{limit: maxArchiveBytes}
	z := zip.NewWriter(out)
	total := 0
	for assetID := range assetIDs {
		var a archiveAsset
		var data []byte
		err = tx.QueryRowContext(r.Context(), `SELECT id,notebook_id,mime_type,width,height,file_name,size_bytes,data FROM journal_assets WHERE id=$1 AND notebook_id=$2`, assetID, id).Scan(&a.ID, &a.NotebookID, &a.MIMEType, &a.Width, &a.Height, &a.FileName, &a.SizeBytes, &data)
		if err != nil {
			writeError(w, 409, "missing_asset", "A referenced photo is missing; export was cancelled")
			return
		}
		total += len(data)
		if total > maxArchiveBytes {
			bad(w, "Archive exceeds 200 MB; export individual entries")
			return
		}
		ext := "png"
		if a.MIMEType == "image/jpeg" {
			ext = "jpg"
		}
		a.Path = fmt.Sprintf("assets/%d.%s", a.ID, ext)
		file, err := z.Create(a.Path)
		if err != nil {
			internal(w)
			return
		}
		if _, err = file.Write(data); err != nil {
			bad(w, "Archive exceeds 200 MB")
			return
		}
		manifest.Assets = append(manifest.Assets, a)
	}
	data := encoded(manifest)
	if len(data) > 20<<20 {
		bad(w, "Archive contains too much text; export individual entries")
		return
	}
	file, err := z.Create("journal.json")
	if err != nil {
		internal(w)
		return
	}
	if _, err = file.Write(data); err != nil {
		bad(w, "Archive exceeds 200 MB")
		return
	}
	if err = z.Close(); err != nil {
		bad(w, "Archive exceeds 200 MB")
		return
	}
	if err = tx.Commit(); err != nil {
		internal(w)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="journal-%d.zip"`, id))
	w.Header().Set("Content-Length", strconv.Itoa(out.Len()))
	w.WriteHeader(200)
	_, _ = w.Write(out.Bytes())
}
func readZipFile(file *zip.File, max int) ([]byte, error) {
	if file.UncompressedSize64 > uint64(max) {
		return nil, errors.New("Archive member is too large")
	}
	r, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer r.Close()
	b, err := io.ReadAll(io.LimitReader(r, int64(max)+1))
	if err != nil {
		return nil, err
	}
	if len(b) > max {
		return nil, errors.New("Archive member is too large")
	}
	return b, nil
}
func (s *Service) importNotebook(w http.ResponseWriter, r *http.Request) {
	book := idParam(r, "id")
	if err := s.notebookExists(r.Context(), book); err != nil {
		dbError(w, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxArchiveBytes+(1<<20))
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		bad(w, "Archive must be at most 200 MB")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	f, _, err := r.FormFile("archive")
	if err != nil {
		bad(w, "Choose a journal ZIP archive")
		return
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxArchiveBytes+1))
	if err != nil || len(data) > maxArchiveBytes {
		bad(w, "Archive must be at most 200 MB")
		return
	}
	z, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil || len(z.File) > 501 {
		bad(w, "Invalid journal ZIP archive")
		return
	}
	files := map[string]*zip.File{}
	total := uint64(0)
	for _, f := range z.File {
		if files[f.Name] != nil {
			bad(w, "Duplicate archive member")
			return
		}
		files[f.Name] = f
		if f.UncompressedSize64 > maxArchiveBytes {
			bad(w, "Archive expands beyond 200 MB")
			return
		}
		total += f.UncompressedSize64
		if total > maxArchiveBytes {
			bad(w, "Archive expands beyond 200 MB")
			return
		}
	}
	mf := files["journal.json"]
	if mf == nil {
		bad(w, "Archive is missing journal.json")
		return
	}
	raw, err := readZipFile(mf, 20<<20)
	if err != nil {
		bad(w, "Invalid archive manifest")
		return
	}
	var manifest archiveManifest
	if err = json.Unmarshal(raw, &manifest); err != nil || manifest.Format != "portfolio-journal" || manifest.Version != 1 || len(manifest.Entries) > 1000 || len(manifest.Assets) > 500 {
		bad(w, "Unsupported journal archive")
		return
	}
	assetRecords := map[int64]archiveAsset{}
	for _, a := range manifest.Assets {
		ext := "png"
		if a.MIMEType == "image/jpeg" {
			ext = "jpg"
		}
		if a.ID <= 0 || a.Path != fmt.Sprintf("assets/%d.%s", a.ID, ext) || files[a.Path] == nil || assetRecords[a.ID].ID != 0 {
			bad(w, "Invalid or missing archive image")
			return
		}
		assetRecords[a.ID] = a
	}
	for i := range manifest.Entries {
		e := &manifest.Entries[i]
		_, ids, err := e.validate()
		if err != nil {
			bad(w, "Invalid canvas in archive")
			return
		}
		for _, id := range ids {
			if assetRecords[id].ID == 0 {
				bad(w, "Archive is missing a referenced image")
				return
			}
		}
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		internal(w)
		return
	}
	defer tx.Rollback()
	var found int64
	if err = tx.QueryRowContext(r.Context(), `SELECT id FROM journal_notebooks WHERE id=$1 FOR KEY SHARE`, book).Scan(&found); err != nil {
		dbError(w, err)
		return
	}
	newIDs := map[int64]int64{}
	for oldID, a := range assetRecords {
		raw, err := readZipFile(files[a.Path], maxStoredImageBytes)
		if err != nil {
			bad(w, "Invalid archive image")
			return
		}
		safe, processed, err := prepareImage(raw, a.FileName)
		if err != nil {
			bad(w, err.Error())
			return
		}
		saved, err := insertAsset(r.Context(), tx, book, safe, processed)
		if err != nil {
			internal(w)
			return
		}
		newIDs[oldID] = saved.ID
	}
	for _, e := range manifest.Entries {
		e.NotebookID = book
		for i := range e.Scene.Elements {
			if old := e.Scene.Elements[i].AssetID; old > 0 {
				e.Scene.Elements[i].AssetID = newIDs[old]
			}
		}
		text, ids, err := e.validate()
		if err != nil {
			bad(w, "Invalid imported canvas")
			return
		}
		saved, err := insertEntry(r.Context(), tx, e, text)
		if err != nil {
			internal(w)
			return
		}
		if err = saveReferences(r.Context(), tx, saved.ID, book, ids); err != nil {
			internal(w)
			return
		}
	}
	if err = tx.Commit(); err != nil {
		internal(w)
		return
	}
	writeJSON(w, 201, map[string]int{"imported": len(manifest.Entries)})
}
