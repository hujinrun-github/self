import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithApp } from "../../test/render";
import { WritingImportDialog } from "./WritingImportDialog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function createPreviewResponse(overrides: Record<string, unknown> = {}) {
  return {
    blocking_errors: [],
    import_token: "preview-token",
    media: [
      {
        asset_id: 12,
        original_path: "images/cover.png",
        replacement_ref: "media:12",
        status: "matched",
      },
    ],
    media_map: {
      "images/cover.png": "media:12",
    },
    mode: "create",
    parsed: {
      content_md: "# Hello world",
      excerpt: "导入摘要",
      slug: "hello-world",
      tags: ["AI", "Testing"],
      title: "导入标题",
    },
    warnings: ["封面图片已自动匹配。"],
    ...overrides,
  };
}

describe("WritingImportDialog", () => {
  it("uploads a markdown file, loads preview, and shows parsed fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(createPreviewResponse()), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      ),
    );

    renderWithApp(<WritingImportDialog mode="create" onClose={() => undefined} open />);

    await userEvent.upload(
      screen.getByLabelText("Markdown 文件"),
      new File(["# Hello world"], "draft.md", { type: "text/markdown" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "生成预览" }));

    expect(await screen.findByRole("heading", { name: "导入预览" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("导入标题")).toBeInTheDocument();
    expect(screen.getByDisplayValue("导入摘要")).toBeInTheDocument();
    expect(screen.getByDisplayValue("hello-world")).toBeInTheDocument();
    expect(screen.getByDisplayValue("# Hello world")).toBeInTheDocument();
    expect(screen.getByDisplayValue("AI, Testing")).toBeInTheDocument();
    expect(screen.getByText("images/cover.png")).toBeInTheDocument();
    expect(screen.getByText("封面图片已自动匹配。")).toBeInTheDocument();
  });

  it("disables commit when blocking errors exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(
            createPreviewResponse({
              blocking_errors: ["缺少封面图片对应的媒体文件。"],
            }),
          ),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        ),
      ),
    );

    renderWithApp(<WritingImportDialog mode="create" onClose={() => undefined} open />);

    await userEvent.upload(
      screen.getByLabelText("Markdown 文件"),
      new File(["# Hello world"], "draft.md", { type: "text/markdown" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "生成预览" }));

    expect(await screen.findByText("缺少封面图片对应的媒体文件。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认提交" })).toBeDisabled();
  });

  it("commits the preview and calls back with the saved writing", async () => {
    const onClose = vi.fn();
    const onCommitted = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(createPreviewResponse()), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            writing: {
              content_md: "# Hello world",
              excerpt: "导入摘要",
              id: 41,
              slug: "hello-world",
              tags: [{ name: "AI" }, { name: "Testing" }],
              title: "导入标题",
            },
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    renderWithApp(<WritingImportDialog mode="create" onClose={onClose} onCommitted={onCommitted} open />);

    await userEvent.upload(
      screen.getByLabelText("Markdown 文件"),
      new File(["# Hello world"], "draft.md", { type: "text/markdown" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "生成预览" }));
    await userEvent.clear(await screen.findByLabelText("标题"));
    await userEvent.type(screen.getByLabelText("标题"), "更新后的标题");
    await userEvent.click(screen.getByRole("button", { name: "确认提交" }));

    expect(onCommitted).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 41,
        title: "导入标题",
      }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);

    const commitBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/admin/writing/imports/commit");
    expect(commitBody).toMatchObject({
      import_token: "preview-token",
      payload: {
        content_md: "# Hello world",
        excerpt: "导入摘要",
        slug: "hello-world",
        tags: ["AI", "Testing"],
        title: "更新后的标题",
      },
    });
  });
});
