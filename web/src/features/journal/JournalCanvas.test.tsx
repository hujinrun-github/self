import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JournalCanvas } from "./JournalCanvas";
import { createJournalScene, makeJournalElement } from "./scene";
import type { JournalAsset, JournalScene } from "./types";

afterEach(cleanup);

function Editable({
  initial,
  onChange = vi.fn(),
  onUpload,
  toolbarActions,
}: {
  initial: JournalScene;
  onChange?: (scene: JournalScene) => void;
  onUpload?: (file: File) => Promise<JournalAsset>;
  toolbarActions?: ReactNode;
}) {
  const [scene, setScene] = useState(initial);
  return (
    <JournalCanvas
      scene={scene}
      onChange={(next) => {
        setScene(next);
        onChange(next);
      }}
      assetURL={(id) => `/api/admin/journal/assets/${id}`}
      onUpload={onUpload}
      toolbarActions={toolbarActions}
    />
  );
}

function textScene() {
  const scene = createJournalScene();
  scene.elements = [
    makeJournalElement("text", {
      id: "text-one",
      text: "记得今天",
      x: 70,
      y: 90,
    }),
  ];
  return scene;
}

describe("JournalCanvas", () => {
  it("keeps the same canvas and undo history while editing and saving in fullscreen", async () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    render(
      <Editable
        initial={textScene()}
        onChange={onChange}
        toolbarActions={
          <>
            <span role="status" aria-label="保存状态">
              有未同步修改
            </span>
            <button type="button" onClick={onSave}>
              保存画布
            </button>
          </>
        }
      />,
    );
    const viewport = screen.getByTestId("journal-viewport");
    await userEvent.click(
      screen.getByRole("button", { name: "文字：记得今天" }),
    );
    fireEvent.change(screen.getByLabelText("元素内容"), {
      target: { value: "进入全屏前的文字" },
    });
    fireEvent.blur(screen.getByLabelText("元素内容"));
    await userEvent.click(screen.getByRole("button", { name: "全屏编辑" }));
    expect(
      screen.getByRole("dialog", { name: "手帐画布编辑器" }),
    ).toHaveAttribute("aria-modal", "true");
    expect(screen.getByTestId("journal-viewport")).toBe(viewport);
    expect(screen.getByLabelText("元素内容")).toHaveValue("进入全屏前的文字");
    expect(screen.getByRole("status", { name: "保存状态" })).toHaveTextContent(
      "有未同步修改",
    );
    await userEvent.click(screen.getByRole("button", { name: "保存画布" }));
    expect(onSave).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText("元素内容"), {
      target: { value: "全屏里继续编辑" },
    });
    fireEvent.blur(screen.getByLabelText("元素内容"));
    await userEvent.click(screen.getByRole("button", { name: "退出全屏编辑" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("journal-viewport")).toBe(viewport);
    expect(screen.getByLabelText("元素内容")).toHaveValue("全屏里继续编辑");
    await userEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByLabelText("元素内容")).toHaveValue("进入全屏前的文字");
    await userEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByLabelText("元素内容")).toHaveValue("记得今天");
  });

  it("exits fullscreen with Escape from an input and restores page focus and scrolling", async () => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "auto";
    const { unmount } = render(
      <>
        <button type="button">返回手帐列表</button>
        <Editable initial={textScene()} />
      </>,
    );
    const backgroundButton = screen.getByRole("button", {
      name: "返回手帐列表",
    });
    const enterButton = screen.getByRole("button", { name: "全屏编辑" });
    await userEvent.click(enterButton);
    expect(document.body.style.overflow).toBe("hidden");
    expect(backgroundButton.inert).toBe(true);
    await userEvent.click(
      screen.getByRole("button", { name: "文字：记得今天" }),
    );
    const textarea = screen.getByLabelText("元素内容");
    textarea.focus();
    fireEvent.keyDown(textarea, { key: "Escape", isComposing: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("元素内容")).toHaveValue("记得今天");
    expect(document.body.style.overflow).toBe("auto");
    expect(backgroundButton.inert).toBeFalsy();
    expect(enterButton).toHaveFocus();
    await userEvent.click(enterButton);
    unmount();
    expect(document.body.style.overflow).toBe("auto");
    document.body.style.overflow = originalOverflow;
  });

  it("refits the page to fullscreen bounds and restores the normal fit on exit", async () => {
    render(<Editable initial={textScene()} />);
    const viewport = screen.getByTestId("journal-viewport");
    const bounds = vi
      .spyOn(viewport, "getBoundingClientRect")
      .mockImplementation(() => {
        const fullscreen = !!screen.queryByRole("dialog");
        return new DOMRect(
          0,
          0,
          fullscreen ? 1000 : 480,
          fullscreen ? 900 : 600,
        );
      });
    fireEvent(window, new Event("resize"));
    expect(screen.getByLabelText("画布缩放比例")).toHaveTextContent("51%");
    await userEvent.click(screen.getByRole("button", { name: "全屏编辑" }));
    expect(screen.getByLabelText("画布缩放比例")).toHaveTextContent("79%");
    await userEvent.click(screen.getByRole("button", { name: "退出全屏编辑" }));
    expect(screen.getByLabelText("画布缩放比例")).toHaveTextContent("51%");
    bounds.mockRestore();
  });

  it("keeps an existing save notification interactive above fullscreen", async () => {
    const dismiss = vi.fn();
    render(
      <>
        <Editable initial={textScene()} />
        {createPortal(
          <div data-journal-overlay role="status" aria-label="保存通知">
            已保存
            <button type="button" onClick={dismiss}>
              关闭保存提示
            </button>
          </div>,
          document.body,
        )}
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "全屏编辑" }));
    expect(screen.getByRole("status", { name: "保存通知" }).inert).toBeFalsy();
    await userEvent.click(screen.getByRole("button", { name: "关闭保存提示" }));
    expect(dismiss).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps viewport controls and reader interactions independent of stored content", async () => {
    const scene = textScene();
    const onChange = vi.fn();
    render(
      <JournalCanvas
        scene={scene}
        onChange={onChange}
        assetURL={String}
        readOnly
      />,
    );
    expect(
      screen.queryByRole("toolbar", { name: "画布工具" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("元素内容")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "放大画布" }));
    await userEvent.click(screen.getByRole("button", { name: "缩小画布" }));
    fireEvent.keyDown(screen.getByLabelText("手帐画布阅读器"), {
      key: "Delete",
    });
    fireEvent.pointerDown(screen.getByTestId("journal-viewport"), {
      pointerId: 1,
      button: 0,
      clientX: 30,
      clientY: 30,
    });
    fireEvent.pointerMove(screen.getByTestId("journal-viewport"), {
      pointerId: 1,
      clientX: 160,
      clientY: 80,
    });
    fireEvent.pointerUp(screen.getByTestId("journal-viewport"), {
      pointerId: 1,
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(scene.elements[0]).toMatchObject({ x: 70, y: 90 });
  });

  it("renders thumbnail previews without nested interactive controls", () => {
    render(
      <JournalCanvas
        scene={textScene()}
        onChange={vi.fn()}
        assetURL={String}
        thumbnail
      />,
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.getByText("记得今天")).toBeInTheDocument();
  });

  it("localizes the public reader controls without exposing edit controls", () => {
    render(
      <JournalCanvas
        scene={textScene()}
        readOnly
        locale="en"
        assetURL={String}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Fit page" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    expect(screen.getByText(/Drag to pan/)).toBeInTheDocument();
    expect(screen.queryByLabelText("纸张方向")).not.toBeInTheDocument();
  });

  it("changes paper orientation as one undoable operation", async () => {
    const onChange = vi.fn();
    render(<Editable initial={textScene()} onChange={onChange} />);
    await userEvent.selectOptions(
      screen.getByLabelText("纸张方向"),
      "landscape",
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.lastCall?.[0]).toMatchObject({
      width: 1080,
      height: 800,
    });
    await userEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(onChange.mock.lastCall?.[0]).toMatchObject({
      width: 800,
      height: 1080,
    });
    expect(onChange.mock.lastCall?.[0].elements[0]).toMatchObject({
      x: 70,
      y: 90,
      font_size: 24,
    });
  });

  it("expands paper without changing content and preserves undo after a saved echo", async () => {
    const initial = textScene();
    initial.elements.push(makeJournalElement("photo", {
      id: "locked-photo", asset_id: 42, locked: true, rotation: 12,
    }));
    const onChange = vi.fn();
    function SavedEditor() {
      const [scene, setScene] = useState(initial);
      return (
        <>
          <button onClick={() => setScene(JSON.parse(JSON.stringify(scene)))}>
            服务器回显
          </button>
          <JournalCanvas scene={scene} assetURL={String} onChange={(next) => {
            setScene(next);
            onChange(next);
          }} />
        </>
      );
    }
    render(<SavedEditor />);
    await userEvent.click(screen.getByRole("button", { name: "扩大纸张" }));
    const expanded = onChange.mock.lastCall?.[0];
    expect(expanded).toMatchObject({ width: 1200, height: 1620 });
    expect(expanded.elements).toBe(initial.elements);
    expect(screen.getByTestId("journal-paper")).toHaveStyle({
      width: "1200px", height: "1620px",
    });
    await userEvent.click(screen.getByRole("button", { name: "服务器回显" }));
    await userEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(onChange.mock.lastCall?.[0]).toBe(initial);
    await userEvent.click(screen.getByRole("button", { name: "重做" }));
    expect(onChange.mock.lastCall?.[0]).toMatchObject({
      width: 1200, height: 1620, elements: initial.elements,
    });
  });

  it("stops expanding at the size limit and disables expansion while editing is disabled", async () => {
    const scene = { ...textScene(), width: 4000, height: 2963 };
    const onChange = vi.fn();
    const { rerender } = render(
      <JournalCanvas scene={scene} onChange={onChange} assetURL={String} />,
    );
    expect(screen.getByRole("button", { name: "扩大纸张" })).toBeDisabled();
    expect(screen.getByText(/纸张已达最大尺寸/)).toBeInTheDocument();
    rerender(<JournalCanvas scene={textScene()} onChange={onChange} assetURL={String} disabled />);
    await userEvent.click(screen.getByRole("button", { name: "扩大纸张" }));
    expect(screen.getByRole("button", { name: "扩大纸张" })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
    rerender(<JournalCanvas scene={scene} onChange={onChange} assetURL={String} readOnly />);
    expect(screen.queryByRole("button", { name: "扩大纸张" })).not.toBeInTheDocument();
  });

  it("fits a large paper into a narrow editor and read-only viewport", async () => {
    const scene = { ...textScene(), width: 4000, height: 4000 };
    const onChange = vi.fn();
    const { rerender } = render(<JournalCanvas scene={scene} onChange={onChange} assetURL={String} />);
    const size = { width: 300, height: 400 } as DOMRect;
    const measured = vi.spyOn(screen.getByTestId("journal-viewport"), "getBoundingClientRect").mockReturnValue(size);
    try {
      fireEvent(window, new Event("resize"));
      await userEvent.click(screen.getByRole("button", { name: "整页" }));
      expect(screen.getByLabelText("画布缩放比例")).toHaveTextContent("6%");
      expect(screen.getByTestId("journal-paper").style.transform).toContain("scale(0.063)");
      rerender(<JournalCanvas scene={scene} onChange={onChange} assetURL={String} readOnly />);
      await userEvent.click(screen.getByRole("button", { name: "整页" }));
      expect(screen.getByLabelText("画布缩放比例")).toHaveTextContent("6%");
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      measured.mockRestore();
    }
  });

  it("uses two-finger gestures to zoom the viewport without moving scene elements", () => {
    const onChange = vi.fn();
    render(<Editable initial={textScene()} onChange={onChange} />);
    const viewport = screen.getByTestId("journal-viewport");
    fireEvent.pointerDown(viewport, {
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerType: "touch",
    });
    fireEvent.pointerDown(viewport, {
      pointerId: 2,
      button: 0,
      clientX: 200,
      clientY: 100,
      pointerType: "touch",
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 2,
      clientX: 300,
      clientY: 100,
      pointerType: "touch",
    });
    fireEvent.pointerUp(viewport, { pointerId: 2, pointerType: "touch" });
    fireEvent.pointerUp(viewport, { pointerId: 1, pointerType: "touch" });
    expect(screen.getByLabelText("画布缩放比例")).toHaveTextContent("100%");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("supports keyboard moves with undo and redo and does not intercept typing", async () => {
    const onChange = vi.fn();
    render(<Editable initial={textScene()} onChange={onChange} />);
    await userEvent.click(
      screen.getByRole("button", { name: "文字：记得今天" }),
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "文字：记得今天" }), {
      key: "ArrowRight",
      shiftKey: true,
    });
    expect(onChange.mock.lastCall?.[0].elements[0].x).toBe(80);
    await userEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(onChange.mock.lastCall?.[0].elements[0].x).toBe(70);
    await userEvent.click(screen.getByRole("button", { name: "重做" }));
    expect(onChange.mock.lastCall?.[0].elements[0].x).toBe(80);
    const calls = onChange.mock.calls.length;
    fireEvent.keyDown(screen.getByLabelText("元素内容"), { key: "Delete" });
    expect(onChange).toHaveBeenCalledTimes(calls);
  });

  it("tracks text immediately for autosave and groups a focused typing session into one undo step", async () => {
    const onChange = vi.fn();
    render(<Editable initial={textScene()} onChange={onChange} />);
    await userEvent.click(
      screen.getByRole("button", { name: "文字：记得今天" }),
    );
    const textarea = screen.getByLabelText("元素内容");
    fireEvent.change(textarea, { target: { value: "新的" } });
    fireEvent.change(textarea, { target: { value: "新的中文内容" } });
    expect(onChange.mock.lastCall?.[0].elements[0].text).toBe("新的中文内容");
    fireEvent.blur(textarea);
    await userEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByLabelText("元素内容")).toHaveValue("记得今天");
    await userEvent.click(screen.getByRole("button", { name: "重做" }));
    expect(screen.getByLabelText("元素内容")).toHaveValue("新的中文内容");
  });

  it("prevents locked element edits and allows unlocking from its inspector", async () => {
    const initial = textScene();
    initial.elements[0].locked = true;
    const onChange = vi.fn();
    render(<Editable initial={initial} onChange={onChange} />);
    await userEvent.click(
      screen.getByRole("button", { name: "文字：记得今天（已锁定）" }),
    );
    expect(screen.getByLabelText("元素内容")).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText("手帐画布编辑器"), {
      key: "Delete",
    });
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "解锁元素" }));
    expect(screen.getByLabelText("元素内容")).toBeEnabled();
    expect(onChange.mock.lastCall?.[0].elements[0].locked).toBe(false);
  });

  it("commits a whole drag once and restores it in one undo step", async () => {
    const onChange = vi.fn();
    render(<Editable initial={textScene()} onChange={onChange} />);
    const element = screen.getByTestId("journal-element-text-one");
    const viewport = screen.getByTestId("journal-viewport");
    fireEvent.pointerDown(element, {
      pointerId: 1,
      button: 0,
      clientX: 70,
      clientY: 90,
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 1,
      clientX: 90,
      clientY: 100,
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 1,
      clientX: 120,
      clientY: 120,
    });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(viewport, { pointerId: 1 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.lastCall?.[0].elements[0]).toMatchObject({
      x: 170,
      y: 150,
    });
    await userEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(onChange.mock.lastCall?.[0].elements[0]).toMatchObject({
      x: 70,
      y: 90,
    });
  });

  it("does not insert or fetch a selected photo until a successful protected upload", async () => {
    let finish!: (asset: JournalAsset) => void;
    const onUpload = vi.fn(
      () =>
        new Promise<JournalAsset>((resolve) => {
          finish = resolve;
        }),
    );
    const onChange = vi.fn();
    render(
      <Editable
        initial={createJournalScene()}
        onChange={onChange}
        onUpload={onUpload}
      />,
    );
    const file = new File(["photo"], "旅行.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("上传手帐照片"), file);
    expect(
      screen.getByRole("status", { name: "照片上传状态" }),
    ).toHaveTextContent("照片正在上传");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    await act(async () => {
      finish({
        id: 31,
        notebook_id: 1,
        width: 1200,
        height: 800,
        mime_type: "image/png",
        file_name: file.name,
        size_bytes: 5,
      });
    });
    const image = await screen.findByRole("img", { name: "旅行.png" });
    expect(image).toHaveAttribute("src", "/api/admin/journal/assets/31");
    expect(onChange.mock.lastCall?.[0].elements[0]).toMatchObject({
      asset_id: 31,
      width: 360,
      height: 240,
    });
    const width = screen.getByLabelText("宽度");
    fireEvent.change(width, { target: { value: "450" } });
    fireEvent.blur(width);
    expect(onChange.mock.lastCall?.[0].elements[0]).toMatchObject({
      width: 450,
      height: 300,
    });
  });

  it("leaves the scene unchanged on upload failure and exposes the retry error", async () => {
    const onChange = vi.fn();
    render(
      <Editable
        initial={createJournalScene()}
        onChange={onChange}
        onUpload={async () => {
          throw new Error("网络暂时不可用");
        }}
      />,
    );
    await userEvent.upload(
      screen.getByLabelText("上传手帐照片"),
      new File(["photo"], "pic.png", { type: "image/png" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "照片上传失败：网络暂时不可用",
      ),
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "照片" })).toBeEnabled();
  });

  it("accepts photos up to 5 MB and rejects larger files before upload", async () => {
    const onUpload = vi.fn().mockResolvedValue({
      id: 32,
      notebook_id: 1,
      width: 800,
      height: 600,
      mime_type: "image/png",
      file_name: "limit.png",
      size_bytes: 5 * 1024 * 1024,
    });
    const onChange = vi.fn();
    render(
      <Editable
        initial={createJournalScene()}
        onChange={onChange}
        onUpload={onUpload}
      />,
    );
    const input = screen.getByLabelText("上传手帐照片");
    const atLimit = new File([new Uint8Array(5 * 1024 * 1024)], "limit.png", {
      type: "image/png",
    });
    await userEvent.upload(input, atLimit);
    await waitFor(() => expect(onUpload).toHaveBeenCalledWith(atLimit));
    expect(onChange).toHaveBeenCalled();

    onUpload.mockClear();
    onChange.mockClear();
    const oversized = new File(
      [new Uint8Array(5 * 1024 * 1024 + 1)],
      "too-large.png",
      { type: "image/png" },
    );
    await userEvent.upload(input, oversized);
    expect(onUpload).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "照片不能超过 5 MB，请压缩后重试。",
    );
  });

  it("preserves undo across a server echo and resets it when an external document replaces the draft", async () => {
    function ReplacingEditor() {
      const [scene, setScene] = useState(textScene());
      return (
        <>
          <button
            onClick={() =>
              setScene({
                ...scene,
                elements: scene.elements.map((element) => ({
                  text: element.text,
                  ...element,
                })),
              })
            }
          >
            服务器回显
          </button>
          <button onClick={() => setScene({ ...textScene(), paper: "dots" })}>
            载入外部版本
          </button>
          <JournalCanvas scene={scene} onChange={setScene} assetURL={String} />
        </>
      );
    }
    render(<ReplacingEditor />);
    await userEvent.click(
      screen.getByRole("button", { name: "文字：记得今天" }),
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "文字：记得今天" }), {
      key: "ArrowRight",
    });
    expect(screen.getByRole("button", { name: "撤销" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "服务器回显" }));
    expect(screen.getByRole("button", { name: "撤销" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "载入外部版本" }));
    expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重做" })).toBeDisabled();
    expect(screen.getByTestId("journal-element-text-one")).toHaveStyle({
      left: "70px",
    });
  });

  it("keeps undo when the server omits cleared text and false formatting flags after saving", async () => {
    function OmittedDefaultsEditor() {
      const initial = textScene();
      initial.elements[0].bold = true;
      const [scene, setScene] = useState(initial);
      return (
        <>
          <button
            onClick={() =>
              setScene({
                ...scene,
                elements: scene.elements.map((element) => {
                  const echoed = { ...element };
                  if (!echoed.text) delete echoed.text;
                  if (!echoed.bold) delete echoed.bold;
                  if (!echoed.italic) delete echoed.italic;
                  return echoed;
                }),
              })
            }
          >
            保存回显
          </button>
          <JournalCanvas scene={scene} onChange={setScene} assetURL={String} />
        </>
      );
    }
    render(<OmittedDefaultsEditor />);
    await userEvent.click(
      screen.getByRole("button", { name: "文字：记得今天" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "加粗" }));
    fireEvent.change(screen.getByLabelText("元素内容"), {
      target: { value: "" },
    });
    fireEvent.blur(screen.getByLabelText("元素内容"));
    await userEvent.click(screen.getByRole("button", { name: "保存回显" }));
    expect(screen.getByRole("button", { name: "撤销" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByLabelText("元素内容")).toHaveValue("记得今天");
    expect(screen.getByRole("button", { name: "加粗" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await userEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByRole("button", { name: "加粗" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("does not insert a photo or clear a newer upload when the old editor has been replaced", async () => {
    const finish: ((asset: JournalAsset) => void)[] = [];
    const onUpload = vi.fn(
      () =>
        new Promise<JournalAsset>((resolve) => {
          finish.push(resolve);
        }),
    );
    const onBusy = vi.fn();
    const onChange = vi.fn();
    const { rerender } = render(
      <JournalCanvas
        scene={createJournalScene()}
        onChange={onChange}
        onUpload={onUpload}
        onUploadStateChange={onBusy}
        assetURL={String}
      />,
    );
    await userEvent.upload(
      screen.getByLabelText("上传手帐照片"),
      new File(["a"], "old.png", { type: "image/png" }),
    );
    rerender(
      <JournalCanvas
        scene={createJournalScene("daily")}
        onChange={onChange}
        onUpload={onUpload}
        onUploadStateChange={onBusy}
        assetURL={String}
      />,
    );
    expect(onBusy.mock.calls.map(([busy]) => busy)).toEqual([true, false]);
    await userEvent.upload(
      screen.getByLabelText("上传手帐照片"),
      new File(["b"], "new.png", { type: "image/png" }),
    );
    await act(async () => {
      finish[0]({
        id: 100,
        notebook_id: 1,
        width: 800,
        height: 600,
        mime_type: "image/png",
        file_name: "old.png",
        size_bytes: 1,
      });
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(onBusy.mock.calls.map(([busy]) => busy)).toEqual([
      true,
      false,
      true,
    ]);
    expect(
      screen.getByRole("status", { name: "照片上传状态" }),
    ).toBeInTheDocument();
  });

  it("keeps later scene edits when a photo upload finishes asynchronously", async () => {
    let finish!: (asset: JournalAsset) => void;
    const onChange = vi.fn();
    render(
      <Editable
        initial={textScene()}
        onChange={onChange}
        onUpload={() =>
          new Promise((resolve) => {
            finish = resolve;
          })
        }
      />,
    );
    await userEvent.upload(
      screen.getByLabelText("上传手帐照片"),
      new File(["a"], "photo.png", { type: "image/png" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "文字：记得今天" }),
    );
    fireEvent.change(screen.getByLabelText("元素内容"), {
      target: { value: "上传途中继续写字" },
    });
    await act(async () => {
      finish({
        id: 101,
        notebook_id: 1,
        width: 800,
        height: 600,
        mime_type: "image/png",
        file_name: "photo.png",
        size_bytes: 1,
      });
    });
    expect(onChange.mock.lastCall?.[0].elements).toHaveLength(2);
    expect(onChange.mock.lastCall?.[0].elements[0].text).toBe(
      "上传途中继续写字",
    );
  });

  it("keeps a completed upload when an already-started element drag ends afterward", async () => {
    let finish!: (asset: JournalAsset) => void;
    const onChange = vi.fn();
    render(
      <Editable
        initial={textScene()}
        onChange={onChange}
        onUpload={() =>
          new Promise((resolve) => {
            finish = resolve;
          })
        }
      />,
    );
    await userEvent.upload(
      screen.getByLabelText("上传手帐照片"),
      new File(["a"], "photo.png", { type: "image/png" }),
    );
    const viewport = screen.getByTestId("journal-viewport");
    fireEvent.pointerDown(screen.getByTestId("journal-element-text-one"), {
      pointerId: 1,
      button: 0,
      clientX: 70,
      clientY: 90,
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 1,
      clientX: 120,
      clientY: 120,
    });
    await act(async () => {
      finish({
        id: 102,
        notebook_id: 1,
        width: 800,
        height: 600,
        mime_type: "image/png",
        file_name: "photo.png",
        size_bytes: 1,
      });
    });
    fireEvent.pointerUp(viewport, { pointerId: 1 });
    expect(onChange.mock.lastCall?.[0].elements).toHaveLength(2);
    expect(onChange.mock.lastCall?.[0].elements[0]).toMatchObject({
      x: 170,
      y: 150,
    });
    expect(onChange.mock.lastCall?.[0].elements[1]).toMatchObject({
      asset_id: 102,
    });
  });

  it("does not resurrect a photo deleted while its replacement uploads", async () => {
    let finish!: (asset: JournalAsset) => void;
    const initial = createJournalScene();
    initial.elements = [
      makeJournalElement("photo", { id: "photo", asset_id: 5, text: "原照片" }),
    ];
    const onChange = vi.fn();
    render(
      <Editable
        initial={initial}
        onChange={onChange}
        onUpload={() =>
          new Promise((resolve) => {
            finish = resolve;
          })
        }
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "照片：原照片" }));
    await userEvent.upload(
      screen.getByLabelText("上传手帐照片"),
      new File(["a"], "new.png", { type: "image/png" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "删除" }));
    await act(async () => {
      finish({
        id: 103,
        notebook_id: 1,
        width: 800,
        height: 600,
        mime_type: "image/png",
        file_name: "new.png",
        size_bytes: 1,
      });
    });
    expect(onChange.mock.lastCall?.[0].elements).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent("原照片已移除");
  });
});
