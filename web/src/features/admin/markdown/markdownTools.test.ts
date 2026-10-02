import { describe, expect, it } from "vitest";

import {
  codeBlockMarkdown,
  documentStats,
  extractOutline,
  formatEdit,
  linkMarkdown,
  markdownPreviewSource,
  tableMarkdown,
} from "./markdownTools";
import type { TextEdit } from "./editorTypes";

function apply(value: string, edit: TextEdit) {
  return value.slice(0, edit.from) + edit.insert + value.slice(edit.to);
}

describe("Markdown formatting", () => {
  it("wraps a selection and toggles markers around or inside the selection", () => {
    expect(apply("Hello world", formatEdit("Hello world", { from: 6, to: 11 }, "bold"))).toBe("Hello **world**");
    expect(apply("Hello **world**", formatEdit("Hello **world**", { from: 8, to: 13 }, "bold"))).toBe("Hello world");
    expect(apply("Hello **world**", formatEdit("Hello **world**", { from: 6, to: 15 }, "bold"))).toBe("Hello world");
  });

  it("selects a useful placeholder after insertion at an empty cursor", () => {
    const edit = formatEdit("正文", { from: 2, to: 2 }, "bold");
    const result = apply("正文", edit);
    expect(result).toBe("正文**加粗文本**");
    expect(result.slice(edit.anchor, edit.head)).toBe("加粗文本");
  });

  it("formats multiline contents while preserving quote and list prefixes", () => {
    const value = "> - 第一行\n> - 第二行\n\n# 标题";
    expect(apply(value, formatEdit(value, { from: 0, to: value.length }, "bold"))).toBe("> - **第一行**\n> - **第二行**\n\n# **标题**");
  });

  it("changes headings at line boundaries and keeps list indentation", () => {
    const value = "before\n  - ### item\nafter";
    expect(apply(value, formatEdit(value, { from: 16, to: 16 }, "heading2"))).toBe("before\n  - ## item\nafter");
    expect(apply("## Title", formatEdit("## Title", { from: 4, to: 7 }, "heading2"))).toBe("Title");
  });

  it("does not include a following line when selection ends at its start", () => {
    expect(apply("one\ntwo", formatEdit("one\ntwo", { from: 0, to: 4 }, "bulletList"))).toBe("- one\ntwo");
  });

  it("converts lists without doubled markers and toggles task markers", () => {
    const value = "  - first\n  - [x] second\n\n  3. third";
    expect(apply(value, formatEdit(value, { from: 0, to: value.length }, "orderedList"))).toBe("  1. first\n  2. second\n\n  3. third");
    expect(apply("- [ ] first\n- [x] second", formatEdit("- [ ] first\n- [x] second", { from: 0, to: 24 }, "taskList"))).toBe("first\nsecond");
  });

  it("keeps blank lines unchanged and supports CRLF documents", () => {
    const value = "one\r\n\r\ntwo";
    expect(apply(value, formatEdit(value, { from: 0, to: value.length }, "quote"))).toBe("> one\r\n\r\n> two");
  });

  it("inserts a block divider without merging with surrounding paragraphs", () => {
    const value = "beforeafter";
    expect(apply(value, formatEdit(value, { from: 6, to: 6 }, "divider"))).toBe("before\n\n---\n\nafter");
  });

  it("uses safe inline-code delimiters when content contains backticks", () => {
    expect(apply("a`b", formatEdit("a`b", { from: 0, to: 3 }, "inlineCode"))).toBe("``a`b``");
    expect(apply("**bold**", formatEdit("**bold**", { from: 0, to: 8 }, "italic"))).toBe("***bold***");
  });

  it("keeps selection whitespace outside emphasis and selects only the formatted text", () => {
    const value = " hello ";
    const edit = formatEdit(value, { from: 0, to: value.length }, "bold");
    const result = apply(value, edit);
    expect(result).toBe(" **hello** ");
    expect(result.slice(edit.anchor, edit.head)).toBe("hello");
    expect(apply(result, formatEdit(result, { from: edit.anchor!, to: edit.head! }, "bold"))).toBe(value);
    const multiline = "one \ntwo ";
    const multilineEdit = formatEdit(multiline, { from: 0, to: multiline.length }, "italic");
    const formattedLines = apply(multiline, multilineEdit);
    expect(formattedLines).toBe("*one* \n*two* ");
    expect(apply(formattedLines, formatEdit(formattedLines, { from: multilineEdit.anchor!, to: multilineEdit.head! }, "italic"))).toBe(multiline);
  });

  it("preserves single-line headings and list markers when formatting their full line", () => {
    const value = "# Title";
    const edit = formatEdit(value, { from: 0, to: value.length }, "bold");
    const result = apply(value, edit);
    expect(result).toBe("# **Title**");
    expect(result.slice(edit.anchor, edit.head)).toBe("Title");
    expect(apply(result, formatEdit(result, { from: 0, to: result.length }, "bold"))).toBe(value);
    expect(apply("> - item", formatEdit("> - item", { from: 0, to: 8 }, "italic"))).toBe("> - *item*");
    expect(apply("literal # tag", formatEdit("literal # tag", { from: 8, to: 13 }, "bold"))).toBe("literal **# tag**");
  });

  it.each(["`a", "a`", "`a`b", " a "])("toggles code around the maintained selection even with padding: %s", (value) => {
    const first = formatEdit(value, { from: 0, to: value.length }, "inlineCode");
    const formatted = apply(value, first);
    expect(formatted.slice(first.anchor, first.head)).toBe(value);
    const second = formatEdit(formatted, { from: first.anchor!, to: first.head! }, "inlineCode");
    expect(apply(formatted, second)).toBe(value);
  });
});

describe("Markdown insertion", () => {
  it("creates bounded tables with the requested number of body rows", () => {
    expect(tableMarkdown(2, 2)).toBe("| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n| 内容 | 内容 |");
    expect(tableMarkdown(100, 100).split("\n")).toHaveLength(22);
    expect(tableMarkdown(0, 0).split("\n")).toHaveLength(3);
    expect(tableMarkdown(Number.NaN, Number.POSITIVE_INFINITY).split("\n")).toHaveLength(3);
  });

  it("chooses a longer code fence than anything in the inserted code", () => {
    expect(codeBlockMarkdown("typescript", "const x = 1;")).toBe("```typescript\nconst x = 1;\n```");
    expect(codeBlockMarkdown("js\n``` injected", "```\nx\n````")).toBe("`````js\n```\nx\n````\n`````");
  });

  it("escapes labels and destinations without breaking valid existing escapes", () => {
    expect(linkMarkdown("a[b]", "https://example.com/a (b)[c]")).toBe("[a\\[b\\]](https://example.com/a%20%28b%29%5Bc%5D)");
    expect(linkMarkdown("封面", "media://asset/12/card", true)).toBe("![封面](media://asset/12/card)");
    expect(linkMarkdown("下载", "../files/my file.pdf")).toBe("[下载](../files/my%20file.pdf)");
    expect(linkMarkdown("联系", "mailto:me@example.com")).toBe("[联系](mailto:me@example.com)");
    expect(linkMarkdown("目录", "#hello")).toBe("[目录](#hello)");
  });

  it.each([
    "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,evil", "vbscript:evil", "file:///etc/passwd",
    "java\nscript:alert(1)", "//evil.test/x", "\\\\evil.test/x", "javascript&#58;alert(1)",
    "https://", "media://asset/abc/card", "media://asset/1/card?x", "",
  ])("rejects an unsafe or invalid destination: %s", (url) => {
    expect(linkMarkdown("link", url)).toBe("");
  });
});

describe("Markdown document helpers", () => {
  it("does not normalize loose image references inside code examples", () => {
    const source = "```md\n![示例]\n(https://example.com/code.png)\n```\n\n![图片]\n(https://example.com/real.png)";
    expect(markdownPreviewSource(source)).toBe("```md\n![示例]\n(https://example.com/code.png)\n```\n\n![图片](https://example.com/real.png)");
  });
  it("extracts real headings and ignores fenced code with either fence style", () => {
    const value = "# Intro\n```md\n## fake\n````\n~~~\n# also fake\n~~~\n  ### Real **title** ###\n####### too deep\nTitle\n-----\n#no-space";
    expect(extractOutline(value)).toEqual([
      { level: 1, text: "Intro", line: 1 },
      { level: 3, text: "Real title", line: 8 },
      { level: 2, text: "Title", line: 10 },
    ]);
  });

  it("does not end a code fence with a shorter fence or a trailing language", () => {
    expect(extractOutline("````\n```\n# fake\n````oops\n# fake too\n````\n# Real")).toEqual([{ level: 1, text: "Real", line: 7 }]);
  });

  it("counts Chinese characters and English words without splitting emoji", () => {
    expect(documentStats("你好 hello world 👋")).toEqual({ characters: 16, words: 4, lines: 1, readingMinutes: 1 });
    expect(documentStats("")).toEqual({ characters: 0, words: 0, lines: 1, readingMinutes: 0 });
    expect(documentStats("你好world\nnext").words).toBe(4);
    expect(documentStats("中文".repeat(201)).readingMinutes).toBe(2);
  });

  it("keeps existing loose-image, GitHub image and media previews working", () => {
    expect(markdownPreviewSource("![cover]\n(https://raw.githubusercontent.com/owner/repo/main/cover.png)\n![media](media://asset/12/card)"))
      .toBe("![cover](https://cdn.jsdelivr.net/gh/owner/repo@main/cover.png)\n![media](/media/12/card)");
  });
});
