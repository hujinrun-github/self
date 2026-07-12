import { cleanup, screen } from "@testing-library/react";
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

    await screen.findByRole("textbox", { name: "Markdown 正文" });
    expect(screen.queryByRole("button", { name: /Toggle fullscreen/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Fullscreen" }));

    const dialog = await screen.findByRole("dialog", { name: "Markdown 正文 fullscreen editor" });
    expect(dialog.parentElement).toBe(document.body);
    expect(document.body.style.overflow).toBe("hidden");

    await userEvent.click(screen.getByRole("button", { name: "Exit fullscreen" }));
    expect(screen.queryByRole("dialog", { name: "Markdown 正文 fullscreen editor" })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });
});
