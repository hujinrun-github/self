import { Save } from "lucide-react";
import { useState } from "react";

import { MarkdownView } from "../../components/markdown/MarkdownView";
import styles from "./Admin.module.css";

export function ContentEditPage({ resource }: { resource: string }) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [body, setBody] = useState("");
  const [featured, setFeatured] = useState(false);

  return (
    <section className={`${styles.panel} ${styles.stack}`}>
      <h1>Edit {resource}</h1>
      <div className={styles.grid}>
        <div className={styles.field}>
          <label htmlFor="content-title">Title</label>
          <input
            id="content-title"
            onChange={(event) => {
              setTitle(event.target.value);
              if (!slug) {
                setSlug(event.target.value.toLowerCase().trim().replaceAll(" ", "-"));
              }
            }}
            value={title}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="content-slug">Slug</label>
          <input id="content-slug" onChange={(event) => setSlug(event.target.value)} value={slug} />
        </div>
      </div>
      <label className={styles.label}>
        <input
          checked={featured}
          onChange={(event) => setFeatured(event.target.checked)}
          type="checkbox"
        />
        Featured
      </label>
      <div className={styles.field}>
        <label htmlFor="content-body">Markdown</label>
        <textarea id="content-body" onChange={(event) => setBody(event.target.value)} value={body} />
      </div>
      <MarkdownView markdown={body} media={{}} />
      <button className={`${styles.button} ${styles.primary}`} type="button">
        <Save aria-hidden="true" size={18} />
        Save
      </button>
    </section>
  );
}
