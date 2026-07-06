package translation

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"portfolio/internal/i18n"
)

func TestGenerateReturnsConfigurationErrorWhenProviderDisabled(t *testing.T) {
	service := NewService(Config{})

	_, err := service.GenerateProject(t.Context(), ProjectTranslationSource{
		Title:   "Chinese Source Title",
		Summary: "Chinese Source Summary",
	}, i18n.LocaleEN)
	if !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("GenerateProject err = %v", err)
	}
}

func TestGenerateProjectAbortsWhenLocaleRowChangesMidFlight(t *testing.T) {
	start := TranslationSnapshot{LocaleETag: `"before"`, SourceVersion: 3}
	end := TranslationSnapshot{LocaleETag: `"after"`, SourceVersion: 3}
	err := checkGenerationSnapshot(start, end)
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("checkGenerationSnapshot err = %v", err)
	}
}

func TestGenerateProjectUsesDeepSeekJSONResponse(t *testing.T) {
	service := NewService(Config{
		Provider: "deepseek",
		APIKey:   "test-key",
		Timeout:  time.Second,
		Client: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			if req.URL.String() != "https://api.deepseek.com/chat/completions" {
				t.Fatalf("request url = %s", req.URL.String())
			}
			if got := req.Header.Get("Authorization"); got != "Bearer test-key" {
				t.Fatalf("authorization = %q", got)
			}
			if got := req.Header.Get("Content-Type"); got != "application/json" {
				t.Fatalf("content-type = %q", got)
			}
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("read body: %v", err)
			}
			text := string(body)
			if !strings.Contains(text, `"response_format":{"type":"json_object"}`) {
				t.Fatalf("request body missing json response format: %s", text)
			}
			if !strings.Contains(text, `"thinking":{"type":"disabled"}`) {
				t.Fatalf("request body missing disabled thinking: %s", text)
			}
			return jsonResponse(`{"title":"English Title","slug":"english-title","summary":"Translated summary","content_md":"","seo_title":"SEO title","seo_description":"SEO description"}`), nil
		}),
	})

	generated, err := service.GenerateProject(t.Context(), ProjectTranslationSource{
		Title:          "中文标题",
		SourceSlug:     "zh-source-slug",
		Summary:        "中文摘要",
		ContentMD:      "正文",
		SEOTitle:       "中文 SEO 标题",
		SEODescription: "中文 SEO 描述",
	}, i18n.LocaleEN)
	if err != nil {
		t.Fatalf("GenerateProject: %v", err)
	}
	if generated.Title != "English Title" || generated.Slug != "english-title" || generated.Summary != "Translated summary" {
		t.Fatalf("generated = %+v", generated)
	}
}

type roundTripFunc func(req *http.Request) (*http.Response, error)

func (fn roundTripFunc) Do(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func jsonResponse(content string) *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Header: http.Header{
			"Content-Type": []string{"application/json"},
		},
		Body: io.NopCloser(strings.NewReader(`{"choices":[{"message":{"content":` + `"` + strings.ReplaceAll(strings.ReplaceAll(content, `\`, `\\`), `"`, `\"`) + `"` + `}}]}`)),
	}
}
