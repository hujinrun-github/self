import { ArrowLeft, CheckCircle2, Save, X } from "lucide-react";
import { type ClipboardEvent, type FormEvent, type KeyboardEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { APIRequestError, apiFetch } from "../../lib/api";
import styles from "./Admin.module.css";
import { MarkdownEditor } from "./MarkdownEditor";

type Resource = "experience" | "projects" | "talks" | "writing";

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

export function ContentEditPage({ resource }: { resource: string }) {
  const typedResource = resource as Resource;
  const config = useMemo(() => configFor(typedResource), [typedResource]);
  const navigate = useNavigate();
  const [form, setForm] = useState<ContentForm>(emptyForm);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setSaving(true);
    try {
      const created = await apiFetch<CreatedContent>(`/api/admin/${typedResource}`, {
        body: JSON.stringify(payloadFor(typedResource, form)),
        method: "POST",
      });
      if (form.publishNow) {
        await apiFetch(`/api/admin/${typedResource}/${created.id}/status`, {
          body: JSON.stringify({
            published_at: new Date().toISOString(),
            status: "published",
          }),
          method: "PATCH",
        });
      }
      setMessage(form.publishNow ? "Saved and published." : "Draft saved.");
      window.setTimeout(() => navigate(`/admin/${typedResource}`), 500);
    } catch (error) {
      setMessage(error instanceof APIRequestError ? error.message : "Could not save content.");
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

  return (
    <form className={`${styles.panel} ${styles.stack}`} onSubmit={onSubmit}>
      <div className={styles.pageHeader}>
        <div>
          <Link className={styles.backLink} to={`/admin/${typedResource}`}>
            <ArrowLeft aria-hidden="true" size={16} />
            Back
          </Link>
          <h1>{config.newTitle}</h1>
          <p>{config.description}</p>
        </div>
        <div className={styles.headerActions}>
          <label className={styles.switch}>
            <input
              checked={form.publishNow}
              onChange={(event) => update("publishNow", event.target.checked)}
              type="checkbox"
            />
            <span>Publish now</span>
          </label>
          <button className={`${styles.button} ${styles.primary}`} disabled={saving} type="submit">
            {form.publishNow ? (
              <CheckCircle2 aria-hidden="true" size={18} />
            ) : (
              <Save aria-hidden="true" size={18} />
            )}
            {saving ? "Saving..." : form.publishNow ? "Save and publish" : "Save draft"}
          </button>
        </div>
      </div>

      {message ? <p className={styles.message}>{message}</p> : null}

      {typedResource === "experience" ? (
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
    </form>
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
        <h2>Basics</h2>
        <div className={styles.grid}>
          <Field label="Title" onChange={updateTitle} required value={form.title} />
          <Field label="Slug" onChange={(value) => update("slug", value)} value={form.slug} />
        </div>
        <Field
          label={config.summaryLabel}
          onChange={(value) => update("summary", value)}
          textarea
          value={form.summary}
        />
      </section>

      {hasMarkdownBody ? (
        <section className={styles.formSection}>
          <h2>Body</h2>
          <MarkdownEditor
            description="Toolbar editing with live Markdown preview."
            id="content-body"
            label="Rich Markdown"
            onChange={(value) => update("body", value)}
            value={form.body}
          />
        </section>
      ) : null}

      <section className={styles.formSection}>
        <h2>Metadata</h2>
        {resource === "projects" ? (
          <div className={styles.grid}>
            <Field label="Demo URL" onChange={(value) => update("demoURL", value)} value={form.demoURL} />
            <Field label="Repo URL" onChange={(value) => update("repoURL", value)} value={form.repoURL} />
          </div>
        ) : null}
        {resource === "talks" ? (
          <div className={styles.grid}>
            <Field label="Event name" onChange={(value) => update("eventName", value)} value={form.eventName} />
            <Field label="Video URL" onChange={(value) => update("videoURL", value)} value={form.videoURL} />
            <Field
              label="Duration minutes"
              onChange={(value) => update("durationMinutes", value)}
              type="number"
              value={form.durationMinutes}
            />
          </div>
        ) : null}
        {resource === "projects" || resource === "writing" ? (
          <TermsInput
            help={
              resource === "projects"
                ? "Add technologies such as Go, React, SQLite."
                : "Add topics such as Notes, Engineering, Design."
            }
            label={resource === "projects" ? "Techs" : "Tags"}
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
            <span>Feature on home page</span>
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
        <h2>Role</h2>
        <div className={styles.grid}>
          <Field label="Title" onChange={updateTitle} required value={form.title} />
          <Field
            label="Organization"
            onChange={(value) => update("organization", value)}
            value={form.organization}
          />
          <Field label="Period" onChange={(value) => update("period", value)} value={form.period} />
        </div>
      </section>
      <section className={styles.formSection}>
        <h2>Description</h2>
        <Field
          label="Description"
          onChange={(value) => update("summary", value)}
          textarea
          value={form.summary}
        />
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
        <span>Enter or comma adds one</span>
      </div>
      <div className={styles.tagEditor}>
        {terms.map((term) => (
          <span className={styles.tagChip} key={term}>
            {term}
            <button aria-label={`Remove ${term}`} onClick={() => removeTerm(term)} type="button">
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
          placeholder={terms.length === 0 ? "Type a tag and press Enter" : "Add another"}
          value={draft}
        />
      </div>
      <p className={styles.fieldHelp}>{terms.length > 0 ? `${terms.length} selected` : help}</p>
    </div>
  );
}

type ResourceConfig = {
  description: string;
  newTitle: string;
  summaryLabel: string;
};

function configFor(resource: Resource): ResourceConfig {
  if (resource === "projects") {
    return {
      description: "Create a case study with a live Markdown body, links, and tech tags.",
      newTitle: "New project",
      summaryLabel: "Summary",
    };
  }
  if (resource === "writing") {
    return {
      description: "Draft articles with a rich Markdown toolbar and split preview.",
      newTitle: "New writing",
      summaryLabel: "Excerpt",
    };
  }
  if (resource === "talks") {
    return {
      description: "Add talks, recordings, and event context.",
      newTitle: "New talk",
      summaryLabel: "Summary",
    };
  }
  return {
    description: "Add career history, roles, and milestones.",
    newTitle: "New experience",
    summaryLabel: "Description",
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
