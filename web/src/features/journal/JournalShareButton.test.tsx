import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JournalShareButton } from "./JournalShareButton";
import { buildJournalShareURL } from "./journalShare";

const dialogMethods = Object.fromEntries(
  ["showModal", "close"].map((method) => [method, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, method)]),
);

beforeEach(() => {
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

async function openShare(props: Partial<Parameters<typeof JournalShareButton>[0]> = {}) {
  const user = userEvent.setup();
  render(<JournalShareButton notebookID={7} {...props} />);
  await user.click(screen.getByRole("button", { name: "分享手帐" }));
  return user;
}

describe("journal share link", () => {
  it("generates a localized reading route with the optional selected entry", () => {
    expect(buildJournalShareURL(7, "ja", 18, "https://journal.example.test"))
      .toBe("https://journal.example.test/ja/journal/7/read?entry=18");
    expect(buildJournalShareURL(7, "en", undefined, "https://journal.example.test"))
      .toBe("https://journal.example.test/en/journal/7/read");
  });

  it("does not include current credentials, session parameters or fragments", () => {
    const url = new URL(buildJournalShareURL(
      7,
      "zh",
      18,
      "https://owner:secret@journal.example.test/admin?password=secret&session=private#draft",
    ));
    expect(url.pathname).toBe("/zh/journal/7/read");
    expect([...url.searchParams]).toEqual([["entry", "18"]]);
    expect(url.hash).toBe("");
    expect(url.username).toBe("");
    expect(url.password).toBe("");
  });
});

describe("JournalShareButton", () => {
  it("opens a read-only link and protected fullscreen preview in a new tab", async () => {
    await openShare({ entryID: 18 });
    expect(screen.getByRole("dialog", { name: "分享这本手帐" })).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "分享链接" });
    expect(input).toHaveAttribute("readonly");
    expect(input).toHaveValue(`${window.location.origin}/zh/journal/7/read?entry=18`);
    expect(input).toHaveFocus();
    expect(screen.getByText(/无需登录，仍需输入手帐的查看密码/)).toBeInTheDocument();
    const preview = screen.getByRole("link", { name: "打开分享预览" });
    expect(preview).toHaveAttribute("href", `${window.location.origin}/zh/journal/7/read?entry=18`);
    expect(preview).toHaveAttribute("target", "_blank");
    expect(preview).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("copies the clean share link and confirms completion", async () => {
    const user = await openShare();
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await user.click(screen.getByRole("button", { name: "复制链接" }));
    expect(copy).toHaveBeenCalledWith(`${window.location.origin}/zh/journal/7/read`);
    expect(screen.getByRole("status")).toHaveTextContent("链接已复制");
  });

  it("selects the link and explains manual copying if Clipboard API fails", async () => {
    const user = await openShare();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Permission denied"));
    const input = screen.getByRole("textbox", { name: "分享链接" }) as HTMLInputElement;
    const select = vi.spyOn(input, "select");
    await user.click(screen.getByRole("button", { name: "复制链接" }));
    expect(screen.getByRole("status")).toHaveTextContent("无法自动复制，链接已选中，请手动复制。");
    expect(input).toHaveFocus();
    expect(select).toHaveBeenCalled();
  });

  it("does not generate a dialog when public display is disabled", async () => {
    const user = userEvent.setup();
    render(<JournalShareButton notebookID={7} enabled={false} />);
    const share = screen.getByRole("button", { name: "分享手帐" });
    expect(share).toBeDisabled();
    expect(share).toHaveAccessibleDescription("先在手帐本设置中开启前台展示并设置查看密码");
    expect(screen.getByText("先在手帐本设置中开启前台展示并设置查看密码")).toBeVisible();
    await user.click(share);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes with the close button and returns focus to the share button", async () => {
    const user = await openShare();
    await user.click(screen.getByRole("button", { name: "关闭分享窗口" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "分享手帐" })).toHaveFocus();
  });

  it("handles Escape through the native dialog cancel event", async () => {
    await openShare();
    const dialog = screen.getByRole("dialog");
    const cancel = new Event("cancel", { bubbles: false, cancelable: true });
    fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "分享手帐" })).toHaveFocus();
  });

  it("ignores a pending clipboard result after the dialog is closed", async () => {
    const user = await openShare();
    let finish: (() => void) | undefined;
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    await user.click(screen.getByRole("button", { name: "复制链接" }));
    await user.click(screen.getByRole("button", { name: "关闭分享窗口" }));
    await act(async () => { finish?.(); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "分享手帐" }));
    await waitFor(() => expect(screen.getByRole("status")).toBeEmptyDOMElement());
  });

  it.each([
    ["en", "Share journal", "Share this journal"],
    ["ja", "手帳を共有", "この手帳を共有"],
  ] as const)("localizes controls and routes in %s", async (locale, label, title) => {
    const user = userEvent.setup();
    render(<JournalShareButton notebookID={7} locale={locale} />);
    await user.click(screen.getByRole("button", { name: label }));
    expect(screen.getByRole("dialog", { name: title })).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue(`${window.location.origin}/${locale}/journal/7/read`);
  });
});
