import { useMemo, useState, type ReactNode } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Search,
  Star,
} from "lucide-react";
import type { Locale } from "../public/locale";
import { JournalCanvas } from "./JournalCanvas";
import { extractSceneText } from "./scene";
import { journalCopy } from "./journalCopy";
import type { JournalEntry } from "./types";
import styles from "./JournalPages.module.css";
import { moodOptions, todayDate } from "./journalHelpers";

export function JournalCollection({
  entries,
  onOpen,
  assetURL,
  locale = "zh",
  renderActions,
  selection,
  onSelect,
  onCreateDate,
}: {
  entries: JournalEntry[];
  onOpen: (entry: JournalEntry) => void;
  assetURL: (id: number) => string;
  locale?: Locale;
  renderActions?: (entry: JournalEntry) => ReactNode;
  selection?: Set<number>;
  onSelect?: (id: number) => void;
  onCreateDate?: (date: string) => void;
}) {
  const copy = journalCopy(locale);
  const [view, setView] = useState<"timeline" | "calendar">("timeline");
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [mood, setMood] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [favorite, setFavorite] = useState(false);
  const [month, setMonth] = useState(todayDate().slice(0, 7));
  const [selectedDay, setSelectedDay] = useState("");
  const tags = useMemo(
    () => [...new Set(entries.flatMap((e) => e.tags))].sort(),
    [entries],
  );
  const filtered = useMemo(
    () =>
      entries
        .filter(
          (e) =>
            (!q ||
              `${e.title} ${extractSceneText(e.scene)}`
                .toLocaleLowerCase()
                .includes(q.toLocaleLowerCase())) &&
            (!tag || e.tags.includes(tag)) &&
            (!mood || e.mood === mood) &&
            (!favorite || e.favorite) &&
            (!from || e.entry_date >= from) &&
            (!to || e.entry_date <= to),
        )
        .sort(
          (a, b) => b.entry_date.localeCompare(a.entry_date) || b.id - a.id,
        ),
    [entries, q, tag, mood, favorite, from, to],
  );
  const visible =
    view === "calendar"
      ? filtered.filter((e) =>
          selectedDay
            ? e.entry_date === selectedDay
            : e.entry_date.startsWith(month),
        )
      : filtered;
  const [year, monthNumber] = month.split("-").map(Number);
  const firstWeekday = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7;
  const days = new Date(year, monthNumber, 0).getDate();
  const counts = new Map<string, number>();
  filtered.forEach((e) =>
    counts.set(e.entry_date, (counts.get(e.entry_date) ?? 0) + 1),
  );
  function changeMonth(delta: number) {
    const d = new Date(year, monthNumber - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    setSelectedDay("");
  }
  return (
    <div className={styles.page}>
      <div className={styles.controls}>
        <div className={styles.tabs} aria-label={copy.title}>
          <button
            type="button"
            className={`${styles.tab} ${view === "timeline" ? styles.active : ""}`}
            aria-pressed={view === "timeline"}
            onClick={() => setView("timeline")}
          >
            <LayoutGrid size={16} />
            {copy.timeline}
          </button>
          <button
            type="button"
            className={`${styles.tab} ${view === "calendar" ? styles.active : ""}`}
            aria-pressed={view === "calendar"}
            onClick={() => setView("calendar")}
          >
            <CalendarDays size={16} />
            {copy.calendar}
          </button>
        </div>
        <label className={styles.visuallyHidden} htmlFor="journal-search">
          {copy.search}
        </label>
        <Search size={17} aria-hidden="true" />
        <input
          id="journal-search"
          className={styles.input}
          placeholder={copy.search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          type="search"
        />
      </div>
      <div className={`${styles.controls} ${styles.filterControls}`}>
        <div className={styles.filterSelects}>
          <div className={styles.filterSelect} data-active={!!tag}>
            <select
              className={`${styles.select} ${styles.filterSelectControl}`}
              aria-label={copy.tag}
              title={tag || copy.tag}
              value={tag}
              onChange={(e) => setTag(e.target.value)}
            >
              <option value="">{copy.tag}</option>
              {tags.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <ChevronDown
              className={styles.filterChevron}
              size={16}
              aria-hidden="true"
            />
          </div>
          <div className={styles.filterSelect} data-active={!!mood}>
            <select
              className={`${styles.select} ${styles.filterSelectControl}`}
              aria-label={copy.mood}
              title={mood || copy.mood}
              value={mood}
              onChange={(e) => setMood(e.target.value)}
            >
              <option value="">{copy.mood}</option>
              {moodOptions.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <ChevronDown
              className={styles.filterChevron}
              size={16}
              aria-hidden="true"
            />
          </div>
        </div>
        <input
          className={styles.input}
          type="date"
          aria-label={copy.from}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <span aria-hidden="true">—</span>
        <input
          className={styles.input}
          type="date"
          aria-label={copy.to}
          value={to}
          min={from}
          onChange={(e) => setTo(e.target.value)}
        />
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={favorite}
            onChange={(e) => setFavorite(e.target.checked)}
          />
          {copy.favorite}
        </label>
        {(q || tag || mood || favorite || from || to) && (
          <button
            className={styles.button}
            onClick={() => {
              setQ("");
              setTag("");
              setMood("");
              setFavorite(false);
              setFrom("");
              setTo("");
            }}
            type="button"
          >
            {copy.reset}
          </button>
        )}
      </div>
      {view === "calendar" && (
        <div className={styles.calendar}>
          <div className={styles.calendarHeader}>
            <button
              className={styles.button}
              type="button"
              aria-label={copy.prevMonth}
              onClick={() => changeMonth(-1)}
            >
              <ChevronLeft size={18} />
            </button>
            <strong>
              {new Date(year, monthNumber - 1, 1).toLocaleDateString(
                locale === "zh" ? "zh-CN" : locale,
                { year: "numeric", month: "long" },
              )}
            </strong>
            <button
              className={styles.button}
              type="button"
              aria-label={copy.nextMonth}
              onClick={() => changeMonth(1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <div className={styles.calendarGrid}>
            {copy.dayNames.map((n) => (
              <div className={styles.weekday} key={n}>
                {n}
              </div>
            ))}
            {Array.from(
              { length: Math.ceil((firstWeekday + days) / 7) * 7 },
              (_, i) => {
                const day = i - firstWeekday + 1;
                const date = `${month}-${String(day).padStart(2, "0")}`;
                const valid = day > 0 && day <= days;
                const count = counts.get(date) ?? 0;
                return (
                  <button
                    className={styles.calendarDay}
                    key={i}
                    type="button"
                    disabled={!valid}
                    aria-pressed={selectedDay === date}
                    aria-label={
                      valid ? `${date}, ${count} ${copy.entries}` : undefined
                    }
                    onClick={() =>
                      setSelectedDay(selectedDay === date ? "" : date)
                    }
                  >
                    {valid && (
                      <>
                        <span>{day}</span>
                        {count > 0 && (
                          <small>
                            ● {count} {copy.entries}
                          </small>
                        )}
                      </>
                    )}
                  </button>
                );
              },
            )}
          </div>
        </div>
      )}
      {selectedDay && view === "calendar" && (
        <div className={styles.actions}>
          <strong>{selectedDay}</strong>
          <button
            className={styles.button}
            onClick={() => setSelectedDay("")}
            type="button"
          >
            {copy.allDates}
          </button>
          {onCreateDate && (
            <button
              className={styles.primary}
              type="button"
              onClick={() => onCreateDate(selectedDay)}
            >
              补记这一天
            </button>
          )}
        </div>
      )}
      {!visible.length ? (
        <div className={styles.empty}>
          <h2>{entries.length ? copy.noMatches : copy.empty}</h2>
        </div>
      ) : (
        <div className={styles.entries}>
          {visible.map((entry) => (
            <article className={styles.entryCard} key={entry.id}>
              <button
                className={styles.entryOpen}
                onClick={() => onOpen(entry)}
                type="button"
                aria-label={`${entry.entry_date} ${entry.title || copy.untitled}`}
              >
                <div className={styles.preview}>
                  <JournalCanvas
                    scene={entry.scene}
                    locale={locale}
                    readOnly
                    thumbnail
                    assetURL={assetURL}
                  />
                </div>
                <div className={styles.entryBody}>
                  <div className={styles.entryDate}>
                    {entry.entry_date} {entry.mood}{" "}
                    {entry.favorite && (
                      <Star
                        size={12}
                        fill="currentColor"
                        aria-label={copy.favorite}
                      />
                    )}
                  </div>
                  <h3>{entry.title || copy.untitled}</h3>
                  <div className={styles.tags}>
                    {entry.tags.map((t) => (
                      <span key={t} className={styles.tag}>
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              </button>
              {(onSelect || renderActions) && (
                <div className={styles.entryActions}>
                  {onSelect && (
                    <label className={styles.check}>
                      <input
                        type="checkbox"
                        aria-label={`选择 ${entry.title || entry.entry_date}`}
                        checked={selection?.has(entry.id) ?? false}
                        onChange={() => onSelect(entry.id)}
                      />
                      选择
                    </label>
                  )}
                  {renderActions?.(entry)}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
