import type { ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { APIRequestError } from "../../lib/api";
import { journalAPI } from "./api";
import { JournalPublicPage } from "./JournalPublicPage";
import type { JournalEntry, JournalScene, JournalUnlockSession } from "./types";

vi.mock("./api", () => ({
  journalAPI: {
    adminSession: vi.fn(),
    adminBooks: vi.fn(),
    entries: vi.fn(),
    entry: vi.fn(),
    saveEntry: vi.fn(),
    createEntry: vi.fn(),
    uploadAsset: vi.fn(),
    deleteEntry: vi.fn(),
    publicBooks: vi.fn(),
    publicSession: vi.fn(),
    unlock: vi.fn(),
    lock: vi.fn(),
    touch: vi.fn(),
    publicEntries: vi.fn(),
    publicEntry: vi.fn(),
    assetURL: (id: number, bookID?: number) =>
      bookID === undefined
        ? `/api/admin/journal/assets/${id}`
        : `/api/site/journal/notebooks/${bookID}/assets/${id}`,
  },
}));
vi.mock("../public/PublicLayout", () => ({
  PublicLayout: ({ children }: { children: ReactNode }) => (
    <div>
      <nav data-testid="public-navigation">作品集导航</nav>
      {children}
      <footer data-testid="public-footer">作品集页脚</footer>
    </div>
  ),
}));
vi.mock("./JournalCanvas", () => ({
  JournalCanvas: ({
    scene,
    readOnly,
    thumbnail,
    assetURL,
  }: {
    scene: JournalScene;
    readOnly?: boolean;
    thumbnail?: boolean;
    assetURL: (id: number) => string;
  }) => (
    <div
      data-testid={thumbnail ? "outgoing-canvas" : "canvas"}
      data-read-only={String(!!readOnly)}
    >
      {scene.elements.map((element) =>
        element.type === "photo" ? (
          <img key={element.id} src={assetURL(element.asset_id!)} alt="手帐照片" />
        ) : (
          <span key={element.id}>{element.text}</span>
        ),
      )}
      {!readOnly && <button type="button">修改测试画布</button>}
    </div>
  ),
}));

const book = { id: 1, public_title: "可分享的日常", cover_color: "#789888" };
function journalEntry(id: number, text: string): JournalEntry {
  return {
    id,
    notebook_id: 1,
    title: `私人标题 ${id}`,
    entry_date: "2026-10-08",
    mood: "😊",
    weather: "晴",
    tags: ["日常"],
    favorite: false,
    version: 1,
    deleted_at: null,
    created_at: "",
    updated_at: "2026-10-08T10:00:00Z",
    scene: {
      schemaVersion: 1,
      width: 800,
      height: 1100,
      paper: "plain",
      elements: [
        {
          id: `text-${id}`,
          type: "text",
          text,
          x: 10,
          y: 10,
          width: 500,
          height: 200,
          rotation: 0,
          locked: false,
        },
        {
          id: `photo-${id}`,
          type: "photo",
          asset_id: id + 100,
          x: 10,
          y: 250,
          width: 500,
          height: 300,
          rotation: 0,
          locked: false,
        },
      ],
    },
  };
}
const first = journalEntry(11, "第一页的私密内容");
const second = journalEntry(12, "第二页的私密内容");
const missingPage = "分享的这一页不存在或已删除。";
function apiError(status: number) {
  return new APIRequestError(status, {
    error: { code: "request_failed", message: "Request failed" },
  });
}
function granted(expiresIn = 60_000): JournalUnlockSession {
  return { unlocked: true, expires_at: new Date(Date.now() + expiresIn).toISOString() };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((pass, fail) => {
    resolve = pass;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function renderShare(path = "/zh/journal/1/read") {
  const router = createMemoryRouter(
    [
      { path: "/:locale/journal/:notebookId/read", element: <JournalPublicPage immersive /> },
      { path: "/:locale/journal/:notebookId", element: <JournalPublicPage /> },
      { path: "/:locale/journal", element: <div>手帐目录</div> },
    ],
    { initialEntries: [path] },
  );
  return { ...render(<RouterProvider router={router} />), router };
}
async function enterPassword() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("查看密码"), "example-passphrase");
  await user.click(screen.getByRole("button", { name: "打开手帐" }));
  return user;
}
async function unlockShare() {
  const user = await enterPassword();
  await screen.findByTestId("canvas");
  return user;
}
function expectPrivateViewsCleared() {
  expect(screen.queryByTestId("canvas")).not.toBeInTheDocument();
  expect(screen.queryByTestId("outgoing-canvas")).not.toBeInTheDocument();
  expect(screen.queryByText(first.title)).not.toBeInTheDocument();
  expect(screen.queryByText(second.title)).not.toBeInTheDocument();
  expect(screen.queryByText("第一页的私密内容")).not.toBeInTheDocument();
  expect(screen.queryByText("第二页的私密内容")).not.toBeInTheDocument();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(journalAPI.publicBooks).mockResolvedValue({ items: [book] });
  vi.mocked(journalAPI.publicSession).mockResolvedValue({ unlocked: false });
  vi.mocked(journalAPI.unlock).mockImplementation(async () => granted());
  vi.mocked(journalAPI.publicEntries).mockResolvedValue({ items: [first, second], total: 2 });
  vi.mocked(journalAPI.publicEntry).mockImplementation(async (_bookID, id) => {
    if (id === first.id) return first;
    if (id === second.id) return second;
    throw apiError(404);
  });
  vi.mocked(journalAPI.lock).mockResolvedValue(undefined);
  vi.mocked(journalAPI.touch).mockImplementation(async () => granted());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("fullscreen read-only journal share links", () => {
  it("asks for the viewing password without loading protected content or site chrome", async () => {
    renderShare("/zh/journal/1/read?entry=12");
    await screen.findByLabelText("查看密码");
    await waitFor(() => expect(journalAPI.publicSession).toHaveBeenCalledWith(1));
    expect(journalAPI.publicEntries).not.toHaveBeenCalled();
    expect(journalAPI.publicEntry).not.toHaveBeenCalled();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByTestId("public-navigation")).not.toBeInTheDocument();
    expect(screen.queryByTestId("public-footer")).not.toBeInTheDocument();
    expectPrivateViewsCleared();
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow, noarchive");
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).not.toContain(first.title);
    expect(journalAPI.adminSession).not.toHaveBeenCalled();
  });

  it("keeps incorrect and rate-limited passwords from requesting private pages", async () => {
    vi.mocked(journalAPI.unlock)
      .mockRejectedValueOnce(apiError(401))
      .mockRejectedValueOnce(apiError(429));
    renderShare();
    const user = await enterPassword();
    expect(await screen.findByRole("alert")).toHaveTextContent("密码不正确");
    await user.type(screen.getByLabelText("查看密码"), "another-passphrase");
    await user.click(screen.getByRole("button", { name: "打开手帐" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("尝试过于频繁");
    expect(journalAPI.publicEntries).not.toHaveBeenCalled();
    expect(journalAPI.publicEntry).not.toHaveBeenCalled();
    expectPrivateViewsCleared();
  });

  it("opens the first page automatically after unlocking and exposes only reader controls", async () => {
    renderShare();
    await unlockShare();
    expect(journalAPI.publicEntry).toHaveBeenCalledWith(1, first.id);
    expect(screen.getByTestId("canvas")).toHaveAttribute("data-read-only", "true");
    expect(screen.getByTestId("canvas")).toHaveTextContent("第一页的私密内容");
    expect(screen.getByRole("img", { name: "手帐照片" })).toHaveAttribute("src", "/api/site/journal/notebooks/1/assets/111");
    expect(screen.queryByRole("button", { name: /修改|保存|上传|删除|编辑|导出/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /编辑/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("public-navigation")).not.toBeInTheDocument();
    expect(screen.queryByTestId("public-footer")).not.toBeInTheDocument();
    for (const method of [journalAPI.adminSession, journalAPI.adminBooks, journalAPI.entries, journalAPI.entry, journalAPI.saveEntry, journalAPI.createEntry, journalAPI.uploadAsset, journalAPI.deleteEntry]) {
      expect(method).not.toHaveBeenCalled();
    }
  });

  it("opens the requested page using a fresh public entry response", async () => {
    const latest = { ...second, title: "指定书页的最新标题" };
    vi.mocked(journalAPI.publicEntry).mockResolvedValueOnce(latest);
    renderShare("/zh/journal/1/read?entry=12");
    await unlockShare();
    expect(journalAPI.publicEntry).toHaveBeenCalledWith(1, second.id);
    expect(screen.getByRole("heading", { name: latest.title })).toBeInTheDocument();
    expect(screen.getByTestId("canvas")).toHaveTextContent("第二页的私密内容");
    expect(screen.queryByText(first.title)).not.toBeInTheDocument();
    expect(screen.queryByText(second.title)).not.toBeInTheDocument();
  });

  it("restores a valid viewing session and reads the requested page without administrator APIs", async () => {
    vi.mocked(journalAPI.publicSession).mockImplementation(async () => granted());
    renderShare("/zh/journal/1/read?entry=12");
    await screen.findByTestId("canvas");
    expect(journalAPI.unlock).not.toHaveBeenCalled();
    expect(journalAPI.publicEntry).toHaveBeenCalledWith(1, 12);
    expect(journalAPI.adminSession).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("查看密码")).not.toBeInTheDocument();
  });

  it("does not offer access to a notebook that is no longer publicly available", async () => {
    vi.mocked(journalAPI.publicBooks).mockResolvedValue({ items: [] });
    renderShare("/zh/journal/1/read?entry=12");
    expect(await screen.findByRole("heading", { name: "这本手帐暂未开放。" })).toBeInTheDocument();
    expect(screen.queryByLabelText("查看密码")).not.toBeInTheDocument();
    expect(journalAPI.publicSession).not.toHaveBeenCalled();
    expect(journalAPI.publicEntries).not.toHaveBeenCalled();
    expectPrivateViewsCleared();
  });

  it("shows an empty read-only notebook without requesting an unrelated entry", async () => {
    vi.mocked(journalAPI.publicEntries).mockResolvedValue({ items: [], total: 0 });
    renderShare();
    await enterPassword();
    expect(await screen.findByRole("heading", { name: "这里还没有记录" })).toBeInTheDocument();
    expect(journalAPI.publicEntry).not.toHaveBeenCalled();
    expectPrivateViewsCleared();
  });

  it.each(["", "0", "-1", "1.5", "abc", "9007199254740992"])("rejects invalid entry parameter %j without opening another page", async (value) => {
    renderShare(`/zh/journal/1/read?entry=${encodeURIComponent(value)}`);
    await enterPassword();
    expect(await screen.findByText(missingPage)).toBeInTheDocument();
    expect(journalAPI.publicEntry).not.toHaveBeenCalled();
    expectPrivateViewsCleared();
  });

  it("does not fall back to a different page when the requested entry belongs to another notebook", async () => {
    renderShare("/zh/journal/1/read?entry=21");
    await enterPassword();
    expect(await screen.findByText(missingPage)).toBeInTheDocument();
    expectPrivateViewsCleared();
  });

  it("reports a page deleted after listing without selecting a neighboring page", async () => {
    vi.mocked(journalAPI.publicEntry).mockRejectedValueOnce(apiError(404));
    renderShare("/zh/journal/1/read?entry=12");
    await enterPassword();
    expect(await screen.findByText(missingPage)).toBeInTheDocument();
    expectPrivateViewsCleared();
    expect(journalAPI.publicEntry).toHaveBeenCalledWith(1, 12);
  });

  it.each([
    { ...second, notebook_id: 2 },
    { ...second, id: 21 },
    { ...second, deleted_at: "2026-10-08T12:00:00Z" },
  ])("does not render an entry response outside the requested live page", async (response) => {
    vi.mocked(journalAPI.publicEntry).mockResolvedValueOnce(response);
    renderShare("/zh/journal/1/read?entry=12");
    await enterPassword();
    expect(await screen.findByText(missingPage)).toBeInTheDocument();
    expectPrivateViewsCleared();
  });

  it.each([401, 403])("locks a shared reader when a page request denies access with %i", async (status) => {
    renderShare();
    const user = await unlockShare();
    vi.mocked(journalAPI.publicEntry).mockRejectedValueOnce(apiError(status));
    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(await screen.findByLabelText("查看密码")).toBeInTheDocument();
    expectPrivateViewsCleared();
  });

  it("removes current and outgoing animated canvases immediately when locked", async () => {
    renderShare();
    const user = await unlockShare();
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByRole("heading", { name: second.title });
    expect(screen.getByTestId("outgoing-canvas")).toHaveAttribute("data-read-only", "true");
    await user.click(screen.getByRole("button", { name: "锁定" }));
    expect(screen.getByLabelText("查看密码")).toBeInTheDocument();
    expectPrivateViewsCleared();
    expect(journalAPI.lock).toHaveBeenCalledWith(1);
  });

  it("does not restore a delayed first-page response after locking", async () => {
    const pending = deferred<JournalEntry>();
    vi.mocked(journalAPI.publicEntry).mockReturnValueOnce(pending.promise);
    renderShare();
    const user = await enterPassword();
    await waitFor(() => expect(journalAPI.publicEntry).toHaveBeenCalledWith(1, 11));
    await user.click(screen.getByRole("button", { name: "锁定" }));
    await act(async () => pending.resolve(first));
    expect(screen.getByLabelText("查看密码")).toBeInTheDocument();
    expectPrivateViewsCleared();
  });

  it("does not restore an old initial session response after an explicit lock", async () => {
    const pending = deferred<JournalUnlockSession>();
    vi.mocked(journalAPI.publicSession).mockReturnValueOnce(pending.promise);
    renderShare();
    const user = await unlockShare();
    await user.click(screen.getByRole("button", { name: "锁定" }));
    await act(async () => pending.resolve(granted()));
    expect(screen.getByLabelText("查看密码")).toBeInTheDocument();
    expectPrivateViewsCleared();
    expect(journalAPI.publicEntries).toHaveBeenCalledTimes(1);
  });

  it("locks at the server deadline and discards a page response arriving after expiry", async () => {
    const pending = deferred<JournalEntry>();
    vi.mocked(journalAPI.unlock).mockImplementation(async () => granted(400));
    vi.mocked(journalAPI.publicEntry).mockImplementation(async (_bookID, id) => id === second.id ? pending.promise : first);
    renderShare();
    const user = await unlockShare();
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(screen.getByLabelText("查看密码")).toBeInTheDocument(), { timeout: 1500 });
    await act(async () => pending.resolve(second));
    expectPrivateViewsCleared();
    expect(journalAPI.touch).not.toHaveBeenCalled();
  });

  it("hides protected pages during overlapping foreground checks and rejects stale responses", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    renderShare();
    const user = await unlockShare();
    const pendingPage = deferred<JournalEntry>();
    vi.mocked(journalAPI.publicEntry).mockReturnValueOnce(pendingPage.promise);
    await user.click(screen.getByRole("button", { name: "下一页" }));
    const oldCheck = deferred<JournalUnlockSession>();
    const newCheck = deferred<JournalUnlockSession>();
    vi.mocked(journalAPI.publicSession)
      .mockReturnValueOnce(oldCheck.promise)
      .mockReturnValueOnce(newCheck.promise);
    fireEvent(document, new Event("visibilitychange"));
    fireEvent(document, new Event("visibilitychange"));
    expectPrivateViewsCleared();
    await act(async () => {
      pendingPage.resolve(second);
      oldCheck.resolve(granted());
    });
    expectPrivateViewsCleared();
    expect(screen.getByRole("status")).toHaveTextContent("正在验证");
    await act(async () => newCheck.reject(apiError(401)));
    expect(await screen.findByLabelText("查看密码")).toBeInTheDocument();
    expectPrivateViewsCleared();
  });

  it("reloads the first shared page after foreground validation cancels its initial request", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const oldPage = deferred<JournalEntry>();
    vi.mocked(journalAPI.publicEntry).mockReturnValueOnce(oldPage.promise);
    renderShare();
    await enterPassword();
    await waitFor(() => expect(journalAPI.publicEntry).toHaveBeenCalledWith(1, first.id));
    const check = deferred<JournalUnlockSession>();
    vi.mocked(journalAPI.publicSession).mockReturnValueOnce(check.promise);
    fireEvent(document, new Event("visibilitychange"));
    expectPrivateViewsCleared();
    await act(async () => check.resolve(granted()));
    expect(await screen.findByTestId("canvas")).toHaveTextContent("第一页的私密内容");
    expect(journalAPI.publicEntry).toHaveBeenCalledTimes(2);
    await act(async () => oldPage.resolve({ ...first, title: "已经取消的旧请求" }));
    expect(screen.queryByText("已经取消的旧请求")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: first.title })).toBeInTheDocument();
  });

  it("still restores a cancelled first page when a newer polling check overtakes foreground validation", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const intervals = vi.spyOn(window, "setInterval");
    const oldPage = deferred<JournalEntry>();
    vi.mocked(journalAPI.publicEntry).mockReturnValueOnce(oldPage.promise);
    renderShare();
    await enterPassword();
    await waitFor(() => expect(journalAPI.publicEntry).toHaveBeenCalledWith(1, first.id));
    const foreground = deferred<JournalUnlockSession>();
    const polling = deferred<JournalUnlockSession>();
    vi.mocked(journalAPI.publicSession)
      .mockReturnValueOnce(foreground.promise)
      .mockReturnValueOnce(polling.promise);
    fireEvent(document, new Event("visibilitychange"));
    const poll = intervals.mock.calls.find(([, delay]) => delay === 30_000)?.[0];
    expect(typeof poll).toBe("function");
    act(() => (poll as () => void)());
    await act(async () => polling.resolve(granted()));
    expect(await screen.findByTestId("canvas")).toHaveTextContent("第一页的私密内容");
    await act(async () => {
      foreground.resolve(granted());
      oldPage.resolve({ ...first, title: "已经取消的旧请求" });
    });
    expect(screen.queryByText("已经取消的旧请求")).not.toBeInTheDocument();
    expect(journalAPI.publicEntry).toHaveBeenCalledTimes(2);
  });

  it("treats a missing entry query differently from an explicitly empty entry query", async () => {
    const { router } = renderShare();
    await unlockShare();
    vi.mocked(journalAPI.publicSession).mockImplementation(async () => granted());
    await act(async () => router.navigate("/zh/journal/1/read?entry="));
    expect(await screen.findByText(missingPage)).toBeInTheDocument();
    expectPrivateViewsCleared();
    // Only the original URL was allowed to request its default first page.
    expect(journalAPI.publicEntry).toHaveBeenCalledTimes(1);
  });

  it("uses the newest share query when an older page fetch finishes late", async () => {
    const pending = deferred<JournalEntry>();
    vi.mocked(journalAPI.publicEntry).mockReturnValueOnce(pending.promise);
    const { router } = renderShare("/zh/journal/1/read?entry=11");
    await enterPassword();
    await waitFor(() => expect(journalAPI.publicEntry).toHaveBeenCalledWith(1, 11));
    // Changing the share URL remounts the reader; the viewing cookie persists.
    vi.mocked(journalAPI.publicSession).mockImplementation(async () => granted());
    await act(async () => router.navigate("/zh/journal/1/read?entry=12"));
    await screen.findByRole("heading", { name: second.title });
    await act(async () => pending.resolve(first));
    expect(screen.getByTestId("canvas")).toHaveTextContent("第二页的私密内容");
    expect(screen.queryByText(first.title)).not.toBeInTheDocument();
    expect(screen.queryByTestId("outgoing-canvas")).not.toBeInTheDocument();
  });

  it("ignores a pending share page after switching to a locked notebook", async () => {
    const otherBook = { ...book, id: 2, public_title: "另一本受保护手帐" };
    vi.mocked(journalAPI.publicBooks).mockResolvedValue({ items: [book, otherBook] });
    const pending = deferred<JournalEntry>();
    vi.mocked(journalAPI.publicEntry).mockReturnValueOnce(pending.promise);
    const { router } = renderShare("/zh/journal/1/read?entry=11");
    await enterPassword();
    await waitFor(() => expect(journalAPI.publicEntry).toHaveBeenCalledWith(1, 11));
    await act(async () => router.navigate("/zh/journal/2/read?entry=21"));
    expect(await screen.findByRole("heading", { name: otherBook.public_title })).toBeInTheDocument();
    await act(async () => pending.resolve(first));
    expect(screen.getByLabelText("查看密码")).toBeInTheDocument();
    expectPrivateViewsCleared();
    expect(journalAPI.publicSession).toHaveBeenLastCalledWith(2);
  });

  it("does not reopen a delayed shared page after returning to the ordinary notebook page", async () => {
    const pending = deferred<JournalEntry>();
    vi.mocked(journalAPI.publicEntry).mockReturnValueOnce(pending.promise);
    const { router } = renderShare("/zh/journal/1/read?entry=11");
    await enterPassword();
    await waitFor(() => expect(journalAPI.publicEntry).toHaveBeenCalledWith(1, 11));
    await act(async () => router.navigate("/zh/journal/1"));
    await act(async () => pending.resolve(first));
    expect(screen.getByTestId("public-navigation")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "手帐书页阅读器" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("canvas")).not.toBeInTheDocument();
  });
});
