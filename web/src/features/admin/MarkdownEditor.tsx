import { Maximize2, X } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import "@uiw/react-md-editor/markdown-editor.css";
import "@uiw/react-markdown-preview/markdown.css";

import styles from "./Admin.module.css";

const MDEditor = lazy(() => import("@uiw/react-md-editor/nohighlight"));

type MarkdownEditorProps = {
  description?: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
};

export function MarkdownEditor({
  description,
  id,
  label,
  onChange,
  value,
}: MarkdownEditorProps) {
  const compact = useMediaQuery("(max-width: 720px)");
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFullscreen(false);
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [fullscreen]);

  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label htmlFor={id}>{label}</label>
        <span className={styles.editorMeta}>
          {description ? <span>{description}</span> : null}
          <button className={styles.inlineToolButton} onClick={() => setFullscreen(true)} type="button">
            <Maximize2 aria-hidden="true" size={15} />
            Fullscreen
          </button>
        </span>
      </div>
      {fullscreen ? null : (
        <div className={styles.markdownEditor} data-color-mode="light">
          <EditorSurface compact={compact} id={id} onChange={onChange} value={value} />
        </div>
      )}
      {fullscreen ? (
        <div
          aria-label={`${label} fullscreen editor`}
          aria-modal="true"
          className={styles.fullscreenBackdrop}
          role="dialog"
        >
          <div className={styles.fullscreenPanel} data-color-mode="light">
            <div className={styles.fullscreenHeader}>
              <div>
                <strong>{label}</strong>
                <span>{description ?? "Fullscreen Markdown editor"}</span>
              </div>
              <button className={styles.button} onClick={() => setFullscreen(false)} type="button">
                <X aria-hidden="true" size={17} />
                Exit fullscreen
              </button>
            </div>
            <div className={`${styles.markdownEditor} ${styles.fullscreenEditor}`}>
              <EditorSurface compact={compact} fullscreen id={`${id}-fullscreen`} onChange={onChange} value={value} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EditorSurface({
  compact,
  fullscreen = false,
  id,
  onChange,
  value,
}: {
  compact: boolean;
  fullscreen?: boolean;
  id: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <Suspense fallback={<div className={styles.editorLoading}>Loading editor...</div>}>
      <MDEditor
        height={fullscreen ? "calc(100vh - 128px)" : compact ? 360 : 420}
        onChange={(nextValue) => onChange(nextValue ?? "")}
        preview={compact ? "edit" : "live"}
        textareaProps={{
          id,
          placeholder: "Write with headings, links, lists, code, and media references.",
        }}
        value={value}
        visibleDragbar={false}
      />
    </Suspense>
  );
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
