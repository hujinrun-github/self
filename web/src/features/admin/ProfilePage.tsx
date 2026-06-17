import { Plus, Save, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { APIRequestError, apiFetch } from "../../lib/api";
import styles from "./Admin.module.css";

type SocialLink = {
  icon: string;
  label: string;
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

const emptyProfile: ProfileForm = {
  bio: "",
  email: "",
  headline: "",
  name: "",
  social_links: [],
  summary: "",
};

export function ProfilePage() {
  const [profile, setProfile] = useState<ProfileForm>(emptyProfile);
  const [etag, setEtag] = useState("");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadProfile().then(({ body, etag: nextEtag }) => {
      if (!cancelled) {
        setProfile({ ...emptyProfile, ...body, social_links: body.social_links ?? [] });
        setEtag(nextEtag);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
      const { body, etag: nextEtag } = await loadProfile();
      setProfile({ ...emptyProfile, ...body, social_links: body.social_links ?? [] });
      setEtag(nextEtag);
      setMessage("Profile saved");
    } catch (error) {
      if (error instanceof APIRequestError) {
        setMessage(error.message);
        setFieldErrors(error.fields ?? {});
      } else {
        setMessage("Could not save profile");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={`${styles.panel} ${styles.stack}`} onSubmit={onSubmit}>
      <div className={styles.pageHeader}>
        <div>
          <h1>Profile</h1>
          <p>The public biography, contact details, and social links shown across the site.</p>
        </div>
        <button className={`${styles.button} ${styles.primary}`} disabled={saving} type="submit">
          <Save aria-hidden="true" size={18} />
          {saving ? "Saving..." : "Save profile"}
        </button>
      </div>

      {message ? <p className={styles.message}>{message}</p> : null}

      <section className={styles.formSection}>
        <h2>Identity</h2>
        <div className={styles.grid}>
          <Field
            error={fieldErrors.name}
            label="Name"
            onChange={(value) => setProfile({ ...profile, name: value })}
            value={profile.name}
          />
          <Field
            error={fieldErrors.email}
            label="Email"
            onChange={(value) => setProfile({ ...profile, email: value })}
            value={profile.email}
          />
        </div>
        <Field
          error={fieldErrors.headline}
          label="Headline"
          onChange={(value) => setProfile({ ...profile, headline: value })}
          value={profile.headline}
        />
      </section>

      <section className={styles.formSection}>
        <h2>Copy</h2>
        <Field
          error={fieldErrors.summary}
          label="Summary"
          onChange={(value) => setProfile({ ...profile, summary: value })}
          textarea
          value={profile.summary}
        />
        <Field
          error={fieldErrors.bio}
          label="Bio"
          onChange={(value) => setProfile({ ...profile, bio: value })}
          textarea
          value={profile.bio}
        />
      </section>

      <SocialLinksEditor
        links={profile.social_links}
        onChange={(links) => setProfile({ ...profile, social_links: links })}
      />
    </form>
  );
}

async function loadProfile() {
  const response = await fetch("/api/admin/profile", { credentials: "include" });
  const body = (await response.json()) as ProfileForm;
  return { body, etag: response.headers.get("ETag") ?? "" };
}

function Field({
  error,
  label,
  onChange,
  textarea = false,
  value,
}: {
  error?: string;
  label: string;
  onChange: (value: string) => void;
  textarea?: boolean;
  value: string;
}) {
  const id = label.toLowerCase().replaceAll(" ", "-");
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {textarea ? (
        <textarea id={id} onChange={(event) => onChange(event.target.value)} value={value} />
      ) : (
        <input id={id} onChange={(event) => onChange(event.target.value)} value={value} />
      )}
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
          <h2>Social links</h2>
          <p>Links are shown in the public contact areas.</p>
        </div>
        <button
          className={styles.button}
          onClick={() => onChange([...links, { icon: "link", label: "", url: "" }])}
          type="button"
        >
          <Plus aria-hidden="true" size={17} />
          Add link
        </button>
      </div>
      {links.map((link, index) => (
        <div className={styles.socialRow} key={`${link.label}-${index}`}>
          <Field
            label="Label"
            onChange={(value) => onChange(replaceLink(links, index, { ...link, label: value }))}
            value={link.label}
          />
          <Field
            label="URL"
            onChange={(value) => onChange(replaceLink(links, index, { ...link, url: value }))}
            value={link.url}
          />
          <button
            aria-label={`Remove ${link.label || "social link"}`}
            className={`${styles.iconButton} ${styles.danger}`}
            onClick={() => onChange(links.filter((_, itemIndex) => itemIndex !== index))}
            type="button"
          >
            <Trash2 aria-hidden="true" size={17} />
            Remove
          </button>
        </div>
      ))}
    </section>
  );
}

function replaceLink(links: SocialLink[], index: number, link: SocialLink) {
  return links.map((item, itemIndex) => (itemIndex === index ? link : item));
}
