import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { WritingDetailPage } from "./WritingDetailPage";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("mobile article navigation", () => {
  it("opens the compact contents and closes it after selecting an article heading", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const body = url.pathname === "/api/site/writing/example"
        ? { item: { id: 1, slug: "example", title: "An article", content_md: "## First section\nBody\n## Second section\nMore body" }, requested_locale: "zh", resolved_locale: "zh", alternates: [] }
        : url.pathname.endsWith("/engagement")
          ? { like_count: 0, liked: false, view_count: 0, visitor_count: 0, comment_count: 0, comments: [], page: 1, limit: 10, has_more: false }
          : { items: [] };
      return Promise.resolve(new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }));
    }));
    render(<MemoryRouter initialEntries={["/zh/writing/example"]}>
      <Routes><Route path="/:locale/writing/:slug" element={<WritingDetailPage />} /></Routes>
    </MemoryRouter>);
    await screen.findByRole("heading", { name: "An article" });
    const contents = screen.getByTestId("mobile-article-contents");
    const summary = contents.querySelector("summary")!;
    expect(contents).not.toHaveAttribute("open");

    await userEvent.click(summary);
    expect(contents).toHaveAttribute("open");
    const target = within(contents).getByRole("link", { name: "Second section" });
    expect(target).toHaveAttribute("href", "#second-section");
    expect(document.getElementById("second-section")).toHaveTextContent("Second section");
    await userEvent.click(target);
    expect(contents).not.toHaveAttribute("open");
    expect(screen.getByRole("link", { name: "返回文章列表" })).toHaveAttribute("href", "/zh/writing");
  });
});
