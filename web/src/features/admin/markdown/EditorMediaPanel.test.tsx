import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReactMarkdown from "react-markdown";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { APIRequestError, apiFetch } from "../../../lib/api";
import { EditorMediaPanel, uploadEditorImage } from "./EditorMediaPanel";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  apiFetch: vi.fn(),
}));

const image = (id = 12, fileName = "cover.png") => ({
  id,
  file_name: fileName,
  mime_type: "image/png",
  variants: { card: { mime_type: "image/jpeg", width: 800, height: 450 } },
});

beforeEach(() => { vi.mocked(apiFetch).mockReset(); });
afterEach(cleanup);

describe("EditorMediaPanel", () => {
  it("loads safe images, ignores non-images and malformed assets, and inserts only the selected image", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: [
      image(),
      { ...image(13, "voice.mp3"), mime_type: "audio/mpeg" },
      { ...image(-1, "broken.png") },
      { ...image(14, "no-variant.png"), variants: {} },
    ] });
    const onInsert = vi.fn();
    render(<EditorMediaPanel onCancel={vi.fn()} onInsert={onInsert} />);
    expect(screen.getByRole("button", { name: "插入图片" })).toBeDisabled();
    await userEvent.click(await screen.findByRole("button", { name: "选择 cover.png" }));
    expect(screen.queryByRole("button", { name: /voice|broken|no-variant/ })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "cover.png" })).toHaveAttribute("src", "/media/12/card");
    expect(onInsert).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "插入图片" }));
    expect(onInsert).toHaveBeenCalledWith("![cover.png](media://asset/12/card)");
    expect(vi.mocked(apiFetch).mock.calls.every(([, options]) => options?.method !== "POST")).toBe(true);
  });

  it("uploads a chosen file, selects its result, and waits for insert confirmation", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce(image(22, "上传.png"));
    const onInsert = vi.fn();
    render(<EditorMediaPanel onCancel={vi.fn()} onInsert={onInsert} />);
    await screen.findByText("媒体库里还没有可用图片");
    const file = new File(["image"], "上传.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("选择图片文件"), file);
    await screen.findByText("上传成功，点击「插入图片」放入正文。");
    const uploadOptions = vi.mocked(apiFetch).mock.calls.find(([, options]) => options?.method === "POST")?.[1];
    expect((uploadOptions?.body as FormData).get("file")).toBe(file);
    expect(uploadOptions?.signal).toBeInstanceOf(AbortSignal);
    expect(onInsert).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "插入图片" }));
    expect(onInsert).toHaveBeenCalledWith("![上传.png](media://asset/22/card)");
  });

  it("shows a Chinese loading error and lets the user retry the library", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce({ items: [image()] });
    render(<EditorMediaPanel onCancel={vi.fn()} onInsert={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("媒体库加载失败");
    await userEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByRole("button", { name: "选择 cover.png" })).toBeInTheDocument();
  });

  it("keeps upload errors visible and retries only on an explicit click", async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ items: [] })
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(image());
    render(<EditorMediaPanel onCancel={vi.fn()} onInsert={vi.fn()} />);
    await screen.findByText("媒体库里还没有可用图片");
    await userEvent.upload(screen.getByLabelText("选择图片文件"), new File(["image"], "cover.png", { type: "image/png" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("上传失败");
    expect(apiFetch).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole("button", { name: "重试上传" }));
    expect(await screen.findByText("上传成功，点击「插入图片」放入正文。")).toBeInTheDocument();
  });

  it("aborts an upload on cancel and never inserts a late response", async () => {
    let resolveUpload!: (asset: ReturnType<typeof image>) => void;
    vi.mocked(apiFetch).mockResolvedValueOnce({ items: [] }).mockImplementationOnce(() => new Promise((resolve) => { resolveUpload = resolve; }));
    const onCancel = vi.fn();
    const onInsert = vi.fn();
    render(<EditorMediaPanel onCancel={onCancel} onInsert={onInsert} />);
    await screen.findByText("媒体库里还没有可用图片");
    await userEvent.upload(screen.getByLabelText("选择图片文件"), new File(["image"], "cover.png", { type: "image/png" }));
    const signal = vi.mocked(apiFetch).mock.calls[1][1]?.signal;
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(signal?.aborted).toBe(true);
    expect(onCancel).toHaveBeenCalledOnce();
    await act(async () => resolveUpload(image()));
    expect(onInsert).not.toHaveBeenCalled();
    expect(screen.queryByText("上传成功，点击「插入图片」放入正文。")).not.toBeInTheDocument();
  });

  it("aborts the library request when unmounted", async () => {
    vi.mocked(apiFetch).mockImplementation(() => new Promise(() => {}));
    const view = render(<EditorMediaPanel onCancel={vi.fn()} onInsert={vi.fn()} />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledOnce());
    const signal = vi.mocked(apiFetch).mock.calls[0][1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
});

describe("uploadEditorImage", () => {
  it("uses the uncropped content variant before card and keeps card for library thumbnails", async () => {
    const asset = {
      ...image(31, "portrait.png"),
      variants: { ...image().variants, content: { mime_type: "image/jpeg", width: 600, height: 900 } },
    };
    vi.mocked(apiFetch).mockResolvedValueOnce(asset).mockResolvedValueOnce({ items: [asset] });
    await expect(uploadEditorImage(new File(["image"], "portrait.png", { type: "image/png" })))
      .resolves.toBe("![portrait.png](media://asset/31/content)");
    const onInsert = vi.fn();
    render(<EditorMediaPanel onCancel={vi.fn()} onInsert={onInsert} />);
    await userEvent.click(await screen.findByRole("button", { name: "选择 portrait.png" }));
    expect(screen.getByRole("img", { name: "portrait.png" })).toHaveAttribute("src", "/media/31/card");
    await userEvent.click(screen.getByRole("button", { name: "插入图片" }));
    expect(onInsert).toHaveBeenCalledWith("![portrait.png](media://asset/31/content)");
  });

  it("accepts a content-only image and uses that variant for its thumbnail", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: [{
      ...image(32, "content-only.png"),
      variants: { content: { mime_type: "image/jpeg", width: 600, height: 900 } },
    }] });
    render(<EditorMediaPanel onCancel={vi.fn()} onInsert={vi.fn()} />);
    expect(await screen.findByRole("img", { name: "content-only.png" })).toHaveAttribute("src", "/media/32/content");
  });

  it("escapes a malicious filename and prefers an original image when available", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ...image(25, "x](https://evil.example)![y.png"),
      variants: {
        ...image().variants,
        content: { mime_type: "image/jpeg", width: 80, height: 40 },
        original: { mime_type: "image/png", width: 80, height: 40 },
      },
    });
    const markdown = await uploadEditorImage(new File(["image"], "safe.png", { type: "image/png" }));
    expect(markdown).toContain("(media://asset/25/original)");
    render(<ReactMarkdown urlTransform={(url) => url}>{markdown}</ReactMarkdown>);
    expect(screen.getByRole("img", { name: "x](https://evil.example)![y.png" })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it.each([
    ["unsupported format", new File(["x"], "vector.svg", { type: "image/svg+xml" }), "仅支持 PNG、JPG 和 WebP 图片"],
    ["mismatched extension", new File(["x"], "wrong.jpg", { type: "image/png" }), "文件扩展名与图片格式不一致"],
    ["empty image", new File([], "empty.png", { type: "image/png" }), "图片文件为空"],
    ["oversized image", new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }), "图片不能超过 5 MB"],
  ])("rejects %s before making a request", async (_label, file, message) => {
    await expect(uploadEditorImage(file)).rejects.toThrow(message);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("rejects malformed upload responses instead of inserting a broken reference", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ...image(), id: "12", variants: { card: null } });
    await expect(uploadEditorImage(new File(["x"], "cover.png", { type: "image/png" }))).rejects.toThrow("上传结果无效");
  });

  it("translates server image-validation errors into actionable Chinese text", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new APIRequestError(400, { error: { code: "upload_error", message: "invalid upload" } }));
    await expect(uploadEditorImage(new File(["x"], "cover.png", { type: "image/png" }))).rejects.toThrow("6000");
  });
});
