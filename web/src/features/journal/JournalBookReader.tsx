import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { BookOpen, ChevronLeft, ChevronRight, MoveHorizontal } from "lucide-react";
import type { Locale } from "../public/locale";
import { JournalCanvas } from "./JournalCanvas";
import type { JournalEntry } from "./types";
import styles from "./JournalBookReader.module.css";

type Props = {
  entry: JournalEntry;
  entries: JournalEntry[];
  bookTitle: string;
  coverColor: string;
  locale: Locale;
  assetURL: (id: number) => string;
  loading: boolean;
  immersive?: boolean;
  onNavigate: (entry: JournalEntry) => void;
};

const messages = {
  zh: {
    reader: "手帐书页阅读器",
    previous: "上一页",
    next: "下一页",
    first: "已经是第一页",
    last: "已经是最后一页",
    only: "这本手帐目前只有一页",
    page: "页",
    loading: "正在打开书页…",
    turning: "正在翻页…",
    untitled: "无题的一页",
    swipe: "在这里左右滑动翻页",
    keyboard: "聚焦阅读器后，按左右方向键翻页。画布支持单独拖动与缩放。",
    mood: "心情",
    weather: "天气",
    tags: "标签",
  },
  en: {
    reader: "Journal book reader",
    previous: "Previous page",
    next: "Next page",
    first: "You are on the first page",
    last: "You are on the last page",
    only: "This journal currently has one page",
    page: "Page",
    loading: "Opening page…",
    turning: "Turning page…",
    untitled: "An untitled page",
    swipe: "Swipe here to turn the page",
    keyboard: "Focus the reader and use the left and right arrow keys to turn pages. Drag and zoom the canvas separately.",
    mood: "Mood",
    weather: "Weather",
    tags: "Tags",
  },
  ja: {
    reader: "手帳のページ閲覧",
    previous: "前のページ",
    next: "次のページ",
    first: "最初のページです",
    last: "最後のページです",
    only: "この手帳には現在 1 ページあります",
    page: "ページ",
    loading: "ページを開いています…",
    turning: "ページをめくっています…",
    untitled: "無題のページ",
    swipe: "ここで左右にスワイプしてページをめくる",
    keyboard: "閲覧エリアにフォーカスし、左右の矢印キーでページをめくります。キャンバスは個別に移動・拡大できます。",
    mood: "気分",
    weather: "天気",
    tags: "タグ",
  },
};

const motionQuery = "(prefers-reduced-motion: reduce)";
function subscribeMotion(callback: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(motionQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
function motionSnapshot() {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(motionQuery).matches
    : false;
}

type Turn = {
  current: JournalEntry;
  outgoing: JournalEntry | null;
  direction: "next" | "previous";
};
type Swipe = { id: number; x: number; y: number; time: number };

export function JournalBookReader({
  entry,
  entries,
  bookTitle,
  coverColor,
  locale,
  assetURL,
  loading,
  immersive = false,
  onNavigate,
}: Props) {
  const copy = messages[locale];
  const hintID = useId();
  const reducedMotion = useSyncExternalStore(subscribeMotion, motionSnapshot, () => true);
  const [turn, setTurn] = useState<Turn>({
    current: entry,
    outgoing: null,
    direction: "next",
  });
  // Keep the previous document for one leaf turn. Updating the snapshot during
  // render avoids briefly painting the new page before its animation is ready.
  if (turn.current !== entry) {
    const changedPage = turn.current.id !== entry.id;
    const previousIndex = entries.findIndex((item) => item.id === turn.current.id);
    const nextIndex = entries.findIndex((item) => item.id === entry.id);
    setTurn({
      current: entry,
      outgoing:
        changedPage &&
        !reducedMotion &&
        turn.current.notebook_id === entry.notebook_id
          ? turn.current
          : changedPage
            ? null
            : turn.outgoing,
      direction:
        changedPage && previousIndex >= 0 && nextIndex < previousIndex
          ? "previous"
          : changedPage
            ? "next"
            : turn.direction,
    });
  } else if (turn.outgoing && reducedMotion) {
    setTurn({ ...turn, outgoing: null });
  }
  const finishTurn = useCallback(() => {
    setTurn((current) =>
      current.outgoing ? { ...current, outgoing: null } : current,
    );
  }, []);
  useEffect(() => {
    if (!turn.outgoing) return;
    // Animation events can be skipped when a tab is hidden or styles change.
    const timeout = window.setTimeout(finishTurn, 760);
    return () => window.clearTimeout(timeout);
  }, [turn.outgoing, finishTurn]);

  const index = entries.findIndex((item) => item.id === entry.id);
  const count = entries.length;
  const page = Math.max(0, index) + 1;
  const previous = index > 0 ? entries[index - 1] : undefined;
  const next = index >= 0 ? entries[index + 1] : undefined;
  const blocked = loading || !!turn.outgoing;
  const swipe = useRef<Swipe | null>(null);
  const touches = useRef(new Set<number>());
  const parsedDate = new Date(`${entry.entry_date.slice(0, 10)}T12:00:00`);
  const validDate = !Number.isNaN(parsedDate.getTime());
  const dateLocale = locale === "zh" ? "zh-CN" : locale === "ja" ? "ja-JP" : "en-US";
  const date = validDate
    ? new Intl.DateTimeFormat(dateLocale, {
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(parsedDate)
    : entry.entry_date;
  const boundary = count === 1 ? copy.only : index === 0 ? copy.first : !next ? copy.last : "";
  const progress = `${copy.page} ${page} / ${count || 1}`;

  function navigate(direction: "previous" | "next") {
    const target = direction === "previous" ? previous : next;
    if (target && !blocked) onNavigate(target);
  }

  function keyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (
      event.target instanceof Element &&
      event.target.closest(
        "input, textarea, select, [contenteditable='true'], [data-book-canvas]",
      )
    ) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    if (!event.repeat) navigate(event.key === "ArrowLeft" ? "previous" : "next");
  }

  function startSwipe(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch") return;
    touches.current.add(event.pointerId);
    if (touches.current.size > 1 || blocked) {
      swipe.current = null;
      return;
    }
    swipe.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function endSwipe(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    touches.current.delete(event.pointerId);
    const start = swipe.current;
    if (!start || start.id !== event.pointerId) return;
    swipe.current = null;
    if (cancelled || blocked) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (
      Math.abs(dx) >= 48 &&
      Math.abs(dx) > Math.abs(dy) * 1.5 &&
      Math.abs(dy) < 70 &&
      event.timeStamp - start.time <= 900
    ) navigate(dx < 0 ? "next" : "previous");
  }

  return (
    <section
      className={`${styles.reader} ${immersive ? styles.immersive : ""}`}
      style={{ "--book-cover": coverColor || "#739887" } as CSSProperties}
      tabIndex={0}
      aria-label={copy.reader}
      aria-describedby={hintID}
      aria-busy={blocked}
      onKeyDown={keyboard}
    >
      <p id={hintID} className={styles.visuallyHidden}>{copy.keyboard}</p>
      <div className={styles.cover}>
        <div className={styles.spread}>
          <div className={styles.metadataLeaf}>
            <div className={styles.bookLabel}>
              <BookOpen size={16} aria-hidden="true" />
              <span>{bookTitle}</span>
            </div>
            <div className={styles.dateBlock}>
              {validDate && <span className={styles.day} aria-hidden="true">{String(parsedDate.getDate()).padStart(2, "0")}</span>}
              <time dateTime={entry.entry_date}>{date}</time>
            </div>
            <h2 className={styles.title}>{entry.title || copy.untitled}</h2>
            {(entry.mood || entry.weather) && (
              <dl className={styles.details}>
                {entry.mood && <div><dt>{copy.mood}</dt><dd>{entry.mood}</dd></div>}
                {entry.weather && <div><dt>{copy.weather}</dt><dd>{entry.weather}</dd></div>}
              </dl>
            )}
            {!!entry.tags.length && (
              <div className={styles.tags} aria-label={copy.tags}>
                {entry.tags.map((tag) => <span key={tag}>{tag}</span>)}
              </div>
            )}
            <div className={styles.leafNumber} aria-hidden="true">
              <span />{String(page).padStart(2, "0")}<span />
            </div>
          </div>
          <div className={styles.canvasLeaf} data-book-canvas>
            <JournalCanvas
              key={entry.id}
              scene={entry.scene}
              readOnly
              bookPage
              immersive={immersive}
              assetURL={assetURL}
              locale={locale}
            />
            <span className={styles.pageCorner} aria-hidden="true" />
          </div>
          {turn.outgoing && !reducedMotion && (
            <div
              key={turn.outgoing.id}
              className={`${styles.turnLeaf} ${turn.direction === "next" ? styles.turnNext : styles.turnPrevious}`}
              aria-hidden="true"
              inert
              onAnimationEnd={(event) => {
                if (event.target === event.currentTarget) finishTurn();
              }}
            >
              <div className={styles.turnContent}>
                <JournalCanvas
                  scene={turn.outgoing.scene}
                  readOnly
                  thumbnail
                  bookPage
                  immersive={immersive}
                  assetURL={assetURL}
                  locale={locale}
                />
              </div>
            </div>
          )}
        </div>
      </div>
      <div className={styles.footer}>
        <button type="button" onClick={() => navigate("previous")} disabled={!previous || blocked}>
          <ChevronLeft size={18} aria-hidden="true" /><span>{copy.previous}</span>
        </button>
        <div className={styles.progress}>
          <span>{progress}</span>
          <span className={styles.boundary} role="status" aria-live="polite">
            {loading ? copy.loading : turn.outgoing ? copy.turning : boundary}
          </span>
        </div>
        <button type="button" onClick={() => navigate("next")} disabled={!next || blocked}>
          <span>{copy.next}</span><ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      <div
        className={styles.swipeStrip}
        onPointerDown={startSwipe}
        onPointerUp={(event) => endSwipe(event)}
        onPointerCancel={(event) => endSwipe(event, true)}
        onLostPointerCapture={(event) => endSwipe(event, true)}
      >
        <MoveHorizontal size={15} aria-hidden="true" />
        <span>{copy.swipe}</span>
      </div>
    </section>
  );
}
