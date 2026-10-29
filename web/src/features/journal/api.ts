import { apiFetch } from "../../lib/api";
import type {
  JournalAsset,
  JournalEntry,
  JournalEntryFilters,
  JournalEntryInput,
  JournalEntryList,
  JournalNotebook,
  JournalNotebookInput,
  JournalPublicNotebook,
  JournalUnlockSession,
} from "./types";

const admin = "/api/admin/journal";
const site = "/api/site/journal";

function query(filters: JournalEntryFilters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const value = params.toString();
  return value ? `?${value}` : "";
}

export const journalAPI = {
  adminSession: () =>
    apiFetch<{ expires_at: string; server_time: string }>(`${admin}/session`),
  adminBooks: () =>
    apiFetch<{ items: JournalNotebook[] }>(`${admin}/notebooks`),
  createBook: (input: JournalNotebookInput) =>
    apiFetch<JournalNotebook>(`${admin}/notebooks`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateBook: (id: number, input: JournalNotebookInput) =>
    apiFetch<JournalNotebook>(`${admin}/notebooks/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deleteBook: (id: number) =>
    apiFetch<void>(`${admin}/notebooks/${id}`, { method: "DELETE" }),
  entries: (bookID: number, filters?: JournalEntryFilters) =>
    apiFetch<JournalEntryList>(
      `${admin}/notebooks/${bookID}/entries${query(filters)}`,
    ),
  entry: (id: number) => apiFetch<JournalEntry>(`${admin}/entries/${id}`),
  createEntry: (bookID: number, input: JournalEntryInput) =>
    apiFetch<JournalEntry>(`${admin}/notebooks/${bookID}/entries`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  saveEntry: (id: number, input: JournalEntryInput) =>
    apiFetch<JournalEntry>(`${admin}/entries/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deleteEntry: (id: number, permanent = false) =>
    apiFetch<void>(
      `${admin}/entries/${id}${permanent ? "?permanent=true" : ""}`,
      { method: "DELETE" },
    ),
  restoreEntry: (id: number) =>
    apiFetch<JournalEntry>(`${admin}/entries/${id}/restore`, {
      method: "POST",
    }),
  uploadAsset: (bookID: number, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return apiFetch<JournalAsset>(`${admin}/notebooks/${bookID}/assets`, {
      method: "POST",
      body,
    });
  },
  importArchive: (bookID: number, file: File) => {
    const body = new FormData();
    body.append("archive", file);
    return apiFetch<{ imported: number }>(
      `${admin}/notebooks/${bookID}/import`,
      { method: "POST", body },
    );
  },
  publicBooks: () =>
    apiFetch<{ items: JournalPublicNotebook[] }>(`${site}/notebooks`),
  publicSession: (bookID: number) =>
    apiFetch<JournalUnlockSession>(`${site}/notebooks/${bookID}/session`),
  unlock: (bookID: number, password: string) =>
    apiFetch<JournalUnlockSession>(`${site}/notebooks/${bookID}/unlock`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  lock: (bookID: number) =>
    apiFetch<void>(`${site}/notebooks/${bookID}/lock`, { method: "POST" }),
  touch: (bookID: number) =>
    apiFetch<JournalUnlockSession>(`${site}/notebooks/${bookID}/touch`, {
      method: "POST",
    }),
  publicEntries: (bookID: number, filters?: JournalEntryFilters) =>
    apiFetch<JournalEntryList>(
      `${site}/notebooks/${bookID}/entries${query(filters)}`,
    ),
  publicEntry: (bookID: number, id: number) =>
    apiFetch<JournalEntry>(`${site}/notebooks/${bookID}/entries/${id}`),
  assetURL: (id: number, publicBookID?: number) =>
    publicBookID === undefined
      ? `${admin}/assets/${id}`
      : `${site}/notebooks/${publicBookID}/assets/${id}`,
};
