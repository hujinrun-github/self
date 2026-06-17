import { Archive, ExternalLink, Plus, Rocket } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { APIRequestError, apiFetch } from "../../lib/api";
import styles from "./Admin.module.css";

type Resource = "experience" | "projects" | "talks" | "writing";
type Status = "archived" | "draft" | "published";

type AdminItem = {
  description?: string;
  event_name?: string;
  excerpt?: string;
  id: number;
  organization?: string;
  period?: string;
  published_at?: string | null;
  slug?: string;
  status: Status;
  summary?: string;
  title: string;
};

export function ContentListPage({ resource }: { resource: string }) {
  const typedResource = resource as Resource;
  const [items, setItems] = useState<AdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetch<AdminItem[]>(`/api/admin/${typedResource}`)
      .then((response) => {
        if (!cancelled) {
          setItems(response);
          setMessage("");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage(error instanceof APIRequestError ? error.message : "Could not load content.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [typedResource]);

  async function setStatus(item: AdminItem, status: Status) {
    const publishedAt = status === "published" ? new Date().toISOString() : item.published_at;
    await apiFetch(`/api/admin/${typedResource}/${item.id}/status`, {
      body: JSON.stringify({ published_at: publishedAt, status }),
      method: "PATCH",
    });
    setItems((current) =>
      current.map((candidate) =>
        candidate.id === item.id ? { ...candidate, published_at: publishedAt, status } : candidate,
      ),
    );
    setMessage(status === "published" ? "Published." : "Archived.");
  }

  const published = items.filter((item) => item.status === "published").length;
  const drafts = items.filter((item) => item.status === "draft").length;

  return (
    <section className={`${styles.panel} ${styles.stack}`}>
      <div className={styles.pageHeader}>
        <div>
          <h1>{titleFor(typedResource)}</h1>
          <p>{descriptionFor(typedResource)}</p>
        </div>
        <Link className={`${styles.button} ${styles.primary}`} to={`/admin/${typedResource}/new`}>
          <Plus aria-hidden="true" size={18} />
          New
        </Link>
      </div>

      <div className={styles.statsGrid}>
        <Metric label="Total" value={items.length} />
        <Metric label="Published" value={published} />
        <Metric label="Drafts" value={drafts} />
      </div>

      {message ? <p className={styles.message}>{message}</p> : null}
      {loading ? <p className={styles.muted}>Loading content...</p> : null}

      {!loading && items.length === 0 ? (
        <div className={styles.emptyState}>
          <h2>No entries yet</h2>
          <p>Create the first {titleFor(typedResource).toLowerCase()} item and publish it when ready.</p>
          <Link className={`${styles.button} ${styles.primary}`} to={`/admin/${typedResource}/new`}>
            <Plus aria-hidden="true" size={18} />
            Create entry
          </Link>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className={styles.list}>
          {items.map((item) => (
            <article className={styles.contentRow} key={item.id}>
              <div>
                <div className={styles.rowMeta}>
                  <span className={`${styles.status} ${styles[`status${item.status}`]}`}>
                    {item.status}
                  </span>
                  {item.published_at ? <span>{formatDate(item.published_at)}</span> : null}
                  {item.period ? <span>{item.period}</span> : null}
                </div>
                <h2>{item.title}</h2>
                <p>{summaryFor(item)}</p>
              </div>
              <div className={styles.rowActions}>
                {publicURLFor(typedResource, item) ? (
                  <Link className={styles.iconButton} to={publicURLFor(typedResource, item) ?? "/"}>
                    <ExternalLink aria-hidden="true" size={17} />
                    View
                  </Link>
                ) : null}
                {item.status !== "published" ? (
                  <button
                    className={styles.iconButton}
                    onClick={() => void setStatus(item, "published")}
                    type="button"
                  >
                    <Rocket aria-hidden="true" size={17} />
                    Publish
                  </button>
                ) : null}
                {item.status !== "archived" ? (
                  <button
                    className={styles.iconButton}
                    onClick={() => void setStatus(item, "archived")}
                    type="button"
                  >
                    <Archive aria-hidden="true" size={17} />
                    Archive
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function titleFor(resource: Resource) {
  if (resource === "projects") {
    return "Projects";
  }
  if (resource === "writing") {
    return "Writing";
  }
  if (resource === "talks") {
    return "Talks";
  }
  return "Experience";
}

function descriptionFor(resource: Resource) {
  if (resource === "projects") {
    return "Case studies, demos, repos, and featured project work.";
  }
  if (resource === "writing") {
    return "Articles and notes backed by rich Markdown editing.";
  }
  if (resource === "talks") {
    return "Conference talks, recordings, and event summaries.";
  }
  return "Career timeline entries shown on the home page.";
}

function summaryFor(item: AdminItem) {
  return item.summary || item.excerpt || item.description || item.organization || "No summary yet.";
}

function publicURLFor(resource: Resource, item: AdminItem) {
  if (resource === "experience" || item.status !== "published" || !item.slug) {
    return null;
  }
  return `/${resource}/${item.slug}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}
