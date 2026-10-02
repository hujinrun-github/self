import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setCSRFToken } from "../../lib/api";
import { AdminLayout } from "./AdminLayout";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setCSRFToken("");
});

async function renderLayout() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (input === "/api/admin/me") {
      return new Response(JSON.stringify({ admin: { id: 1 }, csrf_token: "layout-test-token" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const router = createMemoryRouter([
    {
      element: <AdminLayout />,
      path: "/admin",
      children: [
        { element: <h1>编辑资料</h1>, path: "profile" },
        { element: <h1>管理项目</h1>, path: "projects" },
      ],
    },
    { element: <h1>登录</h1>, path: "/admin/login" },
  ], { initialEntries: ["/admin/profile"] });
  render(<RouterProvider router={router} />);
  await screen.findByTestId("admin-shell");
  return { fetchMock, router };
}

describe("admin layout navigation", () => {
  it("keeps all navigation destinations and reserves the page heading for its content", async () => {
    await renderLayout();
    const navigation = screen.getByRole("navigation", { name: "Admin" });
    expect(within(navigation).getAllByRole("link")).toHaveLength(7);
    expect(within(navigation).getByRole("link", { name: "互动" })).toHaveAttribute("href", "/admin/engagement");
    expect(within(navigation).getByRole("link", { name: "资料" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "查看前台" })).toHaveAttribute("href", "/zh");
    expect(screen.getByText("中文内容工作台")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByText("中文主语言工作区")).not.toBeInTheDocument();
  });

  it("opens the mobile sidebar, traps keyboard focus, and returns focus on Escape", async () => {
    const user = userEvent.setup();
    await renderLayout();
    const toggle = screen.getByRole("button", { name: "切换后台导航" });
    const sidebar = screen.getByTestId("admin-sidebar");
    expect(toggle).toHaveAttribute("aria-controls", "admin-navigation");
    expect(sidebar).toHaveAttribute("id", "admin-navigation");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(sidebar).toHaveAttribute("data-open", "true");
    await waitFor(() => expect(screen.getByRole("button", { name: "关闭后台导航" })).toHaveFocus());
    const lastControl = within(sidebar).getByRole("button", { name: "退出登录" });
    const firstControl = within(sidebar).getByRole("link", { name: "内容管理台" });
    lastControl.focus();
    await user.tab();
    expect(firstControl).toHaveFocus();
    await user.tab({ shift: true });
    expect(lastControl).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(sidebar).toHaveAttribute("data-open", "false");
    expect(toggle).toHaveFocus();
  });

  it("waits for the sidebar to render before moving focus", async () => {
    const user = userEvent.setup();
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => frames.delete(id)));
    await renderLayout();
    await user.click(screen.getByRole("button", { name: "切换后台导航" }));
    const closeButton = screen.getByRole("button", { name: "关闭后台导航" });

    expect(closeButton).not.toHaveFocus();
    expect(frames.size).toBeGreaterThan(0);
    act(() => {
      while (frames.size > 0) {
        const pendingFrames = [...frames];
        frames.clear();
        pendingFrames.forEach(([, callback]) => callback(performance.now()));
      }
    });
    expect(closeButton).toHaveFocus();
  });

  it("cancels pending focus when the sidebar closes before its next frame", async () => {
    const user = userEvent.setup();
    const requestFrame = vi.fn(() => 42);
    const cancelFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);
    await renderLayout();
    const toggle = screen.getByRole("button", { name: "切换后台导航" });
    await user.click(toggle);
    await user.keyboard("{Escape}");

    expect(cancelFrame).toHaveBeenCalledWith(42);
    expect(toggle).toHaveFocus();
  });

  it.each(["关闭后台导航", "关闭后台导航遮罩"])("closes the sidebar with %s", async (label) => {
    const user = userEvent.setup();
    await renderLayout();
    const toggle = screen.getByRole("button", { name: "切换后台导航" });
    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: label }));

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
    expect(screen.queryByRole("button", { name: "关闭后台导航遮罩" })).not.toBeInTheDocument();
  });

  it("closes the drawer after selecting a destination", async () => {
    const user = userEvent.setup();
    const { router } = await renderLayout();
    await user.click(screen.getByRole("button", { name: "切换后台导航" }));
    await user.click(screen.getByRole("link", { name: "项目" }));

    expect(router.state.location.pathname).toBe("/admin/projects");
    expect(screen.getByRole("button", { name: "切换后台导航" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("heading", { name: "管理项目" })).toBeInTheDocument();
  });

  it("releases modal state when the viewport returns to desktop", async () => {
    const user = userEvent.setup();
    let onChange: ((event: { matches: boolean }) => void) | undefined;
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: (_event: string, callback: typeof onChange) => { onChange = callback; },
      removeEventListener: vi.fn(),
    })));
    await renderLayout();
    const toggle = screen.getByRole("button", { name: "切换后台导航" });
    await user.click(toggle);
    expect(toggle.closest("[inert]")).not.toBeNull();

    act(() => onChange?.({ matches: true }));

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle.closest("[inert]")).toBeNull();
  });

  it("preserves the session token on logout and redirects to login", async () => {
    const user = userEvent.setup();
    const { fetchMock, router } = await renderLayout();
    await user.click(screen.getByRole("button", { name: "退出登录" }));

    expect(router.state.location.pathname).toBe("/admin/login");
    const logoutCall = fetchMock.mock.calls.find(([url]) => url === "/api/admin/logout") as unknown as [string, RequestInit];
    expect(logoutCall[1].method).toBe("POST");
    expect(new Headers(logoutCall[1].headers).get("X-CSRF-Token")).toBe("layout-test-token");
  });
});
