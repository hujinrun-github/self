import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setCSRFToken } from "../../lib/api";
import { renderWithApp } from "../../test/render";
import { LoginPage } from "./LoginPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setCSRFToken("");
});

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("LoginPage submission", () => {
  it("prevents duplicate submissions and stays busy until the session is ready", async () => {
    const login = deferredResponse();
    const csrf = deferredResponse();
    const fetchMock = vi.fn().mockReturnValueOnce(login.promise).mockReturnValueOnce(csrf.promise);
    vi.stubGlobal("fetch", fetchMock);
    const router = createMemoryRouter(
      [
        { element: <LoginPage />, path: "/admin/login" },
        { element: <h1>个人资料</h1>, path: "/admin/profile" },
      ],
      { initialEntries: ["/admin/login"] },
    );
    renderWithApp(<RouterProvider router={router} />);
    await userEvent.type(screen.getByLabelText("邮箱"), "admin@example.com");
    await userEvent.type(screen.getByLabelText("密码"), "correct-password");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));

    const form = screen.getByTestId("admin-login-card");
    expect(screen.getByRole("button", { name: "正在登录…" })).toBeDisabled();
    expect(form).toHaveAttribute("aria-busy", "true");
    fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => login.resolve(jsonResponse({ ok: true })));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/admin/csrf");
    expect(screen.getByRole("button", { name: "正在登录…" })).toBeDisabled();
    fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => csrf.resolve(jsonResponse({ csrf_token: "ready-session" })));
    expect(await screen.findByRole("heading", { name: "个人资料" })).toBeInTheDocument();
  });

  it("allows retry after a failed login without clearing the entered credentials", async () => {
    const login = deferredResponse();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(login.promise));
    renderWithApp(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByLabelText("邮箱"), "admin@example.com");
    await userEvent.type(screen.getByLabelText("密码"), "retry-password");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));
    expect(screen.getByTestId("admin-login-card")).toHaveAttribute("aria-busy", "true");

    await act(async () =>
      login.resolve(jsonResponse({ error: { code: "unauthorized", message: "邮箱或密码错误" } }, 401)),
    );

    expect(await screen.findByText("邮箱或密码错误")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录" })).toBeEnabled();
    expect(screen.getByTestId("admin-login-card")).toHaveAttribute("aria-busy", "false");
    expect(screen.getByLabelText("邮箱")).toHaveValue("admin@example.com");
    expect(screen.getByLabelText("密码")).toHaveValue("retry-password");
  });
});
