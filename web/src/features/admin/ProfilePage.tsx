import { CheckCircle2, Languages, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { APIRequestError, apiFetch } from "../../lib/api";
import styles from "./Admin.module.css";
import {
  adminLocaleRoleLabel,
  adminLocaleTabLabel,
  translationStatusLabel,
  type TranslationLocale,
} from "./adminI18n";

type Locale = "zh" | TranslationLocale;
type TranslationStatus = "empty" | "ai_draft" | "reviewed";

type SocialLink = {
  id?: number;
  icon: string;
  label: string;
  url: string;
};

type LocalizedSocialLink = {
  icon: string;
  id: number;
  label: string;
  source_label: string;
  url: string;
};

type ProfileForm = {
  bio: string;
  email: string;
  headline: string;
  name: string;
  social_links: SocialLink[];
  summary: string;
};

type ProfileTranslation = {
  bio: string;
  etag: string | null;
  exists: boolean;
  headline: string;
  name: string;
  social_links: LocalizedSocialLink[];
  stale: boolean;
  summary: string;
  translation_status: TranslationStatus;
};

type ProfileResponse = ProfileForm & {
  translations?: Partial<Record<TranslationLocale, Partial<ProfileTranslation>>>;
};

const emptyProfile: ProfileForm = {
  bio: "",
  email: "",
  headline: "",
  name: "",
  social_links: [],
  summary: "",
};

const emptyTranslation = (): ProfileTranslation => ({
  bio: "",
  etag: null,
  exists: false,
  headline: "",
  name: "",
  social_links: [],
  stale: false,
  summary: "",
  translation_status: "empty",
});

const emptyTranslations = (): Record<TranslationLocale, ProfileTranslation> => ({
  en: emptyTranslation(),
  ja: emptyTranslation(),
});

export function ProfilePage() {
  const [activeLocale, setActiveLocale] = useState<Locale>("zh");
  const [etag, setEtag] = useState("");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [profile, setProfile] = useState<ProfileForm>(emptyProfile);
  const [saving, setSaving] = useState(false);
  const [translations, setTranslations] = useState<Record<TranslationLocale, ProfileTranslation>>(emptyTranslations);
  const translationLocale = activeLocale === "zh" ? null : activeLocale;

  useEffect(() => {
    let cancelled = false;
    loadProfile().then(({ body, etag: nextEtag }) => {
      if (!cancelled) {
        setProfile({ ...emptyProfile, ...body, social_links: body.social_links ?? [] });
        setTranslations(profileTranslationsFrom(body));
        setEtag(nextEtag);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const currentTranslation = translationLocale ? translations[translationLocale] : null;
  const reviewedLocales = (["en", "ja"] as const).filter(
    (locale) => translations[locale].translation_status === "reviewed",
  ).length;
  const draftLocales = (["en", "ja"] as const).filter(
    (locale) => translations[locale].translation_status === "ai_draft",
  ).length;

  async function reloadProfile(successMessage?: string) {
    const { body, etag: nextEtag } = await loadProfile();
    setProfile({ ...emptyProfile, ...body, social_links: body.social_links ?? [] });
    setTranslations(profileTranslationsFrom(body));
    setEtag(nextEtag);
    if (successMessage) {
      setMessage(successMessage);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setFieldErrors({});
    setSaving(true);
    try {
      await apiFetch("/api/admin/profile", {
        body: JSON.stringify(profile),
        headers: { "If-Match": etag },
        method: "PUT",
      });
      await reloadProfile("资料已保存");
    } catch (error) {
      if (error instanceof APIRequestError) {
        setMessage(error.message);
        setFieldErrors(error.fields ?? {});
      } else {
        setMessage("保存资料失败");
      }
    } finally {
      setSaving(false);
    }
  }

  async function saveTranslation(locale: TranslationLocale, successMessage = "辅助语言已保存") {
    setMessage("");
    setSaving(true);
    try {
      const translation = translations[locale];
      const headers: Record<string, string> = {};
      if (translation.exists && translation.etag) {
        headers["If-Match"] = translation.etag;
      } else {
        headers["If-None-Match"] = "*";
      }
      await apiFetch(`/api/admin/profile/translations/${locale}`, {
        body: JSON.stringify({
          bio: translation.bio,
          headline: translation.headline,
          name: translation.name,
          social_links: translation.social_links.map((link) => ({
            id: link.id,
            label: link.label,
          })),
          summary: translation.summary,
        }),
        headers,
        method: "PUT",
      });
      await reloadProfile(successMessage);
    } catch (error) {
      setMessage(error instanceof APIRequestError ? error.message : "保存辅助语言失败");
    } finally {
      setSaving(false);
    }
  }

  async function generateTranslation(locale: TranslationLocale) {
    setMessage("");
    setSaving(true);
    try {
      await apiFetch(`/api/admin/profile/translations/${locale}/generate`, {
        method: "POST",
      });
      await reloadProfile("辅助语言已生成");
    } catch (error) {
      setMessage(error instanceof APIRequestError ? error.message : "生成辅助语言失败");
    } finally {
      setSaving(false);
    }
  }

  async function markReviewed(locale: TranslationLocale) {
    const translation = translations[locale];
    if (!translation.etag) {
      setMessage("请先保存辅助语言，再标记为已审核。");
      return;
    }
    setMessage("");
    setSaving(true);
    try {
      await apiFetch(`/api/admin/profile/translations/${locale}/review`, {
        headers: { "If-Match": translation.etag },
        method: "POST",
      });
      await reloadProfile("辅助语言已审核");
    } catch (error) {
      setMessage(error instanceof APIRequestError ? error.message : "审核辅助语言失败");
    } finally {
      setSaving(false);
    }
  }

  function updateTranslationField<Key extends keyof ProfileTranslation>(
    locale: TranslationLocale,
    key: Key,
    value: ProfileTranslation[Key],
  ) {
    setTranslations((current) => ({
      ...current,
      [locale]: {
        ...current[locale],
        [key]: value,
      },
    }));
  }

  function updateTranslationSocialLink(locale: TranslationLocale, linkID: number, label: string) {
    setTranslations((current) => ({
      ...current,
      [locale]: {
        ...current[locale],
        social_links: current[locale].social_links.map((link) =>
          link.id === linkID
            ? {
                ...link,
                label,
              }
            : link,
        ),
      },
    }));
  }

  return (
    <form className={`${styles.panel} ${styles.stack}`} onSubmit={onSubmit}>
      <div className={styles.pageHeader}>
        <div>
          <h1>资料</h1>
          <p>维护全站共享的中文主资料，并为英文、日文补充辅助语言版本。</p>
        </div>
        <div className={styles.headerActions}>
          {currentTranslation ? (
            <>
              <button
                className={styles.button}
                disabled={saving}
                onClick={() => translationLocale && void generateTranslation(translationLocale)}
                type="button"
              >
                <Sparkles aria-hidden="true" size={17} />
                {currentTranslation.exists ? "重新生成辅助语言" : "生成辅助语言"}
              </button>
              <button
                className={styles.button}
                disabled={saving || !currentTranslation.exists || !currentTranslation.etag}
                onClick={() => translationLocale && void markReviewed(translationLocale)}
                type="button"
              >
                <CheckCircle2 aria-hidden="true" size={17} />
                标记为已审核
              </button>
              {currentTranslation.translation_status === "reviewed" ? (
                <button
                  className={styles.button}
                  disabled={saving}
                  onClick={() =>
                    translationLocale &&
                    void saveTranslation(translationLocale, "已取消发布辅助语言，可以继续修改译文。")
                  }
                  type="button"
                >
                  <Languages aria-hidden="true" size={17} />
                  取消发布辅助语言
                </button>
              ) : null}
              <button
                className={`${styles.button} ${styles.primary}`}
                disabled={saving}
                onClick={() => translationLocale && void saveTranslation(translationLocale)}
                type="button"
              >
                <Save aria-hidden="true" size={18} />
                {saving ? "保存中..." : "保存辅助语言"}
              </button>
            </>
          ) : (
            <button className={`${styles.button} ${styles.primary}`} disabled={saving} type="submit">
              <Save aria-hidden="true" size={18} />
              {saving ? "保存中..." : "保存资料"}
            </button>
          )}
        </div>
      </div>

      <div className={styles.overviewGrid}>
        <article className={styles.overviewCard}>
          <span className={styles.overviewLabel}>主语言来源</span>
          <strong className={styles.overviewValue}>中文主资料</strong>
          <p className={styles.overviewNote}>资料基础信息保留在中文主表，只有需要时才扩展到英日辅助语言。</p>
        </article>
        <article className={styles.metric}>
          <span>已审核辅助语言</span>
          <strong>{reviewedLocales}</strong>
        </article>
        <article className={styles.metric}>
          <span>辅助语言草稿</span>
          <strong>{draftLocales}</strong>
        </article>
        <article className={styles.metric}>
          <span>社交链接</span>
          <strong>{profile.social_links.length}</strong>
        </article>
      </div>

      <div aria-label="Locales" className={styles.tabList} role="tablist">
        {(["zh", "en", "ja"] as const satisfies readonly Locale[]).map((locale) => {
          const selected = activeLocale === locale;
          return (
            <button
              aria-selected={selected}
              className={`${styles.tab} ${selected ? styles.tabActive : ""}`}
              key={locale}
              onClick={() => setActiveLocale(locale)}
              role="tab"
              type="button"
            >
              {adminLocaleTabLabel(locale)}
            </button>
          );
        })}
      </div>

      {message ? <p className={styles.message}>{message}</p> : null}

      {currentTranslation ? (
        <ProfileTranslationEditor
          locale={translationLocale!}
          translation={currentTranslation}
          update={(key, value) => translationLocale && updateTranslationField(translationLocale, key, value)}
          updateSocialLink={(linkID, label) => translationLocale && updateTranslationSocialLink(translationLocale, linkID, label)}
        />
      ) : (
        <>
          <section className={styles.formSection}>
            <h2>身份信息</h2>
            <div className={styles.grid}>
              <Field
                error={fieldErrors.name}
                label="姓名"
                onChange={(value) => setProfile({ ...profile, name: value })}
                value={profile.name}
              />
              <Field
                error={fieldErrors.email}
                label="邮箱"
                onChange={(value) => setProfile({ ...profile, email: value })}
                value={profile.email}
              />
            </div>
            <Field
              error={fieldErrors.headline}
              label="一句话介绍"
              onChange={(value) => setProfile({ ...profile, headline: value })}
              value={profile.headline}
            />
          </section>

          <section className={styles.formSection}>
            <h2>文案内容</h2>
            <Field
              error={fieldErrors.summary}
              label="摘要"
              onChange={(value) => setProfile({ ...profile, summary: value })}
              textarea
              value={profile.summary}
            />
            <Field
              error={fieldErrors.bio}
              label="详细介绍"
              onChange={(value) => setProfile({ ...profile, bio: value })}
              textarea
              value={profile.bio}
            />
          </section>

          <SocialLinksEditor
            links={profile.social_links}
            onChange={(links) => setProfile({ ...profile, social_links: links })}
          />
        </>
      )}
    </form>
  );
}

function ProfileTranslationEditor({
  locale,
  translation,
  updateSocialLink,
  update,
}: {
  locale: TranslationLocale;
  translation: ProfileTranslation;
  updateSocialLink: (linkID: number, label: string) => void;
  update: <Key extends keyof ProfileTranslation>(key: Key, value: ProfileTranslation[Key]) => void;
}) {
  return (
    <>
      <section className={styles.formSection}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>{adminLocaleRoleLabel(locale)}</h2>
            <p>这里的内容只影响当前辅助语言，不会改动中文主资料。</p>
          </div>
          <div className={styles.localeMeta}>
            <span className={`${styles.statusBadge} ${translation.stale ? styles.statusStale : ""}`}>
              {translationStatusLabel(translation.translation_status, translation.stale)}
            </span>
          </div>
        </div>
        <div className={styles.grid}>
          <Field label="姓名" onChange={(value) => update("name", value)} value={translation.name} />
          <Field label="一句话介绍" onChange={(value) => update("headline", value)} value={translation.headline} />
        </div>
      </section>

      <section className={styles.formSection}>
        <h2>辅助语言文案</h2>
        <Field label="摘要" onChange={(value) => update("summary", value)} textarea value={translation.summary} />
        <Field label="详细介绍" onChange={(value) => update("bio", value)} textarea value={translation.bio} />
      </section>

      <section className={styles.formSection}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>辅助语言社交链接</h2>
            <p>只翻译链接名称，URL 和图标继续复用中文主资料里的共享配置。</p>
          </div>
        </div>
        {translation.social_links.length === 0 ? <p className={styles.fieldHelp}>当前还没有可翻译的社交链接。</p> : null}
        {translation.social_links.map((link) => (
          <div className={styles.socialRow} key={link.id}>
            <Field
              helpText={`${link.url} · 中文名称：${link.source_label}`}
              id={`social-link-${link.id}-label`}
              label={`${link.source_label} 名称`}
              onChange={(value) => updateSocialLink(link.id, value)}
              value={link.label}
            />
          </div>
        ))}
      </section>
    </>
  );
}

async function loadProfile() {
  const response = await fetch("/api/admin/profile", { credentials: "include" });
  const body = (await response.json()) as ProfileResponse;
  return { body, etag: response.headers.get("ETag") ?? "" };
}

function profileTranslationsFrom(body: ProfileResponse): Record<TranslationLocale, ProfileTranslation> {
  const next = emptyTranslations();
  for (const locale of ["en", "ja"] as const satisfies readonly TranslationLocale[]) {
    const translation = body.translations?.[locale];
    next[locale] = {
      bio: typeof translation?.bio === "string" ? translation.bio : "",
      etag: typeof translation?.etag === "string" ? translation.etag : null,
      exists: translation?.exists === true,
      headline: typeof translation?.headline === "string" ? translation.headline : "",
      name: typeof translation?.name === "string" ? translation.name : "",
      social_links: Array.isArray(translation?.social_links)
        ? translation.social_links.flatMap((link) =>
            typeof link?.id === "number" &&
            typeof link?.source_label === "string" &&
            typeof link?.url === "string" &&
            typeof link?.icon === "string"
              ? [
                  {
                    icon: link.icon,
                    id: link.id,
                    label: typeof link.label === "string" ? link.label : "",
                    source_label: link.source_label,
                    url: link.url,
                  },
                ]
              : [],
          )
        : [],
      stale: translation?.stale === true,
      summary: typeof translation?.summary === "string" ? translation.summary : "",
      translation_status:
        translation?.translation_status === "ai_draft" || translation?.translation_status === "reviewed"
          ? translation.translation_status
          : "empty",
    };
  }
  return next;
}

function Field({
  error,
  helpText,
  id,
  label,
  onChange,
  placeholder,
  textarea = false,
  value,
}: {
  error?: string;
  helpText?: string;
  id?: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  textarea?: boolean;
  value: string;
}) {
  const fieldID = id ?? label.toLowerCase().replaceAll(" ", "-");
  return (
    <div className={styles.field}>
      <label htmlFor={fieldID}>{label}</label>
      {textarea ? (
        <textarea id={fieldID} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} value={value} />
      ) : (
        <input id={fieldID} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} value={value} />
      )}
      {helpText ? <p className={styles.fieldHelp}>{helpText}</p> : null}
      {error ? <span className={styles.message}>{error}</span> : null}
    </div>
  );
}

function SocialLinksEditor({
  links,
  onChange,
}: {
  links: SocialLink[];
  onChange: (links: SocialLink[]) => void;
}) {
  return (
    <section className={styles.formSection}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>社交链接</h2>
          <p>这些链接会显示在首页和其他公开页面的联系区域。</p>
        </div>
        <button
          className={styles.button}
          onClick={() => onChange([...links, { icon: "link", label: "", url: "" }])}
          type="button"
        >
          <Plus aria-hidden="true" size={17} />
          新增链接
        </button>
      </div>
      {links.map((link, index) => (
        <div className={styles.socialRow} key={link.id ?? `new-${index}`}>
          <Field
            label="名称"
            onChange={(value) => onChange(replaceLink(links, index, { ...link, label: value }))}
            value={link.label}
          />
          <Field
            label="URL"
            onChange={(value) => onChange(replaceLink(links, index, { ...link, url: value }))}
            value={link.url}
          />
          <button
            aria-label={`删除${link.label || "社交链接"}`}
            className={`${styles.iconButton} ${styles.danger}`}
            onClick={() => onChange(links.filter((_, itemIndex) => itemIndex !== index))}
            type="button"
          >
            <Trash2 aria-hidden="true" size={17} />
            删除
          </button>
        </div>
      ))}
    </section>
  );
}

function replaceLink(links: SocialLink[], index: number, link: SocialLink) {
  return links.map((item, itemIndex) => (itemIndex === index ? link : item));
}
