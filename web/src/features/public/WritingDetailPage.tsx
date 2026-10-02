import { ArrowLeft, ArrowRight, CalendarDays, ChevronDown, Heart, ListTree, MessageCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import { MarkdownView } from "../../components/markdown/MarkdownView";
import { APIRequestError, apiFetch } from "../../lib/api";
import type { MediaMap } from "../../lib/types";
import { usePublicPageMeta } from "./head";
import { type Locale, coerceLocale, publicLocaleCopy, withLocale, withLocaleQuery } from "./locale";
import { PublicLayout } from "./PublicLayout";
import styles from "./Public.module.css";
import { WritingEngagementSection, WritingEngagementSummary } from "./WritingEngagement";
import { useWritingEngagement } from "./WritingEngagementState";
import engagementStyles from "./WritingEngagement.module.css";
import readingStyles from "./ReadingProgress.module.css";
import { useReadingProgress } from "./useReadingProgress";

type Term = {
  name?: string;
  slug?: string;
};

type WritingDetail = {
  id: number;
  title: string;
  slug: string;
  excerpt?: string;
  content_md?: string;
  media?: MediaMap;
  published_at?: string | null;
  tags?: Term[];
};

type WritingDetailResponse = {
  alternates?: Array<{
    locale: string;
    path: string;
  }>;
  fallback_from?: string;
  item: WritingDetail;
  requested_locale: string;
  resolved_locale: string;
};

type WritingSummary = {
  id: number;
  title: string;
  slug: string;
  excerpt?: string;
  published_at?: string | null;
  tags?: Term[];
};

type WritingListResponse = {
  items: WritingSummary[];
  requested_locale: string;
  resolved_locale: string;
};

type DetailCopy = {
  backList: string;
  comments: string;
  jumpBody: string;
  jumpComments: string;
  jumpTitle: string;
  likeLabel: string;
  moreWriting: string;
  reading: string;
  readingProgress: string;
  tags: string;
  toc: string;
};

type TocItem = {
  depth: 1 | 2 | 3;
  id: string;
  title: string;
};

const detailCopy: Record<Locale, DetailCopy> = {
  zh: {
    backList: "返回文章列表",
    comments: "评论",
    jumpBody: "正文",
    jumpComments: "评论",
    jumpTitle: "快捷跳转",
    likeLabel: "点赞",
    moreWriting: "更多文章",
    reading: "正在阅读",
    readingProgress: "阅读进度",
    tags: "标签",
    toc: "目录",
  },
  en: {
    backList: "Back to writing",
    comments: "Comments",
    jumpBody: "Article",
    jumpComments: "Comments",
    jumpTitle: "Quick jump",
    likeLabel: "Like",
    moreWriting: "More writing",
    reading: "Reading",
    readingProgress: "Reading progress",
    tags: "Tags",
    toc: "Contents",
  },
  ja: {
    backList: "記事一覧に戻る",
    comments: "コメント",
    jumpBody: "本文",
    jumpComments: "コメント",
    jumpTitle: "クイック移動",
    likeLabel: "いいね",
    moreWriting: "他の記事",
    reading: "閲覧中",
    readingProgress: "読書の進捗",
    tags: "タグ",
    toc: "目次",
  },
};

export function WritingDetailPage() {
  const { locale: localeParam, slug = "" } = useParams();
  const locale = coerceLocale(localeParam);
  const location = useLocation();
  const copy = publicLocaleCopy(locale);
  const pageCopy = detailCopy[locale];
  const mobileContentsRef = useRef<HTMLDetailsElement>(null);
  const articleBodyRef = useRef<HTMLDivElement>(null);
  const detailEndpoint = withLocaleQuery(`/api/site/writing/${slug}`, locale);

  const [detailState, setDetailState] = useState<{ endpoint: string; detail: WritingDetailResponse | null; error: "notFound" | "failed" | null }>({ endpoint: "", detail: null, error: null });
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [quickLinks, setQuickLinks] = useState<{ locale: Locale; items: WritingSummary[] }>({ locale, items: [] });
  const detail = detailState.endpoint === detailEndpoint ? detailState.detail : null;
  const detailError = detailState.endpoint === detailEndpoint ? detailState.error : null;
  const engagement = useWritingEngagement(slug, locale, Boolean(detail?.item.id));
  const statusCopy = {
    zh: { loading: "正在加载文章…", failed: "文章暂时无法加载", retry: "重新加载文章" },
    en: { loading: "Loading article…", failed: "Could not load this article", retry: "Reload article" },
    ja: { loading: "記事を読み込み中…", failed: "記事を読み込めませんでした", retry: "記事を再読み込み" },
  }[locale];

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<WritingDetailResponse>(detailEndpoint, { signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted) setDetailState({ endpoint: detailEndpoint, detail: response, error: null }); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setDetailState({ endpoint: detailEndpoint, detail: null, error: error instanceof APIRequestError && error.status === 404 ? "notFound" : "failed" });
      });
    return () => controller.abort();
  }, [detailEndpoint, detailAttempt]);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<WritingListResponse>(withLocaleQuery("/api/site/writing?limit=8", locale), { signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted) setQuickLinks({ locale, items: response.items }); })
      .catch(() => { if (!controller.signal.aborted) setQuickLinks({ locale, items: [] }); });
    return () => controller.abort();
  }, [locale]);

  const canonicalPath = useMemo(() => {
    if (!detail) {
      return location.pathname;
    }
    return detail.alternates?.find((alternate) => alternate.locale === detail.resolved_locale)?.path ?? location.pathname;
  }, [detail, location.pathname]);

  const relatedLinks = useMemo(
    () => (quickLinks.locale === locale ? quickLinks.items : []).filter((item) => item.slug !== detail?.item.slug).slice(0, 5),
    [detail?.item.slug, locale, quickLinks],
  );
  const tagNames = (detail?.item.tags ?? []).map((tag) => tag.name).filter((name): name is string => Boolean(name));
  const publishedDate = formatPublishedDate(detail?.item.published_at, locale);
  const contentMarkdown = detail?.item.content_md ?? "";
  const tocItems = useMemo(() => extractTableOfContents(contentMarkdown), [contentMarkdown]);
  const { progress, activeHeadingID } = useReadingProgress(articleBodyRef, `${detailEndpoint}:${contentMarkdown}`);
  const articleContent = useMemo(() => <MarkdownView
    headingIDs={tocItems.map((item) => item.id)}
    markdown={contentMarkdown}
    media={detail?.item.media ?? {}}
  />, [contentMarkdown, detail?.item.media, tocItems]);

  usePublicPageMeta({
    alternates: (detail?.alternates ?? []).map((alternate) => ({
      href: alternate.path,
      hreflang: alternate.locale,
    })),
    canonicalPath,
    description: detail?.item.excerpt ?? "",
    robots: detail?.fallback_from ? "noindex, follow" : "",
    title: detail?.item.title ? `${detail.item.title} | ${copy.portfolio}` : copy.portfolio,
  });

  return (
    <PublicLayout alternates={detail?.alternates}>
      {detail?.item.id && contentMarkdown.trim() ? <div
        aria-label={pageCopy.readingProgress}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progress}
        className={readingStyles.track}
        role="progressbar"
      ><span className={readingStyles.fill} style={{ transform: `scaleX(${progress / 100})` }} /></div> : null}
      <article className={`${styles.section} ${styles.articleSection}`}>
        <div className={styles.articleLayout}>
          <div className={styles.articleMain}>
            <Link className={styles.mobileBackLink} to={withLocale(locale, "/writing")}>
              <ArrowLeft aria-hidden="true" size={16} />
              {pageCopy.backList}
            </Link>
            <header className={styles.articleHeader}>
              <div className={styles.articleHeaderGrid}>
                <div className={styles.articleHeaderCopy}>
                  <p className={styles.sectionIndex}>{pageCopy.reading}</p>
                  <h1 className={styles.articleTitle}>{detail?.item.title ?? (detailError === "notFound" ? copy.notFound : detailError ? statusCopy.failed : statusCopy.loading)}</h1>
                  {detail?.item.excerpt ? <p className={styles.articleLede}>{detail.item.excerpt}</p> : null}
                </div>
                <WritingEngagementSummary engagement={engagement} locale={locale} />
              </div>
              <div className={styles.articleMetaStrip}>
                {publishedDate ? (
                  <span className={styles.articleMetaItem}>
                    <CalendarDays aria-hidden="true" size={15} />
                    {publishedDate}
                  </span>
                ) : null}
                {tagNames.length > 0 ? (
                  <div className={styles.articleTags} aria-label={pageCopy.tags}>
                    {tagNames.map((tagName) => (
                      <span className={styles.chip} key={tagName}>
                        {tagName}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </header>

            {detailError ? <div className={engagementStyles.detailError} role="alert">
              {detailError === "notFound" ? copy.notFound : statusCopy.failed}
              <button type="button" onClick={() => { setDetailState({ endpoint: detailEndpoint, detail: null, error: null }); setDetailAttempt((current) => current + 1); }}>{statusCopy.retry}</button>
            </div> : null}

            {detail?.item.id ? (
              <details className={styles.mobileArticleContents} data-testid="mobile-article-contents" key={detailEndpoint} ref={mobileContentsRef}>
                <summary>
                  <ListTree aria-hidden="true" size={17} />
                  <span>{pageCopy.toc}</span>
                  <ChevronDown aria-hidden="true" className={styles.contentsChevron} size={16} />
                </summary>
                <nav aria-label={`${pageCopy.toc} · ${pageCopy.jumpTitle}`} onClick={(event) => {
                  if ((event.target as HTMLElement).closest("a")) mobileContentsRef.current?.removeAttribute("open");
                }}>
                  <div className={styles.mobileContentsActions}>
                    <a href="#article-body">{pageCopy.jumpBody}</a>
                    <a href="#article-comments">{pageCopy.jumpComments}</a>
                  </div>
                  {tocItems.map((item) => (
                    <a aria-current={activeHeadingID === item.id ? "location" : undefined} className={`${styles.tocLink} ${tocDepthClassName(item.depth)} ${readingStyles.tocLink}`} href={`#${item.id}`} key={item.id}>
                      {item.title}
                    </a>
                  ))}
                </nav>
              </details>
            ) : null}

            <div className={styles.articleBody} id="article-body" ref={articleBodyRef}>
              {articleContent}
            </div>

            {detail?.item.id ? <WritingEngagementSection key={`${locale}:${slug}`} engagement={engagement} locale={locale} /> : null}
          </div>

          <aside className={styles.articleAside}>
            <div className={styles.articleAsidePanel}>
              <div className={styles.asideHeader}>
                <div className={styles.asideTitleRow}>
                  <ListTree aria-hidden="true" size={17} />
                  <h2>{pageCopy.jumpTitle}</h2>
                </div>
                <div className={styles.articleAsideMeta}>
                  <span>
                    <MessageCircle aria-hidden="true" size={14} />
                    {engagement.data?.comment_count ?? "—"}
                  </span>
                  <span>
                    <Heart aria-hidden="true" size={14} />
                    {engagement.data?.like_count ?? "—"}
                  </span>
                </div>
              </div>
              <nav aria-label={pageCopy.jumpTitle}>
                <a className={styles.quickJumpLink} href="#article-body">
                  <span>{pageCopy.jumpBody}</span>
                  <ArrowRight aria-hidden="true" size={14} />
                </a>
                <a className={styles.quickJumpLink} href="#article-comments">
                  <span>{pageCopy.jumpComments}</span>
                  <ArrowRight aria-hidden="true" size={14} />
                </a>
              </nav>
              {tocItems.length > 0 ? (
                <div className={styles.articleToc}>
                  <p className={styles.sectionIndex}>{pageCopy.toc}</p>
                  <nav aria-label={pageCopy.toc}>
                    {tocItems.map((item) => (
                      <a aria-current={activeHeadingID === item.id ? "location" : undefined} className={`${styles.tocLink} ${tocDepthClassName(item.depth)} ${readingStyles.tocLink}`} href={`#${item.id}`} key={item.id}>
                        {item.title}
                      </a>
                    ))}
                  </nav>
                </div>
              ) : null}
              {relatedLinks.length > 0 ? (
                <div className={styles.relatedWriting}>
                  <p className={styles.sectionIndex}>{pageCopy.moreWriting}</p>
                  {relatedLinks.map((item) => (
                    <Link className={styles.relatedWritingLink} key={item.id} to={withLocale(locale, `/writing/${item.slug}`)}>
                      <span>{item.title}</span>
                      {item.excerpt ? <small>{item.excerpt}</small> : null}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      </article>
    </PublicLayout>
  );
}

function tocDepthClassName(depth: TocItem["depth"]) {
  if (depth === 2) {
    return styles.tocLevel2;
  }
  if (depth === 3) {
    return styles.tocLevel3;
  }
  return styles.tocLevel1;
}

function extractTableOfContents(markdown: string): TocItem[] {
  const usedIDs = new Map<string, number>();
  const items: TocItem[] = [];
  let inFence = false;

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }

    const match = /^(?: {0,3})(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) {
      continue;
    }

    const title = stripMarkdownHeading(match[2]).trim();
    if (!title) {
      continue;
    }

    items.push({
      depth: match[1].length as TocItem["depth"],
      id: uniqueHeadingID(title, items.length, usedIDs),
      title,
    });
  }

  return items;
}

function stripMarkdownHeading(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function uniqueHeadingID(title: string, index: number, usedIDs: Map<string, number>) {
  const base =
    title
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\u3400-\u9fff\u3040-\u30ff]+/g, "-")
      .replace(/^-+|-+$/g, "") || `section-${index + 1}`;
  const count = usedIDs.get(base) ?? 0;
  usedIDs.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

function formatPublishedDate(value: string | null | undefined, locale: Locale) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}
