package journal

import (
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

type Notebook struct {
	ID            int64     `json:"id"`
	Name          string    `json:"name"`
	PublicTitle   string    `json:"public_title"`
	CoverColor    string    `json:"cover_color"`
	Paper         string    `json:"paper"`
	PublicEnabled bool      `json:"public_enabled"`
	HasPassword   bool      `json:"has_password"`
	Archived      bool      `json:"archived"`
	Version       int64     `json:"version"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}
type Scene struct {
	SchemaVersion int       `json:"schemaVersion"`
	Width         float64   `json:"width"`
	Height        float64   `json:"height"`
	Paper         string    `json:"paper"`
	Elements      []Element `json:"elements"`
}
type Element struct {
	ID       string  `json:"id"`
	Type     string  `json:"type"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Width    float64 `json:"width"`
	Height   float64 `json:"height"`
	Rotation float64 `json:"rotation"`
	Locked   bool    `json:"locked"`
	Text     string  `json:"text,omitempty"`
	AssetID  int64   `json:"asset_id,omitempty"`
	Color    string  `json:"color,omitempty"`
	FontSize float64 `json:"font_size,omitempty"`
	Bold     bool    `json:"bold,omitempty"`
	Italic   bool    `json:"italic,omitempty"`
	Align    string  `json:"align,omitempty"`
}
type Entry struct {
	ID         int64      `json:"id"`
	NotebookID int64      `json:"notebook_id"`
	Title      string     `json:"title"`
	EntryDate  string     `json:"entry_date"`
	Mood       string     `json:"mood"`
	Weather    string     `json:"weather"`
	Tags       []string   `json:"tags"`
	Favorite   bool       `json:"favorite"`
	Scene      Scene      `json:"scene"`
	Version    int64      `json:"version"`
	DeletedAt  *time.Time `json:"deleted_at"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}
type Asset struct {
	ID         int64  `json:"id"`
	NotebookID int64  `json:"notebook_id"`
	MIMEType   string `json:"mime_type"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	FileName   string `json:"file_name"`
	SizeBytes  int64  `json:"size_bytes"`
}

var colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$`)

func validPaper(p string) bool { return p == "plain" || p == "ruled" || p == "dots" }
func bounded(v, lo, hi float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= lo && v <= hi
}
func validText(s string, max int) bool {
	return utf8.ValidString(s) && utf8.RuneCountInString(s) <= max && !strings.ContainsRune(s, 0)
}
func (e *Entry) validate() (string, []int64, error) {
	fail := func() (string, []int64, error) { return "", nil, errors.New("Invalid journal entry or canvas") }
	if _, err := time.Parse("2006-01-02", e.EntryDate); err != nil {
		return fail()
	}
	if !validText(e.Title, 300) || !validText(e.Mood, 40) || !validText(e.Weather, 100) || len(e.Tags) > 30 {
		return fail()
	}
	if e.Tags == nil {
		e.Tags = []string{}
	}
	seenTags := map[string]bool{}
	for i, tag := range e.Tags {
		tag = strings.TrimSpace(tag)
		if tag == "" || !validText(tag, 40) || seenTags[tag] {
			return fail()
		}
		seenTags[tag] = true
		e.Tags[i] = tag
	}
	sc := &e.Scene
	if sc.SchemaVersion != 1 || !bounded(sc.Width, 240, 4000) || !bounded(sc.Height, 240, 4000) || !validPaper(sc.Paper) || len(sc.Elements) > 300 {
		return fail()
	}
	if sc.Elements == nil {
		sc.Elements = []Element{}
	}
	ids := map[string]bool{}
	assets := map[int64]bool{}
	var text strings.Builder
	text.WriteString(e.Title)
	for _, el := range sc.Elements {
		if el.ID == "" || !validText(el.ID, 100) || ids[el.ID] || !bounded(el.X, -4000, 8000) || !bounded(el.Y, -4000, 8000) || !bounded(el.Width, 1, 8000) || !bounded(el.Height, 1, 8000) || !bounded(el.Rotation, -3600, 3600) || !validText(el.Text, 20000) {
			return fail()
		}
		if el.Color != "" && !colorPattern.MatchString(el.Color) {
			return fail()
		}
		if el.FontSize != 0 && !bounded(el.FontSize, 8, 240) {
			return fail()
		}
		if el.Align != "" && el.Align != "left" && el.Align != "center" && el.Align != "right" {
			return fail()
		}
		switch el.Type {
		case "photo":
			if el.AssetID < 0 {
				return fail()
			}
			if el.AssetID > 0 {
				assets[el.AssetID] = true
			}
		case "text", "note", "sticker":
			if el.AssetID != 0 {
				return fail()
			}
		default:
			return fail()
		}
		ids[el.ID] = true
		text.WriteByte('\n')
		text.WriteString(el.Text)
	}
	if text.Len() > 500000 {
		return fail()
	}
	assetIDs := make([]int64, 0, len(assets))
	for id := range assets {
		assetIDs = append(assetIDs, id)
	}
	return text.String(), assetIDs, nil
}
func encoded(v any) []byte { b, _ := json.Marshal(v); return b }
