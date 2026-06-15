import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { apiFetch, setCSRFToken } from "../../lib/api";
import { renderWithApp } from "../../test/render";
import { LoginPage } from "../auth/LoginPage";
import { MediaPage } from "./MediaPage";
import { ProfilePage } from "./ProfilePage";

afterEach(() => {
  vi.unstubAllGlobals();
  setCSRFToken("");
});

describe("admin API client", () => {
  it("sends X-CSRF-Token for unsafe admin mutations", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    setCSRFToken("csrf-token");

    await apiFetch("/api/admin/profile", {
      body: JSON.stringify({ name: "Ada" }),
      method: "PUT",
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("csrf-token");
    expect(init.credentials).toBe("include");
  });
});

describe("LoginPage", () => {
  it("renders login failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: "unauthorized", message: "Invalid email or password" } }),
          { headers: { "Content-Type": "application/json" }, status: 401 },
        ),
      ),
    );

    renderWithApp(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByLabelText("Email"), "admin@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "bad-password");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Invalid email or password")).toBeInTheDocument();
  });
});

describe("ProfilePage", () => {
  it("sends If-Match and shows stale conflict", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 1,
            name: "Ada",
            headline: "",
            summary: "",
            bio: "",
            email: "",
            social_links: [],
            updated_at: "2026-06-15T00:00:00Z",
          }),
          { headers: { "Content-Type": "application/json", ETag: '"abc"' }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "conflict", message: "Profile has changed" } }), {
          headers: { "Content-Type": "application/json" },
          status: 409,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    renderWithApp(<ProfilePage />);
    expect(await screen.findByDisplayValue("Ada")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));

    const init = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("If-Match")).toBe('"abc"');
    expect(await screen.findByText("Profile has changed")).toBeInTheDocument();
  });
});

describe("MediaPage", () => {
  it("disables delete for referenced assets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              {
                id: 1,
                file_name: "cover.png",
                referenced: true,
                variants: {
                  card: {
                    url: "/uploads/ab/cd/card.jpg",
                    width: 800,
                    height: 450,
                    mime_type: "image/jpeg",
                  },
                },
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      ),
    );

    renderWithApp(<MediaPage />);

    await waitFor(() => expect(screen.getByText("cover.png")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /delete cover.png/i })).toBeDisabled();
  });
});
