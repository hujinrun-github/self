export type JournalPaper = "plain" | "ruled" | "dots";

export type JournalElement = {
  id: string;
  type: "text" | "note" | "photo" | "sticker";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  locked: boolean;
  text?: string;
  asset_id?: number;
  color?: string;
  font_size?: number;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
};

export type JournalScene = {
  schemaVersion: 1;
  width: number;
  height: number;
  paper: JournalPaper;
  elements: JournalElement[];
};

export type JournalNotebook = {
  id: number;
  name: string;
  public_title: string;
  cover_color: string;
  paper: JournalPaper;
  public_enabled: boolean;
  has_password: boolean;
  archived: boolean;
  version: number;
  created_at: string;
  updated_at: string;
};

export type JournalPublicNotebook = Pick<
  JournalNotebook,
  "id" | "public_title" | "cover_color"
>;

export type JournalNotebookInput = Pick<
  JournalNotebook,
  | "name"
  | "public_title"
  | "cover_color"
  | "paper"
  | "public_enabled"
  | "archived"
> & {
  version?: number;
  password?: string;
  clear_password?: boolean;
};

export type JournalEntry = {
  id: number;
  notebook_id: number;
  title: string;
  entry_date: string;
  mood: string;
  weather: string;
  tags: string[];
  favorite: boolean;
  scene: JournalScene;
  version: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type JournalEntryInput = Pick<
  JournalEntry,
  "title" | "entry_date" | "mood" | "weather" | "tags" | "favorite" | "scene"
> & {
  version?: number;
  notebook_id?: number;
};

export type JournalAsset = {
  id: number;
  notebook_id: number;
  mime_type: string;
  width: number;
  height: number;
  file_name: string;
  size_bytes: number;
};

export type JournalEntryFilters = {
  q?: string;
  from?: string;
  to?: string;
  tag?: string;
  mood?: string;
  favorite?: boolean;
  trash?: boolean;
  limit?: number;
  offset?: number;
};

export type JournalEntryList = { items: JournalEntry[]; total: number };
export type JournalUnlockSession = { unlocked: boolean; expires_at?: string };
