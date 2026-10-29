import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Archive,
  ArrowLeft,
  BookOpen,
  Download,
  LockKeyhole,
  Plus,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { APIRequestError } from "../../lib/api";
import { journalAPI } from "./api";
import { useJournalAdminSession } from "./useJournalAdminSession";
import { downloadJournalArchive, exportJournalEntries } from "./export";
import { JournalCollection } from "./JournalCollection";
import { JournalBookReader } from "./JournalBookReader";
import { JournalShareButton } from "./JournalShareButton";
import { loadJournalEntries } from "./journalHelpers";
import type {
  JournalEntry,
  JournalNotebook,
  JournalNotebookInput,
} from "./types";
import styles from "./JournalPages.module.css";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}
export function JournalAdminPage() {
  const navigate = useNavigate();
  const [books, setBooks] = useState<JournalNotebook[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [bookID, setBookID] = useState<number | null>(null);
  const [trash, setTrash] = useState(false);
  const {
    expired: sessionExpired,
    setExpired: setSessionExpired,
    checking,
  } = useJournalAdminSession();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [settings, setSettings] = useState<JournalNotebook | "new" | null>(
    null,
  );
  const [create, setCreate] = useState(false);
  const [selection, setSelection] = useState(new Set<number>());
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<JournalEntry | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewGeneration = useRef(0);
  const importRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    journalAPI
      .adminBooks()
      .then((r) => {
        if (active) setBooks(r.items);
      })
      .catch((e) => {
        if (active) {
          if (e instanceof APIRequestError && e.status === 401)
            setSessionExpired(true);
          setError(errorMessage(e));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision, setSessionExpired]);
  // Clear the previous collection while its replacement is being fetched.
  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setEntries([]);
    setSelection(new Set());
    setPreview(null);
    setPreviewLoading(false);
    const targets =
      bookID === null ? books : books.filter((b) => b.id === bookID);
    Promise.all(
      targets.map((book) =>
        loadJournalEntries((offset) =>
          journalAPI.entries(book.id, { trash, limit: 100, offset }),
        ),
      ),
    )
      .then((groups) => {
        if (active) setEntries(groups.flat());
      })
      .catch((e) => {
        if (active) {
          if (e instanceof APIRequestError && e.status === 401)
            setSessionExpired(true);
          setError(errorMessage(e));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Request generation, not a DOM ref.
      previewGeneration.current++;
    };
  }, [books, bookID, trash, revision, setSessionExpired]);
  const currentBook = books.find((b) => b.id === bookID);
  const availableBooks = books.filter((b) => !b.archived);
  async function openPreview(entry: JournalEntry) {
    const generation = ++previewGeneration.current;
    setPreviewLoading(true);
    setError("");
    try {
      const latest = await journalAPI.entry(entry.id);
      if (generation === previewGeneration.current) setPreview(latest);
    } catch (e) {
      if (generation !== previewGeneration.current) return;
      if (e instanceof APIRequestError && e.status === 401)
        setSessionExpired(true);
      setError(errorMessage(e));
    } finally {
      if (generation === previewGeneration.current) setPreviewLoading(false);
    }
  }
  async function action(work: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await work();
      setNotice(message);
      setRevision((r) => r + 1);
    } catch (e) {
      if (e instanceof APIRequestError && e.status === 401)
        setSessionExpired(true);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function exportBooks() {
    await action(async () => {
      for (const book of currentBook ? [currentBook] : books) {
        const ids = entries
          .filter((e) => e.notebook_id === book.id && selection.has(e.id))
          .map((e) => e.id);
        if (!selection.size || ids.length)
          await downloadJournalArchive(
            book.id,
            selection.size ? ids : undefined,
          );
      }
    }, "场景备份已导出，包含记录与原始附件。");
  }
  if (sessionExpired)
    return (
      <section className={styles.panel}>
        <h1>管理员登录已过期</h1>
        <p className={styles.muted}>手帐内容已隐藏。请重新登录后台后继续。</p>
        <div className={styles.actions}>
          <a
            className={styles.primary}
            href="/admin/login"
            target="_blank"
            rel="noopener noreferrer"
          >
            重新登录后台
          </a>
          <button
            className={styles.button}
            type="button"
            onClick={() => navigate(0)}
          >
            我已登录，重新加载
          </button>
        </div>
      </section>
    );
  if (checking)
    return (
      <section className={styles.panel}>
        <p role="status" className={styles.muted}>
          正在验证管理员会话…
        </p>
      </section>
    );
  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>MY JOURNAL</span>
          <h1>一页一日，慢慢记录</h1>
          <p className={styles.muted}>
            在画布上留住生活。后台可直接编辑，前台由每本手帐的密码控制阅读。
          </p>
        </div>
        <div className={styles.actions}>
          <button
            className={styles.button}
            type="button"
            onClick={() => setSettings("new")}
          >
            <Plus size={17} />
            新建手帐本
          </button>
          <button
            className={styles.primary}
            type="button"
            disabled={!availableBooks.length}
            onClick={() => setCreate(true)}
          >
            <Plus size={18} />
            记一页
          </button>
        </div>
      </header>
      {error && (
        <div role="alert" className={styles.error}>
          {error}
          <button
            className={styles.button}
            type="button"
            onClick={() => {
              setError("");
              setRevision((r) => r + 1);
            }}
          >
            重试
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className={styles.notice}>
          {notice}
        </div>
      )}
      <div className={styles.layout}>
        <aside className={styles.sidebar} aria-label="手帐本">
          <div className={styles.sidebarTitle}>我的手帐</div>
          <button
            className={`${styles.button} ${styles.notebookButton} ${bookID === null && !trash ? styles.active : ""}`}
            type="button"
            onClick={() => {
              setBookID(null);
              setTrash(false);
            }}
          >
            <BookOpen size={16} />
            所有记录
          </button>
          {books.map((book) => (
            <button
              key={book.id}
              className={`${styles.button} ${styles.notebookButton} ${bookID === book.id ? styles.active : ""}`}
              onClick={() => {
                setBookID(book.id);
                setTrash(false);
              }}
              type="button"
            >
              <span
                className={styles.dot}
                style={{ "--cover-color": book.cover_color } as CSSProperties}
              />
              {book.name}
              {book.archived ? (
                <Archive size={14} aria-label="已归档" />
              ) : book.public_enabled ? (
                <LockKeyhole size={14} aria-label="前台密码查看" />
              ) : null}
            </button>
          ))}
          <div className={styles.sidebarTitle}>整理与回顾</div>
          <button
            className={`${styles.button} ${styles.notebookButton} ${trash ? styles.active : ""}`}
            onClick={() => setTrash(true)}
            type="button"
          >
            <Trash2 size={16} />
            回收站
          </button>
        </aside>
        <div className={styles.page}>
          <div className={styles.header}>
            <div>
              <h2>{trash ? "回收站" : (currentBook?.name ?? "所有记录")}</h2>
              <p className={styles.muted}>
                {trash
                  ? "删除的记录保留 30 天，之后自动清理。"
                  : currentBook
                    ? currentBook.public_enabled
                      ? "前台展示 · 密码查看，保存的记录对持有密码的访客可见。"
                      : "前台未展示，仅后台管理员可查看。"
                    : "按日期回看每一个值得留住的片刻。"}
              </p>
            </div>
            <div className={styles.actions}>
              {currentBook && !trash && (
                <JournalShareButton
                  key={preview?.id ?? currentBook.id}
                  notebookID={currentBook.id}
                  entryID={preview?.notebook_id === currentBook.id ? preview.id : undefined}
                  enabled={currentBook.public_enabled && currentBook.has_password && !currentBook.archived}
                  className={styles.button}
                />
              )}
              {currentBook && !trash && entries.length > 0 && !preview && (
                <button
                  className={styles.button}
                  type="button"
                  disabled={loading || previewLoading}
                  onClick={() => void openPreview(entries[0])}
                >
                  <BookOpen size={16} />
                  翻阅手帐
                </button>
              )}
              {currentBook && (
                <button
                  className={styles.button}
                  type="button"
                  onClick={() => setSettings(currentBook)}
                >
                  <Settings2 size={16} />
                  手帐本设置
                </button>
              )}
              {!trash && books.length > 0 && (
                <button
                  className={styles.button}
                  type="button"
                  disabled={busy}
                  onClick={() => void exportBooks()}
                >
                  <Download size={16} />
                  场景备份
                </button>
              )}
              {!trash && (
                <button
                  className={styles.button}
                  type="button"
                  disabled={busy || !entries.length}
                  onClick={() =>
                    void action(
                      () =>
                        exportJournalEntries(
                          selection.size
                            ? entries.filter((e) => selection.has(e.id))
                            : entries,
                        ),
                      "PDF 已导出。",
                    )
                  }
                >
                  <Download size={16} />
                  {selection.size
                    ? `导出所选 ${selection.size} 页 PDF`
                    : "导出 PDF"}
                </button>
              )}
              {currentBook && !trash && (
                <>
                  <button
                    className={styles.button}
                    disabled={busy}
                    onClick={() => importRef.current?.click()}
                    type="button"
                  >
                    <Upload size={16} />
                    恢复备份
                  </button>
                  <input
                    ref={importRef}
                    type="file"
                    accept=".zip,application/zip"
                    className={styles.hidden}
                    aria-label="选择场景备份"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file)
                        void action(async () => {
                          const result = await journalAPI.importArchive(
                            currentBook.id,
                            file,
                          );
                          setNotice(`已恢复 ${result.imported} 条记录。`);
                        }, "备份恢复完成。");
                    }}
                  />
                </>
              )}
            </div>
          </div>
          {loading ? (
            <div className={styles.loading} role="status">
              正在加载手帐…
            </div>
          ) : !books.length ? (
            <div className={styles.empty}>
              <BookOpen size={36} />
              <h2>从第一本手帐开始</h2>
              <p>日常、旅行或灵感，用一页画布记录下来。</p>
              <button
                className={styles.primary}
                type="button"
                onClick={() => setSettings("new")}
              >
                创建「日常」手帐
              </button>
            </div>
          ) : preview && currentBook && preview.notebook_id === currentBook.id && !trash ? (
            <>
              <div className={styles.actions}>
                <button
                  className={styles.button}
                  type="button"
                  onClick={() => {
                    previewGeneration.current++;
                    setPreview(null);
                    setPreviewLoading(false);
                  }}
                >
                  <ArrowLeft size={16} /> 返回所有记录
                </button>
                <Link className={styles.button} to={`/admin/journal/entries/${preview.id}`}>
                  编辑这一页
                </Link>
              </div>
              <JournalBookReader
                entry={preview}
                entries={entries}
                bookTitle={currentBook.name}
                coverColor={currentBook.cover_color}
                locale="zh"
                assetURL={(id) => journalAPI.assetURL(id)}
                loading={previewLoading}
                onNavigate={(entry) => void openPreview(entry)}
              />
            </>
          ) : (
            <JournalCollection
              onCreateDate={
                !trash && availableBooks.length
                  ? (date) =>
                      navigate(
                        `/admin/journal/new?notebook=${currentBook && !currentBook.archived ? currentBook.id : availableBooks[0].id}&template=blank&date=${date}`,
                      )
                  : undefined
              }
              entries={entries}
              assetURL={(id) => journalAPI.assetURL(id)}
              onOpen={(entry) => {
                if (!trash) navigate(`/admin/journal/entries/${entry.id}`);
              }}
              selection={selection}
              onSelect={(id) =>
                setSelection((old) => {
                  const next = new Set(old);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              renderActions={(entry) =>
                trash ? (
                  <>
                    <button
                      className={styles.button}
                      disabled={busy}
                      type="button"
                      onClick={() =>
                        void action(
                          () => journalAPI.restoreEntry(entry.id),
                          "记录已恢复。",
                        )
                      }
                    >
                      恢复
                    </button>
                    <button
                      className={styles.danger}
                      disabled={busy}
                      type="button"
                      onClick={() => {
                        if (
                          window.confirm("彻底删除这条记录？此操作无法撤销。")
                        )
                          void action(
                            () => journalAPI.deleteEntry(entry.id, true),
                            "记录已彻底删除。",
                          );
                      }}
                    >
                      彻底删除
                    </button>
                  </>
                ) : (
                  <button
                    className={styles.button}
                    disabled={busy}
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          "将这条记录移至回收站？30 天内可以恢复。",
                        )
                      )
                        void action(
                          () => journalAPI.deleteEntry(entry.id),
                          "记录已移至回收站。",
                        );
                    }}
                  >
                    <Trash2 size={14} />
                    移至回收站
                  </button>
                )
              }
            />
          )}
        </div>
      </div>
      {settings && (
        <NotebookSettings
          onSessionExpired={() => setSessionExpired(true)}
          notebook={settings === "new" ? undefined : settings}
          onClose={() => setSettings(null)}
          onSaved={(book) => {
            setSettings(null);
            setBookID(book.id);
            setRevision((r) => r + 1);
            setNotice("手帐本设置已保存。");
          }}
          onDeleted={() => {
            setSettings(null);
            setBookID(null);
            setRevision((r) => r + 1);
          }}
        />
      )}
      {create && (
        <TemplateDialog
          books={availableBooks}
          selectedID={
            currentBook && !currentBook.archived
              ? currentBook.id
              : availableBooks[0]?.id
          }
          onClose={() => setCreate(false)}
        />
      )}
    </section>
  );
}

function TemplateDialog({
  books,
  selectedID,
  onClose,
}: {
  books: JournalNotebook[];
  selectedID?: number;
  onClose: () => void;
}) {
  const [id, setID] = useState(selectedID ?? books[0]?.id);
  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <section
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <div className={styles.modalHeader}>
          <h2 id="template-title">今天，想记录什么？</h2>
          <button
            className={styles.button}
            aria-label="关闭"
            type="button"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <label className={styles.label}>
          保存到
          <select
            className={styles.select}
            value={id}
            onChange={(e) => setID(Number(e.target.value))}
          >
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.templateGrid}>
          {[
            ["blank", "✎", "随手记", "从一张空白纸开始"],
            ["daily", "☀", "今日小结", "回顾今天的小确幸"],
            ["travel", "✈", "旅行记录", "收集路上的风景"],
          ].map(([template, icon, title, hint]) => (
            <Link
              className={`${styles.button} ${styles.template}`}
              key={template}
              to={`/admin/journal/new?notebook=${id}&template=${template}`}
            >
              <span aria-hidden="true">{icon}</span>
              <strong>{title}</strong>
              <small>{hint}</small>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function NotebookSettings({
  notebook,
  onClose,
  onSaved,
  onDeleted,
  onSessionExpired,
}: {
  onSessionExpired: () => void;
  notebook?: JournalNotebook;
  onClose: () => void;
  onSaved: (book: JournalNotebook) => void;
  onDeleted: () => void;
}) {
  const [input, setInput] = useState<JournalNotebookInput>({
    name: notebook?.name ?? "日常",
    public_title: notebook?.public_title ?? "",
    cover_color: notebook?.cover_color ?? "#789888",
    paper: notebook?.paper ?? "plain",
    public_enabled: notebook?.public_enabled ?? false,
    archived: notebook?.archived ?? false,
    version: notebook?.version,
  });
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const hasPassword =
    !clearPassword &&
    (!!notebook?.has_password ||
      new TextEncoder().encode(password).length >= 8);
  function update<K extends keyof JournalNotebookInput>(
    key: K,
    value: JournalNotebookInput[K],
  ) {
    setInput((old) => ({ ...old, [key]: value }));
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const length = new TextEncoder().encode(password).length;
    if (password && (length < 8 || length > 72)) {
      setError("查看密码需为 8–72 字节（中文通常每字 3 字节）。");
      return;
    }
    setBusy(true);
    try {
      const body = {
        ...input,
        public_enabled: input.public_enabled && hasPassword && !input.archived,
        ...(password ? { password } : {}),
        ...(clearPassword ? { clear_password: true } : {}),
      };
      const saved = notebook
        ? await journalAPI.updateBook(notebook.id, body)
        : await journalAPI.createBook(body);
      setPassword("");
      onSaved(saved);
    } catch (e) {
      if (e instanceof APIRequestError && e.status === 401) {
        setPassword("");
        onSessionExpired();
      }
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.modalBackdrop}>
      <form
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notebook-title"
        onSubmit={(e) => void submit(e)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) onClose();
        }}
      >
        <div className={styles.modalHeader}>
          <h2 id="notebook-title">{notebook ? "手帐本设置" : "新建手帐本"}</h2>
          <button
            className={styles.button}
            type="button"
            onClick={onClose}
            aria-label="关闭"
            disabled={busy}
          >
            <X size={18} />
          </button>
        </div>
        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}
        <div className={styles.formGrid}>
          <label className={styles.label}>
            后台名称
            <input
              autoFocus
              className={styles.input}
              required
              maxLength={100}
              value={input.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </label>
          <label className={styles.label}>
            默认纸张
            <select
              className={styles.select}
              value={input.paper}
              onChange={(e) =>
                update("paper", e.target.value as JournalNotebookInput["paper"])
              }
            >
              <option value="plain">白纸</option>
              <option value="ruled">横线</option>
              <option value="dots">点阵</option>
            </select>
          </label>
        </div>
        <hr className={styles.divider} />
        <h3 style={{ margin: 0 }}>前台展示设置</h3>
        <p className={styles.muted}>
          访客无需登录，输入这本手帐的密码后只读查看。请自行把密码交给希望查看的人。
        </p>
        <label className={styles.label}>
          {notebook?.has_password
            ? "更换查看密码（留空则不更换）"
            : "设置查看密码"}
          <input
            className={styles.input}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setClearPassword(false);
            }}
            placeholder="8–72 字节"
          />
          <small className={styles.muted}>
            更换或清除密码后，旧访客凭证立即失效。
          </small>
        </label>
        {notebook?.has_password && (
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={clearPassword}
              onChange={(e) => {
                setClearPassword(e.target.checked);
                setPassword("");
                if (e.target.checked) update("public_enabled", false);
              }}
            />
            清除查看密码，同时关闭前台展示
          </label>
        )}
        <div className={styles.formGrid}>
          <label className={styles.label}>
            允许公开的手帐本名
            <input
              className={styles.input}
              maxLength={100}
              required={input.public_enabled}
              value={input.public_title}
              onChange={(e) => update("public_title", e.target.value)}
              placeholder="只填写可公开的名称"
            />
          </label>
          <label className={styles.label}>
            装饰封面颜色
            <input
              className={styles.input}
              type="color"
              value={input.cover_color}
              onChange={(e) => update("cover_color", e.target.value)}
            />
          </label>
        </div>
        <div
          className={styles.coverPreview}
          style={{ "--cover-color": input.cover_color } as CSSProperties}
        >
          <LockKeyhole size={25} />
          <strong>{input.public_title || "公开卡片预览"}</strong>
        </div>
        <label className={styles.check}>
          <input
            type="checkbox"
            disabled={!hasPassword || input.archived}
            checked={input.public_enabled}
            onChange={(e) => update("public_enabled", e.target.checked)}
          />
          开启前台展示，确认以上本名和封面可以公开
        </label>
        {!hasPassword && (
          <p className={styles.muted}>
            设置查看密码后才能开启展示。后台始终可直接管理。
          </p>
        )}
        {notebook && (
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={input.archived}
              onChange={(e) => {
                update("archived", e.target.checked);
                if (e.target.checked) update("public_enabled", false);
              }}
            />
            归档手帐本（保留记录并关闭前台展示）
          </label>
        )}
        <div className={styles.actions}>
          <button className={styles.primary} type="submit" disabled={busy}>
            {busy ? "正在保存…" : "保存设置"}
          </button>
          <button
            className={styles.button}
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            取消
          </button>
          {notebook && (
            <button
              className={styles.danger}
              type="button"
              disabled={busy}
              onClick={async () => {
                if (
                  !window.confirm(
                    "仅空手帐本可删除。请先迁移或处理全部记录（含回收站），删除后无法撤销。",
                  )
                )
                  return;
                setBusy(true);
                try {
                  await journalAPI.deleteBook(notebook.id);
                  onDeleted();
                } catch (e) {
                  if (e instanceof APIRequestError && e.status === 401) {
                    setPassword("");
                    onSessionExpired();
                  }
                  setError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              删除空手帐本
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
