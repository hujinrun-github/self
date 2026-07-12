export type AdminLocale = "zh" | "en" | "ja";
export type TranslationLocale = "en" | "ja";
export type TranslationStatus = "empty" | "ai_draft" | "reviewed";
export type ContentStatus = "archived" | "draft" | "published";

export function adminLocaleTabLabel(locale: AdminLocale) {
  if (locale === "zh") {
    return "中文（主）";
  }
  if (locale === "en") {
    return "英文（辅）";
  }
  return "日文（辅）";
}

export function adminLocaleRoleLabel(locale: AdminLocale) {
  if (locale === "zh") {
    return "中文主内容";
  }
  if (locale === "en") {
    return "英文辅助语言";
  }
  return "日文辅助语言";
}

export function adminTranslationLanguageName(locale: TranslationLocale) {
  return locale === "en" ? "英文" : "日文";
}

export function translationStatusLabel(status: TranslationStatus, stale = false) {
  const base = status === "reviewed" ? (stale ? "已失效" : "已审核并发布") : status === "ai_draft" ? "AI 草稿" : "未创建";
  return stale ? `${base} · 待同步` : base;
}

export function contentStatusLabel(status: ContentStatus) {
  if (status === "published") {
    return "已发布";
  }
  if (status === "archived") {
    return "已归档";
  }
  return "草稿";
}
