import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Link,
  useBlocker,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Info,
  Save,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { APIRequestError, apiFetch, setCSRFToken } from "../../lib/api";
import { journalAPI } from "./api";
import { useJournalAdminSession } from "./useJournalAdminSession";
import { JournalCanvas } from "./JournalCanvas";
import { JournalShareButton } from "./JournalShareButton";
import { moodOptions, todayDate } from "./journalHelpers";
import { createJournalScene } from "./scene";
import {
  downloadJournalArchive,
  exportJournalEntry,
  exportJournalText,
} from "./export";
import type { JournalEntry, JournalEntryInput, JournalNotebook } from "./types";
import styles from "./JournalPages.module.css";

const fingerprint = (input: JournalEntryInput) =>
  JSON.stringify({
    notebook_id: input.notebook_id,
    title: input.title,
    entry_date: input.entry_date,
    mood: input.mood,
    weather: input.weather,
    tags: input.tags,
    favorite: input.favorite,
    scene: input.scene,
  });
function toDraft(entry: JournalEntry): JournalEntryInput {
  return {
    notebook_id: entry.notebook_id,
    title: entry.title,
    entry_date: entry.entry_date,
    mood: entry.mood,
    weather: entry.weather,
    tags: entry.tags,
    favorite: entry.favorite,
    scene: entry.scene,
  };
}
export function JournalEntryPage() {
  const { entryId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [books, setBooks] = useState<JournalNotebook[]>([]);
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [draft, setDraft] = useState<JournalEntryInput | null>(null);
  const draftRef = useRef<JournalEntryInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { expired, setExpired, checking, refreshSession } =
    useJournalAdminSession();
  const [online, setOnline] = useState(navigator.onLine);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [saveNotice, setSaveNotice] = useState<{
    message: string;
    kind: "success" | "info" | "error";
  } | null>(null);
  const [tagText, setTagText] = useState("");
  const [savedFingerprint, setSavedFingerprint] = useState("");
  const savedRef = useRef("");
  const versionRef = useRef(0);
  const idRef = useRef<number | null>(null);
  const [operation, setOperation] = useState<
    "move" | "copy" | "reload" | "delete" | null
  >(null);
  const documentGeneration = useRef(0);
  const [generation, setGeneration] = useState(0);
  const [exporting, setExporting] = useState(false);
  const allowLeaveRef = useRef(false);
  const loadedFor = useRef("");
  useEffect(() => {
    if (!saveNotice) return;
    const timer = window.setTimeout(
      () => setSaveNotice(null),
      saveNotice.kind === "error" ? 8000 : 4500,
    );
    return () => window.clearTimeout(timer);
  }, [saveNotice]);
  const [pendingSignOut, setPendingSignOut] = useState<{
    proceed: () => Promise<void>;
  } | null>(null);
  const dirty =
    !!draft &&
    (!!draft.scene.elements.length || entry !== null) &&
    fingerprint(draft) !== savedFingerprint;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !allowLeaveRef.current &&
      (dirty || uploading) &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  );
  function setContent(next: JournalEntryInput) {
    draftRef.current = next;
    setDraft(next);
    setError("");
  }
  function acceptSaved(next: JournalEntry) {
    const content = toDraft(next);
    idRef.current = next.id;
    versionRef.current = next.version;
    setEntry(next);
    setTagText(content.tags.join("，"));
    setContent(content);
    savedRef.current = fingerprint(content);
    setSavedFingerprint(savedRef.current);
    setSavedAt(next.updated_at);
    setConflict(false);
  }
  useEffect(() => {
    const key =
      entryId || `new:${params.get("notebook")}:${params.get("template")}`;
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    documentGeneration.current++;
    allowLeaveRef.current = false;
    savingRef.current = false;
    setSaving(false);
    setOperation(null);
    draftRef.current = null;
    idRef.current = null;
    versionRef.current = 0;
    savedRef.current = "";
    setDraft(null);
    setEntry(null);
    setSavedFingerprint("");
    setSavedAt("");
    setSaveNotice(null);
    setError("");
    setConflict(false);
    let active = true;
    setLoading(true);
    Promise.all([
      journalAPI.adminBooks(),
      entryId ? journalAPI.entry(Number(entryId)) : Promise.resolve(null),
    ])
      .then(([result, existing]) => {
        if (!active) return;
        setBooks(result.items);
        if (existing) acceptSaved(existing);
        else {
          const notebook =
            result.items.find(
              (b) => b.id === Number(params.get("notebook")) && !b.archived,
            ) ?? result.items.find((b) => !b.archived);
          if (!notebook) {
            setError("请先创建一本手帐。");
            return;
          }
          const template = params.get("template");
          const scene = createJournalScene(
            template === "daily" || template === "travel" ? template : "blank",
            notebook.paper,
          );
          const initialDate = params.get("date");
          const content = {
            notebook_id: notebook.id,
            title: "",
            entry_date:
              initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate)
                ? initialDate
                : todayDate(),
            mood: "",
            weather: "",
            tags: [],
            favorite: false,
            scene,
          };
          idRef.current = null;
          versionRef.current = 0;
          setEntry(null);
          setTagText("");
          setContent(content);
          // An untouched blank page is intentionally not persisted.
          savedRef.current = scene.elements.length ? "" : fingerprint(content);
          setSavedFingerprint(savedRef.current);
        }
      })
      .catch((e) => {
        if (active) {
          if (e instanceof APIRequestError && e.status === 401)
            setExpired(true);
          setError(e instanceof Error ? e.message : "无法打开记录。");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    // A document generation counter invalidates pending requests on route changes.
    return () => {
      active = false;
      loadedFor.current = "";
      // eslint-disable-next-line react-hooks/exhaustive-deps
      documentGeneration.current++;
    };
    // The route identifies the document; saving must not reset local undo history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, params]);
  const save = useCallback(
    async (notify = false) => {
      const current = draftRef.current;
      if (
        !current ||
        savingRef.current ||
        !navigator.onLine ||
        expired ||
        checking ||
        conflict ||
        uploading
      )
        return false;
      if (notify) setSaveNotice(null);
      if (!current.scene.elements.length && !idRef.current) {
        if (notify)
          setSaveNotice({
            kind: "info",
            message: "画布还是空白，添加文字、照片或贴纸后再保存。",
          });
        return true;
      }
      if (fingerprint(current) === savedRef.current) {
        if (notify)
          setSaveNotice({
            kind: "success",
            message: "已保存，当前没有新的修改。",
          });
        return true;
      }
      savingRef.current = true;
      setSaving(true);
      setError("");
      const sent = fingerprint(current);
      const documentToken = documentGeneration.current;
      try {
        const result = idRef.current
          ? await journalAPI.saveEntry(idRef.current, {
              ...current,
              version: versionRef.current,
            })
          : await journalAPI.createEntry(current.notebook_id!, current);
        if (documentToken !== documentGeneration.current) return false;
        idRef.current = result.id;
        versionRef.current = result.version;
        setEntry(result);
        setSavedAt(result.updated_at);
        const unchanged =
          !!draftRef.current && fingerprint(draftRef.current) === sent;
        if (unchanged) {
          const accepted = toDraft(result);
          draftRef.current = accepted;
          setDraft(accepted);
          savedRef.current = fingerprint(accepted);
        } else savedRef.current = sent;
        setSavedFingerprint(savedRef.current);
        if (notify)
          setSaveNotice({
            kind: unchanged ? "success" : "info",
            message: unchanged
              ? "保存成功"
              : "本次修改已保存，最新修改仍在同步…",
          });
        return unchanged;
      } catch (e) {
        if (documentToken !== documentGeneration.current) return false;
        let message: string;
        if (e instanceof APIRequestError && e.status === 409) {
          setConflict(true);
          message =
            "其他窗口已修改这页。你的修改仍保留在当前页，请另存副本或载入最新版本。";
        } else if (e instanceof APIRequestError && e.status === 401) {
          setExpired(true);
          message = "管理员登录已过期，修改暂存在当前页面内存中。";
        } else
          message =
            e instanceof Error
              ? `保存失败：${e.message}`
              : "保存失败，请重试。";
        setError(message);
        if (notify) setSaveNotice({ kind: "error", message });
        return false;
      } finally {
        if (documentToken === documentGeneration.current) {
          savingRef.current = false;
          setSaving(false);
          setGeneration((g) => g + 1);
        }
      }
    },
    [expired, checking, conflict, uploading, setExpired],
  );
  useEffect(() => {
    if (
      !dirty ||
      !online ||
      expired ||
      checking ||
      conflict ||
      uploading ||
      saving ||
      operation ||
      error
    )
      return;
    const timer = window.setTimeout(() => {
      void save();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    draft,
    dirty,
    online,
    expired,
    checking,
    conflict,
    uploading,
    saving,
    operation,
    generation,
    error,
    save,
  ]);
  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      setError("");
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if ((dirty || uploading) && !allowLeaveRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, uploading]);
  useEffect(() => {
    function beforeSignOut(event: Event) {
      if (
        (!dirty && !uploading) ||
        !(event instanceof CustomEvent) ||
        typeof event.detail?.proceed !== "function"
      )
        return;
      event.preventDefault();
      setPendingSignOut({ proceed: event.detail.proceed });
    }
    window.addEventListener("portfolio:before-sign-out", beforeSignOut);
    return () =>
      window.removeEventListener("portfolio:before-sign-out", beforeSignOut);
  }, [dirty, uploading]);
  const book = books.find((b) => b.id === draft?.notebook_id);
  const savedBook = books.find((b) => b.id === entry?.notebook_id);
  function reportError(e: unknown, fallback: string) {
    if (e instanceof APIRequestError && e.status === 401) setExpired(true);
    setError(e instanceof Error ? e.message : fallback);
  }
  async function reload() {
    if (
      !idRef.current ||
      operation ||
      savingRef.current ||
      (dirty && !window.confirm("载入最新版本会放弃当前页未同步修改。继续吗？"))
    )
      return;
    const token = documentGeneration.current;
    setOperation("reload");
    try {
      const result = await journalAPI.entry(idRef.current);
      if (token === documentGeneration.current) {
        acceptSaved(result);
        setError("");
      }
    } catch (e) {
      if (token === documentGeneration.current) reportError(e, "加载失败。");
    } finally {
      if (token === documentGeneration.current) setOperation(null);
    }
  }
  async function copy() {
    if (!draftRef.current || operation || savingRef.current) return;
    const token = documentGeneration.current;
    const content = draftRef.current;
    setOperation("copy");
    setSaving(true);
    try {
      const result = await journalAPI.createEntry(content.notebook_id!, {
        ...content,
        title: `${content.title || "无题的一页"}（副本）`,
      });
      if (token !== documentGeneration.current) return;
      acceptSaved(result);
      allowLeaveRef.current = true;
      navigate(`/admin/journal/entries/${result.id}`, { replace: true });
    } catch (e) {
      if (token === documentGeneration.current)
        reportError(e, "另存副本失败。");
    } finally {
      if (token === documentGeneration.current) {
        setSaving(false);
        setOperation(null);
      }
    }
  }
  async function moveNotebook(targetID: number) {
    const target = books.find((b) => b.id === targetID);
    if (!target || !draftRef.current || savingRef.current || operation) return;
    if (!idRef.current && !draftRef.current.scene.elements.length) {
      setContent({ ...draftRef.current, notebook_id: targetID });
      return;
    }
    if (
      !window.confirm(
        `移动到「${target.name}」？${target.public_enabled ? "目标本已开启前台展示，持有目标本密码的访客将可查看这页。" : "目标本前台未展示。"}原本中的记录会移除。`,
      )
    )
      return;
    const token = documentGeneration.current;
    setOperation("move");
    try {
      if (
        !(await save()) ||
        !idRef.current ||
        token !== documentGeneration.current
      )
        return;
      savingRef.current = true;
      setSaving(true);
      const result = await journalAPI.saveEntry(idRef.current, {
        ...draftRef.current!,
        notebook_id: targetID,
        version: versionRef.current,
      });
      if (token === documentGeneration.current) acceptSaved(result);
    } catch (e) {
      if (token === documentGeneration.current) {
        if (e instanceof APIRequestError && e.status === 409) setConflict(true);
        reportError(e, "移动失败，记录仍保留在原手帐本。");
      }
    } finally {
      if (token === documentGeneration.current) {
        savingRef.current = false;
        setSaving(false);
        setOperation(null);
      }
    }
  }
  async function runExport(kind: "png" | "pdf" | "archive" | "text") {
    setExporting(true);
    try {
      if (!(await save())) return;
      if (!idRef.current) {
        setError("先在画布上写一点内容，再导出。");
        return;
      }
      const latest = await journalAPI.entry(idRef.current);
      if (kind === "archive")
        await downloadJournalArchive(latest.notebook_id, latest.id);
      else if (kind === "text") await exportJournalText(latest);
      else if (kind === "png") await exportJournalEntry(latest, "png");
      else await exportJournalEntry(latest, "pdf");
    } catch (e) {
      reportError(e, "导出失败。");
    } finally {
      setExporting(false);
    }
  }
  async function finishLeaving() {
    if (pendingSignOut) {
      allowLeaveRef.current = true;
      const proceed = pendingSignOut.proceed;
      setPendingSignOut(null);
      await proceed();
    } else if (blocker.state === "blocked") blocker.proceed();
  }
  const leaveDialog = (blocker.state === "blocked" || pendingSignOut) && (
    <div className={styles.modalBackdrop}>
      <section
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-title"
      >
        <h2 id="unsaved-title">还有未同步的修改</h2>
        <p className={styles.muted}>
          离开后，未同步内容会丢失。
          {uploading
            ? "请等待照片上传完成。"
            : "可以先保存，或留在这里继续编辑。"}
        </p>
        <div className={styles.actions}>
          <button
            className={styles.primary}
            type="button"
            disabled={
              expired ||
              !!operation ||
              saving ||
              uploading ||
              conflict ||
              !online
            }
            onClick={async () => {
              if (await save()) await finishLeaving();
            }}
          >
            {pendingSignOut ? "保存并退出登录" : "保存并离开"}
          </button>
          <button
            className={styles.button}
            type="button"
            onClick={() => {
              setPendingSignOut(null);
              if (blocker.state === "blocked") blocker.reset();
            }}
          >
            继续编辑
          </button>
          <button
            className={styles.danger}
            type="button"
            onClick={() => void finishLeaving()}
          >
            {pendingSignOut ? "放弃修改并退出登录" : "放弃修改并离开"}
          </button>
        </div>
      </section>
    </div>
  );
  const saveStatus = uploading
    ? "照片上传中，尚未全部保存…"
    : !online
      ? "离线，修改暂未同步。刷新或关闭页面可能丢失。"
      : saving
        ? "正在保存…"
        : conflict
          ? "发现版本冲突，修改已保留"
          : error
            ? "保存未完成，请重试"
            : dirty
              ? "有未同步修改…"
              : savedAt
                ? `已保存于 ${new Date(savedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
                : "空白页，开始记录后自动保存";
  const saveDisabled =
    !!operation || saving || uploading || !online || conflict || !draft;
  if (expired)
    return (
      <section className={styles.panel}>
        <h1>管理员登录已过期</h1>
        <p className={styles.muted}>
          内容已隐藏，未同步修改仅暂存在当前页。请保留本页，在新标签页重新登录，再回到这里继续。
        </p>
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
            onClick={async () => {
              try {
                const result = await apiFetch<{ csrf_token: string }>(
                  "/api/admin/me",
                );
                setCSRFToken(result.csrf_token);
                if (!(await refreshSession())) {
                  setError("暂时无法验证后台会话，请重试。");
                  return;
                }
                setError("");
                if (!draftRef.current) {
                  loadedFor.current = "";
                  navigate(0);
                }
              } catch {
                setError("尚未登录成功，请先完成后台登录。");
              }
            }}
          >
            我已登录，恢复编辑
          </button>
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {leaveDialog}
      </section>
    );
  if (checking)
    return (
      <section className={styles.panel}>
        <p role="status" className={styles.muted}>
          正在验证管理员会话…
        </p>
        {leaveDialog}
      </section>
    );
  return (
    <section className={styles.page}>
      <header className={`${styles.header} ${styles.editorHeader}`}>
        <div>
          <Link to="/admin/journal" className={styles.inlineLink}>
            <ArrowLeft size={14} /> 返回手帐
          </Link>
          <h1 style={{ fontSize: 27, marginTop: 10 }}>
            {draft?.title || "无题的一页"}
          </h1>
          <div role="status" className={styles.saveStatus}>
            {saveStatus}
          </div>
        </div>
        <div className={styles.actions}>
          {entry && savedBook && !entry.deleted_at && (
            <JournalShareButton
              key={`${entry.notebook_id}:${entry.id}`}
              notebookID={entry.notebook_id}
              entryID={entry.id}
              enabled={savedBook.public_enabled && savedBook.has_password && !savedBook.archived}
              className={styles.button}
            />
          )}
          <button
            className={styles.primary}
            type="button"
            disabled={saveDisabled}
            onClick={() => {
              setError("");
              void save(true);
            }}
          >
            <Save size={16} />
            保存
          </button>
          <button
            className={styles.button}
            type="button"
            disabled={
              !!operation ||
              !draft ||
              exporting ||
              uploading ||
              saving ||
              conflict
            }
            onClick={() => void runExport("png")}
          >
            <Download size={16} />
            PNG
          </button>
          <button
            className={styles.button}
            type="button"
            disabled={
              !!operation ||
              !draft ||
              exporting ||
              uploading ||
              saving ||
              conflict
            }
            onClick={() => void runExport("pdf")}
          >
            PDF
          </button>
          <button
            className={styles.button}
            type="button"
            disabled={
              !!operation ||
              !entry ||
              exporting ||
              uploading ||
              saving ||
              conflict
            }
            onClick={() => void runExport("archive")}
          >
            场景备份
          </button>
          <button
            className={styles.button}
            type="button"
            disabled={
              !!operation ||
              !entry ||
              exporting ||
              uploading ||
              saving ||
              conflict
            }
            onClick={() => void runExport("text")}
          >
            文字提取
          </button>
          {entry && (
            <button
              className={styles.danger}
              type="button"
              disabled={!!operation || saving || uploading}
              aria-label="删除记录"
              onClick={async () => {
                if (
                  !window.confirm(
                    "将这条记录移至回收站？当前未同步修改会被放弃。",
                  )
                )
                  return;
                const token = documentGeneration.current;
                setOperation("delete");
                try {
                  await journalAPI.deleteEntry(entry.id);
                  if (token !== documentGeneration.current) return;
                  allowLeaveRef.current = true;
                  navigate("/admin/journal");
                } catch (e) {
                  if (token === documentGeneration.current)
                    reportError(e, "删除失败。");
                } finally {
                  if (token === documentGeneration.current) setOperation(null);
                }
              }}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </header>
      {error && (
        <div className={styles.error} role="alert">
          {error}
          {!conflict && (
            <button
              className={styles.button}
              type="button"
              onClick={() => {
                setError("");
                void save(true);
              }}
            >
              重试保存
            </button>
          )}
        </div>
      )}
      {conflict && (
        <div className={styles.notice}>
          <div className={styles.actions}>
            <button
              className={styles.primary}
              type="button"
              disabled={saving}
              onClick={() => void copy()}
            >
              保留修改，另存副本
            </button>
            <button
              className={styles.button}
              type="button"
              disabled={saving}
              onClick={() => void reload()}
            >
              载入最新版本
            </button>
          </div>
        </div>
      )}
      {loading ? (
        <div className={styles.loading}>正在打开画布…</div>
      ) : (
        draft && (
          <>
            <fieldset
              className={styles.metadata}
              style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
              disabled={!!operation}
            >
              <label className={`${styles.label} ${styles.titleInput}`}>
                标题（可选）
                <input
                  className={styles.input}
                  value={draft.title}
                  maxLength={200}
                  placeholder="给这一页起个名字"
                  onChange={(e) =>
                    setContent({ ...draft, title: e.target.value })
                  }
                />
              </label>
              <label className={styles.label}>
                发生日期
                <input
                  className={styles.input}
                  type="date"
                  required
                  value={draft.entry_date}
                  onChange={(e) => {
                    if (e.target.value)
                      setContent({ ...draft, entry_date: e.target.value });
                  }}
                />
              </label>
              <label className={styles.label}>
                手帐本
                <select
                  className={styles.select}
                  value={draft.notebook_id}
                  disabled={saving || uploading || conflict}
                  onChange={(e) => void moveNotebook(Number(e.target.value))}
                >
                  {books
                    .filter((b) => !b.archived || b.id === draft.notebook_id)
                    .map((b) => (
                      <option value={b.id} key={b.id}>
                        {b.name}
                        {b.archived ? "（已归档）" : ""}
                      </option>
                    ))}
                </select>
              </label>
              <label className={styles.label}>
                心情（可选）
                <select
                  className={styles.select}
                  value={draft.mood}
                  onChange={(e) =>
                    setContent({ ...draft, mood: e.target.value })
                  }
                >
                  <option value="">不填写</option>
                  {moodOptions.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label className={styles.label}>
                天气（可选）
                <input
                  className={styles.input}
                  value={draft.weather}
                  placeholder="晴，微风"
                  maxLength={80}
                  onChange={(e) =>
                    setContent({ ...draft, weather: e.target.value })
                  }
                />
              </label>
              <label className={styles.label}>
                标签（逗号分隔）
                <input
                  className={styles.input}
                  value={tagText}
                  placeholder="生活，旅行"
                  onChange={(e) => {
                    setTagText(e.target.value);
                    const tags = [
                      ...new Set(
                        e.target.value
                          .split(/[,，]/)
                          .map((t) => t.trim())
                          .filter(Boolean),
                      ),
                    ];
                    setContent({ ...draft, tags });
                  }}
                />
              </label>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={draft.favorite}
                  onChange={(e) =>
                    setContent({ ...draft, favorite: e.target.checked })
                  }
                />
                <Star size={16} />
                收藏这一页
              </label>
            </fieldset>
            <div className={styles.notice}>
              {book?.public_enabled
                ? "前台展示 · 密码查看。已保存的内容可由持有本手帐有效密码的访客阅读。"
                : "前台未展示。只有已登录后台的管理员可以查看和编辑。"}{" "}
              <Link className={styles.inlineLink} to="/admin/journal">
                管理展示设置
              </Link>
            </div>
            <JournalCanvas
              key={`${entryId ?? "new"}:${draft.notebook_id}`}
              scene={draft.scene}
              onChange={(scene) => setContent({ ...draftRef.current!, scene })}
              assetURL={(id) => journalAPI.assetURL(id)}
              onUpload={async (file) => {
                const token = documentGeneration.current;
                try {
                  return await journalAPI.uploadAsset(
                    draftRef.current!.notebook_id!,
                    file,
                  );
                } catch (e) {
                  if (
                    token === documentGeneration.current &&
                    e instanceof APIRequestError &&
                    e.status === 401
                  )
                    setExpired(true);
                  throw e;
                }
              }}
              onUploadStateChange={setUploading}
              disabled={conflict || !!operation}
              toolbarActions={
                <div className={styles.canvasSaveActions}>
                  <span
                    className={styles.canvasSaveStatus}
                    aria-live="polite"
                    title={error || saveStatus}
                  >
                    {error || saveStatus}
                  </span>
                  <button
                    type="button"
                    className={styles.primary}
                    aria-label="保存画布"
                    disabled={saveDisabled}
                    onClick={() => {
                      setError("");
                      void save(true);
                    }}
                  >
                    <Save size={16} aria-hidden="true" />
                    保存
                  </button>
                </div>
              }
            />
          </>
        )
      )}
      {leaveDialog}
      {saveNotice &&
        createPortal(
          <div
            className={styles.saveToast}
            data-journal-overlay
            data-kind={saveNotice.kind}
            role={saveNotice.kind === "error" ? "alert" : "status"}
            aria-label="保存结果"
            aria-atomic="true"
          >
            {saveNotice.kind === "success" ? (
              <CheckCircle2 size={21} aria-hidden="true" />
            ) : saveNotice.kind === "error" ? (
              <AlertCircle size={21} aria-hidden="true" />
            ) : (
              <Info size={21} aria-hidden="true" />
            )}
            <span>{saveNotice.message}</span>
            <button
              type="button"
              aria-label="关闭保存提示"
              onClick={() => setSaveNotice(null)}
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>,
          document.body,
        )}
    </section>
  );
}
