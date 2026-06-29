package translation

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"portfolio/internal/i18n"
)

const (
	defaultDeepSeekBaseURL = "https://api.deepseek.com"
	defaultDeepSeekModel   = "deepseek-v4-flash"
	defaultTimeout         = 30 * time.Second
)

var (
	ErrProviderUnavailable   = errors.New("translation provider is not configured")
	ErrProviderRequestFailed = errors.New("translation provider request failed")
	ErrInvalidResponse       = errors.New("translation provider returned invalid response")
	ErrConflict              = errors.New("translation changed during generation")
)

type HTTPClient interface {
	Do(req *http.Request) (*http.Response, error)
}

type Config struct {
	Provider string
	APIKey   string
	BaseURL  string
	Model    string
	Timeout  time.Duration
	Client   HTTPClient
}

type Service struct {
	cfg Config
}

type TranslationSnapshot struct {
	LocaleETag    string
	SourceVersion int64
}

type ProjectTranslationSource struct {
	Title          string
	SourceSlug     string
	Summary        string
	ContentMD      string
	SEOTitle       string
	SEODescription string
}

type GeneratedProjectTranslation struct {
	Title          string
	Slug           string
	Summary        string
	ContentMD      string
	SEOTitle       string
	SEODescription string
}

type WritingTranslationSource struct {
	Title          string
	SourceSlug     string
	Excerpt        string
	ContentMD      string
	SEOTitle       string
	SEODescription string
}

type GeneratedWritingTranslation struct {
	Title          string
	Slug           string
	Excerpt        string
	ContentMD      string
	SEOTitle       string
	SEODescription string
}

type TalkTranslationSource struct {
	Title          string
	SourceSlug     string
	Summary        string
	EventName      string
	SEOTitle       string
	SEODescription string
}

type GeneratedTalkTranslation struct {
	Title          string
	Slug           string
	Summary        string
	EventName      string
	SEOTitle       string
	SEODescription string
}

type ExperienceTranslationSource struct {
	Period       string
	Title        string
	Organization string
	Description  string
}

type GeneratedExperienceTranslation struct {
	Period       string
	Title        string
	Organization string
	Description  string
}

type ProfileSocialLinkTranslationSource struct {
	ID    int64  `json:"id"`
	Icon  string `json:"icon"`
	Label string `json:"label"`
	URL   string `json:"url"`
}

type GeneratedProfileSocialLinkTranslation struct {
	ID    int64  `json:"id"`
	Label string `json:"label"`
}

type ProfileTranslationSource struct {
	Name           string
	Headline       string
	Summary        string
	Bio            string
	SEOTitle       string
	SEODescription string
	SocialLinks    []ProfileSocialLinkTranslationSource `json:"social_links"`
}

type GeneratedProfileTranslation struct {
	Name           string
	Headline       string
	Summary        string
	Bio            string
	SEOTitle       string
	SEODescription string
	SocialLinks    []GeneratedProfileSocialLinkTranslation `json:"social_links"`
}

func NewService(cfg Config) *Service {
	normalized := Config{
		Provider: strings.ToLower(strings.TrimSpace(cfg.Provider)),
		APIKey:   strings.TrimSpace(cfg.APIKey),
		BaseURL:  strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/"),
		Model:    strings.TrimSpace(cfg.Model),
		Timeout:  cfg.Timeout,
		Client:   cfg.Client,
	}
	if normalized.BaseURL == "" {
		normalized.BaseURL = defaultDeepSeekBaseURL
	}
	if normalized.Model == "" {
		normalized.Model = defaultDeepSeekModel
	}
	if normalized.Timeout <= 0 {
		normalized.Timeout = defaultTimeout
	}
	if normalized.Client == nil {
		normalized.Client = &http.Client{}
	}
	return &Service{cfg: normalized}
}

func (s *Service) GenerateProject(ctx context.Context, source ProjectTranslationSource, locale i18n.Locale) (GeneratedProjectTranslation, error) {
	if !s.isConfigured() {
		return GeneratedProjectTranslation{}, ErrProviderUnavailable
	}
	switch s.cfg.Provider {
	case "deepseek":
		return s.generateProjectDeepSeek(ctx, source, locale)
	default:
		return GeneratedProjectTranslation{}, fmt.Errorf("%w: %s", ErrProviderUnavailable, s.cfg.Provider)
	}
}

func (s *Service) GenerateWriting(ctx context.Context, source WritingTranslationSource, locale i18n.Locale) (GeneratedWritingTranslation, error) {
	if !s.isConfigured() {
		return GeneratedWritingTranslation{}, ErrProviderUnavailable
	}
	switch s.cfg.Provider {
	case "deepseek":
		return s.generateWritingDeepSeek(ctx, source, locale)
	default:
		return GeneratedWritingTranslation{}, fmt.Errorf("%w: %s", ErrProviderUnavailable, s.cfg.Provider)
	}
}

func (s *Service) GenerateTalk(ctx context.Context, source TalkTranslationSource, locale i18n.Locale) (GeneratedTalkTranslation, error) {
	if !s.isConfigured() {
		return GeneratedTalkTranslation{}, ErrProviderUnavailable
	}
	switch s.cfg.Provider {
	case "deepseek":
		return s.generateTalkDeepSeek(ctx, source, locale)
	default:
		return GeneratedTalkTranslation{}, fmt.Errorf("%w: %s", ErrProviderUnavailable, s.cfg.Provider)
	}
}

func (s *Service) GenerateExperience(ctx context.Context, source ExperienceTranslationSource, locale i18n.Locale) (GeneratedExperienceTranslation, error) {
	if !s.isConfigured() {
		return GeneratedExperienceTranslation{}, ErrProviderUnavailable
	}
	switch s.cfg.Provider {
	case "deepseek":
		return s.generateExperienceDeepSeek(ctx, source, locale)
	default:
		return GeneratedExperienceTranslation{}, fmt.Errorf("%w: %s", ErrProviderUnavailable, s.cfg.Provider)
	}
}

func (s *Service) GenerateProfile(ctx context.Context, source ProfileTranslationSource, locale i18n.Locale) (GeneratedProfileTranslation, error) {
	if !s.isConfigured() {
		return GeneratedProfileTranslation{}, ErrProviderUnavailable
	}
	switch s.cfg.Provider {
	case "deepseek":
		return s.generateProfileDeepSeek(ctx, source, locale)
	default:
		return GeneratedProfileTranslation{}, fmt.Errorf("%w: %s", ErrProviderUnavailable, s.cfg.Provider)
	}
}

func (s *Service) isConfigured() bool {
	return s.cfg.Provider != "" && s.cfg.APIKey != ""
}

func checkGenerationSnapshot(start TranslationSnapshot, end TranslationSnapshot) error {
	if start.SourceVersion != end.SourceVersion || start.LocaleETag != end.LocaleETag {
		return ErrConflict
	}
	return nil
}
