import { ImagePlus, Plus, Save, Trash2 } from "lucide-react";
import { type FormEvent, type InputHTMLAttributes, useEffect, useState } from "react";

import { APIRequestError, apiFetch } from "../../lib/api";
import styles from "./Admin.module.css";
import {
  adminLocaleRoleLabel,
  adminLocaleTabLabel,
  type TranslationLocale,
} from "./adminI18n";
import { translationActionError } from "./translationErrors";
import { TranslationWorkflow } from "./TranslationWorkflow";

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
  avatarMediaID: string;
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

type ProfileResponse = Omit<ProfileForm, "avatarMediaID"> & {
  avatar_media_id?: number | null;
  translations?: Partial<Record<TranslationLocale, Partial<ProfileTranslation>>>;
};

const emptyProfile: ProfileForm = {
  avatarMediaID: "",
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
  const [uploadingSocialIndex, setUploadingSocialIndex] = useState<number | null>(null);
  const [translations, setTranslations] = useState<Record<TranslationLocale, ProfileTranslation>>(emptyTranslations);
  const translationLocale = activeLocale === "zh" ? null : activeLocale;

  useEffect(() => {
    let cancelled = false;
    loadProfile().then(({ body, etag: nextEtag }) => {
      if (!cancelled) {
        setProfile(profileFormFromResponse(body));
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
    (locale) => translations[locale].translation_status === "reviewed" && !translations[locale].stale,
  ).length;
  const draftLocales = (["en", "ja"] as const).filter(
    (locale) => translations[locale].translation_status === "ai_draft" || translations[locale].stale,
  ).length;

  async function reloadProfile(successMessage?: string) {
    const { body, etag: nextEtag } = await loadProfile();
    setProfile(profileFormFromResponse(body));
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
        body: JSON.stringify(profilePayload(profile)),
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
      setMessage(translationActionError(error, "生成辅助语言失败"));
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
      await reloadProfile("辅助语言已审核并发布");
    } catch (error) {
      setMessage(error instanceof APIRequestError ? error.message : "审核辅助语言失败");
    } finally {
      setSaving(false);
    }
  }

  async function uploadSocialImage(index: number, file: File) {
    const body = new FormData();
    body.append("file", file);
    setMessage("");
    setUploadingSocialIndex(index);
    try {
      const uploaded = await apiFetch<{ id: number }>("/api/admin/media", {
        body,
        method: "POST",
      });
      setProfile((current) => {
        const link = current.social_links[index];
        if (!link) {
          return current;
        }
        return {
          ...current,
          social_links: replaceLink(current.social_links, index, {
            ...link,
            icon: `media://asset/${uploaded.id}/avatar`,
          }),
        };
      });
      setMessage("社交图片已上传，请保存资料。");
    } catch (error) {
      setMessage(error instanceof APIRequestError ? error.message : "上传社交图片失败");
    } finally {
      setUploadingSocialIndex(null);
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
        {!currentTranslation ? (
          <div className={styles.headerActions}>
            <button className={`${styles.button} ${styles.primary}`} disabled={saving} type="submit">
              <Save aria-hidden="true" size={18} />
              {saving ? "保存中..." : "保存资料"}
            </button>
          </div>
        ) : null}
      </div>

      <div className={styles.overviewGrid}>
        <article className={styles.overviewCard}>
          <span className={styles.overviewLabel}>主语言来源</span>
          <strong className={styles.overviewValue}>中文主资料</strong>
          <p className={styles.overviewNote}>资料基础信息保留在中文主表，只有需要时才扩展到英日辅助语言。</p>
        </article>
        <article className={styles.metric}>
          <span>已发布辅助语言</span>
          <strong>{reviewedLocales}</strong>
        </article>
        <article className={styles.metric}>
          <span>待处理辅助语言</span>
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
          generating={saving}
          locale={translationLocale!}
          onGenerate={() => translationLocale && void generateTranslation(translationLocale)}
          onReview={() => translationLocale && void markReviewed(translationLocale)}
          onSave={() => translationLocale && void saveTranslation(translationLocale)}
          onUnpublish={() =>
            translationLocale &&
            void saveTranslation(translationLocale, "已取消发布辅助语言，可以继续修改译文。")
          }
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
              <Field
                error={fieldErrors.avatar_media_id}
                helpText="可以填 12，也可以直接粘贴 media://asset/12/card 或 Markdown 图片引用。留空则继续显示姓名首字。"
                inputMode="numeric"
                placeholder="media://asset/12/card 或 12"
                label="首页头像媒体 ID"
                onChange={(value) => setProfile({ ...profile, avatarMediaID: value })}
                value={profile.avatarMediaID}
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
            onUploadImage={uploadSocialImage}
            uploadingIndex={uploadingSocialIndex}
          />
        </>
      )}
    </form>
  );
}

function ProfileTranslationEditor({
  generating,
  locale,
  onGenerate,
  onReview,
  onSave,
  onUnpublish,
  translation,
  updateSocialLink,
  update,
}: {
  generating: boolean;
  locale: TranslationLocale;
  onGenerate: () => void;
  onReview: () => void;
  onSave: () => void;
  onUnpublish: () => void;
  translation: ProfileTranslation;
  updateSocialLink: (linkID: number, label: string) => void;
  update: <Key extends keyof ProfileTranslation>(key: Key, value: ProfileTranslation[Key]) => void;
}) {
  return (
    <>
      <TranslationWorkflow
        busy={generating}
        locale={locale}
        onGenerate={onGenerate}
        onReview={onReview}
        onSave={onSave}
        onUnpublish={onUnpublish}
        translation={translation}
      />

      <section className={styles.formSection}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>{adminLocaleRoleLabel(locale)}</h2>
            <p>AI 草稿可以继续人工修改，保存后不会立即公开。</p>
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

function profileFormFromResponse(body: ProfileResponse): ProfileForm {
  return {
    ...emptyProfile,
    bio: body.bio ?? "",
    email: body.email ?? "",
    headline: body.headline ?? "",
    name: body.name ?? "",
    social_links: body.social_links ?? [],
    summary: body.summary ?? "",
    avatarMediaID: body.avatar_media_id ? String(body.avatar_media_id) : "",
  };
}

function profilePayload(profile: ProfileForm) {
  const { avatarMediaID, ...payload } = profile;
  const avatarMediaIDValue = mediaIDFromInput(avatarMediaID);
  return {
    ...payload,
    avatar_media_id: avatarMediaIDValue,
  };
}

function mediaIDFromInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d+$/.test(trimmed)) {
    const numericID = Number.parseInt(trimmed, 10);
    return numericID > 0 ? numericID : null;
  }
  const mediaRefMatch = trimmed.match(/media:\/\/asset\/(\d+)\/[a-zA-Z0-9_-]+/);
  if (!mediaRefMatch) {
    return null;
  }
  const refID = Number.parseInt(mediaRefMatch[1], 10);
  return refID > 0 ? refID : null;
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
  inputMode,
  label,
  onChange,
  placeholder,
  textarea = false,
  value,
}: {
  error?: string;
  helpText?: string;
  id?: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
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
        <input
          id={fieldID}
          inputMode={inputMode}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          value={value}
        />
      )}
      {helpText ? <p className={styles.fieldHelp}>{helpText}</p> : null}
      {error ? <span className={styles.message}>{error}</span> : null}
    </div>
  );
}

function SocialLinksEditor({
  links,
  onChange,
  onUploadImage,
  uploadingIndex,
}: {
  links: SocialLink[];
  onChange: (links: SocialLink[]) => void;
  onUploadImage: (index: number, file: File) => Promise<void>;
  uploadingIndex: number | null;
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
          <SocialImageControl
            index={index}
            link={link}
            onUploadImage={onUploadImage}
            uploading={uploadingIndex === index}
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

function SocialImageControl({
  index,
  link,
  onUploadImage,
  uploading,
}: {
  index: number;
  link: SocialLink;
  onUploadImage: (index: number, file: File) => Promise<void>;
  uploading: boolean;
}) {
  const label = link.label.trim() || "社交链接";
  const inputID = `social-link-${link.id ?? index}-image`;
  const previewURL = mediaURLFromIcon(link.icon);

  return (
    <div className={styles.socialImageCell}>
      <div className={styles.socialImagePreview}>
        {previewURL ? (
          <img alt={`${label} 社交图片`} src={previewURL} />
        ) : (
          <ImagePlus aria-hidden="true" size={18} />
        )}
      </div>
      <label className={`${styles.button} ${styles.socialUploadButton}`} htmlFor={inputID}>
        <ImagePlus aria-hidden="true" size={16} />
        {uploading ? "上传中..." : "上传图片"}
      </label>
      <input
        accept="image/png,image/jpeg,image/webp"
        aria-label={`${label} 社交图片文件`}
        className={styles.hiddenInput}
        id={inputID}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void onUploadImage(index, file);
          }
          event.currentTarget.value = "";
        }}
        type="file"
      />
    </div>
  );
}

function mediaURLFromIcon(icon: string) {
  const match = icon.match(/media:\/\/asset\/(\d+)\/([a-zA-Z0-9_-]+)/);
  return match ? `/media/${match[1]}/${match[2]}` : "";
}

function replaceLink(links: SocialLink[], index: number, link: SocialLink) {
  return links.map((item, itemIndex) => (itemIndex === index ? link : item));
}
