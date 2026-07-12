import { Archive, ExternalLink, Pencil, Plus, Rocket } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { APIRequestError, apiFetch } from "../../lib/api";
import styles from "./Admin.module.css";
import { contentStatusLabel } from "./adminI18n";
import { WritingImportDialog } from "./WritingImportDialog";

type Resource = "experience" | "projects" | "talks" | "writing";
type Status = "archived" | "draft" | "published";

type AdminItem = {
  description?: string;
  event_name?: string;
  excerpt?: string;
  featured?: boolean;
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
  const navigate = useNavigate();
  const [items, setItems] = useState<AdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [showImport, setShowImport] = useState(false);

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
          setMessage(error instanceof APIRequestError ? error.message : "加载内容失败。");
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
    setMessage(status === "published" ? "已发布。" : "已归档。");
  }

  const published = items.filter((item) => item.status === "published").length;
  const drafts = items.filter((item) => item.status === "draft").length;
  const featured = items.filter((item) => item.featured).length;

  return (
    <section className={`${styles.panel} ${styles.stack}`}>
      <div className={styles.pageHeader}>
        <div>
          <h1>{titleFor(typedResource)}</h1>
          <p>{descriptionFor(typedResource)}</p>
        </div>
        <div className={styles.headerActions}>
          {typedResource === "writing" ? (
            <button className={styles.button} onClick={() => setShowImport(true)} type="button">
              导入 Markdown
            </button>
          ) : null}
          <Link className={`${styles.button} ${styles.primary}`} to={`/admin/${typedResource}/new`}>
            <Plus aria-hidden="true" size={18} />
            新建
          </Link>
        </div>
      </div>

      <div className={styles.overviewGrid} data-testid="admin-overview-grid">
        <article className={styles.overviewCard}>
          <span className={styles.overviewLabel}>内容集合</span>
          <strong className={styles.overviewValue}>{titleFor(typedResource)}</strong>
          <p className={styles.overviewNote}>{descriptionFor(typedResource)}</p>
        </article>
        <Metric label="总条目" value={items.length} />
        <Metric label="已发布" value={published} />
        <Metric label={typedResource === "experience" ? "草稿" : "推荐位"} value={typedResource === "experience" ? drafts : featured} />
      </div>

      {message ? <p className={styles.message}>{message}</p> : null}
      {loading ? <p className={styles.muted}>正在加载内容...</p> : null}

      {!loading && items.length === 0 ? (
        <div className={styles.emptyState}>
          <h2>还没有内容</h2>
          <p>先创建第一条 {titleFor(typedResource)} 内容，准备好后再发布。</p>
          <Link className={`${styles.button} ${styles.primary}`} to={`/admin/${typedResource}/new`}>
            <Plus aria-hidden="true" size={18} />
            新建内容
          </Link>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className={`${styles.panel} ${styles.listPanel}`}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionIntro}>
              <span className={styles.overviewLabel}>队列</span>
              <h2>编辑队列</h2>
              <p>最近编辑的内容会集中展示，方便继续发布、归档或前台查看。</p>
            </div>
          </div>
          <div className={styles.list} data-testid="admin-content-list">
            {items.map((item) => (
              <article className={styles.contentRow} key={item.id}>
                <div>
                  <div className={styles.rowMeta}>
                    <span className={`${styles.status} ${styles[`status${item.status}`]}`}>{contentStatusLabel(item.status)}</span>
                    {item.published_at ? <span>{formatDate(item.published_at)}</span> : null}
                    {item.period ? <span>{item.period}</span> : null}
                  </div>
                  <h2>{item.title}</h2>
                  <p>{summaryFor(item)}</p>
                </div>
                <div className={styles.rowActions}>
                  <Link className={styles.iconButton} to={`/admin/${typedResource}/${item.id}`}>
                    <Pencil aria-hidden="true" size={17} />
                    编辑
                  </Link>
                  {publicURLFor(typedResource, item) ? (
                    <Link className={styles.iconButton} to={publicURLFor(typedResource, item) ?? "/"}>
                      <ExternalLink aria-hidden="true" size={17} />
                      查看
                    </Link>
                  ) : null}
                  {item.status !== "published" ? (
                    <button className={styles.iconButton} onClick={() => void setStatus(item, "published")} type="button">
                      <Rocket aria-hidden="true" size={17} />
                      发布
                    </button>
                  ) : null}
                  {item.status !== "archived" ? (
                    <button className={styles.iconButton} onClick={() => void setStatus(item, "archived")} type="button">
                      <Archive aria-hidden="true" size={17} />
                      归档
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {typedResource === "writing" ? (
        <WritingImportDialog
          mode="create"
          onClose={() => setShowImport(false)}
          onCommitted={(writing) => {
            setShowImport(false);
            setMessage("Markdown 导入成功，已创建草稿。");
            navigate(`/admin/writing/${writing.id}`);
          }}
          open={showImport}
        />
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <article className={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function titleFor(resource: Resource) {
  if (resource === "projects") {
    return "项目";
  }
  if (resource === "writing") {
    return "写作";
  }
  if (resource === "talks") {
    return "演讲";
  }
  return "经历";
}

function descriptionFor(resource: Resource) {
  if (resource === "projects") {
    return "案例、演示、仓库与重点项目内容。";
  }
  if (resource === "writing") {
    return "文章、随笔与带 Markdown 编辑体验的内容。";
  }
  if (resource === "talks") {
    return "演讲信息、活动背景与视频相关内容。";
  }
  return "首页展示的经历时间线、角色与阶段说明。";
}

function summaryFor(item: AdminItem) {
  return item.summary || item.excerpt || item.description || item.organization || "暂无摘要。";
}

function publicURLFor(resource: Resource, item: AdminItem) {
  if (resource === "experience" || item.status !== "published" || !item.slug) {
    return null;
  }
  return `/zh/${resource}/${item.slug}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}
