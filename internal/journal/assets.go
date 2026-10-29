package journal

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"unicode"

	"github.com/disintegration/imaging"
	_ "golang.org/x/image/webp"
)

const maxImageBytes = 5 << 20
const maxStoredImageBytes = 24 << 20
const maxArchiveBytes = 200 << 20

func cleanFileName(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, name)
	if !validText(name, 150) || name == "." || name == "" {
		return "photo"
	}
	return name
}
func prepareImage(data []byte, name string) (Asset, []byte, error) {
	var a Asset
	if len(data) == 0 || len(data) > maxStoredImageBytes {
		return a, nil, errors.New("Image is too large")
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "jpeg" && format != "png" && format != "webp") {
		return a, nil, errors.New("Choose a JPEG, PNG or WebP image")
	}
	if cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 10000 || cfg.Height > 10000 || int64(cfg.Width)*int64(cfg.Height) > 20000000 {
		return a, nil, errors.New("Image must be at most 20 megapixels")
	}
	img, err := imaging.Decode(bytes.NewReader(data), imaging.AutoOrientation(true))
	if err != nil {
		return a, nil, errors.New("Invalid image")
	}
	var out bytes.Buffer
	a.MIMEType = "image/png"
	if format == "jpeg" {
		a.MIMEType = "image/jpeg"
		err = jpeg.Encode(&out, img, &jpeg.Options{Quality: 92})
	} else {
		err = png.Encode(&out, img)
	}
	if err != nil {
		return a, nil, errors.New("Could not process image")
	}
	if out.Len() > maxStoredImageBytes {
		return a, nil, errors.New("Processed image is too large")
	}
	a.Width = img.Bounds().Dx()
	a.Height = img.Bounds().Dy()
	a.FileName = cleanFileName(name)
	a.SizeBytes = int64(out.Len())
	return a, out.Bytes(), nil
}
func insertAsset(ctx context.Context, tx *sql.Tx, book int64, a Asset, data []byte) (Asset, error) {
	a.NotebookID = book
	err := tx.QueryRowContext(ctx, `INSERT INTO journal_assets(notebook_id,mime_type,width,height,file_name,size_bytes,data) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`, book, a.MIMEType, a.Width, a.Height, a.FileName, a.SizeBytes, data).Scan(&a.ID)
	return a, err
}
func (s *Service) uploadAsset(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	if err := s.notebookExists(r.Context(), id); err != nil {
		dbError(w, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxImageBytes+(1<<20))
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		bad(w, "Image must be at most 5 MB")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	f, h, err := r.FormFile("file")
	if err != nil {
		bad(w, "Choose an image file")
		return
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxImageBytes+1))
	if err != nil || len(data) > maxImageBytes {
		bad(w, "Image must be at most 5 MB")
		return
	}
	a, data, err := prepareImage(data, h.Filename)
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
	a, err = insertAsset(r.Context(), tx, id, a, data)
	if err != nil {
		internal(w)
		return
	}
	if err = tx.Commit(); err != nil {
		internal(w)
		return
	}
	writeJSON(w, 201, a)
}
func (s *Service) getAdminAsset(w http.ResponseWriter, r *http.Request) {
	s.serveAsset(w, r, idParam(r, "id"), 0, false)
}
func (s *Service) getPublicAsset(w http.ResponseWriter, r *http.Request) {
	book, ok := s.authorize(w, r)
	if !ok {
		return
	}
	s.serveAsset(w, r, idParam(r, "assetId"), book, true)
}
func (s *Service) serveAsset(w http.ResponseWriter, r *http.Request, id, book int64, public bool) {
	query := `SELECT a.mime_type,a.data FROM journal_assets a WHERE a.id=$1`
	args := []any{id}
	if public {
		query += ` AND a.notebook_id=$2 AND EXISTS(SELECT 1 FROM journal_entry_assets ref JOIN journal_entries e ON e.id=ref.entry_id WHERE ref.asset_id=a.id AND e.notebook_id=$2 AND e.deleted_at IS NULL)`
		args = append(args, book)
	}
	var mime string
	var data []byte
	if err := s.db.QueryRowContext(r.Context(), query, args...).Scan(&mime, &data); err != nil {
		dbError(w, err)
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Header().Set("Content-Disposition", "inline")
	w.WriteHeader(200)
	_, _ = w.Write(data)
}
