import { Save } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { APIRequestError } from "../../lib/api";
import styles from "./Admin.module.css";

type SocialLink = {
  label: string;
  url: string;
  icon: string;
};

type ProfileForm = {
  name: string;
  headline: string;
  summary: string;
  bio: string;
  email: string;
  social_links: SocialLink[];
};

const emptyProfile: ProfileForm = {
  name: "",
  headline: "",
  summary: "",
  bio: "",
  email: "",
  social_links: [],
};

export function ProfilePage() {
  const [profile, setProfile] = useState<ProfileForm>(emptyProfile);
  const [etag, setEtag] = useState("");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/profile", { credentials: "include" }).then(async (response) => {
      const body = (await response.json()) as ProfileForm;
      if (!cancelled) {
        setProfile({ ...emptyProfile, ...body, social_links: body.social_links ?? [] });
        setEtag(response.headers.get("ETag") ?? "");
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
    const response = await fetch("/api/admin/profile", {
      body: JSON.stringify(profile),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "If-Match": etag,
      },
      method: "PUT",
    });
    if (response.ok) {
      setMessage("Profile saved");
      return;
    }
    const payload = await response.json();
    const error = new APIRequestError(response.status, payload);
    setMessage(error.message);
    setFieldErrors(error.fields ?? {});
  }

  return (
    <form className={`${styles.panel} ${styles.stack}`} onSubmit={onSubmit}>
      <h1>Profile</h1>
      {message ? <p className={styles.message}>{message}</p> : null}
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
      <SocialLinksEditor
        links={profile.social_links}
        onChange={(links) => setProfile({ ...profile, social_links: links })}
      />
      <button className={`${styles.button} ${styles.primary}`} type="submit">
        <Save aria-hidden="true" size={18} />
        Save profile
      </button>
    </form>
  );
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
    <section className={styles.stack}>
      <div className={styles.actions}>
        <strong>Social links</strong>
        <button
          className={styles.button}
          onClick={() => onChange([...links, { icon: "link", label: "", url: "" }])}
          type="button"
        >
          Add link
        </button>
      </div>
      {links.map((link, index) => (
        <div className={styles.grid} key={`${link.label}-${index}`}>
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
        </div>
      ))}
    </section>
  );
}

function replaceLink(links: SocialLink[], index: number, link: SocialLink) {
  return links.map((item, itemIndex) => (itemIndex === index ? link : item));
}
