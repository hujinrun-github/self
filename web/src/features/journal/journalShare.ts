import type { Locale } from "../public/locale";

export function buildJournalShareURL(
  notebookID: number,
  locale: Locale = "zh",
  entryID?: number,
  origin: string = window.location.origin,
) {
  const url = new URL(`/${locale}/journal/${notebookID}/read`, new URL(origin).origin);
  if (entryID !== undefined) url.searchParams.set("entry", String(entryID));
  return url.href;
}
