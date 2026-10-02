import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useRef, useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { SourceEditorHandle, SourceEditorProps } from "./editorTypes";
import { SourceEditor } from "./SourceEditor";

beforeAll(() => {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () => new DOMRect();
  }
});

afterEach(cleanup);

function setup(overrides: Partial<SourceEditorProps> = {}) {
  const ref = createRef<SourceEditorHandle>();
  const props: SourceEditorProps = {
    id: "source",
    label: "Markdown 正文",
    value: "# 标题\n\n正文",
    onChange: vi.fn(),
    lineWrapping: true,
    fontSize: 15,
    stateRef: { current: null },
    ...overrides,
  };
  const result = render(<SourceEditor {...props} ref={ref} />);
  const view = () => EditorView.findFromDOM(screen.getByRole("textbox", { name: props.label }))!;
  return { ...result, props, ref, view };
}

describe("SourceEditor", () => {
  it("reports all typed characters before the parent echoes the document", async () => {
    const editor = setup({ value: "" });
    await userEvent.type(screen.getByRole("textbox", { name: "Markdown 正文" }), "# 正文\n这里是文章内容。");
    expect(editor.props.onChange).toHaveBeenLastCalledWith("# 正文\n这里是文章内容。");
  });

  it("keeps every typed character when the parent controls the document", async () => {
    const onChange = vi.fn();
    function ControlledEditor() {
      const [value, setValue] = useState("");
      const stateRef = useRef<EditorState | null>(null);
      return <SourceEditor id="controlled-source" label="受控正文" value={value} onChange={(next) => { onChange(next); setValue(next); }} lineWrapping fontSize={15} stateRef={stateRef} />;
    }
    render(<ControlledEditor />);
    await userEvent.type(screen.getByRole("textbox", { name: "受控正文" }), "# 正文\n这里是文章内容。");
    expect(onChange).toHaveBeenLastCalledWith("# 正文\n这里是文章内容。");
  });

  it("synchronizes controlled values without echoing them and uses the latest callbacks", () => {
    const editor = setup();
    const nextOnChange = vi.fn();
    editor.rerender(<SourceEditor {...editor.props} value="新正文" onChange={nextOnChange} ref={editor.ref} />);

    expect(editor.view().state.doc.toString()).toBe("新正文");
    expect(editor.props.onChange).not.toHaveBeenCalled();
    expect(nextOnChange).not.toHaveBeenCalled();
    act(() => editor.view().dispatch({ changes: { from: 3, insert: "!" }, userEvent: "input.type" }));
    expect(nextOnChange).toHaveBeenCalledWith("新正文!");
    expect(editor.props.onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Markdown 正文" })).toHaveAttribute("spellcheck", "false");
  });

  it("applies an insertion as one undo step and clamps an invalid requested selection", () => {
    const editor = setup({ value: "hello" });
    act(() => editor.ref.current!.applyEdit({ from: 0, to: 5, insert: "**hello**", anchor: 2, head: 7 }));
    expect(editor.view().state.doc.toString()).toBe("**hello**");
    expect(editor.ref.current!.getSelection()).toEqual({ from: 2, to: 7 });
    act(() => editor.ref.current!.undo());
    expect(editor.view().state.doc.toString()).toBe("hello");
    act(() => editor.ref.current!.redo());
    expect(editor.view().state.doc.toString()).toBe("**hello**");
    act(() => editor.ref.current!.applyEdit({ from: 0, to: 500, insert: "x", anchor: 99, head: -5 }));
    expect(editor.view().state.doc.toString()).toBe("x");
    expect(editor.ref.current!.getSelection()).toEqual({ from: 0, to: 1 });
  });

  it("moves to a heading line and reports its line and column", () => {
    const onCursorChange = vi.fn();
    const editor = setup({ onCursorChange });
    act(() => editor.ref.current!.goToLine(3));
    expect(editor.ref.current!.getSelection()).toEqual({ from: 6, to: 6 });
    expect(onCursorChange).toHaveBeenLastCalledWith({ line: 3, column: 1 });
    act(() => editor.ref.current!.goToLine(500));
    expect(editor.view().state.selection.main.head).toBe(6);
  });

  it("preserves history and selection across portal remounts and rebinds listeners", () => {
    const stateRef = { current: null as EditorState | null };
    const firstChange = vi.fn();
    const first = setup({ stateRef, value: "one", onChange: firstChange });
    act(() => first.ref.current!.applyEdit({ from: 3, to: 3, insert: " two", anchor: 4, head: 7 }));
    first.unmount();
    const secondChange = vi.fn();
    const second = setup({ stateRef, value: "one two", onChange: secondChange });
    expect(second.ref.current!.getSelection()).toEqual({ from: 4, to: 7 });
    act(() => second.ref.current!.undo());
    expect(second.view().state.doc.toString()).toBe("one");
    expect(secondChange).toHaveBeenCalledWith("one");
    expect(firstChange).toHaveBeenCalledTimes(1);
  });

  it("changes wrapping and font size without replacing history", () => {
    const editor = setup({ value: "a" });
    act(() => editor.ref.current!.applyEdit({ from: 1, to: 1, insert: "b" }));
    editor.rerender(<SourceEditor {...editor.props} value="ab" lineWrapping={false} fontSize={18} ref={editor.ref} />);
    expect(editor.view().contentDOM).not.toHaveClass("cm-lineWrapping");
    act(() => editor.ref.current!.undo());
    expect(editor.view().state.doc.toString()).toBe("a");
  });

  it("opens a Chinese find and replace panel and replaces all matches", () => {
    const editor = setup({ value: "cat cat dog" });
    act(() => editor.ref.current!.openSearch());
    fireEvent.change(screen.getByRole("textbox", { name: "查找" }), { target: { value: "cat" } });
    fireEvent.change(screen.getByRole("textbox", { name: "替换为" }), { target: { value: "bird" } });
    fireEvent.click(screen.getByRole("button", { name: "全部替换" }));
    expect(editor.view().state.doc.toString()).toBe("bird bird dog");
    expect(screen.getByRole("checkbox", { name: "正则表达式" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "区分大小写" })).toBeInTheDocument();
    act(() => editor.ref.current!.undo());
    expect(editor.view().state.doc.toString()).toBe("cat cat dog");
  });

  it("intercepts pasted and dropped images for the upload handler", () => {
    const onImagePaste = vi.fn();
    setup({ onImagePaste });
    const input = screen.getByRole("textbox", { name: "Markdown 正文" });
    const image = new File(["png"], "cover.png", { type: "image/png" });
    const paste = fireEvent.paste(input, { clipboardData: { files: [image] } });
    const drop = fireEvent.drop(input, { dataTransfer: { files: [image] } });
    expect(paste).toBe(false);
    expect(drop).toBe(false);
    expect(onImagePaste).toHaveBeenCalledTimes(2);
    expect(onImagePaste).toHaveBeenLastCalledWith([image]);
  });

  it("leaves Tab and Markdown formatting shortcuts available to the workbench", () => {
    setup();
    const input = screen.getByRole("textbox", { name: "Markdown 正文" });
    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "i", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "i", metaKey: true })).toBe(true);
  });
});
