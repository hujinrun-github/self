import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";

import { MarkdownView } from "../../components/markdown/MarkdownView";
import { apiFetch } from "../../lib/api";
import type { MediaMap } from "../../lib/types";
import { usePublicPageMeta } from "./head";
import { coerceLocale, publicLocaleCopy } from "./locale";
import { PublicLayout } from "./PublicLayout";
import styles from "./Public.module.css";

type Detail = {
  title: string;
  summary?: string;
  excerpt?: string;
  content_md?: string;
  media?: MediaMap;
};

type DetailResponse = {
  alternates?: Array<{
    locale: string;
    path: string;
  }>;
  fallback_from?: string;
  item: Detail;
  requested_locale: string;
  resolved_locale: string;
};

export function DetailPage({ endpoint }: { endpoint: string }) {
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const location = useLocation();
  const copy = publicLocaleCopy(coerceLocale(detail?.requested_locale));
  useEffect(() => {
    apiFetch<DetailResponse>(endpoint)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [endpoint]);

  const canonicalPath = useMemo(() => {
    if (!detail) {
      return location.pathname;
    }
    return detail.alternates?.find((alternate) => alternate.locale === detail.resolved_locale)?.path ?? location.pathname;
  }, [detail, location.pathname]);

  usePublicPageMeta({
    alternates: (detail?.alternates ?? []).map((alternate) => ({
      href: alternate.path,
      hreflang: alternate.locale,
    })),
    canonicalPath,
    description: detail?.item.summary ?? detail?.item.excerpt ?? "",
    robots: detail?.fallback_from ? "noindex, follow" : "",
    title: detail?.item.title ? `${detail.item.title} | ${copy.portfolio}` : copy.portfolio,
  });

  return (
    <PublicLayout alternates={detail?.alternates}>
      <article className={styles.section}>
        <h1>{detail?.item.title ?? copy.notFound}</h1>
        <p className={styles.lede}>{detail?.item.summary ?? detail?.item.excerpt}</p>
        <MarkdownView markdown={detail?.item.content_md ?? ""} media={detail?.item.media ?? {}} />
      </article>
    </PublicLayout>
  );
}
