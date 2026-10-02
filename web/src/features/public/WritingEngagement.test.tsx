import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WritingEngagement } from "../../lib/engagement";
import { renderWithApp } from "../../test/render";
import { WritingEngagementSection, WritingEngagementSummary } from "./WritingEngagement";
import { useWritingEngagement } from "./WritingEngagementState";

const baseline: WritingEngagement = {
  like_count: 3, liked: false, view_count: 12, visitor_count: 8, comment_count: 2,
  comments: [{ id: 1, author_name: "Ada", body: "已公开的想法", created_at: "2026-10-01T10:00:00Z" }],
  page: 1, limit: 1, has_more: true,
};
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const failure = () => response({ error: { code: "unavailable", message: "Unavailable" } }, 503);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function Workspace({ slug = "example", enabled = true }: { slug?: string; enabled?: boolean }) {
  const engagement = useWritingEngagement(slug, "zh", enabled);
  return <><WritingEngagementSummary engagement={engagement} locale="zh" /><WritingEngagementSection key={slug} engagement={engagement} locale="zh" /></>;
}

function stubFetch(overrides?: (url: URL, init: RequestInit) => Promise<Response> | undefined) {
  const mock = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://localhost");
    const custom = overrides?.(url, init);
    if (custom) return custom;
    if (url.pathname.endsWith("/view")) return Promise.resolve(response({ view_count: 13, visitor_count: 8 }));
    if (url.pathname.endsWith("/like")) {
      const liked = JSON.parse(String(init.body)).liked;
      return Promise.resolve(response({ liked, like_count: liked ? 4 : 3 }));
    }
    return Promise.resolve(response(baseline));
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("public article engagement", () => {
  it("establishes the visitor cookie before recording a visible read and shows total statistics", async () => {
    const first = deferred<Response>();
    const fetch = stubFetch((url) => url.pathname.endsWith("/engagement") ? first.promise : undefined);
    renderWithApp(<Workspace />);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: "include" });
    await act(async () => first.resolve(response(baseline)));
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).includes("/view"))).toBe(true));
    const viewCall = fetch.mock.calls.find(([url]) => String(url).includes("/view"))!;
    expect(viewCall[1]).toMatchObject({ method: "POST", body: "{}", credentials: "include" });
    expect(new Headers(viewCall[1]?.headers).get("Content-Type")).toBe("application/json");
    expect(screen.getByLabelText("有效阅读数")).toHaveTextContent("13");
    expect(screen.getByLabelText("访客数")).toHaveTextContent("8");
    expect(screen.getByRole("heading", { name: "评论 2" })).toBeInTheDocument();
    expect(screen.getByText(/24 小时/)).toBeInTheDocument();
  });

  it("waits until the page is visible and does not count reads before article loading succeeds", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const fetch = stubFetch();
    const { rerender } = renderWithApp(<Workspace enabled={false} />);
    expect(fetch).not.toHaveBeenCalled();
    rerender(<Workspace />);
    await screen.findByText("已公开的想法");
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("/view"))).toHaveLength(0);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(fetch.mock.calls.filter(([url]) => String(url).includes("/view"))).toHaveLength(1));
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("/view"))).toHaveLength(1);
  });

  it("prevents concurrent likes and allows cancelling a server-confirmed like", async () => {
    const pending = deferred<Response>();
    let calls = 0;
    const fetch = stubFetch((url) => url.pathname.endsWith("/like") && ++calls === 1 ? pending.promise : undefined);
    renderWithApp(<Workspace />);
    const like = await screen.findByRole("button", { name: "点赞 3" });
    fireEvent.click(like);
    fireEvent.click(like);
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("/like"))).toHaveLength(1);
    expect(like).toBeDisabled();
    await act(async () => pending.resolve(response({ liked: true, like_count: 4 })));
    const cancel = screen.getByRole("button", { name: "取消点赞 4" });
    expect(cancel).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(cancel);
    await screen.findByRole("button", { name: "点赞 3" });
    const requests = fetch.mock.calls.filter(([url]) => String(url).includes("/like"));
    expect(requests.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([{ liked: true }, { liked: false }]);
  });

  it("keeps the previous like state on failure and permits retry", async () => {
    let likes = 0;
    stubFetch((url) => url.pathname.endsWith("/like") && ++likes === 1 ? Promise.resolve(failure()) : undefined);
    renderWithApp(<Workspace />);
    await userEvent.click(await screen.findByRole("button", { name: "点赞 3" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("点赞操作失败");
    await userEvent.click(screen.getByRole("button", { name: "点赞 3" }));
    await screen.findByRole("button", { name: "取消点赞 4" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("acknowledges a pending comment without publishing it or incrementing public totals", async () => {
    const fetch = stubFetch((url) => url.pathname.endsWith("/comments") ? Promise.resolve(response({ id: 9, author_name: "Lin", body: "等待审核的评论", created_at: "2026-10-02T10:00:00Z", status: "pending" }, 201)) : undefined);
    renderWithApp(<Workspace />);
    await screen.findByText("已公开的想法");
    await userEvent.type(screen.getByLabelText("昵称"), "Lin");
    await userEvent.type(screen.getByLabelText("评论内容"), "等待审核的评论");
    expect(screen.getByLabelText("评论内容")).toHaveAttribute("maxlength", "1000");
    await userEvent.click(screen.getByRole("button", { name: "提交评论" }));
    expect(await screen.findByRole("status")).toHaveTextContent("审核通过后公开");
    expect(screen.queryByText("等待审核的评论")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "评论 2" })).toBeInTheDocument();
    expect(screen.getByLabelText("昵称")).toHaveValue("Lin");
    expect(screen.getByLabelText("评论内容")).toHaveValue("");
    expect(fetch.mock.calls.find(([url]) => String(url).endsWith("/comments?locale=zh"))?.[1]?.body).toBe(JSON.stringify({ author_name: "Lin", body: "等待审核的评论" }));
  });

  it("appends later public comments without replacing the server total with the page length", async () => {
    stubFetch((url) => url.searchParams.get("page") === "2" ? Promise.resolve(response({ ...baseline, comments: [{ id: 2, author_name: "Bo", body: "第二页评论", created_at: "2026-10-01T11:00:00Z" }], page: 2, has_more: false })) : undefined);
    renderWithApp(<Workspace />);
    await userEvent.click(await screen.findByRole("button", { name: "加载更多评论" }));
    const list = screen.getByRole("feed", { name: "已公开评论" });
    expect(within(list).getByText("已公开的想法")).toBeInTheDocument();
    expect(within(list).getByText("第二页评论")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "加载更多评论" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "评论 2" })).toBeInTheDocument();
  });

  it("shows unavailable statistics instead of false zeros and retries failed loading", async () => {
    let loads = 0;
    stubFetch((url) => url.pathname.endsWith("/engagement") && ++loads === 1 ? Promise.resolve(failure()) : undefined);
    renderWithApp(<Workspace />);
    expect(await screen.findByRole("alert")).toHaveTextContent("互动数据加载失败");
    expect(screen.getByLabelText("访客数")).toHaveTextContent("—");
    await userEvent.click(screen.getByRole("button", { name: "重新加载互动" }));
    await screen.findByText("已公开的想法");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores stale requests across article changes and StrictMode cleanup", async () => {
    const old = deferred<Response>();
    const fetch = stubFetch((url) => url.pathname.includes("/old/") ? old.promise : undefined);
    const { rerender } = renderWithApp(<StrictMode><Workspace slug="old" /></StrictMode>);
    rerender(<StrictMode><Workspace slug="new" /></StrictMode>);
    await screen.findByText("已公开的想法");
    await act(async () => old.resolve(response({ ...baseline, like_count: 99, comments: [{ id: 99, author_name: "old", body: "旧文章内容", created_at: "2026-10-01" }] })));
    expect(screen.queryByText("旧文章内容")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "点赞 3" })).toBeEnabled();
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("/old/view"))).toHaveLength(0);
  });
});
