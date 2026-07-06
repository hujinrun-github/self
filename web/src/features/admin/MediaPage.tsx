import { Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { APIRequestError, apiFetch } from "../../lib/api";
import type { MediaVariant } from "../../lib/types";
import styles from "./Admin.module.css";

type MediaItem = {
  file_name: string;
  id: number;
  mime_type?: string;
  referenced: boolean;
  variants: Record<string, MediaVariant>;
};

export function MediaPage() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ items: MediaItem[] }>("/api/admin/media").then((response) => {
      if (!cancelled) {
        setItems(response.items);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function deleteItem(item: MediaItem) {
    await apiFetch(`/api/admin/media/${item.id}`, { method: "DELETE" });
    setItems(items.filter((candidate) => candidate.id !== item.id));
    setMessage("媒体已删除。");
  }

  async function uploadFile(file: File) {
    setUploading(true);
    setMessage("");
    const body = new FormData();
    body.append("file", file);
    try {
      const uploaded = await apiFetch<MediaItem>("/api/admin/media", {
        body,
        method: "POST",
      });
      setItems((current) => [uploaded, ...current]);
      setMessage("媒体已上传。");
    } catch (error) {
      setMessage(error instanceof APIRequestError ? error.message : "上传失败");
    } finally {
      setUploading(false);
      if (fileInput.current) {
        fileInput.current.value = "";
      }
    }
  }

  return (
    <section className={`${styles.panel} ${styles.stack}`}>
      <div className={styles.pageHeader}>
        <div>
          <h1>媒体</h1>
          <p>上传图片素材、复制引用地址，并清理未使用的文件。</p>
        </div>
        <button
          className={`${styles.button} ${styles.primary}`}
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
          type="button"
        >
          <Upload aria-hidden="true" size={18} />
          {uploading ? "上传中..." : "上传"}
        </button>
      </div>
      <div className={styles.overviewGrid}>
        <article className={styles.overviewCard}>
          <span className={styles.overviewLabel}>素材流转</span>
          <strong className={styles.overviewValue}>共享媒体库</strong>
          <p className={styles.overviewNote}>素材上传一次后，可在写作、项目和资料内容里统一复用。</p>
        </article>
        <article className={styles.metric}>
          <span>素材总数</span>
          <strong>{items.length}</strong>
        </article>
        <article className={styles.metric}>
          <span>已引用</span>
          <strong>{items.filter((item) => item.referenced).length}</strong>
        </article>
        <article className={styles.metric}>
          <span>未使用</span>
          <strong>{items.filter((item) => !item.referenced).length}</strong>
        </article>
      </div>
      <input
        accept="image/png,image/jpeg,image/webp,audio/mpeg,audio/wav,audio/mp4,audio/ogg,video/mp4,video/quicktime,video/webm"
        className={styles.hiddenInput}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void uploadFile(file);
          }
        }}
        ref={fileInput}
        type="file"
      />
      {message ? <p className={styles.message}>{message}</p> : null}
      {items.length === 0 ? (
        <div className={styles.emptyState}>
          <h2>还没有媒体素材</h2>
          <p>先上传封面图或配图，再在 Markdown 中按媒体资源引用。</p>
        </div>
      ) : (
        <div className={styles.mediaGrid}>
          {items.map((item) => {
            const kind = mediaKind(item);
            const card = item.variants.card;
            const markdownRef = mediaReference(item, kind);
            return (
              <article className={styles.mediaCard} key={item.id}>
                {kind === "image" && card ? (
                  <img
                    alt=""
                    className={styles.thumb}
                    height={card.height}
                    src={card.url}
                    width={card.width}
                  />
                ) : (
                  <div className={`${styles.thumb} ${styles.mediaPlaceholder}`}>
                    <strong>{kind === "audio" ? "AUDIO" : "VIDEO"}</strong>
                    <span>{item.mime_type}</span>
                  </div>
                )}
                <div className={styles.mediaBody}>
                  <strong>{item.file_name}</strong>
                  <span>{item.referenced ? "已引用" : "未使用"}</span>
                  <code>{markdownRef}</code>
                </div>
                <button
                  aria-label={`删除 ${item.file_name}`}
                  className={`${styles.iconButton} ${styles.danger}`}
                  disabled={item.referenced}
                  onClick={() => void deleteItem(item)}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={17} />
                  删除
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function mediaKind(item: MediaItem) {
  const mimeType = item.mime_type || item.variants.original?.mime_type || item.variants.card?.mime_type || "";
  if (mimeType.startsWith("audio/")) {
    return "audio";
  }
  if (mimeType.startsWith("video/")) {
    return "video";
  }
  return "image";
}

function mediaReference(item: MediaItem, kind: "audio" | "image" | "video") {
  if (kind === "image") {
    return `![${item.file_name}](media://asset/${item.id}/card)`;
  }
  return `[${item.file_name}](media://asset/${item.id}/original)`;
}
