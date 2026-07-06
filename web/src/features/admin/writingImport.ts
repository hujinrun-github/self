import { apiFetch } from "../../lib/api";
import type { MediaMap } from "../../lib/types";

export type WritingImportMode = "create" | "overwrite";

export type WritingImportParsedPayload = {
  title: string;
  excerpt: string;
  slug: string;
  cover_media_id?: number;
  seo_title?: string;
  seo_description?: string;
  content_md: string;
  tags?: string[];
};

export type WritingImportPreviewMedia = {
  asset_id?: number;
  error_message?: string;
  media_asset_id?: number;
  media_kind?: string;
  original_path: string;
  replacement_ref: string;
  status: string;
};

export type WritingImportPreview = {
  blocking_errors?: string[];
  import_token: string;
  media: WritingImportPreviewMedia[];
  media_map: MediaMap;
  mode: WritingImportMode;
  parsed: WritingImportParsedPayload;
  target_writing_id?: number;
  warnings?: string[];
};

export type WritingImportCommittedWriting = {
  content_md: string;
  excerpt: string;
  id: number;
  media?: MediaMap;
  slug: string;
  status?: string;
  tags?: Array<{ name: string } | string>;
  title: string;
};

export type WritingImportCommitResult = {
  writing: WritingImportCommittedWriting;
};

export async function requestWritingImportPreview(input: {
  markdownFile: File;
  mediaFiles?: File[];
  mode: WritingImportMode;
  parseFrontMatter?: boolean;
  targetId?: number;
}) {
  const body = new FormData();
  body.append("markdown_file", input.markdownFile);
  body.append("mode", input.mode);
  if (input.parseFrontMatter === false) {
    body.append("parse_front_matter", "false");
  }
  if (input.targetId) {
    body.append("target_id", String(input.targetId));
  }
  for (const file of input.mediaFiles ?? []) {
    body.append("media_files[]", file);
    body.append("media_paths[]", file.webkitRelativePath || file.name);
  }
  return apiFetch<WritingImportPreview>("/api/admin/writing/imports/preview", {
    body,
    method: "POST",
  });
}

export async function restoreWritingImportPreview(importToken: string) {
  return apiFetch<WritingImportPreview>(`/api/admin/writing/imports/preview/${importToken}`);
}

export async function commitWritingImport(input: {
  importToken: string;
  payload: WritingImportParsedPayload;
}) {
  return apiFetch<WritingImportCommitResult>("/api/admin/writing/imports/commit", {
    body: JSON.stringify({
      import_token: input.importToken,
      payload: input.payload,
    }),
    method: "POST",
  });
}
