import { Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";

import { apiFetch } from "../../lib/api";
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

  return (
    <section className={`${styles.panel} ${styles.stack}`}>
      <div className={styles.actions}>
        <h1>Media</h1>
        <button className={styles.button} type="button">
          <Upload aria-hidden="true" size={18} />
          Upload
        </button>
      </div>
      {message ? <p>{message}</p> : null}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Preview</th>
            <th>File</th>
            <th>State</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const card = item.variants.card;
            return (
              <tr key={item.id}>
                <td>
                  {card ? (
                    <img
                      alt=""
                      className={styles.thumb}
                      height={card.height}
                      src={card.url}
                      width={card.width}
                    />
                  ) : null}
                </td>
                <td>{item.file_name}</td>
                <td>{item.referenced ? "Referenced" : "Unused"}</td>
                <td>
                  <button
                    aria-label={`Delete ${item.file_name}`}
                    className={`${styles.button} ${styles.danger}`}
                    disabled={item.referenced}
                    onClick={() => void deleteItem(item)}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={18} />
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
