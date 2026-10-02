import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

import { renderWithApp } from "../../test/render";
import { WritingDetailPage } from "./WritingDetailPage";

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}
function article(slug: string) {
  return { item: { id: 1, slug, title: `Article ${slug}`, content_md: "正文" }, requested_locale: "zh", resolved_locale: "zh", alternates: [] };
}
function stubRequests(detail: (url: URL) => Promise<Response> | undefined) {
  const fetch = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const custom = detail(url);
    if (custom) return custom;
    if (url.pathname.endsWith("/engagement")) return Promise.resolve(response({ like_count: 0, liked: false, view_count: 0, visitor_count: 0, comment_count: 0, comments: [], page: 1, limit: 10, has_more: false }));
    if (url.pathname.endsWith("/view")) return Promise.resolve(response({ view_count: 1, visitor_count: 1 }));
    if (url.pathname === "/api/site/profile") return Promise.resolve(response({ name: "Demo", social_links: [], requested_locale: "zh", resolved_locale: "zh" }));
    return Promise.resolve(response({ items: [], requested_locale: "zh", resolved_locale: "zh" }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
function mount() {
  const router = createMemoryRouter([{ path: "/:locale/writing/:slug", element: <WritingDetailPage /> }], { initialEntries: ["/zh/writing/first"] });
  renderWithApp(<RouterProvider router={router} />);
  return router;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("article request lifecycle", () => {
  it("shows loading before a detail failure and records no activity until a successful retry", async () => {
    let finish!: (value: Response) => void;
    let requests = 0;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    const fetch = stubRequests((url) => url.pathname === "/api/site/writing/first" ? ++requests === 1 ? pending : Promise.resolve(response(article("first"))) : undefined);
    mount();
    expect(screen.getByRole("heading", { name: "正在加载文章…" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "未找到" })).not.toBeInTheDocument();
    await act(async () => finish(response({ error: { code: "unavailable", message: "unavailable" } }, 503)));
    expect(await screen.findByRole("alert")).toHaveTextContent("文章暂时无法加载");
    expect(fetch.mock.calls.filter(([url]) => /\/(engagement|view)/.test(String(url)))).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "重新加载文章" }));
    expect(await screen.findByRole("heading", { name: "Article first" })).toBeInTheDocument();
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).includes("/view"))).toBe(true));
  });

  it("does not let a late article response replace the newly selected article", async () => {
    let finish!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    const fetch = stubRequests((url) => url.pathname === "/api/site/writing/first" ? pending : url.pathname === "/api/site/writing/second" ? Promise.resolve(response(article("second"))) : undefined);
    const router = mount();
    await act(async () => router.navigate("/zh/writing/second"));
    await screen.findByRole("heading", { name: "Article second" });
    await act(async () => finish(response(article("first"))));
    expect(screen.queryByRole("heading", { name: "Article first" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Article second" })).toBeInTheDocument();
    expect(fetch.mock.calls.some(([url]) => String(url).includes("/first/engagement"))).toBe(false);
  });
});
