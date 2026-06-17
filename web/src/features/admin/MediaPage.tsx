import { Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { APIRequestError, apiFetch } from "../../lib/api";
import type { MediaVariant } from "../../lib/types";
import styles from "./Admin.module.css";

type MediaItem = {
  id: number;
  file_name: string;
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
    setMessage("Media deleted");
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
      setMessage("Media uploaded");
    } catch (error) {
      setMessage(error instanceof APIRequestError ? error.message : "Upload failed");
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
          <h1>Media</h1>
          <p>Upload images, copy asset references, and clean up unused files.</p>
        </div>
        <button
          className={`${styles.button} ${styles.primary}`}
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
          type="button"
        >
          <Upload aria-hidden="true" size={18} />
          {uploading ? "Uploading..." : "Upload"}
        </button>
      </div>
      <input
        accept="image/png,image/jpeg,image/webp"
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
          <h2>No media yet</h2>
          <p>Upload a cover image, then reference it from Markdown as a media asset.</p>
        </div>
      ) : (
        <div className={styles.mediaGrid}>
          {items.map((item) => {
            const card = item.variants.card;
            const markdownRef = `![${item.file_name}](media://asset/${item.id}/card)`;
            return (
              <article className={styles.mediaCard} key={item.id}>
                {card ? (
                  <img
                    alt=""
                    className={styles.thumb}
                    height={card.height}
                    src={card.url}
                    width={card.width}
                  />
                ) : (
                  <div className={styles.thumb} />
                )}
                <div className={styles.mediaBody}>
                  <strong>{item.file_name}</strong>
                  <span>{item.referenced ? "Referenced" : "Unused"}</span>
                  <code>{markdownRef}</code>
                </div>
                <button
                  aria-label={`Delete ${item.file_name}`}
                  className={`${styles.iconButton} ${styles.danger}`}
                  disabled={item.referenced}
                  onClick={() => void deleteItem(item)}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={17} />
                  Delete
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
