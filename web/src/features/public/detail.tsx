import { useEffect, useState } from "react";

import { MarkdownView } from "../../components/markdown/MarkdownView";
import { apiFetch } from "../../lib/api";
import type { MediaMap } from "../../lib/types";
import { PublicLayout } from "./PublicLayout";
import styles from "./Public.module.css";

type Detail = {
  title: string;
  summary?: string;
  excerpt?: string;
  content_md?: string;
  media?: MediaMap;
};

export function DetailPage({ endpoint }: { endpoint: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  useEffect(() => {
    apiFetch<Detail>(endpoint).then(setDetail).catch(() => setDetail(null));
  }, [endpoint]);

  return (
    <PublicLayout>
      <article className={styles.section}>
        <h1>{detail?.title ?? "Not found"}</h1>
        <p className={styles.lede}>{detail?.summary ?? detail?.excerpt}</p>
        <MarkdownView markdown={detail?.content_md ?? ""} media={detail?.media ?? {}} />
      </article>
    </PublicLayout>
  );
}
