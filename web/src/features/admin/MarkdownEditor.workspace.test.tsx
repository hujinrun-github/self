import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithApp } from "../../test/render";
import { MarkdownEditor } from "./MarkdownEditor";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function Workspace({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <><MarkdownEditor id="workspace-body" label="Markdown 正文" value={value} onChange={setValue} /><output data-testid="document-value">{value}</output></>;
}

describe("Markdown writing workspace", () => {
  it("uses compact tools in a wide but short touch viewport and restores split mode after resizing", async () => {
    const matchMedia = window.matchMedia;
    const media = Object.assign(new EventTarget(), {
      matches: false,
      media: "(max-width: 720px), (max-height: 500px) and (pointer: coarse)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
    });
    vi.spyOn(window, "matchMedia").mockImplementation((query) => query === media.media ? media : matchMedia(query));
    const original = "# 横屏写作\n\n保留正文和编辑模式";
    renderWithApp(<Workspace initial={original} />);
    const editor = await screen.findByRole("textbox", { name: "Markdown 正文" });
    expect(screen.getByRole("tab", { name: "分屏" })).toHaveAttribute("aria-selected", "true");
    act(() => { media.matches = true; media.dispatchEvent(new Event("change")); });
    expect(screen.queryByRole("tab", { name: "分屏" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更多工具" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("textbox", { name: "Markdown 正文" })).toBe(editor);
    act(() => { media.matches = false; media.dispatchEvent(new Event("change")); });
    expect(screen.getByRole("tab", { name: "分屏" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Markdown 预览" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Markdown 正文" })).toBe(editor);
    expect(screen.getByTestId("document-value").textContent).toBe(original);
  });

  it("offers three usable phone modes and keeps less common tools in an expandable panel", async () => {
    const matchMedia = window.matchMedia;
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({ ...matchMedia(query), matches: query.startsWith("(max-width: 720px)") }));
    renderWithApp(<Workspace initial={"# 手机上写作\n\n保留正文"} />);
    await screen.findByRole("textbox", { name: "Markdown 正文" });
    expect(screen.queryByRole("tab", { name: "分屏" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "源码" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "更多工具" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "插入表格" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "更多工具" }));
    expect(screen.getByRole("button", { name: "收起工具" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "插入表格" })).toBeVisible();
    await userEvent.click(screen.getByRole("tab", { name: "预览" }));
    expect(screen.getByRole("region", { name: "Markdown 预览" })).toBeVisible();
    expect(screen.getByRole("button", { name: "更多工具" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("document-value").textContent).toBe("# 手机上写作\n\n保留正文");
  });

  it("inserts from phone tools and preserves undo history when those tools are collapsed", async () => {
    const matchMedia = window.matchMedia;
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({ ...matchMedia(query), matches: query.startsWith("(max-width: 720px)") }));
    renderWithApp(<Workspace initial="保留正文" />);
    await screen.findByRole("textbox", { name: "Markdown 正文" });
    await userEvent.click(screen.getByRole("button", { name: "更多工具" }));
    await userEvent.click(screen.getByRole("button", { name: "插入表格" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "插入表格" })).getByRole("button", { name: "插入表格" }));
    expect(screen.getByTestId("document-value")).toHaveTextContent("列 1");
    expect(screen.getByTestId("document-value")).toHaveTextContent("保留正文");
    expect(screen.queryByRole("button", { name: "插入表格" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByTestId("document-value").textContent).toBe("保留正文");
  });

  it("keeps insertion dialogs inside the visible viewport as a phone keyboard opens", async () => {
    const viewport = Object.assign(new EventTarget(), { height: 720, offsetTop: 0, scale: 1 });
    const removeListener = vi.spyOn(viewport, "removeEventListener");
    vi.stubGlobal("visualViewport", viewport);
    renderWithApp(<Workspace initial="保留正文" />);
    await userEvent.click(screen.getByRole("button", { name: "插入链接" }));
    const dialog = screen.getByRole("dialog", { name: "插入链接" });
    expect(dialog.parentElement).toHaveStyle({ height: "720px", top: "0px" });
    viewport.height = 280;
    viewport.offsetTop = 120;
    viewport.dispatchEvent(new Event("resize"));
    expect(dialog.parentElement).toHaveStyle({ height: "280px", top: "120px" });
    await userEvent.click(within(dialog).getByRole("button", { name: "关闭插入链接" }));
    expect(screen.queryByRole("dialog", { name: "插入链接" })).not.toBeInTheDocument();
    expect(removeListener).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(document.body.style.overflow).toBe("");
  });

  it("offers an editable rich mode without rewriting untouched Markdown on mode switches", async () => {
    const original = "# 标题\n\n**重点** 和普通正文。";
    renderWithApp(<Workspace initial={original} />);
    await userEvent.click(screen.getByRole("tab", { name: "所见即所得" }));
    const rich = await screen.findByRole("textbox", { name: "Markdown 正文（所见即所得）" }, { timeout: 5000 });
    expect(within(rich).getByRole("heading", { name: "标题" })).toBeInTheDocument();
    expect(rich.querySelector("strong")).toHaveTextContent("重点");
    expect(rich).toHaveAttribute("contenteditable", "true");
    await userEvent.click(screen.getByRole("tab", { name: "源码" }));
    expect(screen.getByTestId("document-value").textContent).toBe(original);
  });

  it("keeps the rich editor instance and history alive through fullscreen", async () => {
    renderWithApp(<Workspace initial="保留正文" />);
    await userEvent.click(screen.getByRole("tab", { name: "所见即所得" }));
    const rich = await screen.findByRole("textbox", { name: "Markdown 正文（所见即所得）" }, { timeout: 5000 });
    await userEvent.click(screen.getByRole("button", { name: "分隔线" }));
    await userEvent.click(screen.getByRole("button", { name: "全屏写作" }));
    expect(screen.getByRole("textbox", { name: "Markdown 正文（所见即所得）" })).toBe(rich);
    await userEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByTestId("document-value").textContent).not.toContain("---");
    expect(rich).toHaveTextContent("保留正文");
    await userEvent.click(screen.getByRole("button", { name: "退出全屏" }));
    expect(screen.getByRole("textbox", { name: "Markdown 正文（所见即所得）" })).toBe(rich);
  });

  it("never submits the parent article form when an insertion dialog is submitted", async () => {
    const saveArticle = vi.fn((event: React.FormEvent) => event.preventDefault());
    renderWithApp(<form onSubmit={saveArticle}><Workspace /></form>);
    await screen.findByRole("textbox", { name: "Markdown 正文" });
    await userEvent.click(screen.getByRole("button", { name: "插入表格" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "插入表格" })).getByRole("button", { name: "插入表格" }));
    expect(saveArticle).not.toHaveBeenCalled();
    expect(screen.getByTestId("document-value")).toHaveTextContent("列 1");
  });

  it("switches writing modes without changing the document", async () => {
    renderWithApp(<Workspace initial="# 标题\n\n正文" />);
    await userEvent.click(screen.getByRole("tab", { name: "预览" }));
    expect(screen.getByRole("region", { name: "Markdown 预览" })).toBeVisible();
    await userEvent.click(screen.getByRole("tab", { name: "源码" }));
    expect(await screen.findByRole("textbox", { name: "Markdown 正文" })).toBeVisible();
    expect(screen.getByTestId("document-value")).toHaveTextContent("# 标题");
  });

  it("keeps preview heading anchors aligned with source lines after split image references", () => {
    renderWithApp(<Workspace initial={'![图片]\n(https://example.com/image.png)\n\n# 图片之后'} />);
    expect(screen.getByRole("heading", { name: "图片之后" })).toHaveAttribute("id", "workspace-body-line-4");
  });

  it("inserts a table with the requested dimensions through the toolbar", async () => {
    renderWithApp(<Workspace />);
    await screen.findByRole("textbox", { name: "Markdown 正文" });
    await userEvent.click(screen.getByRole("button", { name: "插入表格" }));
    const dialog = screen.getByRole("dialog", { name: "插入表格" });
    const rows = within(dialog).getByLabelText("正文行数");
    await userEvent.clear(rows);
    await userEvent.type(rows, "2");
    await userEvent.click(within(dialog).getByRole("button", { name: "插入表格" }));
    expect(screen.getByTestId("document-value").textContent).toContain("|");
    expect(screen.getByTestId("document-value").textContent?.trim().split("\n")).toHaveLength(4);
  });

  it("rejects unsafe link URLs without changing the document", async () => {
    renderWithApp(<Workspace initial="保留正文" />);
    await userEvent.click(screen.getByRole("button", { name: "插入链接" }));
    const dialog = screen.getByRole("dialog", { name: "插入链接" });
    await userEvent.type(within(dialog).getByLabelText("链接地址"), "javascript:alert(1)");
    await userEvent.click(within(dialog).getByRole("button", { name: "插入链接" }));
    expect(screen.getByRole("alert")).toHaveTextContent("有效");
    expect(screen.getByTestId("document-value")).toHaveTextContent("保留正文");
  });

  it("renders a safe preview and keeps code-fence headings out of the outline", async () => {
    renderWithApp(<Workspace initial={'# 真正标题\n\n```md\n# 示例标题\n```\n\n[危险](javascript:alert(1))\n\n<iframe src="https://example.com"></iframe>'} />);
    const preview = await screen.findByRole("region", { name: "Markdown 预览" });
    expect(preview.querySelector("iframe, script, a[href^='javascript:']")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "文档目录" }));
    const outline = screen.getByRole("navigation", { name: "文档目录" });
    expect(within(outline).getByRole("button", { name: "真正标题" })).toBeInTheDocument();
    expect(within(outline).queryByRole("button", { name: "示例标题" })).not.toBeInTheDocument();
  });
});
