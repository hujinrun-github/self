import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setCSRFToken } from "../../lib/api";
import type { AdminComment, CommentStatus, WritingStats } from "../../lib/engagement";
import { renderWithApp } from "../../test/render";
import { EngagementPage } from "./EngagementPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setCSRFToken("");
});

function comment(id: number, status: CommentStatus = "pending", writingID = 1): AdminComment {
  return {
    id, status, writing_id: writingID, writing_title: `文章 ${writingID}`, writing_slug: `article-${writingID}`,
    author_name: `读者 ${id}`, body: `评论内容 ${id}`, created_at: "2026-10-01T08:00:00Z", updated_at: "2026-10-01T08:00:00Z",
  };
}

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" }, status });
}

function installAPI(options: {
  comments?: AdminComment[];
  articleCount?: number;
  statsFailures?: number;
  commentsFailures?: number;
  mutationFailures?: number;
  waitForMutation?: Promise<void>;
} = {}) {
  let comments = options.comments ?? [comment(1), comment(2, "published"), comment(3, "hidden")];
  let statsFailures = options.statsFailures ?? 0;
  let commentsFailures = options.commentsFailures ?? 0;
  let mutationFailures = options.mutationFailures ?? 0;
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://localhost");
    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const pageResult = <T,>(items: T[]) => ({ items: items.slice((page - 1) * limit, page * limit), total: items.length, page, limit, has_more: page * limit < items.length });
    const failure = (message: string) => response({ error: { code: "unavailable", message } }, 503);
    if (url.pathname === "/api/admin/writing/stats") {
      if (statsFailures-- > 0) return failure("统计暂不可用");
      const items: WritingStats[] = Array.from({ length: options.articleCount ?? 2 }, (_, index) => ({
        writing_id: index + 1, title: `文章 ${index + 1}`, slug: `article-${index + 1}`, status: "published",
        view_count: 120, visitor_count: 88, like_count: 9,
        comment_count: comments.filter((item) => item.writing_id === index + 1 && item.status === "published").length,
        pending_comment_count: comments.filter((item) => item.writing_id === index + 1 && item.status === "pending").length,
      }));
      return response({ ...pageResult(items), summary: {
        view_count: 1234, visitor_count: 802, like_count: 57,
        comment_count: comments.filter((item) => item.status === "published").length,
        pending_comment_count: comments.filter((item) => item.status === "pending").length,
      } });
    }
    if (url.pathname === "/api/admin/comments") {
      if (commentsFailures-- > 0) return failure("评论暂不可用");
      const status = url.searchParams.get("status");
      const writingID = Number(url.searchParams.get("writing_id"));
      return response(pageResult(comments.filter((item) => (status === "all" || item.status === status) && (!writingID || item.writing_id === writingID))));
    }
    if (/^\/api\/admin\/comments\/\d+$/.test(url.pathname)) {
      if (options.waitForMutation) await options.waitForMutation;
      if (mutationFailures-- > 0) return failure("操作失败，请重试");
      const id = Number(url.pathname.split("/").at(-1));
      if (init?.method === "DELETE") {
        comments = comments.filter((item) => item.id !== id);
        return new Response(null, { status: 204 });
      }
      const status = (JSON.parse(String(init?.body)) as { status: CommentStatus }).status;
      comments = comments.map((item) => item.id === id ? { ...item, status } : item);
      return response(comments.find((item) => item.id === id));
    }
    throw new Error(`Unexpected request ${input}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPage() {
  renderWithApp(<MemoryRouter><EngagementPage /></MemoryRouter>);
}

async function openComments() {
  await userEvent.click(screen.getByRole("tab", { name: /评论审核/ }));
}

describe("EngagementPage", () => {
  it("shows server-wide totals and explains article visitor aggregation", async () => {
    const fetchMock = installAPI();
    renderPage();
    expect(await screen.findByText("1,234")).toBeInTheDocument();
    expect(screen.getByText("802")).toBeInTheDocument();
    expect(screen.getByText(/各文章访客数之和/)).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "每篇文章的互动统计" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url.includes("status=pending"))).toBe(true);
    await openComments();
    expect(await screen.findByText("评论内容 1")).toBeInTheDocument();
    expect(screen.queryByText("评论内容 2")).not.toBeInTheDocument();
  });

  it("approves a pending comment with CSRF and refreshes summary and review counts", async () => {
    const fetchMock = installAPI();
    setCSRFToken("admin-csrf");
    renderPage();
    await openComments();
    await screen.findByText("评论内容 1");
    await userEvent.click(screen.getByRole("button", { name: "批准公开" }));
    expect(await screen.findByText("评论已公开。")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("评论内容 1")).not.toBeInTheDocument());
    expect(screen.getByText("暂无待审核评论")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "待审核" })).getByText("0")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "已公开评论" })).getByText("2")).toBeInTheDocument();
    const mutation = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(mutation?.[0]).toBe("/api/admin/comments/1");
    expect(JSON.parse(String(mutation?.[1]?.body))).toEqual({ status: "published" });
    expect(new Headers(mutation?.[1]?.headers).get("X-CSRF-Token")).toBe("admin-csrf");
  });

  it("filters published and hidden comments and supports hiding then restoring review", async () => {
    const fetchMock = installAPI();
    renderPage();
    await openComments();
    await userEvent.selectOptions(screen.getByLabelText("评论状态"), "published");
    await screen.findByText("评论内容 2");
    await userEvent.click(screen.getByRole("button", { name: "隐藏" }));
    await screen.findByText("评论已隐藏。");
    await userEvent.selectOptions(screen.getByLabelText("评论状态"), "hidden");
    const row = await screen.findByRole("article", { name: "读者 2 的评论" });
    await userEvent.click(within(row).getByRole("button", { name: "恢复待审" }));
    await screen.findByText("评论已恢复待审核。");
    await userEvent.selectOptions(screen.getByLabelText("评论状态"), "pending");
    expect(await screen.findByText("评论内容 2")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH").map(([, init]) => JSON.parse(String(init?.body)).status)).toEqual(["hidden", "pending"]);
  });

  it("requires deletion confirmation and returns to the previous page after deleting its last comment", async () => {
    const fetchMock = installAPI({ comments: Array.from({ length: 21 }, (_, index) => comment(index + 1)) });
    renderPage();
    await openComments();
    await screen.findByText("评论内容 1");
    await userEvent.click(screen.getByRole("button", { name: "下一页评论" }));
    await screen.findByText("评论内容 21");
    await userEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(screen.getByText(/删除后无法恢复/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "取消删除" }));
    expect(screen.queryByRole("button", { name: "确认删除" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "删除" }));
    await userEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(await screen.findByText("评论内容 1")).toBeInTheDocument();
    expect(screen.queryByText("评论内容 21")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上一页评论" })).toBeDisabled();
    expect(screen.getByText("共 20 条评论")).toBeInTheDocument();
  });

  it("paginates article stats and scopes comments to a selected article", async () => {
    const fetchMock = installAPI({ articleCount: 21, comments: [comment(1, "pending", 21), comment(2)] });
    renderPage();
    await screen.findByText("1,234");
    await userEvent.click(screen.getByRole("button", { name: "下一页文章" }));
    expect(await screen.findByRole("link", { name: "文章 21" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "查看评论" }));
    expect(await screen.findByText("评论内容 1")).toBeInTheDocument();
    expect(screen.queryByText("评论内容 2")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url.includes("writing_id=21"))).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "查看全部文章" }));
    expect(await screen.findByText("评论内容 2")).toBeInTheDocument();
  });

  it("shows independent loading errors with retry without treating failures as empty data", async () => {
    installAPI({ statsFailures: 1, commentsFailures: 1 });
    renderPage();
    expect(await screen.findByText("统计暂不可用")).toBeInTheDocument();
    expect(screen.queryByText("还没有文章统计")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重试统计" }));
    expect(await screen.findByText("1,234")).toBeInTheDocument();
    await openComments();
    expect(await screen.findByText("评论暂不可用")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重试评论" }));
    expect(await screen.findByText("评论内容 1")).toBeInTheDocument();
  });

  it("retains a comment and enables retry after a failed moderation request", async () => {
    installAPI({ mutationFailures: 1 });
    renderPage();
    await openComments();
    await screen.findByText("评论内容 1");
    await userEvent.click(screen.getByRole("button", { name: "批准公开" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("操作失败，请重试");
    expect(screen.getByText("评论内容 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批准公开" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "批准公开" }));
    expect(await screen.findByText("评论已公开。")).toBeInTheDocument();
  });

  it("locks moderation and filters while a request is in flight", async () => {
    let finish!: () => void;
    const waitForMutation = new Promise<void>((resolve) => { finish = resolve; });
    const fetchMock = installAPI({ waitForMutation });
    renderPage();
    await openComments();
    await screen.findByText("评论内容 1");
    await userEvent.click(screen.getByRole("button", { name: "批准公开" }));
    expect(screen.getByRole("button", { name: "隐藏" })).toBeDisabled();
    expect(screen.getByLabelText("评论状态")).toBeDisabled();
    expect(screen.getByRole("button", { name: "刷新数据" })).toBeDisabled();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
    await act(async () => finish());
    expect(await screen.findByText("评论已公开。")).toBeInTheDocument();
  });
});
