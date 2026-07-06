import { ArrowLeft, CheckCircle2, Languages, Save, Sparkles, X } from "lucide-react";
import { type ClipboardEvent, type FormEvent, type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { APIRequestError, apiFetch } from "../../lib/api";
import styles from "./Admin.module.css";
import {
  adminLocaleRoleLabel,
  adminLocaleTabLabel,
  translationStatusLabel,
  type TranslationLocale,
} from "./adminI18n";
import { MarkdownEditor } from "./MarkdownEditor";
import { WritingImportDialog } from "./WritingImportDialog";

type Resource = "experience" | "projects" | "talks" | "writing";
type Locale = "zh" | TranslationLocale;
type TranslationStatus = "empty" | "ai_draft" | "reviewed";

type CreatedContent = {
  id: number;
  slug?: string;
  status: "draft" | "published" | "archived";
};

type ContentForm = {
  body: string;
  demoURL: string;
  durationMinutes: string;
  eventName: string;
  featured: boolean;
  organization: string;
  period: string;
  publishNow: boolean;
  repoURL: string;
  slug: string;
  summary: string;
  terms: string;
  title: string;
  videoURL: string;
};

type TranslationState = {
  content_md: string;
  description: string;
  etag: string | null;
  event_name: string;
  exists: boolean;
  excerpt: string;
  organization: string;
  period: string;
  seo_description: string;
  seo_title: string;
  slug: string;
  stale: boolean;
  summary: string;
  title: string;
  translation_status: TranslationStatus;
};

const translationLocales = ["en", "ja"] as const satisfies readonly TranslationLocale[];

const emptyForm: ContentForm = {
  body: "",
  demoURL: "",
  durationMinutes: "",
  eventName: "",
  featured: false,
  organization: "",
  period: "",
  publishNow: false,
  repoURL: "",
  slug: "",
  summary: "",
  terms: "",
  title: "",
  videoURL: "",
};

const emptyTranslationState = (): TranslationState => ({
  content_md: "",
  description: "",
  etag: null,
  event_name: "",
  exists: false,
  excerpt: "",
  organization: "",
  period: "",
  seo_description: "",
  seo_title: "",
  slug: "",
  stale: false,
  summary: "",
  title: "",
  translation_status: "empty",
});

const emptyTranslationMap = (): Record<TranslationLocale, TranslationState> => ({
  en: emptyTranslationState(),
  ja: emptyTranslationState(),
});

export function ContentEditPage({ resource }: { resource: string }) {
  const typedResource = resource as Resource;
  const { id } = useParams();
  const isEditing = Boolean(id);
  const supportsTranslations = isEditing;
  const config = useMemo(() => configFor(typedResource), [typedResource]);
  const navigate = useNavigate();
  const [activeLocale, setActiveLocale] = useState<Locale>("zh");
  const [detailStatus, setDetailStatus] = useState<CreatedContent["status"] | null>(null);
  const [form, setForm] = useState<ContentForm>(emptyForm);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [translations, setTranslations] = useState<Record<TranslationLocale, TranslationState>>(emptyTranslationMap);
  const translationLocale = activeLocale === "zh" ? null : activeLocale;
  const canOverwriteImport =
    typedResource === "writing" && isEditing && activeLocale === "zh" && detailStatus === "draft";

  useEffect(() => {
    if (!isEditing) {
      setActiveLocale("zh");
      setDetailStatus(null);
      setForm(emptyForm);
      setTranslations(emptyTranslationMap());
      return;
    }

    let cancelled = false;
    loadDetail(typedResource, id ?? "")
      .then((detail) => {
        if (cancelled) {
          return;
        }
        setDetailStatus(statusValue(detail.status));
        setForm(formFromResponse(typedResource, detail));
        setTranslations(translationsFromResponse(typedResource, detail));
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage(error instanceof APIRequestError ? error.message : "加载内容失败。");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id, isEditing, typedResource]);

  const currentTranslation = translationLocale ? translations[translationLocale] : null;
  const translationStage = currentTranslation
    ? translationStatusLabel(currentTranslation.translation_status, currentTranslation.stale)
    : "中文主内容";

  async function reloadDetail(successMessage?: string) {
    if (!isEditing || !id) {
      return;
    }
    const detail = await loadDetail(typedResource, id);
    setDetailStatus(statusValue(detail.status));
    setForm(formFromResponse(typedResource, detail));
    setTranslations(translationsFromResponse(typedResource, detail));
    if (successMessage) {
      setMessage(successMessage);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setSaving(true);
    try {
      const endpoint = isEditing ? `/api/admin/${typedResource}/${id}` : `/api/admin/${typedResource}`;
      const method = isEditing ? "PUT" : "POST";
      const saved = await apiFetch<CreatedContent>(endpoint, {
        body: JSON.stringify(payloadFor(typedResource, form)),
        method,
      });
      if (form.publishNow) {
        await apiFetch(`/api/admin/${typedResource}/${saved.id}/status`, {
          body: JSON.stringify({
            published_at: new Date().toISOString(),
            status: "published",
          }),
          method: "PATCH",
        });
      }
      setMessage(form.publishNow ? "已保存并发布。" : isEditing ? "修改已保存。" : "草稿已保存。");
      window.setTimeout(() => navigate(`/admin/${typedResource}`), 500);
    } catch (error) {
      setMessage(error instanceof APIRequestError ? error.message : "保存内容失败。");
    } finally {
      setSaving(false);
    }
  }

  async function saveTranslation(locale: TranslationLocale, successMessage = "辅助语言已保存。") {
    if (!id) {
      return;
    }
    setMessage("");
    setSaving(true);
    try {
      const draft = translations[locale];
      const headers: Record<string, string> = {};
      if (draft.exists && draft.etag) {
        headers["If-Match"] = draft.etag;
      } else {
        headers["If-None-Match"] = "*";
      }
      await apiFetch(`/api/admin/${typedResource}/${id}/translations/${locale}`, {
        body: JSON.stringify(translationPayloadFor(typedResource, draft)),
        headers,
        method: "PUT",
      });
      await reloadDetail(successMessage);
    } catch (error) {
      setMessage(error instanceof APIRequestError ? error.message : "保存辅助语言失败。");
    } finally {
      setSaving(false);
    }
  }

  async function generateTranslation(locale: TranslationLocale) {
    if (!id) {
      return;
    }
    setMessage("");
    setSaving(true);
    try {
      await apiFetch(`/api/admin/${typedResource}/${id}/translations/${locale}/generate`, {
        method: "POST",
      });
      await reloadDetail("辅助语言已生成。");
    } catch (error) {
      setMessage(error instanceof APIRequestError ? error.message : "生成辅助语言失败。");
    } finally {
      setSaving(false);
    }
  }

  async function markReviewed(locale: TranslationLocale) {
    if (!id) {
      return;
    }
    const draft = translations[locale];
    if (!draft.etag) {
      setMessage("请先保存辅助语言，再标记为已审核。");
      return;
    }
    setMessage("");
    setSaving(true);
    try {
      await apiFetch(`/api/admin/${typedResource}/${id}/translations/${locale}/review`, {
        headers: { "If-Match": draft.etag },
        method: "POST",
      });
      await reloadDetail("辅助语言已审核。");
    } catch (error) {
      setMessage(error instanceof APIRequestError ? error.message : "审核辅助语言失败。");
    } finally {
      setSaving(false);
    }
  }

  function update<Key extends keyof ContentForm>(key: Key, value: ContentForm[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateTitle(value: string) {
    setForm((current) => ({
      ...current,
      slug: current.slug || slugify(value),
      title: value,
    }));
  }

  function updateTranslationField<Key extends keyof TranslationState>(
    locale: TranslationLocale,
    key: Key,
    value: TranslationState[Key],
  ) {
    const current = translations[locale];
    if (key === "slug" && hasLocalizedSlug(typedResource) && current.translation_status === "reviewed" && value !== current.slug) {
      setMessage("请先取消发布辅助语言，再修改 slug 和公开地址。");
      return;
    }
    setTranslations((existing) => ({
      ...existing,
      [locale]: {
        ...existing[locale],
        [key]: value,
      },
    }));
  }

  return (
    <form className={`${styles.panel} ${styles.stack}`} onSubmit={onSubmit}>
      <div className={styles.pageHeader}>
        <div>
          <Link className={styles.backLink} to={`/admin/${typedResource}`}>
            <ArrowLeft aria-hidden="true" size={16} />
            返回列表
          </Link>
          <h1>{isEditing ? config.editTitle : config.newTitle}</h1>
          <p>{config.description}</p>
        </div>
        <div className={styles.headerActions}>
          {supportsTranslations && currentTranslation ? (
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
              {hasLocalizedSlug(typedResource) && currentTranslation.translation_status === "reviewed" ? (
                <button
                  className={styles.button}
                  disabled={saving}
                  onClick={() =>
                    translationLocale &&
                    void saveTranslation(translationLocale, "已取消发布辅助语言，可以继续调整 slug 并保存草稿。")
                  }
                  type="button"
                >
                  <Languages aria-hidden="true" size={17} />
                  取消发布辅助语言后编辑 slug
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
            <>
              {canOverwriteImport ? (
                <button className={styles.button} disabled={saving} onClick={() => setShowImport(true)} type="button">
                  导入本地 Markdown
                </button>
              ) : null}
              <label className={styles.switch}>
                <input
                  checked={form.publishNow}
                  onChange={(event) => update("publishNow", event.target.checked)}
                  type="checkbox"
                />
                <span>立即发布</span>
              </label>
              <button className={`${styles.button} ${styles.primary}`} disabled={saving} type="submit">
                {form.publishNow ? (
                  <CheckCircle2 aria-hidden="true" size={18} />
                ) : (
                  <Save aria-hidden="true" size={18} />
                )}
                {saving ? "保存中..." : form.publishNow ? "保存并发布" : "保存草稿"}
              </button>
            </>
          )}
        </div>
      </div>

      <div className={styles.overviewGrid}>
        <article className={styles.overviewCard}>
          <span className={styles.overviewLabel}>编辑模式</span>
          <strong className={styles.overviewValue}>
            {translationLocale ? adminLocaleRoleLabel(translationLocale) : "中文主内容"}
          </strong>
          <p className={styles.overviewNote}>
            {translationLocale
              ? "辅助语言内容会独立保存，只有审核通过后才会进入公开路由。"
              : "这里编辑的是中文主内容，它会驱动路由、回退和辅助语言生成。"}
          </p>
        </article>
        <article className={styles.metric}>
          <span>内容类型</span>
          <strong>{config.resourceLabel}</strong>
        </article>
        <article className={styles.metric}>
          <span>当前状态</span>
          <strong>{translationStage}</strong>
        </article>
      </div>

      {supportsTranslations ? <LocaleTabs activeLocale={activeLocale} onChange={setActiveLocale} /> : null}

      {message ? <p className={styles.message}>{message}</p> : null}

      {supportsTranslations && currentTranslation ? (
        <TranslationFields
          config={config}
          locale={translationLocale!}
          resource={typedResource}
          translation={currentTranslation}
          update={(key, value) => translationLocale && updateTranslationField(translationLocale, key, value)}
        />
      ) : typedResource === "experience" ? (
        <ExperienceFields form={form} update={update} updateTitle={updateTitle} />
      ) : (
        <RoutableContentFields
          config={config}
          form={form}
          resource={typedResource}
          update={update}
          updateTitle={updateTitle}
        />
      )}
      {typedResource === "writing" ? (
        <WritingImportDialog
          mode="overwrite"
          onClose={() => setShowImport(false)}
          onCommitted={() => {
            setShowImport(false);
            void reloadDetail("Markdown 导入已覆盖当前草稿。");
          }}
          open={showImport}
          targetId={id ? Number(id) : undefined}
        />
      ) : null}
    </form>
  );
}

function LocaleTabs({
  activeLocale,
  onChange,
}: {
  activeLocale: Locale;
  onChange: (locale: Locale) => void;
}) {
  return (
    <div aria-label="Locales" className={styles.tabList} role="tablist">
      {(["zh", "en", "ja"] as const satisfies readonly Locale[]).map((locale) => {
        const selected = activeLocale === locale;
        return (
          <button
            aria-selected={selected}
            className={`${styles.tab} ${selected ? styles.tabActive : ""}`}
            key={locale}
            onClick={() => onChange(locale)}
            role="tab"
            type="button"
          >
            {adminLocaleTabLabel(locale)}
          </button>
        );
      })}
    </div>
  );
}

function TranslationFields({
  config,
  resource,
  locale,
  translation,
  update,
}: {
  config: ResourceConfig;
  resource: Resource;
  locale: TranslationLocale;
  translation: TranslationState;
  update: <Key extends keyof TranslationState>(key: Key, value: TranslationState[Key]) => void;
}) {
  if (resource === "experience") {
    return (
      <>
        <section className={styles.formSection}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>{adminLocaleRoleLabel(locale)}</h2>
              <p>辅助语言草稿独立保存，不会直接改动中文主内容。</p>
            </div>
            <div className={styles.localeMeta}>
              <span className={`${styles.statusBadge} ${translation.stale ? styles.statusStale : ""}`}>
                {translationStatusLabel(translation.translation_status, translation.stale)}
              </span>
            </div>
          </div>
          <div className={styles.grid}>
            <Field label="标题" onChange={(value) => update("title", value)} required value={translation.title} />
            <Field label="机构" onChange={(value) => update("organization", value)} value={translation.organization} />
            <Field label="时间段" onChange={(value) => update("period", value)} value={translation.period} />
          </div>
        </section>

        <section className={styles.formSection}>
          <h2>描述</h2>
          <Field label="描述" onChange={(value) => update("description", value)} textarea value={translation.description} />
        </section>
      </>
    );
  }

  const summaryKey = resource === "writing" ? "excerpt" : "summary";
  const summaryValue = resource === "writing" ? translation.excerpt : translation.summary;

  return (
    <>
      <section className={styles.formSection}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>{adminLocaleRoleLabel(locale)}</h2>
            <p>辅助语言草稿独立保存，不会直接改动中文主内容。</p>
          </div>
          <div className={styles.localeMeta}>
            <span className={`${styles.statusBadge} ${translation.stale ? styles.statusStale : ""}`}>
              {translationStatusLabel(translation.translation_status, translation.stale)}
            </span>
          </div>
        </div>
        <div className={styles.grid}>
          <Field label="标题" onChange={(value) => update("title", value)} required value={translation.title} />
          {hasLocalizedSlug(resource) ? (
            <Field label="Slug" onChange={(value) => update("slug", value)} value={translation.slug} />
          ) : null}
        </div>
        <Field label={config.summaryLabel} onChange={(value) => update(summaryKey, value)} textarea value={summaryValue} />
      </section>

      {hasLocalizedBody(resource) ? (
        <section className={styles.formSection}>
          <h2>正文</h2>
          <MarkdownEditor
            description="Markdown 正文按辅助语言分别维护。"
            id={`content-body-${locale}`}
            label="Markdown 正文"
            onChange={(value) => update("content_md", value)}
            value={translation.content_md}
          />
        </section>
      ) : null}

      {resource === "talks" ? (
        <section className={styles.formSection}>
          <h2>元数据</h2>
          <div className={styles.grid}>
            <Field label="活动名称" onChange={(value) => update("event_name", value)} value={translation.event_name} />
          </div>
        </section>
      ) : null}

      {hasLocalizedSEO(resource) ? (
        <section className={styles.formSection}>
          <h2>SEO</h2>
          <div className={styles.grid}>
            <Field label="SEO 标题" onChange={(value) => update("seo_title", value)} value={translation.seo_title} />
            <Field
              label="SEO 描述"
              onChange={(value) => update("seo_description", value)}
              textarea
              value={translation.seo_description}
            />
          </div>
        </section>
      ) : null}
    </>
  );
}

function RoutableContentFields({
  config,
  form,
  resource,
  update,
  updateTitle,
}: {
  config: ResourceConfig;
  form: ContentForm;
  resource: Resource;
  update: <Key extends keyof ContentForm>(key: Key, value: ContentForm[Key]) => void;
  updateTitle: (value: string) => void;
}) {
  const hasMarkdownBody = resource === "projects" || resource === "writing";
  return (
    <>
      <section className={styles.formSection}>
        <h2>基础信息</h2>
        <div className={styles.grid}>
          <Field label="标题" onChange={updateTitle} required value={form.title} />
          <Field label="Slug" onChange={(value) => update("slug", value)} value={form.slug} />
        </div>
        <Field label={config.summaryLabel} onChange={(value) => update("summary", value)} textarea value={form.summary} />
      </section>

      {hasMarkdownBody ? (
        <section className={styles.formSection}>
          <h2>正文</h2>
          <MarkdownEditor
            description="支持工具栏编辑和实时 Markdown 预览。"
            id="content-body"
            label="Markdown 正文"
            onChange={(value) => update("body", value)}
            value={form.body}
          />
        </section>
      ) : null}

      <section className={styles.formSection}>
        <h2>元数据</h2>
        {resource === "projects" ? (
          <div className={styles.grid}>
            <Field label="演示 URL" onChange={(value) => update("demoURL", value)} value={form.demoURL} />
            <Field label="仓库 URL" onChange={(value) => update("repoURL", value)} value={form.repoURL} />
          </div>
        ) : null}
        {resource === "talks" ? (
          <div className={styles.grid}>
            <Field label="活动名称" onChange={(value) => update("eventName", value)} value={form.eventName} />
            <Field label="视频 URL" onChange={(value) => update("videoURL", value)} value={form.videoURL} />
            <Field label="时长（分钟）" onChange={(value) => update("durationMinutes", value)} type="number" value={form.durationMinutes} />
          </div>
        ) : null}
        {resource === "projects" || resource === "writing" ? (
          <TermsInput
            help={resource === "projects" ? "添加技术栈，例如 Go、React、SQLite。" : "添加主题标签，例如 Notes、Engineering、Design。"}
            label={resource === "projects" ? "技术栈" : "标签"}
            onChange={(value) => update("terms", value)}
            value={form.terms}
          />
        ) : null}
        {resource !== "experience" ? (
          <label className={styles.switch}>
            <input
              checked={form.featured}
              onChange={(event) => update("featured", event.target.checked)}
              type="checkbox"
            />
            <span>在首页推荐展示</span>
          </label>
        ) : null}
      </section>
    </>
  );
}

function ExperienceFields({
  form,
  update,
  updateTitle,
}: {
  form: ContentForm;
  update: <Key extends keyof ContentForm>(key: Key, value: ContentForm[Key]) => void;
  updateTitle: (value: string) => void;
}) {
  return (
    <>
      <section className={styles.formSection}>
        <h2>角色信息</h2>
        <div className={styles.grid}>
          <Field label="标题" onChange={updateTitle} required value={form.title} />
          <Field label="机构" onChange={(value) => update("organization", value)} value={form.organization} />
          <Field label="时间段" onChange={(value) => update("period", value)} value={form.period} />
        </div>
      </section>
      <section className={styles.formSection}>
        <h2>描述</h2>
        <Field label="描述" onChange={(value) => update("summary", value)} textarea value={form.summary} />
      </section>
    </>
  );
}

function Field({
  help,
  label,
  onChange,
  required = false,
  textarea = false,
  type = "text",
  value,
}: {
  help?: string;
  label: string;
  onChange: (value: string) => void;
  required?: boolean;
  textarea?: boolean;
  type?: string;
  value: string;
}) {
  const id = label.toLowerCase().replaceAll(" ", "-");
  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label htmlFor={id}>{label}</label>
        {help ? <span>{help}</span> : null}
      </div>
      {textarea ? (
        <textarea
          id={id}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          value={value}
        />
      ) : (
        <input
          id={id}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          type={type}
          value={value}
        />
      )}
    </div>
  );
}

function TermsInput({
  help,
  label,
  onChange,
  value,
}: {
  help: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const [draft, setDraft] = useState("");
  const terms = termsFrom(value);
  const id = `${label.toLowerCase()}-input`;

  function addTerms(rawValue: string) {
    const nextTerms = mergeTerms(terms, termsFrom(rawValue));
    onChange(nextTerms.join(", "));
    setDraft("");
  }

  function removeTerm(term: string) {
    onChange(terms.filter((candidate) => candidate !== term).join(", "));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTerms(draft);
      return;
    }
    if (event.key === "Backspace" && draft === "" && terms.length > 0) {
      event.preventDefault();
      onChange(terms.slice(0, -1).join(", "));
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    if (!/[,\n]/.test(text)) {
      return;
    }
    event.preventDefault();
    addTerms(text);
  }

  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label htmlFor={id}>{label}</label>
        <span>回车或逗号可新增一项</span>
      </div>
      <div className={styles.tagEditor}>
        {terms.map((term) => (
          <span className={styles.tagChip} key={term}>
            {term}
            <button aria-label={`删除 ${term}`} onClick={() => removeTerm(term)} type="button">
              <X aria-hidden="true" size={14} />
            </button>
          </span>
        ))}
        <input
          id={id}
          onBlur={() => {
            if (draft.trim()) {
              addTerms(draft);
            }
          }}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={terms.length === 0 ? "输入后按回车添加" : "继续添加"}
          value={draft}
        />
      </div>
      <p className={styles.fieldHelp}>{terms.length > 0 ? `已选择 ${terms.length} 项` : help}</p>
    </div>
  );
}

type ResourceConfig = {
  description: string;
  editTitle: string;
  newTitle: string;
  resourceLabel: string;
  summaryLabel: string;
};

function configFor(resource: Resource): ResourceConfig {
  if (resource === "projects") {
    return {
      description: "维护项目案例、演示链接、技术栈和 Markdown 正文。",
      editTitle: "编辑项目",
      newTitle: "新建项目",
      resourceLabel: "项目",
      summaryLabel: "摘要",
    };
  }
  if (resource === "writing") {
    return {
      description: "维护文章标题、摘要、标签和完整 Markdown 正文。",
      editTitle: "编辑写作",
      newTitle: "新建写作",
      resourceLabel: "写作",
      summaryLabel: "摘要",
    };
  }
  if (resource === "talks") {
    return {
      description: "维护演讲信息、活动上下文、视频链接与公开摘要。",
      editTitle: "编辑演讲",
      newTitle: "新建演讲",
      resourceLabel: "演讲",
      summaryLabel: "摘要",
    };
  }
  return {
    description: "维护经历时间线、角色、机构与阶段描述。",
    editTitle: "编辑经历",
    newTitle: "新建经历",
    resourceLabel: "经历",
    summaryLabel: "描述",
  };
}

function payloadFor(resource: Resource, form: ContentForm) {
  if (resource === "experience") {
    return {
      description: form.summary,
      organization: form.organization,
      period: form.period,
      title: form.title,
    };
  }
  if (resource === "projects") {
    return {
      content_md: form.body,
      demo_url: form.demoURL,
      featured: form.featured,
      repo_url: form.repoURL,
      slug: form.slug,
      summary: form.summary,
      techs: termsFrom(form.terms),
      title: form.title,
    };
  }
  if (resource === "writing") {
    return {
      content_md: form.body,
      excerpt: form.summary,
      featured: form.featured,
      slug: form.slug,
      tags: termsFrom(form.terms),
      title: form.title,
    };
  }
  return {
    duration_minutes: form.durationMinutes ? Number(form.durationMinutes) : undefined,
    event_name: form.eventName,
    featured: form.featured,
    slug: form.slug,
    summary: form.summary,
    title: form.title,
    video_url: form.videoURL,
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

function termsFrom(value: string) {
  return mergeTerms(
    [],
    value
      .split(/[,\n]/)
      .map((term) => term.trim())
      .filter(Boolean),
  );
}

function mergeTerms(current: string[], incoming: string[]) {
  const seen = new Set(current.map((term) => term.toLowerCase()));
  const next = [...current];
  for (const term of incoming) {
    const normalized = term.trim().replace(/\s+/g, " ");
    const key = normalized.toLowerCase();
    if (normalized && !seen.has(key)) {
      seen.add(key);
      next.push(normalized);
    }
  }
  return next;
}

async function loadDetail(resource: Resource, id: string) {
  return apiFetch<Record<string, unknown>>(`/api/admin/${resource}/${id}`);
}

function translationPayloadFor(resource: Resource, translation: TranslationState) {
  if (resource === "projects") {
    return {
      content_md: translation.content_md,
      seo_description: translation.seo_description,
      seo_title: translation.seo_title,
      slug: translation.slug,
      summary: translation.summary,
      title: translation.title,
    };
  }
  if (resource === "writing") {
    return {
      content_md: translation.content_md,
      excerpt: translation.excerpt,
      seo_description: translation.seo_description,
      seo_title: translation.seo_title,
      slug: translation.slug,
      title: translation.title,
    };
  }
  if (resource === "talks") {
    return {
      event_name: translation.event_name,
      seo_description: translation.seo_description,
      seo_title: translation.seo_title,
      slug: translation.slug,
      summary: translation.summary,
      title: translation.title,
    };
  }
  return {
    description: translation.description,
    organization: translation.organization,
    period: translation.period,
    title: translation.title,
  };
}

function formFromResponse(resource: Resource, response: Record<string, unknown>): ContentForm {
  if (resource === "experience") {
    return {
      ...emptyForm,
      organization: stringValue(response.organization),
      period: stringValue(response.period),
      summary: stringValue(response.description),
      title: stringValue(response.title),
    };
  }
  if (resource === "projects") {
    return {
      ...emptyForm,
      body: stringValue(response.content_md),
      demoURL: stringValue(response.demo_url),
      featured: booleanValue(response.featured),
      repoURL: stringValue(response.repo_url),
      slug: stringValue(response.slug),
      summary: stringValue(response.summary),
      terms: termsToInput(response.techs),
      title: stringValue(response.title),
    };
  }
  if (resource === "writing") {
    return {
      ...emptyForm,
      body: stringValue(response.content_md),
      featured: booleanValue(response.featured),
      slug: stringValue(response.slug),
      summary: stringValue(response.excerpt),
      terms: termsToInput(response.tags),
      title: stringValue(response.title),
    };
  }
  return {
    ...emptyForm,
    durationMinutes: numberStringValue(response.duration_minutes),
    eventName: stringValue(response.event_name),
    featured: booleanValue(response.featured),
    slug: stringValue(response.slug),
    summary: stringValue(response.summary),
    title: stringValue(response.title),
    videoURL: stringValue(response.video_url),
  };
}

function translationsFromResponse(resource: Resource, response: Record<string, unknown>): Record<TranslationLocale, TranslationState> {
  const next = emptyTranslationMap();
  const translations = objectValue(response.translations);
  if (!translations) {
    return next;
  }

  for (const locale of translationLocales) {
    const translation = objectValue(translations[locale]);
    if (!translation) {
      continue;
    }
    const current = emptyTranslationState();
    current.etag = nullableStringValue(translation.etag);
    current.exists = booleanValue(translation.exists);
    current.stale = booleanValue(translation.stale);
    current.title = stringValue(translation.title);
    current.translation_status = translationStatusValue(translation.translation_status);

    if (resource === "projects") {
      current.content_md = stringValue(translation.content_md);
      current.seo_description = stringValue(translation.seo_description);
      current.seo_title = stringValue(translation.seo_title);
      current.slug = stringValue(translation.slug);
      current.summary = stringValue(translation.summary);
    } else if (resource === "writing") {
      current.content_md = stringValue(translation.content_md);
      current.excerpt = stringValue(translation.excerpt);
      current.seo_description = stringValue(translation.seo_description);
      current.seo_title = stringValue(translation.seo_title);
      current.slug = stringValue(translation.slug);
    } else if (resource === "talks") {
      current.event_name = stringValue(translation.event_name);
      current.seo_description = stringValue(translation.seo_description);
      current.seo_title = stringValue(translation.seo_title);
      current.slug = stringValue(translation.slug);
      current.summary = stringValue(translation.summary);
    } else {
      current.description = stringValue(translation.description);
      current.organization = stringValue(translation.organization);
      current.period = stringValue(translation.period);
    }

    next[locale] = current;
  }
  return next;
}

function hasLocalizedBody(resource: Resource) {
  return resource === "projects" || resource === "writing";
}

function hasLocalizedSEO(resource: Resource) {
  return resource === "projects" || resource === "writing" || resource === "talks";
}

function hasLocalizedSlug(resource: Resource) {
  return resource === "projects" || resource === "writing" || resource === "talks";
}

function objectValue(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nullableStringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function booleanValue(value: unknown) {
  return value === true;
}

function numberStringValue(value: unknown) {
  return typeof value === "number" ? String(value) : "";
}

function statusValue(value: unknown): CreatedContent["status"] | null {
  return value === "draft" || value === "published" || value === "archived" ? value : null;
}

function translationStatusValue(value: unknown): TranslationStatus {
  return value === "ai_draft" || value === "reviewed" ? value : "empty";
}

function termsToInput(value: unknown) {
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((item) => {
      if (item && typeof item === "object" && "name" in item && typeof item.name === "string") {
        return item.name;
      }
      return "";
    })
    .filter(Boolean)
    .join(", ");
}
