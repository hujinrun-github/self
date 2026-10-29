import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, ExternalLink, Link, Share2, X } from "lucide-react";
import type { Locale } from "../public/locale";
import { buildJournalShareURL } from "./journalShare";
import styles from "./JournalShareButton.module.css";

type Props = {
  notebookID: number;
  entryID?: number;
  locale?: Locale;
  enabled?: boolean;
  className?: string;
};

const messages = {
  zh: {
    share: "分享手帐",
    title: "分享这本手帐",
    description: "分享链接以全屏只读方式打开，仅展示已保存内容。无需登录，仍需输入手帐的查看密码。",
    startingPage: "链接将从当前页开始，接收者可以继续翻阅整本手帐。",
    disabled: "先在手帐本设置中开启前台展示并设置查看密码",
    link: "分享链接",
    copy: "复制链接",
    copied: "链接已复制",
    failed: "无法自动复制，链接已选中，请手动复制。",
    preview: "打开分享预览",
    close: "关闭分享窗口",
  },
  en: {
    share: "Share journal",
    title: "Share this journal",
    description: "The link opens a fullscreen, read-only view of saved content. No sign-in is needed; the journal viewing password is still required.",
    startingPage: "The link starts on this page. Recipients can continue through the entire journal.",
    disabled: "Enable public display and set a viewing password in notebook settings first",
    link: "Share link",
    copy: "Copy link",
    copied: "Link copied",
    failed: "The link could not be copied automatically. It is selected for you to copy manually.",
    preview: "Open share preview",
    close: "Close share window",
  },
  ja: {
    share: "手帳を共有",
    title: "この手帳を共有",
    description: "リンクは保存済みの内容を全画面の閲覧専用ページで開きます。ログインは不要ですが、手帳の閲覧パスワードが必要です。",
    startingPage: "このページから開き、受信者は手帳全体をめくることができます。",
    disabled: "手帳の設定で公開表示を有効にし、閲覧パスワードを設定してください",
    link: "共有リンク",
    copy: "リンクをコピー",
    copied: "リンクをコピーしました",
    failed: "自動コピーができませんでした。選択されたリンクを手動でコピーしてください。",
    preview: "共有プレビューを開く",
    close: "共有ウィンドウを閉じる",
  },
};

function ShareDialog({
  url,
  locale,
  onClose,
  trigger,
  startsAtPage,
}: {
  url: string;
  locale: Locale;
  onClose: () => void;
  trigger: RefObject<HTMLButtonElement | null>;
  startsAtPage: boolean;
}) {
  const copy = messages[locale];
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    active.current = true;
    const element = dialog.current;
    const button = trigger.current;
    element?.showModal();
    input.current?.focus();
    input.current?.select();
    return () => {
      active.current = false;
      element?.close();
      button?.focus();
    };
  }, [trigger]);

  async function copyLink() {
    if (copying) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(url);
      if (active.current) setStatus("copied");
    } catch {
      if (active.current) {
        setStatus("failed");
        input.current?.focus();
        input.current?.select();
      }
    } finally {
      if (active.current) setCopying(false);
    }
  }

  return createPortal(
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) onClose();
      }}
    >
      <header className={styles.header}>
        <span className={styles.symbol} aria-hidden="true"><Link size={22} /></span>
        <h2 id={`${id}-title`}>{copy.title}</h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label={copy.close}>
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <p id={`${id}-description`} className={styles.description}>{copy.description}{startsAtPage && ` ${copy.startingPage}`}</p>
      <label className={styles.label} htmlFor={`${id}-link`}>{copy.link}</label>
      <input
        ref={input}
        id={`${id}-link`}
        className={styles.url}
        type="text"
        value={url}
        readOnly
        onFocus={(event) => event.currentTarget.select()}
      />
      <p className={styles.status} role="status">
        {status === "copied" ? copy.copied : status === "failed" ? copy.failed : ""}
      </p>
      <div className={styles.actions}>
        <a href={url} target="_blank" rel="noopener noreferrer" className={styles.preview}>
          <ExternalLink size={16} aria-hidden="true" />{copy.preview}
        </a>
        <button type="button" className={styles.copy} onClick={() => void copyLink()} disabled={copying}>
          {status === "copied" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          {status === "copied" ? copy.copied : copy.copy}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}

export function JournalShareButton({
  notebookID,
  entryID,
  locale = "zh",
  enabled = true,
  className,
}: Props) {
  const copy = messages[locale];
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <span className={styles.control}>
      <button
        ref={trigger}
        type="button"
        className={`${styles.share}${className ? ` ${className}` : ""}`}
        disabled={!enabled}
        aria-describedby={!enabled ? `${id}-disabled` : undefined}
        onClick={() => setOpen(true)}
      >
        <Share2 size={16} aria-hidden="true" />{copy.share}
      </button>
      {!enabled && <span id={`${id}-disabled`} className={styles.disabled}>{copy.disabled}</span>}
      {open && enabled && (
        <ShareDialog
          url={buildJournalShareURL(notebookID, locale, entryID)}
          locale={locale}
          onClose={() => setOpen(false)}
          trigger={trigger}
          startsAtPage={entryID !== undefined}
        />
      )}
    </span>
  );
}
