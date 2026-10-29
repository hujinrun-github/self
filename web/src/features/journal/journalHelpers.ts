import type { JournalEntry, JournalEntryList } from "./types";

export async function loadJournalEntries(
  fetchPage: (offset: number) => Promise<JournalEntryList>,
) {
  const items: JournalEntry[] = [];
  for (;;) {
    const page = await fetchPage(items.length);
    items.push(...page.items);
    if (!page.items.length || items.length >= page.total) return items;
  }
}
export const moodOptions = ["😊", "🥰", "😌", "🤩", "😐", "😔", "😢", "😤"];
export function todayDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
