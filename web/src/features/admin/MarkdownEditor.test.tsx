import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithApp } from "../../test/render";
import { MarkdownEditor } from "./MarkdownEditor";

afterEach(() => {
  cleanup();
});

describe("MarkdownEditor", () => {
  it("renders one fullscreen action and portals the fullscreen editor to the document body", async () => {
    renderWithApp(
      <div data-testid="filtered-ancestor" style={{ backdropFilter: "blur(10px)" }}>
        <MarkdownEditor id="body" label="Markdown 正文" onChange={vi.fn()} value="# Hello" />
      </div>,
    );

    await screen.findByRole("textbox", { name: "Markdown 正文" }, { timeout: 3000 });
    expect(screen.queryByRole("button", { name: /Toggle fullscreen/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "全屏写作" }));

    const dialog = await screen.findByRole("dialog", { name: "Markdown 正文 · 全屏写作" });
    expect(dialog.parentElement).toBe(document.body);
    expect(document.body.style.overflow).toBe("hidden");

    await userEvent.click(screen.getByRole("button", { name: "退出全屏" }));
    expect(screen.queryByRole("dialog", { name: "Markdown 正文 · 全屏写作" })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });

  it("previews images when pasted markdown splits the label and url across lines", async () => {
    renderWithApp(
      <MarkdownEditor
        id="body"
        label="Markdown 正文"
        onChange={vi.fn()}
        value={"![cover.png]\n(https://raw.githubusercontent.com/hujinrun-github/blog_images/master/images/cover.png)"}
      />,
    );

    const image = await screen.findByRole("img", { name: "cover.png" }, { timeout: 3000 });
    expect(image).toHaveAttribute(
      "src",
      "https://cdn.jsdelivr.net/gh/hujinrun-github/blog_images@master/images/cover.png",
    );
  });

  it("previews media library image references with browser-loadable urls", async () => {
    const { container } = renderWithApp(
      <MarkdownEditor
        id="body"
        label="Markdown 正文"
        onChange={vi.fn()}
        value={"![media cover](media://asset/12/card)"}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('img[alt="media cover"]')).toHaveAttribute("src", "/media/12/card");
    });
  });
});
