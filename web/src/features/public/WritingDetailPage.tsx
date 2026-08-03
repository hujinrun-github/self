import { ArrowRight, CalendarDays, Heart, ListTree, MessageCircle, Send } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import { MarkdownView } from "../../components/markdown/MarkdownView";
import { apiFetch } from "../../lib/api";
import type { MediaMap } from "../../lib/types";
import { usePublicPageMeta } from "./head";
import { type Locale, coerceLocale, publicLocaleCopy, withLocale, withLocaleQuery } from "./locale";
import { PublicLayout } from "./PublicLayout";
import styles from "./Public.module.css";

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

type WritingComment = {
  id: number;
  author_name: string;
  body: string;
  created_at: string;
};

type WritingEngagement = {
  like_count: number;
  comments: WritingComment[];
};

type WritingLikeResponse = {
  like_count: number;
};

type DetailCopy = {
  commentBody: string;
  commentBodyPlaceholder: string;
  commentError: string;
  commentName: string;
  commentNamePlaceholder: string;
  comments: string;
  emptyComments: string;
  jumpBody: string;
  jumpComments: string;
  jumpTitle: string;
  liked: string;
  likeLabel: string;
  moreWriting: string;
  publishComment: string;
  reading: string;
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
    commentBody: "评论内容",
    commentBodyPlaceholder: "写下你的想法，或补充一个相关经验。",
    commentError: "评论发送失败，请稍后再试。",
    commentName: "昵称",
    commentNamePlaceholder: "怎么称呼你",
    comments: "评论",
    emptyComments: "还没有评论，欢迎留下第一条想法。",
    jumpBody: "正文",
    jumpComments: "评论",
    jumpTitle: "快捷跳转",
    liked: "已点赞",
    likeLabel: "点赞",
    moreWriting: "更多文章",
    publishComment: "发布评论",
    reading: "正在阅读",
    tags: "标签",
    toc: "目录",
  },
  en: {
    commentBody: "Comment",
    commentBodyPlaceholder: "Share a thought, question, or related note.",
    commentError: "Could not send the comment. Please try again.",
    commentName: "Name",
    commentNamePlaceholder: "How should I call you?",
    comments: "Comments",
    emptyComments: "No comments yet. Start the discussion.",
    jumpBody: "Article",
    jumpComments: "Comments",
    jumpTitle: "Quick jump",
    liked: "Liked",
    likeLabel: "Like",
    moreWriting: "More writing",
    publishComment: "Post comment",
    reading: "Reading",
    tags: "Tags",
    toc: "Contents",
  },
  ja: {
    commentBody: "コメント",
    commentBodyPlaceholder: "感想、質問、関連するメモを書いてください。",
    commentError: "コメントを送信できませんでした。もう一度お試しください。",
    commentName: "名前",
    commentNamePlaceholder: "表示名",
    comments: "コメント",
    emptyComments: "まだコメントはありません。最初のコメントをどうぞ。",
    jumpBody: "本文",
    jumpComments: "コメント",
    jumpTitle: "クイック移動",
    liked: "いいね済み",
    likeLabel: "いいね",
    moreWriting: "他の記事",
    publishComment: "コメントを投稿",
    reading: "閲覧中",
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
  const detailEndpoint = withLocaleQuery(`/api/site/writing/${slug}`, locale);
  const engagementEndpoint = withLocaleQuery(`/api/site/writing/${slug}/engagement`, locale);

  const [detail, setDetail] = useState<WritingDetailResponse | null>(null);
  const [quickLinks, setQuickLinks] = useState<WritingSummary[]>([]);
  const [engagement, setEngagement] = useState<WritingEngagement>({ comments: [], like_count: 0 });
  const [likedArticleIDs, setLikedArticleIDs] = useState<Record<number, boolean>>({});
  const [commentForm, setCommentForm] = useState({ authorName: "", body: "" });
  const [commentError, setCommentError] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);

  useEffect(() => {
    apiFetch<WritingDetailResponse>(detailEndpoint)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [detailEndpoint]);

  useEffect(() => {
    apiFetch<WritingListResponse>(withLocaleQuery("/api/site/writing?limit=8", locale))
      .then((response) => setQuickLinks(response.items))
      .catch(() => setQuickLinks([]));
  }, [locale]);

  useEffect(() => {
    apiFetch<WritingEngagement>(engagementEndpoint)
      .then((response) => setEngagement(normalizeEngagement(response)))
      .catch(() => setEngagement({ comments: [], like_count: 0 }));
  }, [engagementEndpoint]);

  const canonicalPath = useMemo(() => {
    if (!detail) {
      return location.pathname;
    }
    return detail.alternates?.find((alternate) => alternate.locale === detail.resolved_locale)?.path ?? location.pathname;
  }, [detail, location.pathname]);

  const relatedLinks = useMemo(
    () => quickLinks.filter((item) => item.slug !== detail?.item.slug).slice(0, 5),
    [detail?.item.slug, quickLinks],
  );
  const tagNames = (detail?.item.tags ?? []).map((tag) => tag.name).filter((name): name is string => Boolean(name));
  const comments = engagement.comments ?? [];
  const liked = detail?.item.id ? likedArticleIDs[detail.item.id] ?? isWritingLiked(detail.item.id) : false;
  const publishedDate = formatPublishedDate(detail?.item.published_at, locale);
  const contentMarkdown = detail?.item.content_md ?? "";
  const tocItems = useMemo(() => extractTableOfContents(contentMarkdown), [contentMarkdown]);

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

  async function handleLike() {
    if (!detail?.item.id || liked) {
      return;
    }
    const response = await apiFetch<WritingLikeResponse>(withLocaleQuery(`/api/site/writing/${slug}/like`, locale), {
      method: "POST",
    });
    window.localStorage.setItem(likedStorageKey(detail.item.id), "true");
    setLikedArticleIDs((current) => ({ ...current, [detail.item.id]: true }));
    setEngagement((current) => ({ ...current, like_count: response.like_count }));
  }

  async function handleCommentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const authorName = commentForm.authorName.trim();
    const body = commentForm.body.trim();
    if (!authorName || !body) {
      return;
    }
    setSubmittingComment(true);
    setCommentError("");
    try {
      const comment = await apiFetch<WritingComment>(withLocaleQuery(`/api/site/writing/${slug}/comments`, locale), {
        body: JSON.stringify({ author_name: authorName, body }),
        method: "POST",
      });
      setEngagement((current) => ({ ...current, comments: [comment, ...(current.comments ?? [])] }));
      setCommentForm({ authorName, body: "" });
    } catch {
      setCommentError(pageCopy.commentError);
    } finally {
      setSubmittingComment(false);
    }
  }

  return (
    <PublicLayout alternates={detail?.alternates}>
      <article className={`${styles.section} ${styles.articleSection}`}>
        <div className={styles.articleLayout}>
          <main className={styles.articleMain}>
            <header className={styles.articleHeader}>
              <div className={styles.articleHeaderGrid}>
                <div className={styles.articleHeaderCopy}>
                  <p className={styles.sectionIndex}>{pageCopy.reading}</p>
                  <h1 className={styles.articleTitle}>{detail?.item.title ?? copy.notFound}</h1>
                  {detail?.item.excerpt ? <p className={styles.articleLede}>{detail.item.excerpt}</p> : null}
                </div>
                <div className={styles.articleDigest} aria-label="Article activity">
                  <span>
                    <MessageCircle aria-hidden="true" size={14} />
                    <strong>{comments.length}</strong>
                    {pageCopy.comments}
                  </span>
                  <span>
                    <Heart aria-hidden="true" size={14} />
                    <strong>{engagement.like_count}</strong>
                    {pageCopy.likeLabel}
                  </span>
                </div>
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

            <div className={styles.articleBody} id="article-body">
              <MarkdownView
                headingIDs={tocItems.map((item) => item.id)}
                markdown={contentMarkdown}
                media={detail?.item.media ?? {}}
              />
            </div>

            <section className={styles.articleEngagement} id="article-comments">
              <div className={styles.engagementHeader}>
                <div>
                  <p className={styles.sectionIndex}>{pageCopy.comments}</p>
                  <h2>{pageCopy.comments}</h2>
                </div>
                <button
                  className={`${styles.likeButton} ${liked ? styles.likeButtonActive : ""}`}
                  disabled={liked || !detail?.item.id}
                  onClick={handleLike}
                  type="button"
                >
                  <Heart aria-hidden="true" fill={liked ? "currentColor" : "none"} size={17} />
                  <span>{liked ? pageCopy.liked : pageCopy.likeLabel}</span>
                  <strong>{engagement.like_count}</strong>
                </button>
              </div>

              <form className={styles.commentForm} onSubmit={handleCommentSubmit}>
                <label>
                  <span>{pageCopy.commentName}</span>
                  <input
                    maxLength={80}
                    onChange={(event) => setCommentForm((current) => ({ ...current, authorName: event.target.value }))}
                    placeholder={pageCopy.commentNamePlaceholder}
                    required
                    value={commentForm.authorName}
                  />
                </label>
                <label>
                  <span>{pageCopy.commentBody}</span>
                  <textarea
                    maxLength={1000}
                    onChange={(event) => setCommentForm((current) => ({ ...current, body: event.target.value }))}
                    placeholder={pageCopy.commentBodyPlaceholder}
                    required
                    rows={4}
                    value={commentForm.body}
                  />
                </label>
                <div className={styles.commentFormActions}>
                  {commentError ? <p className={styles.commentError}>{commentError}</p> : <span />}
                  <button className={styles.button} disabled={submittingComment} type="submit">
                    <Send aria-hidden="true" size={16} />
                    {pageCopy.publishComment}
                  </button>
                </div>
              </form>

              <div className={styles.commentList}>
                {comments.length === 0 ? (
                  <p className={styles.emptyComments}>{pageCopy.emptyComments}</p>
                ) : (
                  comments.map((comment) => (
                    <article className={styles.commentItem} key={comment.id}>
                      <div>
                        <strong>{comment.author_name}</strong>
                        <time dateTime={comment.created_at}>{formatCommentTime(comment.created_at, locale)}</time>
                      </div>
                      <p>{comment.body}</p>
                    </article>
                  ))
                )}
              </div>
            </section>
          </main>

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
                    {comments.length}
                  </span>
                  <span>
                    <Heart aria-hidden="true" size={14} />
                    {engagement.like_count}
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
                      <a className={`${styles.tocLink} ${tocDepthClassName(item.depth)}`} href={`#${item.id}`} key={item.id}>
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

function likedStorageKey(id: number) {
  return `portfolio-writing-liked-${id}`;
}

function isWritingLiked(id: number) {
  return window.localStorage.getItem(likedStorageKey(id)) === "true";
}

function normalizeEngagement(value: Partial<WritingEngagement>): WritingEngagement {
  return {
    comments: value.comments ?? [],
    like_count: value.like_count ?? 0,
  };
}

function formatCommentTime(value: string, locale: Locale) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
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
