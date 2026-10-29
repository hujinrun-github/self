import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, LockKeyhole } from "lucide-react";
import { type Locale, withLocale } from "../public/locale";
import { journalAPI } from "./api";
import { journalCopy } from "./journalCopy";
import type { JournalPublicNotebook } from "./types";
import styles from "./JournalPages.module.css";

export function JournalBookCards({
  books,
  locale = "zh",
}: {
  books: JournalPublicNotebook[];
  locale?: Locale;
}) {
  const copy = journalCopy(locale);
  return (
    <div className={styles.books}>
      {books.map((book) => (
        <Link
          key={book.id}
          to={withLocale(locale, `/journal/${book.id}`)}
          className={styles.book}
          style={
            {
              "--cover-color": /^#[0-9a-f]{6}$/i.test(book.cover_color)
                ? book.cover_color
                : "#789888",
            } as CSSProperties
          }
        >
          <LockKeyhole size={20} aria-hidden="true" />
          <h3>{book.public_title}</h3>
          <small>
            {copy.passwordRequired}
            <ArrowUpRight size={14} aria-hidden="true" />
          </small>
        </Link>
      ))}
    </div>
  );
}
export function JournalHomeSection({ locale = "zh" }: { locale?: Locale }) {
  const [books, setBooks] = useState<JournalPublicNotebook[]>([]);
  useEffect(() => {
    let active = true;
    journalAPI
      .publicBooks()
      .then((result) => {
        if (active) setBooks(Array.isArray(result.items) ? result.items : []);
      })
      .catch(() => {
        /* The optional homepage section should not break the portfolio. */
      });
    return () => {
      active = false;
    };
  }, []);
  if (!books.length) return null;
  const copy = journalCopy(locale);
  return (
    <section
      className={`${styles.homeSection} ${styles.page}`}
      aria-label={copy.title}
    >
      <div className={styles.header}>
        <div>
          <span className={styles.eyebrow}>JOURNAL</span>
          <h2>{copy.title}</h2>
          <p className={styles.muted}>{copy.subtitle}</p>
        </div>
        <Link className={styles.inlineLink} to={withLocale(locale, "/journal")}>
          {copy.viewAll} <ArrowUpRight size={14} />
        </Link>
      </div>
      <JournalBookCards books={books.slice(0, 4)} locale={locale} />
    </section>
  );
}
