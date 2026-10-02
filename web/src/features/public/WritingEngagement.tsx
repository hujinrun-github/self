import { CheckCircle2, Eye, Heart, LoaderCircle, MessageCircle, RefreshCw, Send, ShieldCheck, Users } from "lucide-react";
import { useState, type FormEvent } from "react";

import type { Locale } from "./locale";
import type { WritingEngagementController } from "./WritingEngagementState";
import styles from "./WritingEngagement.module.css";

const copy = {
  zh: {
    activity: "文章互动", visitors: "访客数", views: "有效阅读数", comments: "评论", likes: "点赞数", like: "点赞", unlike: "取消点赞",
    note: "访客按浏览器累计去重；同一浏览器 24 小时内只计一次有效阅读。", title: "留下你的想法", moderation: "无需注册。评论审核通过后公开。", name: "昵称", namePlaceholder: "怎么称呼你", body: "评论内容", bodyPlaceholder: "写下你的想法，或补充一个相关经验。", submit: "提交评论", sending: "正在提交…", success: "评论已收到，审核通过后公开。", commentError: "评论提交失败，请稍后重试。已填写的内容会保留。", empty: "还没有公开评论，欢迎留下第一条想法。", public: "已公开评论", more: "加载更多评论", loading: "正在加载互动…", loadingMore: "正在加载评论…", loadError: "互动数据加载失败，请重试。", reload: "重新加载互动", likeError: "点赞操作失败，请再试一次。", pageError: "更多评论加载失败，可以重新加载。", viewError: "本次阅读暂未登记，已显示最近一次统计。", retryView: "重试记录阅读",
  },
  en: {
    activity: "Article activity", visitors: "Visitors", views: "Qualified reads", comments: "Comments", likes: "Likes", like: "Like", unlike: "Unlike",
    note: "Visitors are counted by browser. Each browser counts as one qualified read within 24 hours.", title: "Join the conversation", moderation: "No account needed. Comments appear after approval.", name: "Name", namePlaceholder: "Your display name", body: "Comment", bodyPlaceholder: "Share a thought, question, or related experience.", submit: "Submit comment", sending: "Submitting…", success: "Comment received. It will appear after approval.", commentError: "Could not submit your comment. Your text is saved here; please try again.", empty: "No public comments yet. Share the first thought.", public: "Public comments", more: "Load more comments", loading: "Loading activity…", loadingMore: "Loading comments…", loadError: "Could not load activity. Please try again.", reload: "Reload activity", likeError: "Could not update your like. Please try again.", pageError: "Could not load more comments. Please try again.", viewError: "This read has not been recorded yet. Showing the latest available counts.", retryView: "Retry recording read",
  },
  ja: {
    activity: "記事への反応", visitors: "訪問者数", views: "有効閲覧数", comments: "コメント", likes: "いいね数", like: "いいね", unlike: "いいねを取り消す",
    note: "訪問者はブラウザごとに集計。同じブラウザの閲覧は 24 時間に 1 回だけ数えます。", title: "感想を残す", moderation: "登録は不要です。コメントは承認後に公開されます。", name: "名前", namePlaceholder: "表示名", body: "コメント内容", bodyPlaceholder: "感想、質問、関連する経験を書いてください。", submit: "コメントを送信", sending: "送信中…", success: "コメントを受け付けました。承認後に公開されます。", commentError: "コメントを送信できませんでした。入力内容は保持されています。もう一度お試しください。", empty: "公開されたコメントはまだありません。最初の感想をどうぞ。", public: "公開コメント", more: "コメントをもっと読む", loading: "読み込み中…", loadingMore: "コメントを読み込み中…", loadError: "記事への反応を読み込めませんでした。再試行してください。", reload: "再読み込み", likeError: "いいねを更新できませんでした。もう一度お試しください。", pageError: "コメントを読み込めませんでした。再試行してください。", viewError: "今回の閲覧はまだ記録されていません。直近の集計を表示しています。", retryView: "閲覧の記録を再試行",
  },
};

type Props = { engagement: WritingEngagementController; locale: Locale };

export function WritingEngagementSummary({ engagement, locale }: Props) {
  const text = copy[locale];
  const data = engagement.data;
  return <div className={styles.summary} aria-label={text.activity}>
    {([
      [Users, text.visitors, data?.visitor_count], [Eye, text.views, data?.view_count],
      [Heart, text.likes, data?.like_count], [MessageCircle, text.comments, data?.comment_count],
    ] as const).map(([Icon, label, count]) => <span key={label} className={styles.metric} aria-label={label}><Icon aria-hidden="true" size={15} /><strong>{count === undefined ? "—" : count.toLocaleString(locale)}</strong><span>{label}</span></span>)}
  </div>;
}

export function WritingEngagementSection({ engagement, locale }: Props) {
  const text = copy[locale];
  const [authorName, setAuthorName] = useState("");
  const [body, setBody] = useState("");
  const data = engagement.data;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await engagement.submitComment(authorName, body)) {
      setAuthorName(authorName.trim());
      setBody("");
    }
  }

  return <section className={styles.section} id="article-comments" aria-label={text.activity}>
    <header className={styles.header}>
      <div><h2>{text.comments} <span>{data?.comment_count ?? "—"}</span></h2><p>{text.title}</p></div>
      <button aria-pressed={data?.liked ?? false} aria-label={`${data?.liked ? text.unlike : text.like} ${data?.like_count ?? "—"}`} className={styles.like} disabled={!data || engagement.liking} onClick={() => void engagement.toggleLike()} type="button">
        {engagement.liking ? <LoaderCircle size={18} aria-hidden="true" /> : <Heart size={18} aria-hidden="true" fill={data?.liked ? "currentColor" : "none"} />}<span>{data?.liked ? text.unlike : text.like}</span><strong>{data?.like_count ?? "—"}</strong>
      </button>
    </header>
    <p className={styles.countNote}><Eye size={14} aria-hidden="true" />{text.note}</p>
    {engagement.loadError ? <div className={styles.error} role="alert"><span>{text.loadError}</span><button onClick={() => void engagement.reload()} type="button"><RefreshCw size={14} aria-hidden="true" />{text.reload}</button></div> : null}
    {engagement.loading ? <p className={styles.loading}>{text.loading}</p> : null}
    {engagement.likeError ? <p className={styles.error} role="alert">{text.likeError}</p> : null}
    {engagement.viewError ? <div className={styles.error} role="alert"><span>{text.viewError}</span><button onClick={() => void engagement.registerView()} type="button">{text.retryView}</button></div> : null}

    <form className={styles.form} onSubmit={submit}>
      <p className={styles.moderation}><ShieldCheck size={15} aria-hidden="true" />{text.moderation}</p>
      <label className={styles.name}><span>{text.name}</span><input autoComplete="nickname" maxLength={80} value={authorName} placeholder={text.namePlaceholder} onChange={(event) => setAuthorName(event.target.value)} required disabled={engagement.submitting} /></label>
      <label><span>{text.body}</span><textarea rows={4} maxLength={1000} value={body} placeholder={text.bodyPlaceholder} onChange={(event) => setBody(event.target.value)} required disabled={engagement.submitting} /></label>
      <div className={styles.formFooter}><span className={styles.length}>{Array.from(body).length} / 1000</span><button className={styles.submit} type="submit" disabled={!data || engagement.submitting}><Send size={15} aria-hidden="true" />{engagement.submitting ? text.sending : text.submit}</button></div>
      {engagement.commentSent ? <p className={styles.success} role="status"><CheckCircle2 size={16} aria-hidden="true" />{text.success}</p> : null}
      {engagement.commentError ? <p className={styles.error} role="alert">{text.commentError}</p> : null}
    </form>

    {data ? <div className={styles.comments} role="feed" aria-label={text.public} aria-busy={engagement.loadingMore}>
      {data.comments.length ? data.comments.map((comment) => <article className={styles.comment} key={comment.id}>
        <span className={styles.avatar} aria-hidden="true">{Array.from(comment.author_name)[0] ?? "·"}</span>
        <div><header><strong>{comment.author_name}</strong><time dateTime={comment.created_at}>{commentDate(comment.created_at, locale)}</time></header><p>{comment.body}</p></div>
      </article>) : <p className={styles.empty}>{text.empty}</p>}
    </div> : null}
    {engagement.pageError ? <p className={styles.error} role="alert">{text.pageError}</p> : null}
    {data?.has_more ? <button className={styles.more} type="button" onClick={() => void engagement.loadMore()} disabled={engagement.loadingMore}>{engagement.loadingMore ? text.loadingMore : text.more}</button> : null}
  </section>;
}

function commentDate(value: string, locale: Locale) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale, { day: "2-digit", month: "short", year: "numeric" }).format(date);
}
