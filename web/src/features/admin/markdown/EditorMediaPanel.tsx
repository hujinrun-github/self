import { Check, ImagePlus, LoaderCircle, RefreshCw, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { APIRequestError, apiFetch } from "../../../lib/api";
import { linkMarkdown } from "./markdownTools";
import styles from "./EditorMediaPanel.module.css";

type EditorMediaPanelProps = {
  onInsert: (markdown: string) => void;
  onCancel: () => void;
};

type EditorImage = {
  id: number;
  name: string;
  thumbnail: string;
  markdown: string;
};

const acceptedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const maxImageBytes = 5 * 1024 * 1024;
const pageSize = 50;

/** Uploads through the existing authenticated media API; no insertion happens here. */
// eslint-disable-next-line react-refresh/only-export-components -- Shared public upload entry point also serves editor paste and drop.
export async function uploadEditorImage(file: File, signal?: AbortSignal): Promise<string> {
  return (await uploadImage(file, signal)).markdown;
}

export function EditorMediaPanel({ onInsert, onCancel }: EditorMediaPanelProps) {
  const [items, setItems] = useState<EditorImage[]>([]);
  const [selected, setSelected] = useState<EditorImage | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [message, setMessage] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const libraryRequest = useRef<AbortController | null>(null);
  const uploadRequest = useRef<AbortController | null>(null);
  const lastFile = useRef<File | null>(null);
  const requestedPage = useRef(1);
  const nextPage = useRef(1);
  const active = useRef(true);

  const loadLibrary = useCallback((page: number) => {
    libraryRequest.current?.abort();
    const controller = new AbortController();
    libraryRequest.current = controller;
    requestedPage.current = page;
    return apiFetch<unknown>(`/api/admin/media?page=${page}&limit=${pageSize}`, {
      signal: controller.signal,
    }).then((response) => {
      if (!active.current || controller.signal.aborted) return;
      if (!isRecord(response) || !Array.isArray(response.items)) {
        throw new Error("invalid media list");
      }
      const images = response.items.map(readImage).filter((item): item is EditorImage => item !== null);
      setItems((current) => mergeImages(current, images));
      setHasMore(response.items.length === pageSize);
      nextPage.current = page + 1;
    }).catch((error: unknown) => {
      if (active.current && !controller.signal.aborted) {
        setLibraryError(requestError(error, "媒体库加载失败，请检查网络后重试。"));
      }
    }).finally(() => {
      if (active.current && !controller.signal.aborted) setLoading(false);
    });
  }, []);

  useEffect(() => {
    active.current = true;
    void loadLibrary(1);
    return () => {
      active.current = false;
      libraryRequest.current?.abort();
      uploadRequest.current?.abort();
    };
  }, [loadLibrary]);

  function startLibraryLoad(page: number) {
    setLoading(true);
    setLibraryError("");
    void loadLibrary(page);
  }

  async function upload(file: File) {
    uploadRequest.current?.abort();
    const controller = new AbortController();
    uploadRequest.current = controller;
    lastFile.current = file;
    setUploading(true);
    setUploadError("");
    setMessage("");
    try {
      const item = await uploadImage(file, controller.signal);
      if (!active.current || controller.signal.aborted) return;
      setItems((current) => mergeImages([item], current));
      setSelected(item);
      setMessage("上传成功，点击「插入图片」放入正文。");
    } catch (error) {
      if (active.current && !controller.signal.aborted) {
        setUploadError(error instanceof Error ? error.message : "上传失败，请重试。");
      }
    } finally {
      if (active.current && !controller.signal.aborted) {
        setUploading(false);
        if (fileInput.current) fileInput.current.value = "";
      }
    }
  }

  function finish(action: () => void) {
    if (!active.current) return;
    active.current = false;
    libraryRequest.current?.abort();
    uploadRequest.current?.abort();
    action();
  }

  return (
    <div className={styles.panel}>
      <div className={styles.uploadArea}>
        <span aria-hidden="true" className={styles.uploadIcon}><ImagePlus size={23} /></span>
        <div className={styles.uploadCopy}>
          <strong>添加正文配图</strong>
          <p>上传新图片，或从媒体库选择已有素材。</p>
          <small>PNG、JPG、WebP · 最大 5 MB</small>
        </div>
        <button className={`${styles.button} ${styles.primary}`} disabled={uploading} onClick={() => fileInput.current?.click()} type="button">
          {uploading ? <LoaderCircle aria-hidden="true" className={styles.spinner} size={16} /> : <Upload aria-hidden="true" size={16} />}
          {uploading ? "上传中…" : "上传图片"}
        </button>
        <input
          accept="image/png,image/jpeg,image/webp"
          aria-label="选择图片文件"
          className={styles.fileInput}
          disabled={uploading}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void upload(file);
          }}
          ref={fileInput}
          type="file"
        />
      </div>

      {uploadError ? (
        <div className={styles.error} role="alert">
          <span>{uploadError}</span>
          <button className={styles.textButton} disabled={uploading} onClick={() => lastFile.current && void upload(lastFile.current)} type="button">重试上传</button>
        </div>
      ) : null}
      {message ? <p className={styles.success} role="status">{message}</p> : null}

      <div className={styles.libraryHeading}>
        <h3>媒体库</h3>
        <span>{items.length > 0 ? `已加载 ${items.length} 张图片` : "仅显示可用图片"}</span>
      </div>
      {libraryError ? (
        <div className={styles.error} role="alert">
          <span>{libraryError}</span>
          <button className={styles.textButton} disabled={loading} onClick={() => startLibraryLoad(requestedPage.current)} type="button"><RefreshCw aria-hidden="true" size={14} />重新加载</button>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div aria-label="媒体库图片" className={styles.grid}>
          {items.map((item) => (
            <button
              aria-label={`选择 ${item.name}`}
              aria-pressed={selected?.id === item.id}
              className={`${styles.imageCard} ${selected?.id === item.id ? styles.selected : ""}`}
              disabled={uploading}
              key={item.id}
              onClick={() => { setSelected(item); setMessage(""); }}
              type="button"
            >
              <img alt={item.name} className={styles.thumbnail} loading="lazy" src={item.thumbnail} />
              <span className={styles.filename}>{item.name}</span>
              {selected?.id === item.id ? <span aria-hidden="true" className={styles.check}><Check size={14} /></span> : null}
            </button>
          ))}
        </div>
      ) : !loading && !libraryError ? (
        <div className={styles.empty}><ImagePlus aria-hidden="true" size={27} /><strong>媒体库里还没有可用图片</strong><span>上传第一张配图，即可在正文中使用。</span></div>
      ) : null}
      {loading ? <p className={styles.loading} role="status"><LoaderCircle aria-hidden="true" className={styles.spinner} size={16} />正在加载图片…</p> : null}
      {hasMore && !libraryError ? <button className={styles.moreButton} disabled={loading} onClick={() => startLibraryLoad(nextPage.current)} type="button">加载更多</button> : null}

      <div className={styles.footer}>
        <span className={styles.selectionInfo}>{selected ? `已选择：${selected.name}` : "选择一张图片后插入光标位置"}</span>
        <div className={styles.actions}>
          <button className={styles.button} onClick={() => finish(onCancel)} type="button">取消</button>
          <button className={`${styles.button} ${styles.primary}`} disabled={!selected || uploading} onClick={() => selected && finish(() => onInsert(selected.markdown))} type="button">插入图片</button>
        </div>
      </div>
    </div>
  );
}

async function uploadImage(file: File, signal?: AbortSignal): Promise<EditorImage> {
  throwIfAborted(signal);
  if (!acceptedTypes.has(file.type)) throw new Error("仅支持 PNG、JPG 和 WebP 图片。");
  const extension = file.name.split(".").pop()?.toLowerCase();
  const validExtension = file.type === "image/png" ? extension === "png" : file.type === "image/webp" ? extension === "webp" : extension === "jpg" || extension === "jpeg";
  if (!validExtension) throw new Error("文件扩展名与图片格式不一致，请选择正确的 PNG、JPG 或 WebP 文件。");
  if (file.size === 0) throw new Error("图片文件为空，请选择其他图片。");
  if (file.size > maxImageBytes) throw new Error("图片不能超过 5 MB，请压缩后重试。");
  const body = new FormData();
  body.append("file", file);
  let response: unknown;
  try {
    response = await apiFetch<unknown>("/api/admin/media", { method: "POST", body, signal });
  } catch (error) {
    throwIfAborted(signal);
    if (error instanceof APIRequestError && error.status === 400) {
      throw new Error("图片无法处理。请确认文件未损坏，单边不超过 6000 像素，总像素不超过 2400 万。", { cause: error });
    }
    throw new Error(requestError(error, "上传失败，请检查网络后重试。"), { cause: error });
  }
  throwIfAborted(signal);
  const item = readImage(response);
  if (!item) throw new Error("上传结果无效，未获得可用的图片引用，请重新加载媒体库检查。");
  return item;
}

function readImage(value: unknown): EditorImage | null {
  if (!isRecord(value) || !Number.isSafeInteger(value.id) || (value.id as number) <= 0 || typeof value.file_name !== "string" || !value.file_name.trim() || !isRecord(value.variants)) return null;
  if (value.mime_type !== undefined && (typeof value.mime_type !== "string" || !acceptedTypes.has(value.mime_type))) return null;
  const card = isImageVariant(value.variants.card);
  const content = isImageVariant(value.variants.content);
  const original = isImageVariant(value.variants.original);
  if (!card && !content && !original) return null;
  const variant = original ? "original" : content ? "content" : "card";
  const markdown = linkMarkdown(value.file_name, `media://asset/${value.id}/${variant}`, true);
  if (!markdown) return null;
  return {
    id: value.id as number,
    name: value.file_name,
    thumbnail: `/media/${value.id}/${card ? "card" : variant}`,
    markdown,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isImageVariant(value: unknown): boolean {
  return isRecord(value) && typeof value.mime_type === "string" && acceptedTypes.has(value.mime_type)
    && typeof value.width === "number" && Number.isFinite(value.width) && value.width > 0
    && typeof value.height === "number" && Number.isFinite(value.height) && value.height > 0;
}

function mergeImages(current: EditorImage[], incoming: EditorImage[]) {
  const merged = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) if (!merged.has(item.id)) merged.set(item.id, item);
  return [...merged.values()];
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("图片上传已取消", "AbortError");
}

function requestError(error: unknown, fallback: string) {
  if (error instanceof APIRequestError && (error.status === 401 || error.status === 403)) {
    return "登录状态已失效或没有媒体权限，请重新登录后重试。";
  }
  return fallback;
}
