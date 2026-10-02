import { rewriteRemoteImageURLs } from "../../../lib/media";
import type { TextEdit, TextSelection } from "./editorTypes";

export type FormatAction =
  | "bold" | "italic" | "strike" | "inlineCode"
  | "quote" | "bulletList" | "orderedList" | "taskList"
  | "divider" | "heading1" | "heading2" | "heading3";

const inlineFormats = {
  bold: { marker: "**", placeholder: "加粗文本" },
  italic: { marker: "*", placeholder: "斜体文本" },
  strike: { marker: "~~", placeholder: "删除线文本" },
  inlineCode: { marker: "`", placeholder: "代码" },
} as const;

function normalizedSelection(value: string, selection: TextSelection): TextSelection {
  const clamp = (position: number) => Number.isFinite(position) ? Math.max(0, Math.min(value.length, Math.trunc(position))) : 0;
  const a = clamp(selection.from);
  const b = clamp(selection.to);
  return { from: Math.min(a, b), to: Math.max(a, b) };
}

function selectedEdit(from: number, to: number, insert: string, offset = 0, length = insert.length): TextEdit {
  return { from, to, insert, anchor: from + offset, head: from + offset + length };
}

function quoteParts(line: string) {
  const match = line.match(/^([ \t]*(?:>[ \t]*)*)(.*)$/)!;
  return { prefix: match[1], content: match[2] };
}

function listParts(line: string) {
  const quoted = quoteParts(line);
  const match = quoted.content.match(/^((?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)(.*)$/);
  return { ...quoted, marker: match?.[1] ?? "", content: match?.[2] ?? quoted.content };
}

function contentParts(line: string) {
  const listed = listParts(line);
  const heading = listed.content.match(/^(#{1,6}[ \t]+)(.*)$/);
  return {
    prefix: listed.prefix + listed.marker + (heading?.[1] ?? ""),
    content: heading?.[2] ?? listed.content,
  };
}

function codeFence(value: string, minimum: number) {
  let length = minimum;
  for (const match of value.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  return "`".repeat(length);
}

function unwrappedInline(value: string, marker: string): string | null {
  if (marker === "`") {
    const match = value.match(/^(`+)([\s\S]*?)\1$/);
    if (!match || !match[2] || match[2].startsWith("`") || match[2].endsWith("`")) return null;
    const inner = match[2];
    return inner.startsWith(" ") && inner.endsWith(" ") && inner.trim() ? inner.slice(1, -1) : inner;
  }
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const text = value.trim();
  const trailing = value.slice(leading.length + text.length);
  if (text.length < marker.length * 2 || !text.startsWith(marker) || !text.endsWith(marker)) return null;
  if (marker === "*" && (text.startsWith("**") || text.endsWith("**"))) return null;
  return leading + text.slice(marker.length, -marker.length) + trailing;
}

function wrapInline(content: string, marker: string) {
  if (marker !== "`") {
    const leading = content.match(/^\s*/)?.[0] ?? "";
    const text = content.trim();
    const trailing = content.slice(leading.length + text.length);
    if (!text) return { insert: content, offset: 0, length: content.length };
    return { insert: leading + marker + text + marker + trailing, offset: leading.length + marker.length, length: text.length };
  }
  const fence = codeFence(content, 1);
  const pad = content.startsWith("`") || content.endsWith("`") || (content.startsWith(" ") && content.endsWith(" ") && !!content.trim()) ? " " : "";
  return { insert: fence + pad + content + pad + fence, offset: fence.length + pad.length, length: content.length };
}

export function formatEdit(value: string, selection: TextSelection, action: FormatAction): TextEdit {
  const { from, to } = normalizedSelection(value, selection);
  if (action in inlineFormats) {
    const { marker, placeholder } = inlineFormats[action as keyof typeof inlineFormats];
    const selected = value.slice(from, to);
    if (!selected) {
      const wrapped = wrapInline(placeholder, marker);
      return selectedEdit(from, to, wrapped.insert, wrapped.offset, placeholder.length);
    }

    let outsideMarker: string = marker;
    if (marker === "`") {
      const paddedBefore = value.slice(0, from).match(/(`+) $/)?.[1];
      const paddedAfter = value.slice(to).match(/^ (`+)/)?.[1];
      if (paddedBefore && paddedBefore === paddedAfter && (selected.startsWith("`") || selected.endsWith("`") || (selected.startsWith(" ") && selected.endsWith(" ") && !!selected.trim()))) {
        return selectedEdit(from - paddedBefore.length - 1, to + paddedAfter.length + 1, selected);
      }
      const before = value.slice(0, from).match(/`+$/)?.[0];
      const after = value.slice(to).match(/^`+/)?.[0];
      outsideMarker = before && before === after ? before : "";
    }
    if (outsideMarker && value.slice(from - outsideMarker.length, from) === outsideMarker && value.slice(to, to + outsideMarker.length) === outsideMarker
      && !(marker === "*" && (value[from - 2] === "*" || value[to + 1] === "*"))) {
      return selectedEdit(from - outsideMarker.length, to + outsideMarker.length, selected);
    }

    if (!selected.includes("\n")) {
      const atLineStart = from === value.slice(0, from).lastIndexOf("\n") + 1;
      let parts = atLineStart ? contentParts(selected) : { prefix: "", content: selected };
      if (marker === "`" && !parts.prefix.trim()) parts = { prefix: "", content: selected };
      const content = parts.content || placeholder;
      const leading = marker === "`" ? "" : content.match(/^\s*/)?.[0] ?? "";
      const text = marker === "`" ? content : content.trim();
      const trailing = marker === "`" ? "" : content.slice(leading.length + text.length);
      const unwrapped = unwrappedInline(text, marker);
      if (unwrapped !== null) return selectedEdit(from, to, parts.prefix + leading + unwrapped + trailing, parts.prefix.length + leading.length, unwrapped.length);
      const wrapped = wrapInline(content, marker);
      return selectedEdit(from, to, parts.prefix + wrapped.insert, parts.prefix.length + wrapped.offset, wrapped.length);
    }

    const lines = selected.split(/(\r?\n)/);
    const contents = lines.filter((_, index) => index % 2 === 0 && !!lines[index].trim()).map((line) => contentParts(line).content);
    const remove = contents.length > 0 && contents.every((content) => unwrappedInline(content, marker) !== null);
    const insert = lines.map((line, index) => {
      if (index % 2 || !line.trim()) return line;
      const parts = contentParts(line);
      if (!parts.content) return line;
      return parts.prefix + (remove ? unwrappedInline(parts.content, marker)! : wrapInline(parts.content, marker).insert);
    }).join("");
    return selectedEdit(from, to, insert);
  }

  if (action === "divider") {
    const before = value.slice(0, from);
    const after = value.slice(to);
    const eol = value.includes("\r\n") ? "\r\n" : "\n";
    const prefix = before ? (before.endsWith(eol + eol) ? "" : before.endsWith(eol) ? eol : eol + eol) : "";
    const suffix = after ? (after.startsWith(eol + eol) ? "" : after.startsWith(eol) ? eol : eol + eol) : eol + eol;
    const insert = prefix + "---" + suffix;
    return selectedEdit(from, to, insert, insert.length, 0);
  }

  const lineFrom = value.slice(0, from).lastIndexOf("\n") + 1;
  const selectionEnd = to > from && value[to - 1] === "\n" ? to - 1 : to;
  const newline = value.indexOf("\n", selectionEnd);
  const lineTo = newline < 0 ? value.length : newline;
  const source = value.slice(lineFrom, lineTo);
  const lines = source.split(/(\r?\n)/);
  const nonempty = lines.filter((line, index) => index % 2 === 0 && !!line.trim());
  const headingLevel = action.startsWith("heading") ? Number(action.slice(-1)) : 0;
  const matchesAction = (line: string) => {
    const listed = listParts(line);
    if (headingLevel) return listed.content.match(/^(#{1,6})(?:[ \t]+|$)/)?.[1].length === headingLevel;
    if (action === "quote") return /^[ \t]*>/.test(line);
    if (action === "taskList") return /\[[ xX]\]/.test(listed.marker);
    if (action === "orderedList") return /^\d+[.)]/.test(listed.marker);
    return /^[-+*]/.test(listed.marker) && !/\[[ xX]\]/.test(listed.marker);
  };
  const remove = nonempty.length > 0 && nonempty.every(matchesAction);
  let number = 0;
  let placeholderOffset = -1;
  let resultLength = 0;
  const insert = lines.map((line, index) => {
    if (index % 2 || (!line.trim() && nonempty.length > 0)) {
      resultLength += line.length;
      return line;
    }
    const carriage = line.endsWith("\r") ? "\r" : "";
    const original = carriage ? line.slice(0, -1) : line;
    const listed = listParts(original);
    let formatted: string;
    if (headingLevel) {
      const content = listed.content.replace(/^#{1,6}(?:[ \t]+|$)/, "");
      const marker = remove ? "" : "#".repeat(headingLevel) + " ";
      formatted = listed.prefix + listed.marker + marker + (content || "标题");
      if (!content) placeholderOffset = resultLength + formatted.length - 2;
    } else if (action === "quote") {
      if (remove) formatted = original.replace(/^([ \t]*)>[ \t]?/, "$1");
      else {
        formatted = original.replace(/^([ \t]*)(.*)$/, (_, indent, content) => indent + "> " + (content || "引用文本"));
        if (!original.trim()) placeholderOffset = resultLength + formatted.length - 4;
      }
    } else {
      number += 1;
      const marker = remove ? "" : action === "orderedList" ? `${number}. ` : action === "taskList" ? "- [ ] " : "- ";
      formatted = listed.prefix + marker + (listed.content || "列表项");
      if (!listed.content) placeholderOffset = resultLength + formatted.length - 3;
    }
    formatted += carriage;
    resultLength += formatted.length;
    return formatted;
  }).join("");
  if (placeholderOffset >= 0 && !source.trim()) {
    const placeholderLength = headingLevel ? 2 : action === "quote" ? 4 : 3;
    return selectedEdit(lineFrom, lineTo, insert, placeholderOffset, placeholderLength);
  }
  return selectedEdit(lineFrom, lineTo, insert);
}

export function tableMarkdown(rows: number, columns: number): string {
  const bound = (value: number, max: number) => Number.isFinite(value) ? Math.max(1, Math.min(max, Math.trunc(value))) : 1;
  const count = bound(columns, 10);
  const row = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [
    row(Array.from({ length: count }, (_, index) => `列 ${index + 1}`)),
    row(Array.from({ length: count }, () => "---")),
    ...Array.from({ length: bound(rows, 20) }, () => row(Array.from({ length: count }, () => "内容"))),
  ].join("\n");
}

export function codeBlockMarkdown(language: string, code: string): string {
  const languageName = language.trim().split(/\s/)[0].replace(/[^a-zA-Z0-9_+#.-]/g, "").slice(0, 40);
  const fence = codeFence(code, 3);
  return `${fence}${languageName}\n${code}${code.endsWith("\n") ? "" : "\n"}${fence}`;
}

export function linkMarkdown(label: string, url: string, image = false): string {
  const destination = url.trim();
  if (!destination || /[\p{Cc}\\<>]/u.test(destination) || /^(?:\/\/)/.test(destination) || /&(?:#|colon;|tab;|newline;)/i.test(destination)) return "";
  const scheme = destination.match(/^([a-z][a-z0-9+.-]*):/i)?.[1].toLowerCase();
  if (scheme) {
    if (!["http", "https", "mailto", "media"].includes(scheme)) return "";
    if (scheme === "media" && !/^media:\/\/asset\/\d+\/[a-z_][a-z0-9_-]*$/i.test(destination)) return "";
    if (scheme === "mailto" && !/^mailto:[^\s@]+@[^\s@]+/i.test(destination)) return "";
    if (scheme === "http" || scheme === "https") {
      try {
        const parsed = new URL(destination);
        if (!parsed.hostname || !/^https?:\/\//i.test(destination)) return "";
      } catch {
        return "";
      }
    }
  } else if (/^[^/?#]*:/.test(destination)) {
    return "";
  }
  const escapedLabel = label.replace(/[\r\n]+/g, " ").replace(/[\\[\]]/g, "\\$&");
  const escapedURL = destination.replace(/[\s()[\]"']/g, (character) => encodeURIComponent(character).replace(/[()']/g, (part) => `%${part.charCodeAt(0).toString(16).toUpperCase()}`));
  return `${image ? "!" : ""}[${escapedLabel}](${escapedURL})`;
}

function headingText(value: string): string {
  return value.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]*>/g, "").replace(/[`*_~]/g, "").replace(/\\([\p{P}\p{S}])/gu, "$1").trim();
}

export function extractOutline(value: string): Array<{ level: number; text: string; line: number }> {
  const result: Array<{ level: number; text: string; line: number }> = [];
  const lines = value.split(/\r\n|\n|\r/);
  let fence: { character: string; length: number } | null = null;
  let previousText: { text: string; line: number } | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) fence = null;
      previousText = null;
      continue;
    }
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (opening && !(opening[1][0] === "`" && opening[2].includes("`"))) {
      fence = { character: opening[1][0], length: opening[1].length };
      previousText = null;
      continue;
    }
    const heading = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/);
    if (heading) {
      result.push({ level: heading[1].length, text: headingText((heading[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "")), line: index + 1 });
      previousText = null;
      continue;
    }
    const underline = line.match(/^ {0,3}(=+|-+)[ \t]*$/);
    if (underline && previousText) {
      result.push({ level: underline[1][0] === "=" ? 1 : 2, text: headingText(previousText.text), line: previousText.line });
      previousText = null;
      continue;
    }
    previousText = line.trim() && !/^ {4}|^\t|^ {0,3}(?:>|[-+*][ \t]|\d+[.)][ \t]|#{1,6}(?:[ \t]|$))/.test(line)
      ? { text: line.trim(), line: index + 1 }
      : null;
  }
  return result;
}

export function documentStats(value: string): { characters: number; words: number; lines: number; readingMinutes: number } {
  const chinese = value.match(/\p{Script=Han}/gu)?.length ?? 0;
  const words = value.replace(/\p{Script=Han}/gu, " $& ").match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  return {
    characters: Array.from(value).length,
    words,
    lines: value.split(/\r\n|\n|\r/).length,
    readingMinutes: Math.ceil(chinese / 400 + (words - chinese) / 200),
  };
}

export function normalizeLooseImageReferences(value: string): string {
  // Legacy split image references are prose; never rewrite examples inside code.
  const codeRanges: Array<[number, number]> = [];
  let fence: { start: number; character: string; length: number } | null = null;
  for (const match of value.matchAll(/[^\n]*(?:\n|$)/g)) {
    const line = match[0].replace(/\r?\n$/, "");
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) {
        codeRanges.push([fence.start, match.index + match[0].length]);
        fence = null;
      }
    } else if (marker && !(marker[1][0] === "`" && marker[2].includes("`"))) {
      fence = { start: match.index, character: marker[1][0], length: marker[1].length };
    } else if (/^(?: {4}|\t)/.test(line)) codeRanges.push([match.index, match.index + match[0].length]);
  }
  if (fence) codeRanges.push([fence.start, value.length]);
  for (const match of value.matchAll(/(`+)([\s\S]*?)\1(?!`)/g)) codeRanges.push([match.index, match.index + match[0].length]);
  return value.replace(
    /!\[([^\]\r\n]*)\][ \t]*(?:\r?\n[ \t]*)+\((https?:\/\/[^\s)]+|media:\/\/asset\/\d+\/[a-zA-Z0-9_-]+)\)/g,
    (match: string, label: string, url: string, offset: number) => codeRanges.some(([from, to]) => offset < to && offset + match.length > from) ? match : `![${label}](${url})`,
  );
}

export function markdownPreviewSource(value: string): string {
  return rewriteRemoteImageURLs(normalizeLooseImageReferences(value)).replace(/media:\/\/asset\/(\d+)\/([a-zA-Z0-9_-]+)/g, "/media/$1/$2");
}
