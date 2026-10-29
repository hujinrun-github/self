package journal

import (
	"database/sql"
	"net/http"
	"strings"

	"golang.org/x/crypto/bcrypt"
	"portfolio/internal/auth"
)

type notebookInput struct {
	Notebook
	Password      *string `json:"password"`
	ClearPassword bool    `json:"clear_password"`
}

func (in *notebookInput) validate() errorMessage {
	in.Name = strings.TrimSpace(in.Name)
	in.PublicTitle = strings.TrimSpace(in.PublicTitle)
	if in.Name == "" || !validText(in.Name, 100) || !validText(in.PublicTitle, 100) {
		return "Notebook names must contain 1–100 characters"
	}
	if !validPaper(in.Paper) || !colorPattern.MatchString(in.CoverColor) {
		return "Invalid paper or cover color"
	}
	if in.Password != nil && (len(*in.Password) < 8 || len(*in.Password) > 72) {
		return "Viewing password must contain 8–72 UTF-8 bytes"
	}
	if in.Password != nil && in.ClearPassword {
		return "Cannot set and clear the password together"
	}
	if in.Archived || in.ClearPassword {
		in.PublicEnabled = false
	}
	if in.PublicEnabled && in.PublicTitle == "" {
		return "Confirm a public title before enabling public viewing"
	}
	return ""
}

type errorMessage string

func (s *Service) listNotebooks(w http.ResponseWriter, r *http.Request) {
	s.cleanup(r.Context())
	rows, err := s.db.QueryContext(r.Context(), `SELECT `+notebookColumns+` FROM journal_notebooks ORDER BY archived,id`)
	if err != nil {
		internal(w)
		return
	}
	defer rows.Close()
	items := []Notebook{}
	for rows.Next() {
		n, err := scanNotebook(rows)
		if err != nil {
			internal(w)
			return
		}
		items = append(items, n)
	}
	if rows.Err() != nil {
		internal(w)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}
func (s *Service) createNotebook(w http.ResponseWriter, r *http.Request) {
	var in notebookInput
	if !readJSON(w, r, &in) {
		return
	}
	if in.Paper == "" {
		in.Paper = "plain"
	}
	if in.CoverColor == "" {
		in.CoverColor = "#d9e5ee"
	}
	if msg := in.validate(); msg != "" {
		bad(w, string(msg))
		return
	}
	hash := ""
	if in.Password != nil {
		b, err := bcrypt.GenerateFromPassword([]byte(*in.Password), bcrypt.DefaultCost)
		if err != nil {
			internal(w)
			return
		}
		hash = string(b)
	}
	if in.PublicEnabled && hash == "" {
		bad(w, "Set a viewing password before enabling public viewing")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		internal(w)
		return
	}
	defer tx.Rollback()
	n, err := scanNotebook(tx.QueryRowContext(r.Context(), `INSERT INTO journal_notebooks(name,public_title,cover_color,paper,public_enabled,archived,password_hash) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING `+notebookColumns, in.Name, in.PublicTitle, in.CoverColor, in.Paper, in.PublicEnabled, in.Archived, hash))
	if err != nil {
		internal(w)
		return
	}
	if err = s.audit(r, tx, n.ID, "created"); err != nil {
		internal(w)
		return
	}
	if err = tx.Commit(); err != nil {
		internal(w)
		return
	}
	writeJSON(w, 201, n)
}
func (s *Service) updateNotebook(w http.ResponseWriter, r *http.Request) {
	var in notebookInput
	if !readJSON(w, r, &in) {
		return
	}
	if msg := in.validate(); msg != "" {
		bad(w, string(msg))
		return
	}
	if in.Version < 1 {
		bad(w, "Version is required")
		return
	}
	newHash := ""
	if in.Password != nil {
		b, err := bcrypt.GenerateFromPassword([]byte(*in.Password), bcrypt.DefaultCost)
		if err != nil {
			internal(w)
			return
		}
		newHash = string(b)
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		internal(w)
		return
	}
	defer tx.Rollback()
	var hash string
	var enabled, archived bool
	var version int64
	if err = tx.QueryRowContext(r.Context(), `SELECT password_hash,public_enabled,archived,version FROM journal_notebooks WHERE id=$1 FOR UPDATE`, idParam(r, "id")).Scan(&hash, &enabled, &archived, &version); err != nil {
		dbError(w, err)
		return
	}
	if version != in.Version {
		conflict(w)
		return
	}
	action := ""
	invalidate := enabled != in.PublicEnabled || archived != in.Archived
	if in.Password != nil {
		hash = newHash
		invalidate = true
		action = "password_changed"
	}
	if in.ClearPassword {
		hash = ""
		invalidate = true
		action = "password_cleared"
	}
	if in.PublicEnabled && hash == "" {
		bad(w, "Set a viewing password before enabling public viewing")
		return
	}
	if enabled != in.PublicEnabled || archived != in.Archived {
		action += " public_policy_changed"
	}
	bump := 0
	if invalidate {
		bump = 1
	}
	n, err := scanNotebook(tx.QueryRowContext(r.Context(), `UPDATE journal_notebooks SET name=$2,public_title=$3,cover_color=$4,paper=$5,public_enabled=$6,archived=$7,password_hash=$8,password_version=password_version+$9,version=version+1,updated_at=now() WHERE id=$1 RETURNING `+notebookColumns, idParam(r, "id"), in.Name, in.PublicTitle, in.CoverColor, in.Paper, in.PublicEnabled, in.Archived, hash, bump))
	if err != nil {
		internal(w)
		return
	}
	if invalidate {
		if _, err = tx.ExecContext(r.Context(), `DELETE FROM journal_view_sessions WHERE notebook_id=$1`, n.ID); err != nil {
			internal(w)
			return
		}
	}
	if action != "" {
		if err = s.audit(r, tx, n.ID, strings.TrimSpace(action)); err != nil {
			internal(w)
			return
		}
	}
	if err = tx.Commit(); err != nil {
		internal(w)
		return
	}
	writeJSON(w, 200, n)
}
func (s *Service) audit(r *http.Request, tx *sql.Tx, id int64, action string) error {
	var adminID any
	if session, ok := auth.SessionFromContext(r.Context()); ok {
		adminID = session.AdminID
	}
	_, err := tx.ExecContext(r.Context(), `INSERT INTO journal_audit(notebook_id,admin_id,action) VALUES($1,$2,$3)`, id, adminID, action)
	return err
}
func (s *Service) deleteNotebook(w http.ResponseWriter, r *http.Request) {
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		internal(w)
		return
	}
	defer tx.Rollback()
	id := idParam(r, "id")
	var found int64
	if err = tx.QueryRowContext(r.Context(), `SELECT id FROM journal_notebooks WHERE id=$1 FOR UPDATE`, id).Scan(&found); err != nil {
		dbError(w, err)
		return
	}
	var count int
	if err = tx.QueryRowContext(r.Context(), `SELECT count(*) FROM journal_entries WHERE notebook_id=$1`, id).Scan(&count); err != nil {
		internal(w)
		return
	}
	if count > 0 {
		writeError(w, 409, "notebook_not_empty", "Remove all entries, including trash, before deleting this notebook")
		return
	}
	if err = s.audit(r, tx, id, "deleted"); err != nil {
		internal(w)
		return
	}
	if _, err = tx.ExecContext(r.Context(), `DELETE FROM journal_notebooks WHERE id=$1`, id); err != nil {
		internal(w)
		return
	}
	if err = tx.Commit(); err != nil {
		internal(w)
		return
	}
	w.WriteHeader(204)
}
func (s *Service) listPublicNotebooks(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT id,public_title,cover_color FROM journal_notebooks WHERE public_enabled AND NOT archived AND password_hash<>'' ORDER BY id`)
	if err != nil {
		internal(w)
		return
	}
	defer rows.Close()
	type card struct {
		ID          int64  `json:"id"`
		PublicTitle string `json:"public_title"`
		CoverColor  string `json:"cover_color"`
	}
	items := []card{}
	for rows.Next() {
		var c card
		if err = rows.Scan(&c.ID, &c.PublicTitle, &c.CoverColor); err != nil {
			internal(w)
			return
		}
		items = append(items, c)
	}
	if rows.Err() != nil {
		internal(w)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}
