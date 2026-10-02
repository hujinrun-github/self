import { Check, ChevronLeft, ChevronRight, EyeOff, MessageSquare, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";

import { APIRequestError, apiFetch } from "../../lib/api";
import type { AdminComment, CommentStatus, PageResult, WritingStats, WritingStatsResult } from "../../lib/engagement";
import admin from "./Admin.module.css";
import styles from "./EngagementPage.module.css";

type ReviewFilter = CommentStatus | "all";
type Section = "overview" | "comments";
const pageSize = 20;
const statusLabels: Record<CommentStatus, string> = { pending: "待审核", published: "已公开", hidden: "已隐藏" };
const metrics = [
  ["view_count", "有效阅读"],
  ["visitor_count", "文章访客累计"],
  ["like_count", "点赞"],
  ["comment_count", "已公开评论"],
  ["pending_comment_count", "待审核"],
] as const;
const numberFormatter = new Intl.NumberFormat("zh-CN");
const dateFormatter = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });

function useRemote<T>(path: string, fallback: string) {
  const [revision, setRevision] = useState(0);
  const key = `${path}:${revision}`;
  const [result, setResult] = useState<{ key: string; data: T | null; error: string }>({ key: "", data: null, error: "" });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    apiFetch<T>(path, { signal: controller.signal })
      .then((data) => {
        if (!cancelled) setResult({ key, data, error: "" });
      })
      .catch((error: unknown) => {
        if (!cancelled) setResult({ key, data: null, error: error instanceof APIRequestError ? error.message : fallback });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [path, key, fallback]);

  return {
    data: result.data,
    loading: result.key !== key,
    error: result.key === key ? result.error : "",
    reload: () => setRevision((current) => current + 1),
  };
}

export function EngagementPage() {
  const [section, setSection] = useState<Section>("overview");
  const [statsPage, setStatsPage] = useState(1);
  const [commentPage, setCommentPage] = useState(1);
  const [filter, setFilter] = useState<ReviewFilter>("pending");
  const [writing, setWriting] = useState<Pick<WritingStats, "writing_id" | "title"> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [operation, setOperation] = useState<number | null>(null);
  const operationLock = useRef(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const stats = useRemote<WritingStatsResult>(`/api/admin/writing/stats?page=${statsPage}&limit=${pageSize}`, "加载统计失败，请重试。");
  const comments = useRemote<PageResult<AdminComment>>(
    `/api/admin/comments?status=${filter}&page=${commentPage}&limit=${pageSize}${writing ? `&writing_id=${writing.writing_id}` : ""}`,
    "加载评论失败，请重试。",
  );
  const busy = operation !== null;
  const reviewLocked = busy || comments.loading;

  function refresh() {
    setNotice(null);
    setConfirmDelete(null);
    stats.reload();
    comments.reload();
  }

  function changeFilter(next: ReviewFilter) {
    setFilter(next);
    setCommentPage(1);
    setConfirmDelete(null);
    setNotice(null);
  }

  function selectWriting(item: Pick<WritingStats, "writing_id" | "title"> | null) {
    setWriting(item);
    setCommentPage(1);
    setConfirmDelete(null);
    setNotice(null);
    setSection("comments");
  }

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, current: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - current;
    setSection(next === 0 ? "overview" : "comments");
    tabRefs.current[next]?.focus();
  }

  async function moderate(item: AdminComment, next: CommentStatus | "delete") {
    if (operationLock.current) return;
    operationLock.current = true;
    setOperation(item.id);
    setNotice(null);
    try {
      await apiFetch(`/api/admin/comments/${item.id}`, next === "delete" ? { method: "DELETE" } : {
        method: "PATCH", body: JSON.stringify({ status: next }),
      });
      setConfirmDelete(null);
      setNotice({ error: false, text: next === "delete" ? "评论已删除。" : next === "published" ? "评论已公开。" : next === "hidden" ? "评论已隐藏。" : "评论已恢复待审核。" });
      const leavesPage = next === "delete" || (filter !== "all" && next !== filter);
      if (leavesPage && comments.data?.items.length === 1 && commentPage > 1) {
        setCommentPage((current) => current - 1);
      } else {
        comments.reload();
      }
      stats.reload();
    } catch (error) {
      setNotice({ error: true, text: error instanceof APIRequestError ? error.message : "操作失败，请重试。" });
    } finally {
      operationLock.current = false;
      setOperation(null);
    }
  }

  return (
    <section className={`${admin.panel} ${admin.stack} ${styles.page}`}>
      <header className={admin.pageHeader}>
        <div>
          <h1>文章互动</h1>
          <p>了解文章的阅读与回应，让每一条讨论都有所归属。</p>
        </div>
        <button className={admin.button} disabled={busy || stats.loading || comments.loading} onClick={refresh} type="button">
          <RefreshCw aria-hidden="true" size={16} />刷新数据
        </button>
      </header>

      <section aria-label="互动汇总" aria-busy={stats.loading} className={styles.summarySection}>
        <div className={styles.metrics}>
          {metrics.map(([key, label]) => (
            <div aria-label={label} className={styles.metric} key={key} role="group">
              <span>{label}</span>
              <strong>{stats.data ? numberFormatter.format(stats.data.summary[key]) : "—"}</strong>
            </div>
          ))}
        </div>
        <p className={styles.note}>文章访客累计为各文章访客数之和；同一浏览器访问不同文章会分别计入。有效阅读按每篇文章、每个浏览器 24 小时去重。</p>
        {stats.error ? <ErrorState message={stats.error} onRetry={stats.reload} retryLabel="重试统计" /> : null}
      </section>

      <div aria-label="文章互动管理" className={styles.tabs} role="tablist">
        {(["overview", "comments"] as const).map((value, index) => (
          <button
            aria-controls={`engagement-panel-${value}`} aria-selected={section === value}
            className={styles.tab} disabled={busy} id={`engagement-tab-${value}`} key={value}
            onClick={() => setSection(value)} onKeyDown={(event) => moveTab(event, index)}
            ref={(element) => { tabRefs.current[index] = element; }} role="tab" tabIndex={section === value ? 0 : -1} type="button"
          >
            {value === "overview" ? "文章概览" : "评论审核"}
            {value === "comments" && stats.data ? <span className={styles.tabCount}>{numberFormatter.format(stats.data.summary.pending_comment_count)}</span> : null}
          </button>
        ))}
      </div>

      {notice ? <p className={`${admin.message} ${notice.error ? styles.errorNotice : ""}`} role={notice.error ? "alert" : "status"}>{notice.text}</p> : null}

      <section aria-labelledby="engagement-tab-overview" className={styles.section} hidden={section !== "overview"} id="engagement-panel-overview" role="tabpanel" tabIndex={0}>
        <div className={styles.sectionHeader}><h2>每篇文章的互动</h2><span>{stats.data ? `共 ${numberFormatter.format(stats.data.total)} 篇文章` : ""}</span></div>
        {stats.loading ? <p className={styles.loading} role="status">正在加载文章统计…</p> : null}
        {!stats.loading && !stats.error && stats.data?.items.length === 0 ? <EmptyState title="还没有文章统计" description="创建文章后，可以在这里查看阅读、点赞和评论。" /> : null}
        {!stats.loading && !stats.error && stats.data && stats.data.items.length > 0 ? (
          <>
            <div className={styles.tableWrap}>
              <table aria-label="每篇文章的互动统计" className={styles.table}>
                <thead><tr><th scope="col">文章</th><th scope="col">阅读</th><th scope="col">访客</th><th scope="col">点赞</th><th scope="col">已公开</th><th scope="col">待审核</th><th scope="col"><span className={styles.srOnly}>操作</span></th></tr></thead>
                <tbody>{stats.data.items.map((item) => (
                  <tr key={item.writing_id}>
                    <td className={styles.articleCell}><Link to={`/admin/writing/${item.writing_id}`}>{item.title || "未命名文章"}</Link><span>{item.status === "published" ? "已发布" : item.status === "archived" ? "已归档" : "草稿"}</span></td>
                    <td data-label="阅读">{numberFormatter.format(item.view_count)}</td>
                    <td data-label="访客">{numberFormatter.format(item.visitor_count)}</td>
                    <td data-label="点赞">{numberFormatter.format(item.like_count)}</td>
                    <td data-label="已公开">{numberFormatter.format(item.comment_count)}</td>
                    <td data-label="待审核">{numberFormatter.format(item.pending_comment_count)}</td>
                    <td className={styles.articleAction}><button className={styles.textButton} onClick={() => selectWriting(item)} type="button">查看评论</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <Pagination disabled={busy} hasMore={stats.data.has_more} noun="文章" onChange={setStatsPage} page={statsPage} />
          </>
        ) : null}
      </section>

      <section aria-labelledby="engagement-tab-comments" className={styles.section} hidden={section !== "comments"} id="engagement-panel-comments" role="tabpanel" tabIndex={0}>
        <div className={styles.reviewHeader}>
          <div><h2>评论审核</h2><p>新评论审核后才会公开；隐藏的评论可随时恢复。</p></div>
          <label className={styles.filter}>评论状态<select disabled={reviewLocked} onChange={(event) => changeFilter(event.target.value as ReviewFilter)} value={filter}>
            <option value="pending">待审核</option><option value="published">已公开</option><option value="hidden">已隐藏</option><option value="all">全部状态</option>
          </select></label>
        </div>
        {writing ? <div className={styles.articleFilter}><span>所属文章：<strong>{writing.title || "未命名文章"}</strong></span><button className={styles.textButton} disabled={reviewLocked} onClick={() => selectWriting(null)} type="button">查看全部文章</button></div> : null}
        <div aria-busy={reviewLocked}>
          {comments.loading ? <p className={styles.loading} role="status">正在加载评论…</p> : null}
          {comments.error ? <ErrorState message={comments.error} onRetry={comments.reload} retryLabel="重试评论" /> : null}
          {!comments.loading && !comments.error && comments.data?.items.length === 0 ? <EmptyState title={filter === "pending" ? "暂无待审核评论" : filter === "published" ? "暂无已公开评论" : filter === "hidden" ? "暂无已隐藏评论" : "暂无评论"} description={filter === "pending" ? "新的读者留言会出现在这里，审核后即可公开。" : "可以切换评论状态，查看其他留言。"} /> : null}
          {!comments.loading && !comments.error && comments.data && comments.data.items.length > 0 ? <div className={styles.commentList}>
            {comments.data.items.map((item) => <article aria-label={`${item.author_name} 的评论`} aria-busy={operation === item.id} className={styles.comment} key={item.id}>
              <div className={styles.commentHeader}>
                <div className={styles.author}><span aria-hidden="true" className={styles.avatar}>{Array.from(item.author_name)[0] || "访"}</span><div><strong>{item.author_name}</strong><time dateTime={item.created_at}>{formatDate(item.created_at)}</time></div></div>
                <span className={styles.status} data-status={item.status}>{statusLabels[item.status]}</span>
              </div>
              <p className={styles.commentBody}>{item.body}</p>
              <div className={styles.commentFooter}>
                <Link className={styles.writingLink} to={`/admin/writing/${item.writing_id}`}><MessageSquare aria-hidden="true" size={15} /><span>{item.writing_title || "未命名文章"}</span></Link>
                <div className={styles.actions}>
                  {item.status !== "published" ? <button className={`${admin.iconButton} ${styles.approve}`} disabled={reviewLocked} onClick={() => void moderate(item, "published")} type="button"><Check aria-hidden="true" size={15} />批准公开</button> : null}
                  {item.status !== "hidden" ? <button className={admin.iconButton} disabled={reviewLocked} onClick={() => void moderate(item, "hidden")} type="button"><EyeOff aria-hidden="true" size={15} />隐藏</button> : null}
                  {item.status !== "pending" ? <button className={admin.iconButton} disabled={reviewLocked} onClick={() => void moderate(item, "pending")} type="button"><RotateCcw aria-hidden="true" size={15} />恢复待审</button> : null}
                  <button className={`${admin.iconButton} ${admin.danger}`} disabled={reviewLocked} onClick={() => setConfirmDelete(item.id)} type="button"><Trash2 aria-hidden="true" size={15} />删除</button>
                </div>
              </div>
              {confirmDelete === item.id ? <div aria-label="删除评论确认" className={styles.confirmation} role="group">
                <p>确定删除这条评论？删除后无法恢复。</p>
                <div className={styles.actions}><button className={admin.button} disabled={busy} onClick={() => setConfirmDelete(null)} type="button">取消删除</button><button className={`${admin.button} ${styles.deleteButton}`} disabled={busy} onClick={() => void moderate(item, "delete")} type="button">{operation === item.id ? "删除中…" : "确认删除"}</button></div>
              </div> : null}
            </article>)}
          </div> : null}
        </div>
        {!comments.loading && !comments.error && comments.data ? <div className={styles.reviewPagination}><span>共 {numberFormatter.format(comments.data.total)} 条评论</span><Pagination disabled={busy} hasMore={comments.data.has_more} noun="评论" onChange={(page) => { setCommentPage(page); setConfirmDelete(null); }} page={commentPage} /></div> : null}
      </section>
    </section>
  );
}

function Pagination({ page, hasMore, onChange, disabled, noun }: { page: number; hasMore: boolean; onChange: (page: number) => void; disabled: boolean; noun: string }) {
  return <nav aria-label={`${noun}分页`} className={styles.pagination}>
    <button aria-label={`上一页${noun}`} className={admin.button} disabled={disabled || page <= 1} onClick={() => onChange(page - 1)} type="button"><ChevronLeft aria-hidden="true" size={16} /><span>上一页</span></button>
    <span>第 {page} 页</span>
    <button aria-label={`下一页${noun}`} className={admin.button} disabled={disabled || !hasMore} onClick={() => onChange(page + 1)} type="button"><span>下一页</span><ChevronRight aria-hidden="true" size={16} /></button>
  </nav>;
}

function ErrorState({ message, onRetry, retryLabel }: { message: string; onRetry: () => void; retryLabel: string }) {
  return <div className={styles.errorState}><p role="alert">{message}</p><button className={admin.button} onClick={onRetry} type="button"><RefreshCw aria-hidden="true" size={15} />{retryLabel}</button></div>;
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className={admin.emptyState}><MessageSquare aria-hidden="true" className={styles.emptyIcon} size={25} /><h3>{title}</h3><p>{description}</p></div>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}
