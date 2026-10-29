import type { ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { journalAPI } from "./api";
import { JournalAdminPage } from "./JournalAdminPage";
import { JournalEntryPage } from "./JournalEntryPage";
import type { JournalEntry, JournalNotebook, JournalScene } from "./types";

vi.mock("./api", () => ({
  journalAPI: {
    adminSession: vi.fn(),
    adminBooks: vi.fn(),
    entries: vi.fn(),
    entry: vi.fn(),
    createEntry: vi.fn(),
    saveEntry: vi.fn(),
    assetURL: (id: number) => `/api/admin/journal/assets/${id}`,
  },
}));
vi.mock("./export", () => ({
  downloadJournalArchive: vi.fn(),
  exportJournalEntry: vi.fn(),
  exportJournalEntries: vi.fn(),
  exportJournalText: vi.fn(),
}));
vi.mock("./JournalBookReader", () => ({
  JournalBookReader: ({ entry }: { entry: JournalEntry }) => (
    <section aria-label="手帐书页阅读器">{entry.title}</section>
  ),
}));
vi.mock("./JournalCanvas", () => ({
  JournalCanvas: ({ scene, onChange, readOnly, thumbnail, toolbarActions }: {
    scene: JournalScene;
    onChange?: (value: JournalScene) => void;
    readOnly?: boolean;
    thumbnail?: boolean;
    toolbarActions?: ReactNode;
  }) => (
    <div data-testid={thumbnail ? "journal-preview" : "journal-canvas"}>
      {toolbarActions}
      {!readOnly && <button type="button" onClick={() => onChange?.({
        ...scene,
        elements: [{ id: "draft", type: "text", text: "新添的文字", x: 0, y: 0, width: 50, height: 50, rotation: 0, locked: false }],
      })}>添加测试文字</button>}
    </div>
  ),
}));

const notebook: JournalNotebook = {
  id: 1,
  name: "日常手帐",
  public_title: "我的日常",
  cover_color: "#789888",
  paper: "plain",
  public_enabled: true,
  has_password: true,
  archived: false,
  version: 1,
  created_at: "",
  updated_at: "",
};
const entry: JournalEntry = {
  id: 11,
  notebook_id: 1,
  title: "已保存的一页",
  entry_date: "2026-10-08",
  mood: "",
  weather: "",
  tags: [],
  favorite: false,
  scene: {
    schemaVersion: 1,
    width: 800,
    height: 1100,
    paper: "plain",
    elements: [{ id: "saved", type: "text", text: "已保存内容", x: 0, y: 0, width: 50, height: 50, rotation: 0, locked: false }],
  },
  version: 1,
  deleted_at: null,
  created_at: "",
  updated_at: "2026-10-08T10:00:00Z",
};

const dialogMethods = Object.fromEntries(["showModal", "close"].map((method) => [
  method,
  Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, method),
]));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(journalAPI.adminSession).mockResolvedValue({
    server_time: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
  vi.mocked(journalAPI.adminBooks).mockResolvedValue({ items: [notebook] });
  vi.mocked(journalAPI.entries).mockResolvedValue({ items: [entry], total: 1 });
  vi.mocked(journalAPI.entry).mockResolvedValue(entry);
  vi.mocked(journalAPI.saveEntry).mockImplementation(async (_id, input) => ({
    ...entry, ...input, notebook_id: input.notebook_id ?? entry.notebook_id, version: 2,
  }));
  vi.mocked(journalAPI.createEntry).mockImplementation(async (notebookID, input) => ({
    ...entry, ...input, id: 77, notebook_id: notebookID,
  }));
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) { this.removeAttribute("open"); }),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const [method, descriptor] of Object.entries(dialogMethods)) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, method, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, method);
  }
});

function renderPage(path: string) {
  const router = createMemoryRouter([
    { path: "/admin/journal", element: <JournalAdminPage /> },
    { path: "/admin/journal/entries/:entryId", element: <JournalEntryPage /> },
    { path: "/admin/journal/new", element: <JournalEntryPage /> },
  ], { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

async function selectNotebook(user: ReturnType<typeof userEvent.setup>, name = notebook.name) {
  await user.click(await screen.findByRole("button", { name: new RegExp(name) }));
  return screen.findByRole("button", { name: "分享手帐" });
}

async function shareURL(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "分享手帐" }));
  return (screen.getByRole("textbox", { name: "分享链接" }) as HTMLInputElement).value;
}

describe("administrator journal sharing", () => {
  it.each([
    { public_enabled: true, has_password: true, archived: false, allowed: true },
    { public_enabled: false, has_password: true, archived: false, allowed: false },
    { public_enabled: true, has_password: false, archived: false, allowed: false },
    { public_enabled: true, has_password: true, archived: true, allowed: false },
  ])("allows sharing only when public=$public_enabled password=$has_password archived=$archived", async ({ allowed, ...status }) => {
    const user = userEvent.setup();
    vi.mocked(journalAPI.adminBooks).mockResolvedValue({ items: [{ ...notebook, ...status }] });
    renderPage("/admin/journal");
    const share = await selectNotebook(user);
    if (allowed) expect(share).toBeEnabled();
    else {
      expect(share).toBeDisabled();
      expect(share).toHaveAccessibleDescription("先在手帐本设置中开启前台展示并设置查看密码");
      await user.click(share);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    }
  });

  it("shares the whole selected notebook without a page, then the preview's starting page", async () => {
    const user = userEvent.setup();
    renderPage("/admin/journal");
    await selectNotebook(user);
    expect(await shareURL(user)).toBe(`${window.location.origin}/zh/journal/1/read`);
    await user.click(screen.getByRole("button", { name: "关闭分享窗口" }));
    await user.click(await screen.findByRole("button", { name: "翻阅手帐" }));
    await screen.findByRole("region", { name: "手帐书页阅读器" });
    expect(await shareURL(user)).toBe(`${window.location.origin}/zh/journal/1/read?entry=11`);
    expect(screen.getByText(/接收者可以继续翻阅整本手帐/)).toBeInTheDocument();
  });

  it("uses the saved entry's notebook and page even with unsaved title changes and a different route notebook", async () => {
    const user = userEvent.setup();
    const savedBook = { ...notebook, id: 2, name: "已保存的本" };
    const differentBook = { ...notebook, public_enabled: false, has_password: false };
    vi.mocked(journalAPI.adminBooks).mockResolvedValue({ items: [differentBook, savedBook] });
    vi.mocked(journalAPI.entry).mockResolvedValue({ ...entry, id: 22, notebook_id: 2 });
    renderPage("/admin/journal/entries/22?notebook=1");
    await screen.findByTestId("journal-canvas");
    await user.type(screen.getByLabelText("标题（可选）"), "未保存的秘密标题");
    expect(screen.getByRole("button", { name: "分享手帐" })).toBeEnabled();
    expect(await shareURL(user)).toBe(`${window.location.origin}/zh/journal/2/read?entry=22`);
    expect(screen.getByText(/仅展示已保存内容/)).toBeInTheDocument();
    expect(journalAPI.saveEntry).not.toHaveBeenCalled();
  });

  it("keeps the previously saved notebook while moving, and updates eligibility after the move is saved", async () => {
    const user = userEvent.setup();
    const privateBook = { ...notebook, id: 2, name: "后台私密本", public_enabled: false, has_password: false };
    vi.mocked(journalAPI.adminBooks).mockResolvedValue({ items: [notebook, privateBook] });
    let finishMove: (value: JournalEntry) => void = () => {};
    vi.mocked(journalAPI.saveEntry).mockImplementationOnce(() => new Promise((resolve) => { finishMove = resolve; }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage("/admin/journal/entries/11");
    await screen.findByTestId("journal-canvas");
    await user.selectOptions(screen.getByLabelText("手帐本"), "2");
    await waitFor(() => expect(journalAPI.saveEntry).toHaveBeenCalledWith(11, expect.objectContaining({ notebook_id: 2 })));
    expect(await shareURL(user)).toBe(`${window.location.origin}/zh/journal/1/read?entry=11`);
    await user.click(screen.getByRole("button", { name: "关闭分享窗口" }));
    await act(async () => { finishMove({ ...entry, notebook_id: 2, version: 2 }); });
    expect(screen.getByRole("button", { name: "分享手帐" })).toBeDisabled();
  });

  it.each([
    { public_enabled: false, has_password: true, archived: false },
    { public_enabled: true, has_password: false, archived: false },
    { public_enabled: true, has_password: true, archived: true },
  ])("disables saved-entry sharing when its notebook does not allow public reading: %j", async (status) => {
    vi.mocked(journalAPI.adminBooks).mockResolvedValue({ items: [{ ...notebook, ...status }] });
    renderPage("/admin/journal/entries/11");
    expect(await screen.findByRole("button", { name: "分享手帐" })).toBeDisabled();
  });

  it("shows no sharing for an unsaved blank page or unsaved edits, then uses the newly saved entry", async () => {
    const user = userEvent.setup();
    let finishCreate: (value: JournalEntry) => void = () => {};
    vi.mocked(journalAPI.createEntry).mockImplementationOnce(() => new Promise((resolve) => { finishCreate = resolve; }));
    renderPage("/admin/journal/new?notebook=1&template=blank");
    await screen.findByTestId("journal-canvas");
    expect(screen.queryByRole("button", { name: "分享手帐" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "添加测试文字" }));
    expect(screen.queryByRole("button", { name: "分享手帐" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(journalAPI.createEntry).toHaveBeenCalledOnce());
    expect(screen.queryByRole("button", { name: "分享手帐" })).not.toBeInTheDocument();
    await act(async () => { finishCreate({ ...entry, id: 77 }); });
    await screen.findByRole("button", { name: "分享手帐" });
    expect(await shareURL(user)).toBe(`${window.location.origin}/zh/journal/1/read?entry=77`);
  });
});
