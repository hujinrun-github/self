import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithApp } from "../../test/render";
import { ContentEditPage } from "./ContentEditPage";
import { MediaPage } from "./MediaPage";
import { ProfilePage } from "./ProfilePage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json", ETag: '"current"' } });
}

describe("mobile admin actions", () => {
  it("saves a new draft from the end of the content form", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json({ id: 10, status: "draft" }));
    vi.stubGlobal("fetch", fetchMock);
    renderWithApp(<MemoryRouter><ContentEditPage resource="experience" /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText("标题"), "手机添加的经历");
    await userEvent.click(screen.getByRole("button", { name: "完成并保存草稿" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/experience", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining("手机添加的经历"),
    })));
  });

  it("saves the current profile translation from the footer without changing the primary profile", async () => {
    const profile = { name: "中文名字", social_links: [], translations: { en: { name: "English name", social_links: [], translation_status: "ai_draft" } } };
    const fetchMock = vi.fn().mockImplementation(async () => json(profile));
    vi.stubGlobal("fetch", fetchMock);
    renderWithApp(<ProfilePage />);
    await screen.findByDisplayValue("中文名字");
    await userEvent.click(screen.getByRole("tab", { name: /英文/ }));
    await userEvent.click(screen.getByRole("button", { name: "保存当前译文" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/profile/translations/en", expect.objectContaining({ method: "PUT" })));
    expect(fetchMock.mock.calls.some(([url, init]) => url === "/api/admin/profile" && init?.method === "PUT")).toBe(false);
  });

  it("copies a media reference with one tap", async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => json({ items: [{ id: 7, file_name: "封面.png", referenced: false, variants: {} }] })));
    renderWithApp(<MediaPage />);
    await user.click(await screen.findByRole("button", { name: "复制 封面.png 的引用" }));
    expect(copy).toHaveBeenCalledWith("![封面.png](media://asset/7/card)");
    expect(await screen.findByRole("status")).toHaveTextContent("引用已复制");
  });

  it("keeps the selectable reference available if copying is denied", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Permission denied"));
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => json({ items: [{ id: 7, file_name: "封面.png", referenced: false, variants: {} }] })));
    renderWithApp(<MediaPage />);
    await user.click(await screen.findByRole("button", { name: "复制 封面.png 的引用" }));
    expect(await screen.findByRole("status")).toHaveTextContent("长按下方引用复制");
    expect(screen.getByText("![封面.png](media://asset/7/card)")).toBeInTheDocument();
  });
});
