import { Editor, editorViewCtx } from "@milkdown/core";
import { TextSelection } from "@milkdown/prose/state";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, StrictMode, useState } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { RichEditor } from "./RichEditor";
import type { RichEditorHandle, RichEditorProps } from "./richEditorTypes";

beforeAll(() => {
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
  HTMLElement.prototype.scrollIntoView ??= () => {};
});
let instances: Editor[];
beforeEach(() => {
  instances = [];
  const make = Editor.make;
  vi.spyOn(Editor, "make").mockImplementation(() => {
    const editor = make();
    instances.push(editor);
    return editor;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function setup(overrides: Partial<RichEditorProps> = {}) {
  const ref = createRef<RichEditorHandle>();
  const props: RichEditorProps = {
    id: "rich-source", label: "可视化正文", value: "# 标题\n\n正文", fontSize: 16, onChange: vi.fn(), ...overrides,
  };
  const rendered = render(<RichEditor {...props} ref={ref} />);
  const textbox = await screen.findByRole("textbox", { name: props.label });
  await waitFor(() => expect(screen.queryByText("正在准备可视化编辑器…")).not.toBeInTheDocument());
  const view = () => instances.at(-1)!.action((ctx) => ctx.get(editorViewCtx));
  return { ...rendered, props, ref, textbox, view };
}

describe("RichEditor", () => {
  it("inserts code and table blocks without flattening them into the current paragraph", async () => {
    const editor = await setup({ value: "原有正文" });
    act(() => editor.view().dispatch(editor.view().state.tr.setSelection(TextSelection.atEnd(editor.view().state.doc))));
    act(() => editor.ref.current!.insertMarkdown("```go\npackage main\n```", true, true));
    expect(editor.textbox.querySelector("pre code")).toHaveTextContent("package main");
    expect(editor.textbox).toHaveTextContent("原有正文");
    act(() => editor.ref.current!.insertMarkdown("| 名称 | 内容 |\n| --- | --- |\n| A | B |", true, true));
    expect(editor.textbox.querySelector("table")).toHaveTextContent("名称");
    expect(editor.textbox.querySelector("pre code")).toHaveTextContent("package main");
    expect(editor.props.onChange).toHaveBeenLastCalledWith(expect.stringContaining("```go"));
  });

  it("renders real GFM content without rewriting the source on mount", async () => {
    const source = '# 标题\n\n- [ ] 待办\n\n| 名称 | 状态 |\n| --- | --- |\n| a | b |\n\n```js title="sample.js"\nconst x = 1\n```\n\n![封面](media://asset/12/card)';
    const editor = await setup({ value: source });
    expect(editor.textbox.querySelector("table")).toBeInTheDocument();
    expect(editor.textbox.querySelector('input[type="checkbox"]')).not.toBeChecked();
    expect(editor.textbox.querySelector("pre code")).toHaveTextContent("const x = 1");
    expect(editor.textbox.querySelector('img[alt="封面"]')).toHaveAttribute("src", "/media/12/card");
    expect(editor.props.onChange).not.toHaveBeenCalled();
    act(() => editor.ref.current!.insertMarkdown("\n\n新增内容"));
    const emitted = vi.mocked(editor.props.onChange).mock.calls.at(-1)![0];
    expect(emitted).toContain('title="sample.js"');
    expect(emitted).toContain("media://asset/12/card");
    expect(emitted).toContain("[ ] 待办");
    expect(emitted).toContain("| 名称");
  });

  it("formats a real selection, reports Markdown synchronously, and supports undo and redo", async () => {
    const editor = await setup({ value: "hello world" });
    act(() => editor.view().dispatch(editor.view().state.tr.setSelection(TextSelection.create(editor.view().state.doc, 1, 6))));
    expect(editor.ref.current!.getSelectedText()).toBe("hello");
    act(() => editor.ref.current!.format("bold"));
    expect(editor.textbox.querySelector("strong")).toHaveTextContent("hello");
    expect(editor.props.onChange).toHaveBeenLastCalledWith(expect.stringContaining("**hello** world"));
    act(() => editor.ref.current!.undo());
    expect(editor.textbox.querySelector("strong")).not.toBeInTheDocument();
    act(() => editor.ref.current!.redo());
    expect(editor.textbox.querySelector("strong")).toHaveTextContent("hello");
  });

  it.each([
    ["italic", "em"], ["strike", "del"], ["inlineCode", "code"], ["quote", "blockquote"],
    ["bulletList", "ul"], ["orderedList", "ol"], ["taskList", 'input[type="checkbox"]'],
    ["heading1", "h1"], ["heading2", "h2"], ["heading3", "h3"], ["divider", "hr"],
  ] as const)("applies the %s toolbar command to the editable document", async (action, selector) => {
    const editor = await setup({ value: "正文" });
    act(() => editor.view().dispatch(editor.view().state.tr.setSelection(TextSelection.create(editor.view().state.doc, 1, 3))));
    act(() => editor.ref.current!.format(action));
    expect(editor.textbox.querySelector(selector)).toBeInTheDocument();
    expect(editor.props.onChange).toHaveBeenCalled();
  });

  it("inserts links into a selection and keeps media protocols when inserting images", async () => {
    const editor = await setup({ value: "hello world" });
    act(() => editor.view().dispatch(editor.view().state.tr.setSelection(TextSelection.create(editor.view().state.doc, 1, 6))));
    act(() => editor.ref.current!.insertMarkdown("[hello](https://example.com)"));
    expect(editor.textbox.querySelector("a")).toHaveTextContent("hello");
    expect(editor.textbox).toHaveTextContent("hello world");
    act(() => editor.ref.current!.insertMarkdown("![封面]\n(media://asset/99/card)", false));
    expect(editor.textbox.querySelector('img[alt="封面"]')).toHaveAttribute("src", "/media/99/card");
    expect(editor.props.onChange).toHaveBeenLastCalledWith(expect.stringContaining("media://asset/99/card"));
  });

  it("synchronizes external values without emitting or polluting undo", async () => {
    const editor = await setup({ value: "原文" });
    editor.rerender(<RichEditor {...editor.props} value="# 外部标题\n\n新正文" ref={editor.ref} />);
    await waitFor(() => expect(editor.textbox.querySelector("h1")).toHaveTextContent("外部标题"));
    expect(editor.props.onChange).not.toHaveBeenCalled();
    act(() => editor.ref.current!.undo());
    expect(editor.textbox).toHaveTextContent("新正文");
  });

  it("keeps source echoes and consecutive composition-like inserts intact", async () => {
    const onChange = vi.fn();
    const ref = createRef<RichEditorHandle>();
    function Controlled() {
      const [value, setValue] = useState("");
      return <RichEditor id="controlled-rich" label="受控富文本" value={value} fontSize={16} ref={ref} onChange={(next) => { onChange(next); setValue(next); }} />;
    }
    render(<Controlled />);
    const textbox = await screen.findByRole("textbox", { name: "受控富文本" });
    await waitFor(() => expect(screen.queryByText("正在准备可视化编辑器…")).not.toBeInTheDocument());
    const view = instances.at(-1)!.action((ctx) => ctx.get(editorViewCtx));
    for (const text of ["中文", "连续输入", "测试"]) act(() => view.dispatch(view.state.tr.insertText(text)));
    expect(textbox).toHaveTextContent("中文连续输入测试");
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining("中文连续输入测试"));
  });

  it("preserves HTML as inert text and prevents unsafe or editable link navigation", async () => {
    const editor = await setup({ value: '<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[危险](javascript:alert%281%29) [安全](https://example.com)' });
    expect(editor.textbox.querySelector("script")).toBeNull();
    expect(editor.textbox.querySelector("img[onerror]")).toBeNull();
    expect(editor.textbox).toHaveTextContent("<script>alert(1)</script>");
    expect(editor.textbox.querySelector('a[href^="javascript:"]')).toBeNull();
    const link = screen.getByText("安全");
    expect(fireEvent.click(link)).toBe(false);
    act(() => editor.ref.current!.insertMarkdown("\n\n继续"));
    expect(editor.props.onChange).toHaveBeenLastCalledWith(expect.stringContaining("<script>alert(1)</script>"));
  });

  it("toggles task checkboxes through an undoable document transaction", async () => {
    const editor = await setup({ value: "- [ ] 写作任务" });
    fireEvent.click(screen.getByRole("checkbox", { name: "完成任务" }));
    expect(screen.getByRole("checkbox", { name: "完成任务" })).toBeChecked();
    expect(editor.props.onChange).toHaveBeenLastCalledWith(expect.stringContaining("[x] 写作任务"));
    act(() => editor.ref.current!.undo());
    expect(screen.getByRole("checkbox", { name: "完成任务" })).not.toBeChecked();
  });

  it("toggles task formatting off and back on without losing list text", async () => {
    const editor = await setup({ value: "- [x] 写作任务" });
    act(() => editor.ref.current!.format("taskList"));
    expect(screen.queryByRole("checkbox", { name: "完成任务" })).not.toBeInTheDocument();
    expect(editor.textbox.querySelector("ul li")).toHaveTextContent("写作任务");
    expect(editor.props.onChange).toHaveBeenLastCalledWith(expect.not.stringContaining("[x]"));
    act(() => editor.ref.current!.format("taskList"));
    expect(screen.getByRole("checkbox", { name: "完成任务" })).not.toBeChecked();
    expect(editor.textbox).toHaveTextContent("写作任务");
  });

  it("switches an existing bullet list to numbered and back without nesting or losing items", async () => {
    const editor = await setup({ value: "- 第一项\n- 第二项" });
    act(() => editor.ref.current!.format("orderedList"));
    expect(editor.textbox.querySelectorAll("ol > li")).toHaveLength(2);
    expect(editor.textbox.querySelector("ul")).not.toBeInTheDocument();
    act(() => editor.ref.current!.format("bulletList"));
    expect(editor.textbox.querySelectorAll("ul > li")).toHaveLength(2);
    expect(editor.textbox.querySelector("ol")).not.toBeInTheDocument();
    expect(editor.textbox).toHaveTextContent("第一项");
    expect(editor.textbox).toHaveTextContent("第二项");
  });

  it("delegates images and link shortcuts while preserving real heading navigation", async () => {
    const onImagePaste = vi.fn();
    const onLinkShortcut = vi.fn();
    const editor = await setup({ onImagePaste, onLinkShortcut, value: "# 第一节\n\n内容\n\n## 第二节" });
    const file = new File(["png"], "image.png", { type: "image/png" });
    expect(fireEvent.paste(editor.textbox, { clipboardData: { files: [file] } })).toBe(false);
    expect(fireEvent.drop(editor.textbox, { dataTransfer: { files: [file] } })).toBe(false);
    expect(onImagePaste).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(editor.textbox, { key: "k", ctrlKey: true });
    expect(onLinkShortcut).toHaveBeenCalledTimes(1);
    act(() => editor.ref.current!.goToHeading(1));
    expect(editor.view().state.selection.$from.parent.textContent).toBe("第二节");
  });

  it("handles StrictMode asynchronous creation without duplicating editors", async () => {
    const onChange = vi.fn();
    const result = render(<StrictMode><RichEditor id="strict-rich" label="严格模式正文" value="正文" fontSize={16} onChange={onChange} /></StrictMode>);
    await screen.findByRole("textbox", { name: "严格模式正文" });
    await waitFor(() => expect(screen.getAllByRole("textbox", { name: "严格模式正文" })).toHaveLength(1));
    expect(onChange).not.toHaveBeenCalled();
    result.unmount();
    await waitFor(() => expect(document.querySelector(".ProseMirror")).toBeNull());
  });
});
