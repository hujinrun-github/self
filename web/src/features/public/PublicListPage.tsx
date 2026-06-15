import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { apiFetch } from "../../lib/api";
import { PublicLayout } from "./PublicLayout";
import styles from "./Public.module.css";

type Item = {
  id: number;
  title: string;
  slug: string;
  summary?: string;
  excerpt?: string;
};

export function PublicListPage({ resource }: { resource: "projects" | "writing" | "talks" }) {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    apiFetch<Item[]>(`/api/site/${resource}`).then(setItems).catch(() => setItems([]));
  }, [resource]);

  return (
    <PublicLayout>
      <section className={styles.section}>
        <h1>{titleFor(resource)}</h1>
        <div className={styles.grid}>
          {items.map((item) => (
            <Link className={styles.card} key={item.id} to={`/${resource}/${item.slug}`}>
              <div className={styles.media} />
              <h2>{item.title}</h2>
              <p className={styles.muted}>{item.summary ?? item.excerpt}</p>
            </Link>
          ))}
        </div>
        {items.length === 0 ? <p className={styles.muted}>No published entries yet.</p> : null}
      </section>
    </PublicLayout>
  );
}

function titleFor(resource: string) {
  if (resource === "projects") {
    return "Projects";
  }
  if (resource === "writing") {
    return "Writing";
  }
  return "Talks";
}
