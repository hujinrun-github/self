package translation

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"portfolio/internal/i18n"
)

type deepSeekChatCompletionRequest struct {
	Model          string                 `json:"model"`
	Messages       []deepSeekChatMessage  `json:"messages"`
	ResponseFormat deepSeekResponseFormat `json:"response_format"`
	Thinking       deepSeekThinkingMode   `json:"thinking"`
	Stream         bool                   `json:"stream"`
}

type deepSeekChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type deepSeekResponseFormat struct {
	Type string `json:"type"`
}

type deepSeekThinkingMode struct {
	Type string `json:"type"`
}

type deepSeekChatCompletionResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

func (s *Service) generateProjectDeepSeek(ctx context.Context, source ProjectTranslationSource, locale i18n.Locale) (GeneratedProjectTranslation, error) {
	prompt, err := buildProjectPrompt(source, locale)
	if err != nil {
		return GeneratedProjectTranslation{}, err
	}

	var generated GeneratedProjectTranslation
	if err := s.deepSeekJSON(ctx, projectSystemPrompt(locale), prompt, &generated); err != nil {
		return GeneratedProjectTranslation{}, err
	}

	generated.Title = strings.TrimSpace(generated.Title)
	generated.Slug = strings.TrimSpace(generated.Slug)
	generated.Summary = strings.TrimSpace(generated.Summary)
	generated.SEOTitle = strings.TrimSpace(generated.SEOTitle)
	generated.SEODescription = strings.TrimSpace(generated.SEODescription)
	if strings.TrimSpace(generated.ContentMD) == "" {
		generated.ContentMD = ""
	}
	if generated.Title == "" || generated.Slug == "" || generated.Summary == "" {
		return GeneratedProjectTranslation{}, ErrInvalidResponse
	}
	return generated, nil
}

func (s *Service) generateProfileDeepSeek(ctx context.Context, source ProfileTranslationSource, locale i18n.Locale) (GeneratedProfileTranslation, error) {
	prompt, err := buildProfilePrompt(source, locale)
	if err != nil {
		return GeneratedProfileTranslation{}, err
	}

	var generated GeneratedProfileTranslation
	if err := s.deepSeekJSON(ctx, profileSystemPrompt(locale), prompt, &generated); err != nil {
		return GeneratedProfileTranslation{}, err
	}

	generated.Name = strings.TrimSpace(generated.Name)
	generated.Headline = strings.TrimSpace(generated.Headline)
	generated.Summary = strings.TrimSpace(generated.Summary)
	generated.SEOTitle = strings.TrimSpace(generated.SEOTitle)
	generated.SEODescription = strings.TrimSpace(generated.SEODescription)
	if strings.TrimSpace(generated.Bio) == "" {
		generated.Bio = ""
	}
	generated.SocialLinks, err = normalizeGeneratedProfileSocialLinks(source.SocialLinks, generated.SocialLinks)
	if err != nil {
		return GeneratedProfileTranslation{}, err
	}
	if generated.Name == "" || generated.Headline == "" || generated.Summary == "" {
		return GeneratedProfileTranslation{}, ErrInvalidResponse
	}
	return generated, nil
}

func (s *Service) generateWritingDeepSeek(ctx context.Context, source WritingTranslationSource, locale i18n.Locale) (GeneratedWritingTranslation, error) {
	prompt, err := buildWritingPrompt(source, locale)
	if err != nil {
		return GeneratedWritingTranslation{}, err
	}

	var generated GeneratedWritingTranslation
	if err := s.deepSeekJSON(ctx, writingSystemPrompt(locale), prompt, &generated); err != nil {
		return GeneratedWritingTranslation{}, err
	}

	generated.Title = strings.TrimSpace(generated.Title)
	generated.Slug = strings.TrimSpace(generated.Slug)
	generated.Excerpt = strings.TrimSpace(generated.Excerpt)
	generated.SEOTitle = strings.TrimSpace(generated.SEOTitle)
	generated.SEODescription = strings.TrimSpace(generated.SEODescription)
	if strings.TrimSpace(generated.ContentMD) == "" {
		generated.ContentMD = ""
	}
	if generated.Title == "" || generated.Slug == "" || generated.Excerpt == "" {
		return GeneratedWritingTranslation{}, ErrInvalidResponse
	}
	return generated, nil
}

func (s *Service) generateTalkDeepSeek(ctx context.Context, source TalkTranslationSource, locale i18n.Locale) (GeneratedTalkTranslation, error) {
	prompt, err := buildTalkPrompt(source, locale)
	if err != nil {
		return GeneratedTalkTranslation{}, err
	}

	var generated GeneratedTalkTranslation
	if err := s.deepSeekJSON(ctx, talkSystemPrompt(locale), prompt, &generated); err != nil {
		return GeneratedTalkTranslation{}, err
	}

	generated.Title = strings.TrimSpace(generated.Title)
	generated.Slug = strings.TrimSpace(generated.Slug)
	generated.Summary = strings.TrimSpace(generated.Summary)
	generated.EventName = strings.TrimSpace(generated.EventName)
	generated.SEOTitle = strings.TrimSpace(generated.SEOTitle)
	generated.SEODescription = strings.TrimSpace(generated.SEODescription)
	if generated.Title == "" || generated.Slug == "" || generated.Summary == "" || generated.EventName == "" {
		return GeneratedTalkTranslation{}, ErrInvalidResponse
	}
	return generated, nil
}

func (s *Service) generateExperienceDeepSeek(ctx context.Context, source ExperienceTranslationSource, locale i18n.Locale) (GeneratedExperienceTranslation, error) {
	prompt, err := buildExperiencePrompt(source, locale)
	if err != nil {
		return GeneratedExperienceTranslation{}, err
	}

	var generated GeneratedExperienceTranslation
	if err := s.deepSeekJSON(ctx, experienceSystemPrompt(locale), prompt, &generated); err != nil {
		return GeneratedExperienceTranslation{}, err
	}

	generated.Period = strings.TrimSpace(generated.Period)
	generated.Title = strings.TrimSpace(generated.Title)
	generated.Organization = strings.TrimSpace(generated.Organization)
	generated.Description = strings.TrimSpace(generated.Description)
	if generated.Period == "" || generated.Title == "" || generated.Organization == "" || generated.Description == "" {
		return GeneratedExperienceTranslation{}, ErrInvalidResponse
	}
	return generated, nil
}

func (s *Service) deepSeekJSON(ctx context.Context, systemPrompt string, userPrompt string, target any) error {
	requestBody := deepSeekChatCompletionRequest{
		Model: s.cfg.Model,
		Messages: []deepSeekChatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
		ResponseFormat: deepSeekResponseFormat{Type: "json_object"},
		Thinking:       deepSeekThinkingMode{Type: "disabled"},
		Stream:         false,
	}

	payload, err := json.Marshal(requestBody)
	if err != nil {
		return fmt.Errorf("%w: marshal request: %v", ErrProviderRequestFailed, err)
	}

	requestCtx, cancel := context.WithTimeout(ctx, s.cfg.Timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(requestCtx, http.MethodPost, s.cfg.BaseURL+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("%w: build request: %v", ErrProviderRequestFailed, err)
	}
	req.Header.Set("Authorization", "Bearer "+s.cfg.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.cfg.Client.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrProviderRequestFailed, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("%w: read response: %v", ErrProviderRequestFailed, err)
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		message := strings.TrimSpace(string(body))
		if message == "" {
			message = resp.Status
		}
		return fmt.Errorf("%w: %s", ErrProviderRequestFailed, message)
	}

	var completion deepSeekChatCompletionResponse
	if err := json.Unmarshal(body, &completion); err != nil {
		return fmt.Errorf("%w: decode completion: %v", ErrInvalidResponse, err)
	}
	if len(completion.Choices) == 0 {
		return ErrInvalidResponse
	}
	content := strings.TrimSpace(completion.Choices[0].Message.Content)
	if content == "" {
		return ErrInvalidResponse
	}
	if err := json.Unmarshal([]byte(content), target); err != nil {
		return fmt.Errorf("%w: decode generated json: %v", ErrInvalidResponse, err)
	}
	return nil
}

func buildProjectPrompt(source ProjectTranslationSource, locale i18n.Locale) (string, error) {
	payload := struct {
		TargetLocale string                   `json:"target_locale"`
		Source       ProjectTranslationSource `json:"source"`
	}{
		TargetLocale: localeName(locale),
		Source:       source,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func buildProfilePrompt(source ProfileTranslationSource, locale i18n.Locale) (string, error) {
	payload := struct {
		TargetLocale string                   `json:"target_locale"`
		Source       ProfileTranslationSource `json:"source"`
	}{
		TargetLocale: localeName(locale),
		Source:       source,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func buildWritingPrompt(source WritingTranslationSource, locale i18n.Locale) (string, error) {
	payload := struct {
		TargetLocale string                   `json:"target_locale"`
		Source       WritingTranslationSource `json:"source"`
	}{
		TargetLocale: localeName(locale),
		Source:       source,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func buildTalkPrompt(source TalkTranslationSource, locale i18n.Locale) (string, error) {
	payload := struct {
		TargetLocale string                `json:"target_locale"`
		Source       TalkTranslationSource `json:"source"`
	}{
		TargetLocale: localeName(locale),
		Source:       source,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func buildExperiencePrompt(source ExperienceTranslationSource, locale i18n.Locale) (string, error) {
	payload := struct {
		TargetLocale string                      `json:"target_locale"`
		Source       ExperienceTranslationSource `json:"source"`
	}{
		TargetLocale: localeName(locale),
		Source:       source,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func projectSystemPrompt(locale i18n.Locale) string {
	return fmt.Sprintf(
		"Translate Chinese portfolio project content into natural %s and return JSON only with keys title, slug, summary, content_md, seo_title, seo_description. Keep markdown structure in content_md. Slug must be lowercase ASCII romanized words separated by hyphens. Do not omit keys. If there is no long body, return content_md as an empty string.",
		localeName(locale),
	)
}

func profileSystemPrompt(locale i18n.Locale) string {
	return fmt.Sprintf(
		"Translate Chinese portfolio profile content into natural %s and return JSON only with keys name, headline, summary, bio, seo_title, seo_description, social_links. Keep bio as plain markdown-compatible text. social_links must be an array of objects with id and label, preserving every source id exactly once. Do not omit keys or social link items. Use empty strings only for optional SEO fields when needed.",
		localeName(locale),
	)
}

func normalizeGeneratedProfileSocialLinks(
	source []ProfileSocialLinkTranslationSource,
	generated []GeneratedProfileSocialLinkTranslation,
) ([]GeneratedProfileSocialLinkTranslation, error) {
	if len(source) == 0 {
		return nil, nil
	}
	if len(generated) != len(source) {
		return nil, ErrInvalidResponse
	}

	byID := make(map[int64]string, len(generated))
	for _, link := range generated {
		label := strings.TrimSpace(link.Label)
		if label == "" {
			return nil, ErrInvalidResponse
		}
		byID[link.ID] = label
	}

	normalized := make([]GeneratedProfileSocialLinkTranslation, 0, len(source))
	for _, link := range source {
		label, ok := byID[link.ID]
		if !ok {
			return nil, ErrInvalidResponse
		}
		normalized = append(normalized, GeneratedProfileSocialLinkTranslation{
			ID:    link.ID,
			Label: label,
		})
	}
	return normalized, nil
}

func writingSystemPrompt(locale i18n.Locale) string {
	return fmt.Sprintf(
		"Translate Chinese portfolio writing content into natural %s and return JSON only with keys title, slug, excerpt, content_md, seo_title, seo_description. Keep markdown structure in content_md. Slug must be lowercase ASCII romanized words separated by hyphens. Do not omit keys. If there is no long body, return content_md as an empty string.",
		localeName(locale),
	)
}

func talkSystemPrompt(locale i18n.Locale) string {
	return fmt.Sprintf(
		"Translate Chinese portfolio talk content into natural %s and return JSON only with keys title, slug, summary, event_name, seo_title, seo_description. Slug must be lowercase ASCII romanized words separated by hyphens. Do not omit keys. Use empty strings for optional SEO fields when needed.",
		localeName(locale),
	)
}

func experienceSystemPrompt(locale i18n.Locale) string {
	return fmt.Sprintf(
		"Translate Chinese portfolio experience content into natural %s and return JSON only with keys period, title, organization, description. Preserve the original meaning and chronology. Do not omit keys.",
		localeName(locale),
	)
}

func localeName(locale i18n.Locale) string {
	switch locale {
	case i18n.LocaleJA:
		return "Japanese"
	case i18n.LocaleEN:
		return "English"
	default:
		return string(locale)
	}
}
