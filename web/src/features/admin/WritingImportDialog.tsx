import { AlertCircle, FileText, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { APIRequestError } from "../../lib/api";
import styles from "./Admin.module.css";
import {
  commitWritingImport,
  requestWritingImportPreview,
  restoreWritingImportPreview,
  type WritingImportCommittedWriting,
  type WritingImportMode,
  type WritingImportParsedPayload,
  type WritingImportPreview,
} from "./writingImport";

type WritingImportDialogProps = {
  initialPreviewToken?: string;
  mode: WritingImportMode;
  onClose: () => void;
  onCommitted?: (writing: WritingImportCommittedWriting) => void;
  open: boolean;
  targetId?: number;
};

const emptyDraft: WritingImportParsedPayload = {
  content_md: "",
  excerpt: "",
  seo_description: "",
  seo_title: "",
  slug: "",
  tags: [],
  title: "",
};

export function WritingImportDialog({
  initialPreviewToken,
  mode,
  onClose,
  onCommitted,
  open,
  targetId,
}: WritingImportDialogProps) {
  const restoredTokenRef = useRef<string | null>(null);
  const [step, setStep] = useState<"choose" | "preview">("choose");
  const [markdownFile, setMarkdownFile] = useState<File | null>(null);
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<WritingImportPreview | null>(null);
  const [draft, setDraft] = useState<WritingImportParsedPayload>(emptyDraft);
  const warnings = preview?.warnings ?? [];
  const blockingErrors = preview?.blocking_errors ?? [];

  useEffect(() => {
    if (!open) {
      restoredTokenRef.current = null;
      setStep("choose");
      setMarkdownFile(null);
      setMediaFiles([]);
      setLoading(false);
      setMessage("");
      setPreview(null);
      setDraft(emptyDraft);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !initialPreviewToken || restoredTokenRef.current === initialPreviewToken) {
      return;
    }
    restoredTokenRef.current = initialPreviewToken;
    setLoading(true);
    setMessage("");
    restoreWritingImportPreview(initialPreviewToken)
      .then((result) => {
        setPreview(result);
        setDraft(normalizeParsedPayload(result.parsed));
        setStep("preview");
      })
      .catch((error) => {
        setMessage(error instanceof APIRequestError ? error.message : "恢复导入预览失败。");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [initialPreviewToken, open]);

  if (!open) {
    return null;
  }

  async function createPreview() {
    if (!markdownFile) {
      setMessage("请选择 Markdown 文件。");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const result = await requestWritingImportPreview({
        markdownFile,
        mediaFiles,
        mode,
        targetId,
      });
      setPreview(result);
      setDraft(normalizeParsedPayload(result.parsed));
      setStep("preview");
    } catch (error) {
      setMessage(error instanceof APIRequestError ? error.message : "生成导入预览失败。");
    } finally {
      setLoading(false);
    }
  }

  async function submitImport() {
    if (!preview) {
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const result = await commitWritingImport({
        importToken: preview.import_token,
        payload: normalizeParsedPayload(draft),
      });
      onCommitted?.(result.writing);
      onClose();
    } catch (error) {
      setMessage(error instanceof APIRequestError ? error.message : "提交导入内容失败。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.modalBackdrop}>
      <div aria-modal="true" className={styles.modalPanel} role="dialog">
        <div className={styles.modalHeader}>
          <div>
            <span className={styles.overviewLabel}>{mode === "overwrite" ? "覆盖草稿" : "创建写作"}</span>
            <h2>{step === "preview" ? "导入预览" : "导入 Markdown"}</h2>
            <p>
              {mode === "overwrite"
                ? "以中文主内容为准，用本地 Markdown 覆盖当前草稿，并保留预览确认步骤。"
                : "从本地 Markdown 生成新写作草稿，导入前先检查解析结果与媒体替换。"}
            </p>
          </div>
          <button
            aria-label="关闭导入对话框"
            className={styles.iconButton}
            disabled={loading}
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        {message ? <p className={styles.message}>{message}</p> : null}

        {step === "choose" ? (
          <section className={styles.importSection}>
            <div className={styles.importGrid}>
              <label className={styles.importPicker}>
                <span className={styles.label}>Markdown 文件</span>
                <input
                  accept=".md,.markdown,text/markdown"
                  aria-label="Markdown 文件"
                  onChange={(event) => setMarkdownFile(event.target.files?.[0] ?? null)}
                  type="file"
                />
                <span className={styles.importPickerButton}>
                  <FileText aria-hidden="true" size={16} />
                  {markdownFile ? markdownFile.name : "选择 Markdown 文件"}
                </span>
              </label>

              <label className={styles.importPicker}>
                <span className={styles.label}>媒体文件（可选）</span>
                <input
                  aria-label="媒体文件（可选）"
                  multiple
                  onChange={(event) => setMediaFiles(Array.from(event.target.files ?? []))}
                  type="file"
                />
                <span className={styles.importPickerButton}>
                  <Upload aria-hidden="true" size={16} />
                  {mediaFiles.length > 0 ? `已选择 ${mediaFiles.length} 个文件` : "附加图片 / 音频 / 视频"}
                </span>
              </label>
            </div>

            {mediaFiles.length > 0 ? (
              <ul className={styles.importFileList}>
                {mediaFiles.map((file) => (
                  <li key={`${file.name}-${file.size}`}>{file.webkitRelativePath || file.name}</li>
                ))}
              </ul>
            ) : null}

            <div className={styles.importActions}>
              <button className={styles.button} disabled={loading} onClick={onClose} type="button">
                取消
              </button>
              <button className={`${styles.button} ${styles.primary}`} disabled={loading || !markdownFile} onClick={() => void createPreview()} type="button">
                {loading ? "生成中..." : "生成预览"}
              </button>
            </div>
          </section>
        ) : (
          <section className={styles.importSection}>
            <div className={styles.importPreviewGrid}>
              <div className={styles.importPreviewPane}>
                <div className={styles.grid}>
                  <Field
                    label="标题"
                    onChange={(value) => setDraft((current) => ({ ...current, title: value }))}
                    value={draft.title}
                  />
                  <Field
                    label="Slug"
                    onChange={(value) => setDraft((current) => ({ ...current, slug: value }))}
                    value={draft.slug}
                  />
                </div>
                <Field
                  label="摘要"
                  onChange={(value) => setDraft((current) => ({ ...current, excerpt: value }))}
                  textarea
                  value={draft.excerpt}
                />
                <Field
                  label="标签"
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      tags: splitTags(value),
                    }))
                  }
                  value={(draft.tags ?? []).join(", ")}
                />
                <Field
                  label="正文"
                  onChange={(value) => setDraft((current) => ({ ...current, content_md: value }))}
                  textarea
                  value={draft.content_md}
                />
              </div>

              <div className={styles.importPreviewPane}>
                <div className={styles.importSummaryCard}>
                  <strong>媒体替换</strong>
                  <ul className={styles.importSummaryList}>
                    {(preview?.media ?? []).map((item) => (
                      <li key={`${item.original_path}-${item.replacement_ref}`}>
                        <span>{item.original_path}</span>
                        <code>{item.replacement_ref}</code>
                      </li>
                    ))}
                  </ul>
                </div>

                {warnings.length > 0 ? (
                  <div className={styles.importSummaryCard}>
                    <strong>提示</strong>
                    <ul className={styles.importSummaryList}>
                      {warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {blockingErrors.length > 0 ? (
                  <div className={`${styles.importSummaryCard} ${styles.importBlockingCard}`}>
                    <strong>
                      <AlertCircle aria-hidden="true" size={16} />
                      阻塞问题
                    </strong>
                    <ul className={styles.importSummaryList}>
                      {blockingErrors.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>

            <div className={styles.importActions}>
              <button className={styles.button} disabled={loading} onClick={() => setStep("choose")} type="button">
                返回选择
              </button>
              <button
                className={`${styles.button} ${styles.primary}`}
                disabled={loading || blockingErrors.length > 0}
                onClick={() => void submitImport()}
                type="button"
              >
                {loading ? "提交中..." : "确认提交"}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  onChange,
  textarea = false,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  textarea?: boolean;
  value: string;
}) {
  const id = `writing-import-${label.toLowerCase()}`;
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {textarea ? (
        <textarea id={id} onChange={(event) => onChange(event.target.value)} value={value} />
      ) : (
        <input id={id} onChange={(event) => onChange(event.target.value)} type="text" value={value} />
      )}
    </div>
  );
}

function normalizeParsedPayload(payload: WritingImportParsedPayload): WritingImportParsedPayload {
  return {
    content_md: payload.content_md ?? "",
    cover_media_id: payload.cover_media_id,
    excerpt: payload.excerpt ?? "",
    seo_description: payload.seo_description ?? "",
    seo_title: payload.seo_title ?? "",
    slug: payload.slug ?? "",
    tags: payload.tags ?? [],
    title: payload.title ?? "",
  };
}

function splitTags(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
