import type { ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { APIRequestError } from "../../lib/api";
import { journalAPI } from "./api";
import { JournalAdminPage } from "./JournalAdminPage";
import { JournalEntryPage } from "./JournalEntryPage";
import { JournalPublicPage } from "./JournalPublicPage";
import { JournalCollection } from "./JournalCollection";
import { todayDate } from "./journalHelpers";
import type {
  JournalEntry,
  JournalNotebook,
  JournalScene,
  JournalUnlockSession,
} from "./types";

vi.mock("./api", () => ({
  journalAPI: {
    adminSession: vi.fn(),
    adminBooks: vi.fn(),
    entries: vi.fn(),
    entry: vi.fn(),
    createBook: vi.fn(),
    updateBook: vi.fn(),
    deleteBook: vi.fn(),
    createEntry: vi.fn(),
    saveEntry: vi.fn(),
    deleteEntry: vi.fn(),
    restoreEntry: vi.fn(),
    uploadAsset: vi.fn(),
    importArchive: vi.fn(),
    publicBooks: vi.fn(),
    publicSession: vi.fn(),
    unlock: vi.fn(),
    lock: vi.fn(),
    touch: vi.fn(),
    publicEntries: vi.fn(),
    publicEntry: vi.fn(),
    assetURL: (id: number, bookID?: number) =>
      bookID
        ? `/api/site/journal/notebooks/${bookID}/assets/${id}`
        : `/api/admin/journal/assets/${id}`,
  },
}));
vi.mock("./export", () => ({
  downloadJournalArchive: vi.fn(),
  exportJournalEntry: vi.fn(),
  exportJournalEntries: vi.fn(),
  exportJournalText: vi.fn(),
}));
vi.mock("./JournalCanvas", () => ({
  JournalCanvas: ({
    scene,
    onChange,
    readOnly,
    thumbnail,
    toolbarActions,
  }: {
    scene: JournalScene;
    onChange?: (s: JournalScene) => void;
    readOnly?: boolean;
    thumbnail?: boolean;
    toolbarActions?: ReactNode;
  }) => (
    <div data-testid={thumbnail ? "preview" : "canvas"}>
      {toolbarActions}
      {scene.elements.map((e) => (
        <span key={e.id}>{e.text}</span>
      ))}
      {!readOnly && (
        <button
          type="button"
          onClick={() =>
            onChange?.({
              ...scene,
              elements: [
                ...scene.elements,
                {
                  id: "new-text",
                  type: "text",
                  text: "本地未同步文字",
                  x: 5,
                  y: 5,
                  width: 100,
                  height: 50,
                  rotation: 0,
                  locked: false,
                },
              ],
            })
          }
        >
          添加测试文字
        </button>
      )}
    </div>
  ),
}));
const notebook: JournalNotebook = {
  id: 1,
  name: "私人日常",
  public_title: "公开的日常",
  cover_color: "#789888",
  paper: "plain",
  has_password: false,
  public_enabled: false,
  archived: false,
  version: 1,
  created_at: "",
  updated_at: "",
};
const entry: JournalEntry = {
  id: 11,
  notebook_id: 1,
  title: "不应提前泄露的标题",
  entry_date: todayDate(),
  mood: "😊",
  weather: "晴",
  tags: ["生活"],
  favorite: false,
  version: 1,
  deleted_at: null,
  created_at: "",
  updated_at: "2026-10-03T10:00:00Z",
  scene: {
    schemaVersion: 1,
    width: 800,
    height: 1100,
    paper: "plain",
    elements: [
      {
        id: "text1",
        type: "text",
        text: "受保护的私人文字",
        x: 10,
        y: 10,
        width: 500,
        height: 200,
        rotation: 0,
        locked: false,
      },
    ],
  },
};
function error(status: number, message = "Request failed") {
  return new APIRequestError(status, { error: { code: "error", message } });
}
function renderPage(path: string) {
  const router = createMemoryRouter(
    [
      { path: "/:locale/journal/:notebookId?", element: <JournalPublicPage /> },
      { path: "/admin/journal", element: <JournalAdminPage /> },
      {
        path: "/admin/journal/entries/:entryId",
        element: <JournalEntryPage />,
      },
      { path: "/admin/journal/new", element: <JournalEntryPage /> },
    ],
    { initialEntries: [path] },
  );
  return { ...render(<RouterProvider router={router} />), router };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(journalAPI.adminSession).mockResolvedValue({
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    server_time: new Date().toISOString(),
  });
  vi.mocked(journalAPI.adminBooks).mockResolvedValue({ items: [notebook] });
  vi.mocked(journalAPI.entry).mockResolvedValue(entry);
  vi.mocked(journalAPI.entries).mockResolvedValue({ items: [entry], total: 1 });
  vi.mocked(journalAPI.publicBooks).mockResolvedValue({
    items: [
      {
        id: 1,
        public_title: notebook.public_title,
        cover_color: notebook.cover_color,
      },
    ],
  });
  vi.mocked(journalAPI.publicSession).mockResolvedValue({ unlocked: false });
  vi.mocked(journalAPI.unlock).mockResolvedValue({
    unlocked: true,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  vi.mocked(journalAPI.publicEntries).mockResolvedValue({
    items: [entry],
    total: 1,
  });
  vi.mocked(journalAPI.publicEntry).mockResolvedValue(entry);
  vi.mocked(journalAPI.lock).mockResolvedValue(undefined);
  vi.mocked(journalAPI.saveEntry).mockImplementation(async (_id, input) => ({
    ...entry,
    ...input,
    notebook_id: input.notebook_id ?? 1,
    version: 2,
  }));
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function unlockBook() {
  const user = userEvent.setup();
  await user.type(
    await screen.findByLabelText("查看密码"),
    "example-passphrase",
  );
  await user.click(screen.getByRole("button", { name: "打开手帐" }));
  await screen.findByText(entry.title);
  return user;
}

describe("password protected public journals", () => {
  it("loads only public card data and a session check before unlocking, never private content", async () => {
    renderPage("/zh/journal/1");
    expect(
      await screen.findByRole("heading", { name: notebook.public_title }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("查看密码")).toBeInTheDocument();
    expect(journalAPI.publicEntries).not.toHaveBeenCalled();
    expect(journalAPI.publicEntry).not.toHaveBeenCalled();
    expect(screen.queryByText(entry.title)).not.toBeInTheDocument();
    expect(screen.queryByTestId("canvas")).not.toBeInTheDocument();
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow, noarchive",
    );
  });
  it("does not request private contents after an invalid password and distinguishes rate limits", async () => {
    const user = userEvent.setup();
    vi.mocked(journalAPI.unlock)
      .mockRejectedValueOnce(error(401))
      .mockRejectedValueOnce(error(429));
    renderPage("/zh/journal/1");
    await user.type(await screen.findByLabelText("查看密码"), "wrong");
    await user.click(screen.getByRole("button", { name: "打开手帐" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("密码不正确");
    await user.type(screen.getByLabelText("查看密码"), "wrong-again");
    await user.click(screen.getByRole("button", { name: "打开手帐" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("尝试过于频繁");
    expect(journalAPI.publicEntries).not.toHaveBeenCalled();
  });
  it("unlocks without an account and clears all private views on an explicit lock", async () => {
    renderPage("/zh/journal/1");
    const user = await unlockBook();
    expect(journalAPI.unlock).toHaveBeenCalledWith(1, "example-passphrase");
    expect(journalAPI.publicEntries).toHaveBeenCalledWith(1, {
      limit: 100,
      offset: 0,
    });
    expect(
      screen.queryByRole("button", { name: /PNG|PDF|导出|编辑/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "锁定" }));
    expect(screen.getByLabelText("查看密码")).toBeInTheDocument();
    expect(screen.queryByText(entry.title)).not.toBeInTheDocument();
    expect(screen.queryByText("受保护的私人文字")).not.toBeInTheDocument();
    expect(journalAPI.lock).toHaveBeenCalledWith(1);
  });
  it("does not restore access when an initial session response arrives after a manual lock", async () => {
    let finishInitialSession: (session: JournalUnlockSession) => void = () => {};
    vi.mocked(journalAPI.publicSession).mockImplementationOnce(
      () => new Promise((resolve) => { finishInitialSession = resolve; }),
    );
    renderPage("/zh/journal/1");
    const user = await unlockBook();
    await user.click(screen.getByRole("button", { name: "锁定" }));
    expect(screen.getByLabelText("查看密码")).toBeInTheDocument();
    await act(async () => {
      finishInitialSession({
        unlocked: true,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
    });
    expect(screen.getByLabelText("查看密码")).toBeInTheDocument();
    expect(screen.queryByText(entry.title)).not.toBeInTheDocument();
    expect(screen.queryByText("受保护的私人文字")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "手帐书页阅读器" })).not.toBeInTheDocument();
    expect(journalAPI.publicEntries).toHaveBeenCalledTimes(1);
  });
  it("hides content during foreground validation and removes it after revocation", async () => {
    const next: JournalEntry = {
      ...entry,
      id: 12,
      title: "另一页",
      scene: {
        ...entry.scene,
        elements: [{ ...entry.scene.elements[0], text: "第二页的受保护文字" }],
      },
    };
    vi.mocked(journalAPI.publicEntries).mockResolvedValue({ items: [entry, next], total: 2 });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    renderPage("/zh/journal/1");
    const user = await unlockBook();
    await user.click(screen.getByRole("button", { name: "翻阅手帐" }));
    await screen.findByTestId("canvas");
    vi.mocked(journalAPI.publicEntry).mockResolvedValueOnce(next);
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByRole("heading", { name: next.title });
    expect(screen.getByTestId("preview")).toHaveTextContent("受保护的私人文字");
    expect(screen.getByTestId("canvas")).toHaveTextContent("第二页的受保护文字");
    let rejectSession: (reason: unknown) => void = () => {};
    vi.mocked(journalAPI.publicSession).mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectSession = reject;
      }),
    );
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.queryByText(entry.title)).not.toBeInTheDocument();
    expect(screen.queryByText(next.title)).not.toBeInTheDocument();
    expect(screen.queryByText("受保护的私人文字")).not.toBeInTheDocument();
    expect(screen.queryByText("第二页的受保护文字")).not.toBeInTheDocument();
    expect(screen.queryByTestId("canvas")).not.toBeInTheDocument();
    expect(screen.queryByTestId("preview")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("正在验证");
    await act(async () => {
      rejectSession(error(401));
    });
    expect(await screen.findByLabelText("查看密码")).toBeInTheDocument();
    expect(screen.queryByText("受保护的私人文字")).not.toBeInTheDocument();
    expect(screen.queryByText("第二页的受保护文字")).not.toBeInTheDocument();
  });
  it("keeps the reader hidden until the newest overlapping foreground check completes", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    renderPage("/zh/journal/1");
    const user = await unlockBook();
    await user.click(screen.getByRole("button", { name: "翻阅手帐" }));
    await screen.findByTestId("canvas");
    let finishOlderCheck: (session: JournalUnlockSession) => void = () => {};
    let rejectNewerCheck: (reason: unknown) => void = () => {};
    vi.mocked(journalAPI.publicSession)
      .mockImplementationOnce(
        () => new Promise((resolve) => { finishOlderCheck = resolve; }),
      )
      .mockImplementationOnce(
        () => new Promise((_resolve, reject) => { rejectNewerCheck = reject; }),
      );
    fireEvent(document, new Event("visibilitychange"));
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.queryByTestId("canvas")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("正在验证");
    await act(async () => {
      finishOlderCheck({
        unlocked: true,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
    });
    expect(screen.getByRole("status")).toHaveTextContent("正在验证");
    expect(screen.queryByRole("region", { name: "手帐书页阅读器" })).not.toBeInTheDocument();
    expect(screen.queryByText(entry.title)).not.toBeInTheDocument();
    expect(screen.queryByText("受保护的私人文字")).not.toBeInTheDocument();
    await act(async () => rejectNewerCheck(error(401)));
    expect(await screen.findByLabelText("查看密码")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("手帐已锁定");
    expect(screen.queryByTestId("canvas")).not.toBeInTheDocument();
    expect(screen.queryByText("受保护的私人文字")).not.toBeInTheDocument();
  });
  it("locks at the server supplied deadline without waiting for polling", async () => {
    vi.mocked(journalAPI.unlock).mockResolvedValue({
      unlocked: true,
      expires_at: new Date(Date.now() + 500).toISOString(),
    });
    renderPage("/zh/journal/1");
    await unlockBook();
    await waitFor(
      () => expect(screen.getByLabelText("查看密码")).toBeInTheDocument(),
      { timeout: 1500 },
    );
    expect(screen.queryByText(entry.title)).not.toBeInTheDocument();
    expect(journalAPI.touch).not.toHaveBeenCalled();
  });
  it("keeps the current book page while fetching the next and after a failed turn", async () => {
    const next = { ...entry, id: 12, title: "另一页", scene: { ...entry.scene, elements: [] } };
    vi.mocked(journalAPI.publicEntries).mockResolvedValue({ items: [entry, next], total: 2 });
    renderPage("/zh/journal/1");
    const user = await unlockBook();
    await user.click(screen.getByRole("button", { name: "翻阅手帐" }));
    await screen.findByRole("region", { name: "手帐书页阅读器" });
    let reject: (reason: unknown) => void = () => {};
    vi.mocked(journalAPI.publicEntry).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByTestId("canvas")).toHaveTextContent("受保护的私人文字");
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
    await act(async () => reject(error(500)));
    expect(await screen.findByRole("alert")).toHaveTextContent("加载失败");
    expect(screen.getByTestId("canvas")).toHaveTextContent("受保护的私人文字");
    expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled();
  });
  it("ignores a page response after returning to the collection", async () => {
    const next = { ...entry, id: 12, title: "另一页" };
    vi.mocked(journalAPI.publicEntries).mockResolvedValue({ items: [entry, next], total: 2 });
    renderPage("/zh/journal/1");
    const user = await unlockBook();
    await user.click(screen.getByRole("button", { name: "翻阅手帐" }));
    await screen.findByTestId("canvas");
    let finish: (value: JournalEntry) => void = () => {};
    vi.mocked(journalAPI.publicEntry).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await user.click(screen.getByRole("button", { name: "返回所有记录" }));
    await act(async () => finish(next));
    expect(screen.queryByRole("region", { name: "手帐书页阅读器" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "翻阅手帐" })).toBeEnabled();
  });
  it("does not restore a pending page after switching to another notebook", async () => {
    const next: JournalEntry = {
      ...entry,
      id: 12,
      title: "迟到的另一页",
      scene: {
        ...entry.scene,
        elements: [{ ...entry.scene.elements[0], text: "只属于第一本的私人文字" }],
      },
    };
    vi.mocked(journalAPI.publicBooks).mockResolvedValue({
      items: [
        { id: 1, public_title: notebook.public_title, cover_color: notebook.cover_color },
        { id: 2, public_title: "另一本手帐", cover_color: "#887799" },
      ],
    });
    vi.mocked(journalAPI.publicEntries).mockResolvedValue({ items: [entry, next], total: 2 });
    const { router } = renderPage("/zh/journal/1");
    const user = await unlockBook();
    await user.click(screen.getByRole("button", { name: "翻阅手帐" }));
    await screen.findByTestId("canvas");
    let finishPage: (value: JournalEntry) => void = () => {};
    vi.mocked(journalAPI.publicEntry).mockImplementationOnce(
      () => new Promise((resolve) => { finishPage = resolve; }),
    );
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await act(async () => router.navigate("/zh/journal/2"));
    expect(await screen.findByRole("heading", { name: "另一本手帐" })).toBeInTheDocument();
    expect(screen.getByLabelText("查看密码")).toBeInTheDocument();
    await act(async () => finishPage(next));
    expect(screen.getByLabelText("查看密码")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "手帐书页阅读器" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("canvas")).not.toBeInTheDocument();
    expect(screen.queryByText(next.title)).not.toBeInTheDocument();
    expect(screen.queryByText("只属于第一本的私人文字")).not.toBeInTheDocument();
    expect(journalAPI.publicSession).toHaveBeenLastCalledWith(2);
  });
  it("discards pending and animated pages immediately when the book is locked", async () => {
    const next = { ...entry, id: 12, title: "另一页", scene: { ...entry.scene, elements: [] } };
    vi.mocked(journalAPI.publicEntries).mockResolvedValue({ items: [entry, next], total: 2 });
    renderPage("/zh/journal/1");
    const user = await unlockBook();
    await user.click(screen.getByRole("button", { name: "翻阅手帐" }));
    await screen.findByTestId("canvas");
    vi.mocked(journalAPI.publicEntry).mockResolvedValueOnce(next);
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByRole("heading", { name: "另一页" });
    await user.click(screen.getByRole("button", { name: "锁定" }));
    expect(screen.getByLabelText("查看密码")).toBeInTheDocument();
    expect(screen.queryByText("受保护的私人文字")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "另一页" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "手帐书页阅读器" })).not.toBeInTheDocument();
  });
  it("does not restore a pending page after locking or a revoked page request", async () => {
    const next = { ...entry, id: 12, title: "另一页" };
    vi.mocked(journalAPI.publicEntries).mockResolvedValue({ items: [entry, next], total: 2 });
    renderPage("/zh/journal/1");
    const user = await unlockBook();
    await user.click(screen.getByRole("button", { name: "翻阅手帐" }));
    await screen.findByTestId("canvas");
    let finish: (value: JournalEntry) => void = () => {};
    vi.mocked(journalAPI.publicEntry).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await user.click(screen.getByRole("button", { name: "锁定" }));
    await act(async () => finish(next));
    expect(screen.getByLabelText("查看密码")).toBeInTheDocument();
    expect(screen.queryByText("另一页")).not.toBeInTheDocument();
    const secondUser = await unlockBook();
    await secondUser.click(screen.getByRole("button", { name: "翻阅手帐" }));
    await screen.findByTestId("canvas");
    vi.mocked(journalAPI.publicEntry).mockRejectedValueOnce(error(401));
    await secondUser.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByLabelText("查看密码");
    expect(screen.queryByTestId("canvas")).not.toBeInTheDocument();
  });
});

describe("administrator journal management", () => {
  it("can flip through a notebook directly and return to editing without a viewing password", async () => {
    const user = userEvent.setup();
    renderPage("/admin/journal");
    await user.click(await screen.findByRole("button", { name: notebook.name }));
    await user.click(await screen.findByRole("button", { name: "翻阅手帐" }));
    await screen.findByRole("region", { name: "手帐书页阅读器" });
    expect(screen.queryByLabelText("查看密码")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "编辑这一页" })).toHaveAttribute("href", "/admin/journal/entries/11");
    await user.click(screen.getByRole("button", { name: "返回所有记录" }));
    expect(screen.queryByRole("region", { name: "手帐书页阅读器" })).not.toBeInTheDocument();
  });
  it("announces manual save only after the server accepts the content", async () => {
    let finish: (value: JournalEntry) => void = () => {};
    vi.mocked(journalAPI.saveEntry).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    renderPage("/admin/journal/entries/11");
    const title = await screen.findByLabelText("标题（可选）");
    await user.clear(title);
    await user.type(title, "手动保存的标题");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(
      screen.queryByRole("status", { name: "保存结果" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    await act(async () =>
      finish({ ...entry, title: "手动保存的标题", version: 2 }),
    );
    expect(
      await screen.findByRole("status", { name: "保存结果" }),
    ).toHaveTextContent("保存成功");
    expect(journalAPI.saveEntry).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ title: "手动保存的标题", version: 1 }),
    );
    await user.click(screen.getByRole("button", { name: "关闭保存提示" }));
    expect(
      screen.queryByRole("status", { name: "保存结果" }),
    ).not.toBeInTheDocument();
  });
  it("confirms already saved content from the canvas toolbar without another write", async () => {
    const user = userEvent.setup();
    renderPage("/admin/journal/entries/11");
    await screen.findByTestId("canvas");
    await user.click(screen.getByRole("button", { name: "保存画布" }));
    expect(
      await screen.findByRole("status", { name: "保存结果" }),
    ).toHaveTextContent("已保存，当前没有新的修改");
    expect(journalAPI.saveEntry).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "关闭保存提示" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(
      await screen.findByRole("status", { name: "保存结果" }),
    ).toHaveTextContent("已保存，当前没有新的修改");
  });
  it("explains an empty unsaved canvas without reporting a successful write", async () => {
    const user = userEvent.setup();
    renderPage("/admin/journal/new?notebook=1&template=blank");
    await screen.findByTestId("canvas");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(
      await screen.findByRole("status", { name: "保存结果" }),
    ).toHaveTextContent("画布还是空白");
    expect(journalAPI.createEntry).not.toHaveBeenCalled();
  });
  it("announces the actual error and preserves the draft until a successful retry", async () => {
    vi.mocked(journalAPI.saveEntry).mockRejectedValueOnce(
      error(500, "服务暂时不可用"),
    );
    const user = userEvent.setup();
    renderPage("/admin/journal/entries/11");
    await screen.findByTestId("canvas");
    await user.click(screen.getByRole("button", { name: "添加测试文字" }));
    await user.click(screen.getByRole("button", { name: "保存画布" }));
    expect(
      await screen.findByRole("alert", { name: "保存结果" }),
    ).toHaveTextContent("保存失败：服务暂时不可用");
    expect(screen.getByText("本地未同步文字")).toBeInTheDocument();
    expect(screen.queryByText("保存成功")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试保存" }));
    expect(
      await screen.findByRole("status", { name: "保存结果" }),
    ).toHaveTextContent("保存成功");
    expect(
      screen.queryByRole("alert", { name: "保存结果" }),
    ).not.toBeInTheDocument();
  });
  it("does not claim the newest draft is saved when editing continues during a manual save", async () => {
    let finish: (value: JournalEntry) => void = () => {};
    vi.mocked(journalAPI.saveEntry).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    renderPage("/admin/journal/entries/11");
    const title = await screen.findByLabelText("标题（可选）");
    await user.clear(title);
    await user.type(title, "提交的版本");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await user.clear(title);
    await user.type(title, "正在继续修改");
    await act(async () =>
      finish({ ...entry, title: "提交的版本", version: 2 }),
    );
    expect(
      await screen.findByRole("status", { name: "保存结果" }),
    ).toHaveTextContent("最新修改仍在同步");
    expect(title).toHaveValue("正在继续修改");
  });
  it("opens and edits directly when the notebook has no public password", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const user = userEvent.setup();
    renderPage("/admin/journal/entries/11");
    expect(await screen.findByTestId("canvas")).toHaveTextContent(
      "受保护的私人文字",
    );
    expect(screen.queryByLabelText("查看密码")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "添加测试文字" }));
    await waitFor(() => expect(journalAPI.saveEntry).toHaveBeenCalled(), {
      timeout: 2000,
    });
    expect(journalAPI.saveEntry).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        version: 1,
        scene: expect.objectContaining({
          elements: expect.arrayContaining([
            expect.objectContaining({ text: "本地未同步文字" }),
          ]),
        }),
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("已保存于");
    expect(
      screen.queryByRole("status", { name: "保存结果" }),
    ).not.toBeInTheDocument();
    expect(journalAPI.unlock).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
  });
  it("preserves the local scene on a version conflict and exposes copy/reload choices", async () => {
    vi.mocked(journalAPI.saveEntry).mockRejectedValue(error(409));
    const user = userEvent.setup();
    renderPage("/admin/journal/entries/11");
    await screen.findByTestId("canvas");
    await user.click(screen.getByRole("button", { name: "添加测试文字" }));
    expect(
      await screen.findByRole(
        "button",
        { name: "保留修改，另存副本" },
        { timeout: 2000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("本地未同步文字")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "载入最新版本" }),
    ).toBeInTheDocument();
    expect(journalAPI.createEntry).not.toHaveBeenCalled();
  });
  it("hides private content after administrator session expiry without asking for a journal password", async () => {
    vi.mocked(journalAPI.saveEntry).mockRejectedValue(error(401));
    const user = userEvent.setup();
    renderPage("/admin/journal/entries/11");
    await screen.findByTestId("canvas");
    await user.click(screen.getByRole("button", { name: "添加测试文字" }));
    expect(
      await screen.findByRole(
        "heading",
        { name: "管理员登录已过期" },
        { timeout: 2000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("canvas")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "重新登录后台" })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(screen.queryByLabelText("查看密码")).not.toBeInTheDocument();
  });
  it("protects dirty drafts when navigating within the application", async () => {
    const user = userEvent.setup();
    renderPage("/admin/journal/entries/11");
    await screen.findByTestId("canvas");
    await user.click(screen.getByRole("button", { name: "添加测试文字" }));
    await user.click(screen.getByRole("link", { name: /返回手帐/ }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "还有未同步的修改",
    );
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByText("本地未同步文字")).toBeInTheDocument();
  });
  it("keeps edits made during an in-flight autosave and saves them against the returned version", async () => {
    let finish: (entry: JournalEntry) => void = () => {};
    vi.mocked(journalAPI.saveEntry).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    renderPage("/admin/journal/entries/11");
    const title = await screen.findByLabelText("标题（可选）");
    await user.clear(title);
    await user.type(title, "第一次修改");
    await waitFor(() => expect(journalAPI.saveEntry).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });
    await user.clear(title);
    await user.type(title, "保存时继续修改");
    await act(async () => {
      finish({ ...entry, title: "第一次修改", version: 2 });
    });
    expect(title).toHaveValue("保存时继续修改");
    await waitFor(() => expect(journalAPI.saveEntry).toHaveBeenCalledTimes(2), {
      timeout: 2000,
    });
    expect(journalAPI.saveEntry).toHaveBeenLastCalledWith(
      11,
      expect.objectContaining({ title: "保存时继续修改", version: 2 }),
    );
  });
  it("ignores a discarded save response after opening another entry", async () => {
    let finish: (entry: JournalEntry) => void = () => {};
    vi.mocked(journalAPI.saveEntry).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.mocked(journalAPI.entry).mockImplementation(async (id) =>
      id === 12 ? { ...entry, id: 12, title: "另一页" } : entry,
    );
    const user = userEvent.setup();
    const { router } = renderPage("/admin/journal/entries/11");
    const title = await screen.findByLabelText("标题（可选）");
    await user.clear(title);
    await user.type(title, "等待保存的旧页");
    await waitFor(() => expect(journalAPI.saveEntry).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });
    await act(async () => {
      void router.navigate("/admin/journal/entries/12");
    });
    await user.click(
      await screen.findByRole("button", { name: "放弃修改并离开" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("标题（可选）")).toHaveValue("另一页"),
    );
    await act(async () => {
      finish({ ...entry, title: "等待保存的旧页", version: 2 });
    });
    expect(screen.getByLabelText("标题（可选）")).toHaveValue("另一页");
  });
  it("blocks changing new-page template parameters while a draft is dirty", async () => {
    const user = userEvent.setup();
    const { router } = renderPage(
      "/admin/journal/new?notebook=1&template=blank",
    );
    await screen.findByTestId("canvas");
    await user.click(screen.getByRole("button", { name: "添加测试文字" }));
    await act(async () => {
      void router.navigate("/admin/journal/new?notebook=1&template=travel");
    });
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "还有未同步的修改",
    );
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByText("本地未同步文字")).toBeInTheDocument();
  });
  it("delays logout until the user chooses to save or discard their draft", async () => {
    const user = userEvent.setup();
    const proceed = vi.fn().mockResolvedValue(undefined);
    renderPage("/admin/journal/entries/11");
    await screen.findByTestId("canvas");
    await user.click(screen.getByRole("button", { name: "添加测试文字" }));
    const event = new CustomEvent("portfolio:before-sign-out", {
      cancelable: true,
      detail: { proceed },
    });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(proceed).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "保存并退出登录" }));
    await waitFor(() => expect(proceed).toHaveBeenCalledOnce());
    expect(journalAPI.saveEntry).toHaveBeenCalledOnce();
  });
  it("hides an idle administrator draft at the server deadline even with a different server clock", async () => {
    vi.mocked(journalAPI.adminSession).mockResolvedValue({
      server_time: "2020-01-01T00:00:00.000Z",
      expires_at: "2020-01-01T00:00:00.500Z",
    });
    renderPage("/admin/journal/entries/11");
    expect(await screen.findByTestId("canvas")).toBeInTheDocument();
    expect(
      await screen.findByRole(
        "heading",
        { name: "管理员登录已过期" },
        { timeout: 1500 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("canvas")).not.toBeInTheDocument();
    expect(journalAPI.adminSession).toHaveBeenCalledOnce();
  });
  it("rechecks administrator access before revealing an in-memory draft on foreground", async () => {
    const user = userEvent.setup();
    renderPage("/admin/journal/entries/11");
    await screen.findByTestId("canvas");
    await user.click(screen.getByRole("button", { name: "添加测试文字" }));
    let finish: (value: {
      expires_at: string;
      server_time: string;
    }) => void = () => {};
    vi.mocked(journalAPI.adminSession).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.queryByTestId("canvas")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("正在验证管理员会话");
    await act(async () => {
      finish({
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        server_time: new Date().toISOString(),
      });
    });
    expect(screen.getByText("本地未同步文字")).toBeInTheDocument();
    expect(journalAPI.entry).toHaveBeenCalledOnce();
  });
  it("does not create an empty entry merely by opening a blank canvas", async () => {
    renderPage("/admin/journal/new?notebook=1&template=blank");
    await screen.findByTestId("canvas");
    expect(journalAPI.createEntry).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("开始记录后自动保存");
  });
  it("keeps public display disabled until a notebook viewing password is set", async () => {
    const user = userEvent.setup();
    renderPage("/admin/journal");
    await user.click(await screen.findByRole("button", { name: "新建手帐本" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("checkbox", { name: /开启前台展示/ }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("checkbox", { name: /开启前台展示/ }),
    ).not.toBeChecked();
    await user.type(
      within(dialog).getByLabelText(/设置查看密码/),
      "example-passphrase",
    );
    expect(
      within(dialog).getByRole("checkbox", { name: /开启前台展示/ }),
    ).toBeEnabled();
    expect(
      within(dialog).getByRole("textbox", { name: "允许公开的手帐本名" }),
    ).toHaveValue("");
  });
});

describe("journal review views", () => {
  it("lists every entry on the same calendar date and filters text from the canvas", async () => {
    const user = userEvent.setup();
    render(
      <JournalCollection
        entries={[entry, { ...entry, id: 12, title: "同日第二页" }]}
        assetURL={() => ""}
        onOpen={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "月历" }));
    const day = screen.getByRole("button", { name: `${todayDate()}, 2 篇` });
    await user.click(day);
    expect(screen.getByText(entry.title)).toBeInTheDocument();
    expect(screen.getByText("同日第二页")).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox"), "受保护的私人文字");
    expect(screen.getByText("同日第二页")).toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "不存在的文字");
    expect(screen.getByText("没有符合条件的记录")).toBeInTheDocument();
  });
});
