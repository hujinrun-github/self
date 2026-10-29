/* eslint-disable react-hooks/preserve-manual-memoization -- Permission request callbacks intentionally share mutable generation refs; their explicit dependencies control session revalidation. */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  LockKeyhole,
  Maximize,
  Minimize,
} from "lucide-react";
import { APIRequestError } from "../../lib/api";
import { PublicLayout } from "../public/PublicLayout";
import { usePublicPageMeta } from "../public/head";
import { coerceLocale, withLocale } from "../public/locale";
import { journalAPI } from "./api";
import { JournalBookCards } from "./JournalHomeSection";
import { JournalBookReader } from "./JournalBookReader";
import { JournalCollection } from "./JournalCollection";
import { JournalShareButton } from "./JournalShareButton";
import { loadJournalEntries } from "./journalHelpers";
import { journalCopy } from "./journalCopy";
import type { JournalEntry, JournalPublicNotebook } from "./types";
import styles from "./JournalPages.module.css";
import readingStyles from "./JournalReadingPage.module.css";

export function JournalPublicPage({ immersive = false }: { immersive?: boolean }) {
  const { locale, notebookId } = useParams();
  const [params] = useSearchParams();
  const sharedEntry = immersive ? params.get("entry") : null;
  // A different shared URL starts with no protected state, even before effects run.
  return <JournalPublicContent key={JSON.stringify([locale, notebookId, immersive, sharedEntry])} immersive={immersive} sharedEntry={sharedEntry} />;
}

function JournalPublicContent({ immersive, sharedEntry }: { immersive: boolean; sharedEntry: string | null }) {
  const { locale: localeParam, notebookId } = useParams();
  const locale = coerceLocale(localeParam);
  const copy = journalCopy(locale);
  const bookID = Number(notebookId);
  const sharedEntryID = sharedEntry !== null && /^\d+$/.test(sharedEntry) && Number.isSafeInteger(Number(sharedEntry)) && Number(sharedEntry) > 0 ? Number(sharedEntry) : null;
  const invalidSharedEntry = sharedEntry !== null && sharedEntryID === null;
  const [books, setBooks] = useState<JournalPublicNotebook[]>([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [sessionBook, setSessionBook] = useState<number | null>(null);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [selected, setSelected] = useState<JournalEntry | null>(null);
  const [deadline, setDeadline] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [nativeFullscreen, setNativeFullscreen] = useState(!!document.fullscreenElement);
  const [fullscreenError, setFullscreenError] = useState("");
  const requestVersion = useRef(0);
  const entryRequestVersion = useRef(0);
  const sessionCheckVersion = useRef(0);
  const sessionRef = useRef<number | null>(null);
  const selectedRef = useRef<JournalEntry | null>(null);
  const resumeNeeded = useRef(false);
  const lastTouch = useRef(0);
  const book = books.find((b) => b.id === bookID);
  const unlocked = sessionBook === bookID;
  usePublicPageMeta({
    title: `${copy.title} · ${book?.public_title ?? copy.passwordRequired}`,
    canonicalPath: withLocale(
      locale,
      notebookId ? `/journal/${notebookId}${immersive ? "/read" : ""}` : "/journal",
    ),
    robots: "noindex, nofollow, noarchive",
    description: copy.passwordRequired,
  });
  useEffect(() => {
    if (!immersive) return;
    const changed = () => setNativeFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", changed);
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      if (document.fullscreenElement === document.documentElement)
        void document.exitFullscreen().catch(() => {});
    };
  }, [immersive]);
  const clear = useCallback((message = "") => {
    requestVersion.current++;
    entryRequestVersion.current++;
    sessionCheckVersion.current++;
    sessionRef.current = null;
    setSessionBook(null);
    setEntries([]);
    setSelected(null);
    selectedRef.current = null;
    resumeNeeded.current = false;
    setPassword("");
    setLoading(false);
    setDeadline(null);
    setVerifying(false);
    setError(message);
  }, []);
  useEffect(() => {
    let active = true;
    journalAPI
      .publicBooks()
      .then((result) => {
        if (active) {
          setBooks(result.items);
          setCatalogLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setError(copy.failed);
          setCatalogLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [copy.failed, revision]);
  const loadEntries = useCallback(
    async (id: number) => {
      const messages = journalCopy(locale);
      const version = ++requestVersion.current;
      setLoading(true);
      try {
        const result = await loadJournalEntries((offset) =>
          version === requestVersion.current && sessionRef.current === id
            ? journalAPI.publicEntries(id, { limit: 100, offset })
            : Promise.resolve({ items: [], total: 0 }),
        );
        if (version === requestVersion.current && sessionRef.current === id) {
          setEntries(result);
          setError("");
          if (immersive) {
            const target = sharedEntryID === null ? result[0] : result.find((item) => item.id === sharedEntryID);
            if (invalidSharedEntry || (sharedEntryID !== null && !target)) {
              setError(messages.pageUnavailable);
              return;
            }
            if (target) {
              const entryVersion = ++entryRequestVersion.current;
              try {
                const latest = await journalAPI.publicEntry(id, target.id);
                if (version === requestVersion.current && entryVersion === entryRequestVersion.current && sessionRef.current === id) {
                  if (latest.notebook_id === id && latest.id === target.id && !latest.deleted_at) {
                    selectedRef.current = latest;
                    setSelected(latest);
                  } else setError(messages.pageUnavailable);
                }
              } catch (e) {
                if (version !== requestVersion.current || entryVersion !== entryRequestVersion.current || sessionRef.current !== id) return;
                if (e instanceof APIRequestError && e.status === 404) setError(messages.pageUnavailable);
                else throw e;
              }
            }
          }
        }
      } catch (e) {
        if (version !== requestVersion.current) return;
        if (e instanceof APIRequestError && [401, 403, 404].includes(e.status))
          clear(messages.expired);
        else setError(messages.failed);
      } finally {
        if (version === requestVersion.current) setLoading(false);
      }
    },
    [clear, locale, immersive, sharedEntryID, invalidSharedEntry],
  );
  useEffect(() => {
    // Permission and notebook changes must immediately discard protected state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    clear();
    if (!bookID || !catalogLoaded || !book) return;
    let active = true;
    const version = requestVersion.current;
    journalAPI
      .publicSession(bookID)
      .then((session) => {
        if (active && version === requestVersion.current && session.unlocked) {
          setDeadline(session.expires_at ?? null);
          sessionRef.current = bookID;
          setSessionBook(bookID);
          void loadEntries(bookID);
        }
      })
      .catch(() => {
        /* A locked book stays on the password form. */
      });
    // This ref is a request generation counter, not a DOM ref.
    return () => {
      active = false;
      // eslint-disable-next-line react-hooks/exhaustive-deps
      requestVersion.current++;
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Request generation, not a DOM ref.
      entryRequestVersion.current++;
      sessionRef.current = null;
    };
  }, [bookID, catalogLoaded, book, clear, loadEntries]);
  useEffect(() => {
    if (!unlocked || !deadline) return;
    const remaining = new Date(deadline).getTime() - Date.now();
    const timer = window.setTimeout(
      () => clear(copy.expired),
      Math.max(0, remaining),
    );
    return () => window.clearTimeout(timer);
  }, [unlocked, deadline, clear, copy.expired]);
  useEffect(() => {
    if (!unlocked) return;
    let active = true;
    async function check() {
      const version = ++sessionCheckVersion.current;
      try {
        const session = await journalAPI.publicSession(bookID);
        if (
          !active ||
          version !== sessionCheckVersion.current ||
          sessionRef.current !== bookID ||
          document.visibilityState !== "visible"
        ) return;
        if (!session.unlocked) clear(copy.expired);
        else {
          setDeadline(session.expires_at ?? null);
          setVerifying(false);
          // A foreground check may have cancelled the first page request.
          if (resumeNeeded.current) {
            resumeNeeded.current = false;
            if (immersive && !selectedRef.current && !invalidSharedEntry)
              void loadEntries(bookID);
          }
        }
      } catch (e) {
        if (!active || version !== sessionCheckVersion.current) return;
        if (e instanceof APIRequestError && [401, 403, 404].includes(e.status))
          clear(copy.expired);
        else clear(copy.failed);
      }
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, 30_000);
    const visible = () => {
      resumeNeeded.current = true;
      sessionCheckVersion.current++;
      entryRequestVersion.current++;
      setLoading(false);
      setVerifying(true);
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [unlocked, bookID, clear, copy.expired, copy.failed, immersive, invalidSharedEntry, loadEntries]);
  async function unlock(e: FormEvent) {
    e.preventDefault();
    if (!book || busy) return;
    setBusy(true);
    setError("");
    const version = requestVersion.current;
    try {
      const session = await journalAPI.unlock(bookID, password);
      setPassword("");
      if (version !== requestVersion.current) return;
      if (!session.unlocked) {
        setError(copy.incorrect);
        return;
      }
      setDeadline(session.expires_at ?? null);
      sessionRef.current = bookID;
      lastTouch.current = Date.now();
      setSessionBook(bookID);
      await loadEntries(bookID);
    } catch (e) {
      if (version !== requestVersion.current) return;
      setPassword("");
      setError(
        e instanceof APIRequestError && e.status === 429
          ? copy.limited
          : e instanceof APIRequestError && [401, 403].includes(e.status)
            ? copy.incorrect
            : e instanceof APIRequestError && e.status === 404
              ? copy.unavailable
              : copy.failed,
      );
    } finally {
      setBusy(false);
    }
  }
  function interact() {
    if (
      sessionRef.current !== bookID ||
      verifying ||
      Date.now() - lastTouch.current < 30_000
    )
      return;
    lastTouch.current = Date.now();
    const version = requestVersion.current;
    void journalAPI
      .touch(bookID)
      .then(async (result) => {
        const session = result ?? (await journalAPI.publicSession(bookID));
        if (version !== requestVersion.current || sessionRef.current !== bookID)
          return;
        if (session.unlocked) setDeadline(session.expires_at ?? null);
        else clear(copy.expired);
      })
      .catch((e) => {
        if (
          version === requestVersion.current &&
          e instanceof APIRequestError &&
          [401, 403, 404].includes(e.status)
        )
          clear(copy.expired);
      });
  }
  async function openEntry(entry: JournalEntry) {
    if (sessionRef.current !== bookID || verifying) return;
    const version = requestVersion.current;
    const entryVersion = ++entryRequestVersion.current;
    setLoading(true);
    setError("");
    try {
      const latest = await journalAPI.publicEntry(bookID, entry.id);
      if (
        version === requestVersion.current &&
        entryVersion === entryRequestVersion.current &&
        sessionRef.current === bookID
      ) {
        if (latest.notebook_id === bookID && latest.id === entry.id && !latest.deleted_at) {
          selectedRef.current = latest;
          setSelected(latest);
        }
        else setError(copy.pageUnavailable);
      }
    } catch (e) {
      if (
        version !== requestVersion.current ||
        entryVersion !== entryRequestVersion.current
      ) return;
      if (e instanceof APIRequestError && [401, 403, 404].includes(e.status))
        clear(copy.expired);
      else setError(copy.failed);
    } finally {
      if (
        version === requestVersion.current &&
        entryVersion === entryRequestVersion.current
      ) setLoading(false);
    }
  }
  function backToEntries() {
    entryRequestVersion.current++;
    setSelected(null);
    selectedRef.current = null;
    setLoading(false);
    setError("");
  }
  function lock() {
    clear();
    void journalAPI.lock(bookID).catch(() => setError(copy.failed));
  }
  async function toggleFullscreen() {
    setFullscreenError("");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setFullscreenError(copy.fullscreenFailed);
    }
  }
  const unlockForm = (
    <form onSubmit={(e) => void unlock(e)} className={`${styles.panel} ${styles.unlock}`}>
      <span className={styles.unlockIcon}><LockKeyhole size={26} /></span>
      <span className={styles.eyebrow}>{copy.passwordRequired}</span>
      <h1>{book?.public_title}</h1>
      <p>{copy.passwordHint}</p>
      <label className={styles.label}>
        {copy.password}
        <input className={styles.input} type="password" autoComplete="off" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <div className={styles.error} role="alert">{error}</div>}
      <button className={styles.primary} disabled={busy} type="submit">{busy ? copy.checking : copy.unlock}</button>
    </form>
  );
  const bookReader = selected && (
    <JournalBookReader entry={selected} entries={entries} bookTitle={book?.public_title ?? copy.title} coverColor={book?.cover_color ?? "#789888"} locale={locale} loading={loading} immersive={immersive} onNavigate={(entry) => void openEntry(entry)} assetURL={(id) => journalAPI.assetURL(id, bookID)} />
  );
  if (immersive) return (
    <main className={readingStyles.page} aria-label={copy.fullscreenReader} onPointerDown={interact} onKeyDown={interact} onWheel={interact}>
      <header className={readingStyles.toolbar}>
        <div className={readingStyles.identity}>
          <BookOpen size={20} aria-hidden="true" />
          <div><strong>{book?.public_title ?? copy.title}</strong><span>{copy.fullscreenReader}</span></div>
        </div>
        <div className={readingStyles.actions}>
          {unlocked && !verifying && <JournalShareButton key={selected?.id ?? "book"} notebookID={bookID} entryID={selected?.id} locale={locale} className={styles.button} />}
          {typeof document.documentElement.requestFullscreen === "function" && <button className={styles.button} type="button" onClick={() => void toggleFullscreen()} aria-label={nativeFullscreen ? copy.exitFullscreen : copy.fullscreen}>{nativeFullscreen ? <Minimize size={17} /> : <Maximize size={17} />}</button>}
          {unlocked && !verifying && <button className={styles.button} type="button" onClick={lock}><LockKeyhole size={16} />{copy.lock}</button>}
        </div>
      </header>
      <div className={readingStyles.content}>
        {fullscreenError && <p className={styles.error} role="alert">{fullscreenError}</p>}
        {!catalogLoaded ? <div className={styles.loading} role="status">{copy.loading}</div>
          : !book ? <div className={styles.empty}><h1>{copy.unavailable}</h1></div>
            : !unlocked ? unlockForm
              : verifying ? <div className={styles.loading} role="status">{copy.checking}</div>
                : <>
                  {error && <div className={styles.error} role="alert">{error}<button className={styles.button} type="button" onClick={() => void (selected ? openEntry(selected) : loadEntries(bookID))}>{copy.retry}</button></div>}
                  {bookReader || (loading ? <div className={styles.loading} role="status">{copy.loading}</div> : !error && <div className={styles.empty}><BookOpen size={32} /><h1>{copy.empty}</h1></div>)}
                </>}
      </div>
    </main>
  );
  return (
    <PublicLayout>
      <section
        className={`${styles.page} ${styles.publicPage}`}
        onPointerDown={interact}
        onKeyDown={interact}
        onWheel={interact}
      >
        {!notebookId ? (
          <>
            <header className={styles.header}>
              <div>
                <span className={styles.eyebrow}>JOURNAL</span>
                <h1>{copy.title}</h1>
                <p className={styles.muted}>{copy.subtitle}</p>
              </div>
            </header>
            {!catalogLoaded ? (
              <div className={styles.loading}>{copy.loading}</div>
            ) : error ? (
              <div className={styles.error} role="alert">
                {error}
                <button
                  className={styles.button}
                  type="button"
                  onClick={() => {
                    setError("");
                    setRevision((r) => r + 1);
                  }}
                >
                  {copy.retry}
                </button>
              </div>
            ) : books.length ? (
              <JournalBookCards books={books} locale={locale} />
            ) : (
              <div className={styles.empty}>
                <LockKeyhole size={28} />
                <h2>{copy.emptyBooks}</h2>
              </div>
            )}
          </>
        ) : !unlocked ? (
          <>
            <Link
              className={styles.inlineLink}
              to={withLocale(locale, "/journal")}
            >
              <ArrowLeft size={14} /> {copy.back}
            </Link>
            {!catalogLoaded ? (
              <div className={styles.loading}>{copy.loading}</div>
            ) : !book ? (
              <div className={styles.empty}>
                <h1>{copy.unavailable}</h1>
              </div>
            ) : (
              unlockForm
            )}
          </>
        ) : verifying ? (
          <div className={styles.loading} role="status">
            {copy.checking}
          </div>
        ) : (
          <div className={styles.reader}>
            <header className={styles.readerHeader}>
              <div>
                <span className={styles.eyebrow}>{copy.unlocked}</span>
                <h1>{book?.public_title}</h1>
              </div>
              <div className={styles.actions}>
                <JournalShareButton key={selected?.id ?? "book"} notebookID={bookID} entryID={selected?.id} locale={locale} className={styles.button} />
                {!selected && entries.length > 0 && (
                  <button
                    className={styles.button}
                    type="button"
                    disabled={loading}
                    onClick={() => void openEntry(entries[0])}
                  >
                    <BookOpen size={16} />
                    {copy.readBook}
                  </button>
                )}
                <Link
                  className={styles.inlineLink}
                  to={withLocale(locale, "/journal")}
                >
                  {copy.back}
                </Link>
                <button
                  className={styles.button}
                  type="button"
                  onClick={lock}
                >
                  <LockKeyhole size={16} />
                  {copy.lock}
                </button>
              </div>
            </header>
            {error && (
              <div className={styles.error} role="alert">
                {error}
                <button
                  className={styles.button}
                  type="button"
                  onClick={() => void loadEntries(bookID)}
                >
                  {copy.retry}
                </button>
              </div>
            )}
            {loading && (
              <div className={styles.status} role="status">
                {copy.loading}
              </div>
            )}
            {selected ? (
              <>
                <div className={styles.readerHeader}>
                  <button
                    className={styles.button}
                    type="button"
                    onClick={backToEntries}
                  >
                    <ArrowLeft size={15} />
                    {copy.backEntries}
                  </button>
                </div>
                {bookReader}
              </>
            ) : (
              <JournalCollection
                key={bookID}
                locale={locale}
                entries={entries}
                assetURL={(id) => journalAPI.assetURL(id, bookID)}
                onOpen={(entry) => void openEntry(entry)}
              />
            )}
          </div>
        )}
      </section>
    </PublicLayout>
  );
}
