import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithApp } from "../../test/render";
import { PublicListPage } from "./PublicListPage";

const items = [
  { id: 1, slug: "interfaces", title: "Interface notes", excerpt: "Small details matter", summary: "Thoughtful interfaces", tags: [{ name: "交互设计" }] },
  { id: 2, slug: "systems", title: "System journal", excerpt: "Reliable infrastructure", summary: "A resilient platform", techs: [{ name: "TypeScript" }] },
];

function response(entries = items, locale = "zh", status = 200) {
  return new Response(JSON.stringify(status === 200 ? { items: entries, requested_locale: locale, resolved_locale: locale } : { error: { code: "unavailable", message: "Unavailable" } }), { status, headers: { "Content-Type": "application/json" } });
}

function mount(resource: "writing" | "projects" = "writing", locale = "zh") {
  const router = createMemoryRouter([
    { path: "/:locale/writing", element: <PublicListPage resource="writing" /> },
    { path: "/:locale/projects", element: <PublicListPage resource="projects" /> },
  ], { initialEntries: [`/${locale}/${resource}`] });
  renderWithApp(<RouterProvider router={router} />);
  return router;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("public collection interactions", () => {
  it.each(["writing", "projects"] as const)("filters the %s collection locally and clears without losing input focus", async (resource) => {
    const fetch = vi.fn(() => Promise.resolve(response()));
    vi.stubGlobal("fetch", fetch);
    mount(resource);
    const search = await screen.findByRole("searchbox", { name: resource === "writing" ? "搜索文章" : "搜索项目" });
    const list = within(screen.getByTestId(resource === "writing" ? "public-writing-list" : "public-project-grid"));
    expect(list.getAllByRole("link")).toHaveLength(2);
    const user = userEvent.setup();

    for (const [query, title] of [["INTERFACE", "Interface notes"], ["交互设计", "Interface notes"], ["typescript", "System journal"], [resource === "writing" ? "infrastructure" : "resilient", "System journal"]]) {
      await user.clear(search);
      await user.type(search, query);
      expect(list.getAllByRole("link")).toHaveLength(1);
      expect(list.getByRole("heading", { name: title })).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("1 / 2");
    }

    await user.clear(search);
    await user.type(search, "nothing matches");
    expect(list.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent("没有找到匹配内容，试试其他关键词。");
    expect(screen.queryByText("暂无已发布内容。")).not.toBeInTheDocument();
    expect(list.queryByRole("heading", { name: "下一篇长文正在整理" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "清空搜索" }));
    expect(search).toHaveValue("");
    expect(search).toHaveFocus();
    expect(list.getAllByRole("link")).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["en", "Search writing", "Clear search", "No matches. Try another keyword."],
    ["ja", "記事を検索", "検索をクリア", "一致する内容がありません。別のキーワードをお試しください。"],
  ])("localizes the collection controls for %s", async (locale, label, clearLabel, emptyMessage) => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response(items, locale))));
    mount("writing", locale);
    const search = await screen.findByRole("searchbox", { name: label });
    await userEvent.type(search, "unmatched");
    expect(screen.getByRole("button", { name: clearLabel })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(emptyMessage);
  });

  it("distinguishes loading, failure, and retry without showing the empty collection", async () => {
    let finish!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(pending).mockImplementation(() => Promise.resolve(response())));
    mount();
    expect(screen.getByRole("status")).toHaveTextContent("正在加载内容…");
    expect(screen.queryByText("暂无已发布内容。")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("public-writing-list")).queryAllByRole("heading")).toHaveLength(0);
    await act(async () => finish(response([], "zh", 503)));
    expect(await screen.findByRole("alert")).toHaveTextContent("内容暂时无法加载，请重试。");
    expect(screen.queryByText("暂无已发布内容。")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByRole("searchbox", { name: "搜索文章" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the empty collection previews separate from searchable published content", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response([]))));
    mount();
    expect(await screen.findByText("暂无已发布内容。")).toBeInTheDocument();
    const list = within(screen.getByTestId("public-writing-list"));
    expect(list.getByRole("heading", { name: "下一篇长文正在整理" })).toBeInTheDocument();
    expect(list.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("ignores an old language response after navigation", async () => {
    let finish!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    const fetch = vi.fn((url: string) => url.includes("locale=zh") ? pending : Promise.resolve(response([{ ...items[0], title: "English edition" }], "en")));
    vi.stubGlobal("fetch", fetch);
    const router = mount();
    await act(async () => router.navigate("/en/writing"));
    await screen.findByRole("searchbox", { name: "Search writing" });
    await act(async () => finish(response()));
    const list = within(screen.getByTestId("public-writing-list"));
    expect(list.getByRole("heading", { name: "English edition" })).toBeInTheDocument();
    expect(list.queryByRole("heading", { name: "Interface notes" })).not.toBeInTheDocument();
  });

  it("resets the search when switching collections", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response())));
    const router = mount();
    await userEvent.type(await screen.findByRole("searchbox", { name: "搜索文章" }), "unmatched");
    await act(async () => router.navigate("/zh/projects"));
    await waitFor(() => expect(screen.getByRole("searchbox", { name: "搜索项目" })).toHaveValue(""));
    expect(within(screen.getByTestId("public-project-grid")).getAllByRole("link")).toHaveLength(2);
  });
});
