import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";

import { apiFetch, setCSRFToken } from "../../lib/api";
import { renderWithApp } from "../../test/render";
import { LoginPage } from "../auth/LoginPage";
import { AdminLayout } from "./AdminLayout";
import { ContentListPage } from "./ContentListPage";
import { ContentEditPage } from "./ContentEditPage";
import { MediaPage } from "./MediaPage";
import { ProfilePage } from "./ProfilePage";

afterEach(() => {
  cleanup();
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

  it("refreshes a stale CSRF token and retries unsafe admin mutations", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "forbidden", message: "Invalid CSRF token" } }), {
          headers: { "Content-Type": "application/json" },
          status: 403,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ csrf_token: "fresh-csrf-token" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    setCSRFToken("stale-csrf-token");

    await apiFetch("/api/admin/profile", {
      body: JSON.stringify({ name: "Ada" }),
      method: "PUT",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const firstInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(firstInit.headers).get("X-CSRF-Token")).toBe("stale-csrf-token");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/admin/csrf");
    const retryInit = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect(new Headers(retryInit.headers).get("X-CSRF-Token")).toBe("fresh-csrf-token");
  });
});

describe("LoginPage", () => {
  it("renders the branded admin login shell", async () => {
    renderWithApp(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("admin-login-shell")).toBeInTheDocument();
    expect(screen.getByTestId("admin-login-card")).toBeInTheDocument();
    expect(screen.getByText("内容管理台")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /后台登录/i })).toBeInTheDocument();
  });

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
    await userEvent.type(screen.getByLabelText("邮箱"), "admin@example.com");
    await userEvent.type(screen.getByLabelText("密码"), "bad-password");
    await userEvent.click(screen.getByRole("button", { name: /登录/i }));

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
    await userEvent.click(screen.getByRole("button", { name: /保存资料/i }));

    const init = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("If-Match")).toBe('"abc"');
    expect(await screen.findByText("Profile has changed")).toBeInTheDocument();
  });

  it("saves the homepage avatar media id with the profile", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            avatar_media_id: 42,
            bio: "",
            email: "",
            headline: "",
            id: 1,
            name: "Ada",
            social_links: [],
            summary: "",
            updated_at: "2026-06-15T00:00:00Z",
          }),
          { headers: { "Content-Type": "application/json", ETag: '"abc"' }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            avatar_media_id: 99,
            bio: "",
            email: "",
            headline: "",
            id: 1,
            name: "Ada",
            social_links: [],
            summary: "",
            updated_at: "2026-06-15T00:00:01Z",
          }),
          { headers: { "Content-Type": "application/json", ETag: '"def"' }, status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    renderWithApp(<ProfilePage />);
    const avatarInput = await screen.findByLabelText("首页头像媒体 ID");
    expect(avatarInput).toHaveValue("42");

    await userEvent.clear(avatarInput);
    await userEvent.type(avatarInput, "![avatar](media://asset/99/card)");
    await userEvent.click(screen.getByRole("button", { name: /保存资料/i }));

    const putInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(putInit.body))).toMatchObject({
      avatar_media_id: 99,
      name: "Ada",
    });
  });

  it("uploads a social link image and saves it as the link icon", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            bio: "",
            email: "",
            headline: "",
            id: 1,
            name: "Ada",
            social_links: [{ icon: "link", id: 7, label: "X", sort_order: 10, url: "https://x.com/ada" }],
            summary: "",
            updated_at: "2026-06-15T00:00:00Z",
          }),
          { headers: { "Content-Type": "application/json", ETag: '"abc"' }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 31,
            file_name: "x.png",
            variants: {
              avatar: { height: 400, mime_type: "image/png", path: "/uploads/aa/bb/avatar.png", width: 400 },
            },
          }),
          { headers: { "Content-Type": "application/json" }, status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            bio: "",
            email: "",
            headline: "",
            id: 1,
            name: "Ada",
            social_links: [{ icon: "media://asset/31/avatar", id: 7, label: "X", sort_order: 10, url: "https://x.com/ada" }],
            summary: "",
            updated_at: "2026-06-15T00:00:01Z",
          }),
          { headers: { "Content-Type": "application/json", ETag: '"def"' }, status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    renderWithApp(<ProfilePage />);

    const socialImageInput = await screen.findByLabelText("X 社交图片文件");
    await userEvent.upload(socialImageInput, new File(["avatar"], "x.png", { type: "image/png" }));

    expect(await screen.findByAltText("X 社交图片")).toHaveAttribute("src", "/media/31/avatar");
    await userEvent.click(screen.getByRole("button", { name: /保存资料/i }));

    const putCall = fetchMock.mock.calls.find(([, init]) => (init?.method ?? "GET").toUpperCase() === "PUT");
    const putInit = putCall?.[1] as RequestInit;
    expect(JSON.parse(String(putInit.body)).social_links[0]).toMatchObject({
      icon: "media://asset/31/avatar",
      label: "X",
      url: "https://x.com/ada",
    });
  });

  it("redirects unauthenticated admin routes to login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: "unauthorized", message: "Authentication required" } }),
          { headers: { "Content-Type": "application/json" }, status: 401 },
        ),
      ),
    );

    const router = createMemoryRouter(
      [
        { element: <div>Login route</div>, path: "/admin/login" },
        {
          element: <AdminLayout />,
          path: "/admin",
          children: [{ element: <div>Profile route</div>, path: "profile" }],
        },
      ],
      { initialEntries: ["/admin/profile"] },
    );

    renderWithApp(<RouterProvider router={router} />);

    expect(await screen.findByText("Login route")).toBeInTheDocument();
  });

  it("restores csrf token before saving after direct admin entry", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();

      if (url === "/api/admin/me") {
        return new Response(JSON.stringify({ admin: { id: 1 }, csrf_token: "csrf-token" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url === "/api/admin/profile" && method === "GET") {
        return new Response(
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
        );
      }
      if (url === "/api/admin/profile" && method === "PUT") {
        return new Response(null, { status: 204 });
      }

      throw new Error(`unexpected request ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const router = createMemoryRouter(
      [
        { element: <LoginPage />, path: "/admin/login" },
        {
          element: <AdminLayout />,
          path: "/admin",
          children: [{ element: <ProfilePage />, path: "profile" }],
        },
      ],
      { initialEntries: ["/admin/profile"] },
    );

    renderWithApp(<RouterProvider router={router} />);

    expect(await screen.findByDisplayValue("Ada")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /保存资料/i }));

    const putCall = fetchMock.mock.calls.find(([, init]) => (init?.method ?? "GET").toUpperCase() === "PUT");
    expect(putCall).toBeTruthy();
    const putInit = putCall?.[1] as RequestInit;
    expect(new Headers(putInit.headers).get("X-CSRF-Token")).toBe("csrf-token");
  });

  it("generates an auxiliary-language draft inline and publishes it after human review", async () => {
    const profileResponse = (english: Record<string, unknown>) =>
      new Response(
        JSON.stringify({
          bio: "Chinese bio",
          email: "ada@example.com",
          headline: "Chinese headline",
          id: 1,
          name: "Chinese name",
          social_links: [],
          summary: "Chinese summary",
          translations: {
            en: english,
            ja: {
              bio: "",
              etag: null,
              exists: false,
              headline: "",
              name: "",
              stale: false,
              summary: "",
              translation_status: "empty",
            },
          },
          updated_at: "2026-06-15T00:00:00Z",
        }),
        { headers: { "Content-Type": "application/json", ETag: '"profile-etag"' }, status: 200 },
      );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        profileResponse({
          bio: "",
          etag: null,
          exists: false,
          headline: "",
          name: "",
          stale: false,
          summary: "",
          translation_status: "empty",
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        profileResponse({
          bio: "English bio",
          etag: '"en-draft-etag"',
          exists: true,
          headline: "English headline",
          name: "English name",
          stale: false,
          summary: "English summary",
          translation_status: "ai_draft",
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        profileResponse({
          bio: "English bio",
          etag: '"en-reviewed-etag"',
          exists: true,
          headline: "English headline",
          name: "English name",
          stale: false,
          summary: "English summary",
          translation_status: "reviewed",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    renderWithApp(<ProfilePage />);

    await userEvent.click(await screen.findByRole("tab", { name: "英文（辅）" }));
    expect(screen.getByText("未创建")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "AI 翻译为英文" }));

    expect(await screen.findByDisplayValue("English name")).toBeInTheDocument();
    expect(screen.getByText("AI 草稿")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "人工审核并发布" }));

    expect(await screen.findByText("已审核并发布")).toBeInTheDocument();
    expect(fetchMock.mock.calls).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(["/api/admin/profile/translations/en/generate", expect.objectContaining({ method: "POST" })]),
        expect.arrayContaining([
          "/api/admin/profile/translations/en/review",
          expect.objectContaining({ method: "POST" }),
        ]),
      ]),
    );
  });

  it("creates the first profile translation with If-None-Match star", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            bio: "Chinese bio",
            email: "ada@example.com",
            headline: "Chinese headline",
            id: 1,
            name: "Chinese name",
            social_links: [],
            summary: "Chinese summary",
            translations: {
              en: {
                bio: "",
                etag: null,
                exists: false,
                headline: "",
                name: "",
                stale: false,
                summary: "",
                translation_status: "empty",
              },
              ja: {
                bio: "",
                etag: null,
                exists: false,
                headline: "",
                name: "",
                stale: false,
                summary: "",
                translation_status: "empty",
              },
            },
            updated_at: "2026-06-15T00:00:00Z",
          }),
          { headers: { "Content-Type": "application/json", ETag: '"abc"' }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            bio: "Chinese bio",
            email: "ada@example.com",
            headline: "Chinese headline",
            id: 1,
            name: "Chinese name",
            social_links: [],
            summary: "Chinese summary",
            translations: {
              en: {
                bio: "English bio",
                etag: '"en-etag"',
                exists: true,
                headline: "English headline",
                name: "English name",
                stale: false,
                summary: "English summary",
                translation_status: "ai_draft",
              },
              ja: {
                bio: "",
                etag: null,
                exists: false,
                headline: "",
                name: "",
                stale: false,
                summary: "",
                translation_status: "empty",
              },
            },
            updated_at: "2026-06-15T00:00:00Z",
          }),
          { headers: { "Content-Type": "application/json", ETag: '"abc"' }, status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    renderWithApp(<ProfilePage />);

    await userEvent.click(await screen.findByRole("tab", { name: "英文（辅）" }));
    await userEvent.type(screen.getByLabelText("姓名"), "English name");
    await userEvent.type(screen.getByLabelText("一句话介绍"), "English headline");
    await userEvent.click(screen.getByRole("button", { name: "保存人工修改" }));

    const putCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/admin/profile/translations/en" && (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(putCall).toBeTruthy();
    const init = putCall?.[1] as RequestInit;
    expect(new Headers(init.headers).get("If-None-Match")).toBe("*");
  });

  it("saves translated social link labels from the locale tab", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            bio: "Chinese bio",
            email: "ada@example.com",
            headline: "Chinese headline",
            id: 1,
            name: "Chinese name",
            social_links: [{ icon: "github", id: 12, label: "GitHub", url: "https://github.com/ada" }],
            summary: "Chinese summary",
            translations: {
              en: {
                bio: "",
                etag: '"en-etag"',
                exists: true,
                headline: "",
                name: "",
                social_links: [
                  {
                    icon: "github",
                    id: 12,
                    label: "",
                    source_label: "GitHub",
                    url: "https://github.com/ada",
                  },
                ],
                stale: false,
                summary: "",
                translation_status: "ai_draft",
              },
              ja: {
                bio: "",
                etag: null,
                exists: false,
                headline: "",
                name: "",
                social_links: [],
                stale: false,
                summary: "",
                translation_status: "empty",
              },
            },
            updated_at: "2026-06-15T00:00:00Z",
          }),
          { headers: { "Content-Type": "application/json", ETag: '"abc"' }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            bio: "Chinese bio",
            email: "ada@example.com",
            headline: "Chinese headline",
            id: 1,
            name: "Chinese name",
            social_links: [{ icon: "github", id: 12, label: "GitHub", url: "https://github.com/ada" }],
            summary: "Chinese summary",
            translations: {
              en: {
                bio: "",
                etag: '"en-etag-2"',
                exists: true,
                headline: "",
                name: "",
                social_links: [
                  {
                    icon: "github",
                    id: 12,
                    label: "Code",
                    source_label: "GitHub",
                    url: "https://github.com/ada",
                  },
                ],
                stale: false,
                summary: "",
                translation_status: "ai_draft",
              },
              ja: {
                bio: "",
                etag: null,
                exists: false,
                headline: "",
                name: "",
                social_links: [],
                stale: false,
                summary: "",
                translation_status: "empty",
              },
            },
            updated_at: "2026-06-15T00:00:00Z",
          }),
          { headers: { "Content-Type": "application/json", ETag: '"abc"' }, status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    renderWithApp(<ProfilePage />);

    await userEvent.click(await screen.findByRole("tab", { name: "英文（辅）" }));
    await userEvent.type(screen.getByLabelText("GitHub 名称"), "Code");
    await userEvent.click(screen.getByRole("button", { name: "保存人工修改" }));

    const putCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/admin/profile/translations/en" && (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(putCall).toBeTruthy();
    const body = JSON.parse(String((putCall?.[1] as RequestInit | undefined)?.body));
    expect(body).toMatchObject({
      social_links: [{ id: 12, label: "Code" }],
    });
  });
});

describe("Writing import entry points", () => {
  it("shows the markdown import entry only on the writing list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    renderWithApp(
      <MemoryRouter>
        <ContentListPage resource="writing" />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "导入 Markdown" })).toBeInTheDocument();

    cleanup();

    renderWithApp(
      <MemoryRouter>
        <ContentListPage resource="projects" />
      </MemoryRouter>,
    );

    await screen.findByRole("link", { name: "新建" });
    expect(screen.queryByRole("button", { name: "导入 Markdown" })).not.toBeInTheDocument();
  });

  it("shows the overwrite import entry for draft writing only", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content_md: "Chinese body",
            excerpt: "Chinese excerpt",
            featured: false,
            id: 9,
            slug: "zh-writing",
            status: "draft",
            tags: [],
            title: "Chinese Writing",
            translations: {
              en: {
                content_md: "",
                etag: null,
                exists: false,
                excerpt: "",
                seo_description: "",
                seo_title: "",
                slug: "",
                stale: false,
                title: "",
                translation_status: "empty",
              },
              ja: {
                content_md: "",
                etag: null,
                exists: false,
                excerpt: "",
                seo_description: "",
                seo_title: "",
                slug: "",
                stale: false,
                title: "",
                translation_status: "empty",
              },
            },
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content_md: "Chinese body",
            excerpt: "Chinese excerpt",
            featured: false,
            id: 10,
            slug: "published-writing",
            status: "published",
            tags: [],
            title: "Published Writing",
            translations: {
              en: {
                content_md: "",
                etag: null,
                exists: false,
                excerpt: "",
                seo_description: "",
                seo_title: "",
                slug: "",
                stale: false,
                title: "",
                translation_status: "empty",
              },
              ja: {
                content_md: "",
                etag: null,
                exists: false,
                excerpt: "",
                seo_description: "",
                seo_title: "",
                slug: "",
                stale: false,
                title: "",
                translation_status: "empty",
              },
            },
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content_md: "Project body",
            featured: false,
            id: 7,
            slug: "project",
            status: "draft",
            summary: "Project summary",
            techs: [],
            title: "Project title",
            translations: {
              en: {
                content_md: "",
                etag: null,
                exists: false,
                slug: "",
                stale: false,
                summary: "",
                title: "",
                translation_status: "empty",
              },
              ja: {
                content_md: "",
                etag: null,
                exists: false,
                slug: "",
                stale: false,
                summary: "",
                title: "",
                translation_status: "empty",
              },
            },
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const draftRouter = createMemoryRouter(
      [{ path: "/admin/writing/:id", element: <ContentEditPage resource="writing" /> }],
      { initialEntries: ["/admin/writing/9"] },
    );
    renderWithApp(<RouterProvider router={draftRouter} />);

    expect(await screen.findByDisplayValue("Chinese Writing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入本地 Markdown" })).toBeInTheDocument();

    cleanup();

    const publishedRouter = createMemoryRouter(
      [{ path: "/admin/writing/:id", element: <ContentEditPage resource="writing" /> }],
      { initialEntries: ["/admin/writing/10"] },
    );
    renderWithApp(<RouterProvider router={publishedRouter} />);

    expect(await screen.findByDisplayValue("Published Writing")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导入本地 Markdown" })).not.toBeInTheDocument();

    cleanup();

    const projectRouter = createMemoryRouter(
      [{ path: "/admin/projects/:id", element: <ContentEditPage resource="projects" /> }],
      { initialEntries: ["/admin/projects/7"] },
    );
    renderWithApp(<RouterProvider router={projectRouter} />);

    expect(await screen.findByDisplayValue("Project title")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导入本地 Markdown" })).not.toBeInTheDocument();
  });
});

describe("AdminLayout", () => {
  it("renders the workspace shell after restoring the session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/admin/me") {
          return new Response(JSON.stringify({ admin: { id: 1 }, csrf_token: "csrf-token" }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        throw new Error(`unexpected request GET ${url}`);
      }),
    );

    const router = createMemoryRouter(
      [
        {
          element: <AdminLayout />,
          path: "/admin",
          children: [{ element: <div>Profile route</div>, path: "profile" }],
        },
      ],
      { initialEntries: ["/admin/profile"] },
    );

    renderWithApp(<RouterProvider router={router} />);

    expect(await screen.findByTestId("admin-shell")).toBeInTheDocument();
    expect(screen.getByTestId("admin-sidebar")).toBeInTheDocument();
    expect(screen.getByText("内容管理台")).toBeInTheDocument();
    expect(screen.getByText("中文内容工作台")).toBeInTheDocument();
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
                    path: "/uploads/ab/cd/card.jpg",
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
    expect(document.querySelector("img")).toHaveAttribute("src", "/uploads/ab/cd/card.jpg");
    expect(screen.getByRole("button", { name: /删除 cover\.png/i })).toBeDisabled();
  });
});

describe("MediaPage", () => {
  it("renders audio and video assets with placeholders and original media refs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              {
                file_name: "podcast.mp3",
                id: 21,
                mime_type: "audio/mpeg",
                referenced: false,
                variants: {
                  original: {
                    mime_type: "audio/mpeg",
                    url: "/media/21/original",
                  },
                },
              },
              {
                file_name: "demo.mp4",
                id: 22,
                mime_type: "video/mp4",
                referenced: false,
                variants: {
                  original: {
                    mime_type: "video/mp4",
                    url: "/media/22/original",
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

    expect(await screen.findByText("podcast.mp3")).toBeInTheDocument();
    expect(screen.getByText("AUDIO")).toBeInTheDocument();
    expect(screen.getByText("VIDEO")).toBeInTheDocument();
    expect(screen.getByText("[podcast.mp3](media://asset/21/original)")).toBeInTheDocument();
  });
});

describe("ContentEditPage", () => {
  it.each([
    ["experience", "经历"],
    ["talks", "演讲"],
    ["writing", "写作"],
    ["projects", "项目"],
  ])("shows multilingual options while creating %s content", async (resource, resourceLabel) => {
    const router = createMemoryRouter(
      [{ path: `/admin/${resource}/new`, element: <ContentEditPage resource={resource} /> }],
      { initialEntries: [`/admin/${resource}/new`] },
    );

    renderWithApp(<RouterProvider router={router} />);

    expect(screen.getByRole("tab", { name: "中文（主）" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "英文（辅）" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "日文（辅）" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "英文（辅）" }));
    expect(screen.getByRole("heading", { name: "先保存中文主内容" })).toBeInTheDocument();
    expect(screen.getByText(`保存后会自动进入${resourceLabel}的英文翻译页。`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存中文草稿并继续英文翻译" })).toBeInTheDocument();
  });

  it("creates the Chinese source and continues directly to the selected translation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 27, slug: "new-project", status: "draft" }), {
          headers: { "Content-Type": "application/json" },
          status: 201,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content_md: "",
            featured: false,
            id: 27,
            slug: "new-project",
            status: "draft",
            summary: "",
            techs: [],
            title: "New Project",
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const router = createMemoryRouter(
      [
        { path: "/admin/projects/new", element: <ContentEditPage resource="projects" /> },
        { path: "/admin/projects/:id", element: <ContentEditPage resource="projects" /> },
      ],
      { initialEntries: ["/admin/projects/new"] },
    );

    renderWithApp(<RouterProvider router={router} />);

    await userEvent.type(screen.getByLabelText("标题"), "New Project");
    await userEvent.click(screen.getByRole("tab", { name: "英文（辅）" }));
    await userEvent.click(screen.getByRole("button", { name: "保存中文草稿并继续英文翻译" }));

    await screen.findByRole("region", { name: "英文翻译与发布" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      slug: "new-project",
      title: "New Project",
    });
    expect(router.state.location.pathname).toBe("/admin/projects/27");
    expect(router.state.location.search).toBe("?locale=en");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/admin/projects");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.method).toBe("POST");
  });

  it("loads an existing project into edit mode and saves with PUT", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content_md: "Existing body",
            featured: false,
            id: 7,
            slug: "existing",
            summary: "",
            title: "Existing",
            techs: [],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 7,
            slug: "existing",
            status: "draft",
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const router = createMemoryRouter(
      [{ path: "/admin/projects/:id", element: <ContentEditPage resource="projects" /> }],
      { initialEntries: ["/admin/projects/7"] },
    );

    renderWithApp(<RouterProvider router={router} />);

    expect(await screen.findByDisplayValue("Existing")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /保存草稿/i }));

    const updateCall = fetchMock.mock.calls[1];
    expect(updateCall?.[0]).toBe("/api/admin/projects/7");
    expect((updateCall?.[1] as RequestInit | undefined)?.method).toBe("PUT");
  });

  it("creates the first locale translation with If-None-Match star", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content_md: "Chinese body",
            featured: false,
            id: 7,
            slug: "zh-slug",
            summary: "Chinese summary",
            techs: [],
            title: "Chinese Source Title",
            translations: {
              en: {
                content_md: "",
                etag: null,
                exists: false,
                slug: "",
                stale: false,
                summary: "",
                title: "",
                translation_status: "empty",
              },
              ja: {
                content_md: "",
                etag: null,
                exists: false,
                slug: "",
                stale: false,
                summary: "",
                title: "",
                translation_status: "empty",
              },
            },
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const router = createMemoryRouter(
      [{ path: "/admin/projects/:id", element: <ContentEditPage resource="projects" /> }],
      { initialEntries: ["/admin/projects/7"] },
    );

    renderWithApp(<RouterProvider router={router} />);

    await userEvent.click(await screen.findByRole("tab", { name: "英文（辅）" }));
    const workflow = await screen.findByRole("region", { name: "英文翻译与发布" });
    await userEvent.clear(screen.getByLabelText("标题"));
    await userEvent.type(screen.getByLabelText("标题"), "English Title");
    await userEvent.click(within(workflow).getByRole("button", { name: "保存人工修改" }));

    const init = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/admin/projects/7/translations/en");
    expect(new Headers(init.headers).get("If-None-Match")).toBe("*");
    expect(init.method).toBe("PUT");
  });

  it("warns before unpublishing a locale to edit slug", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            content_md: "Chinese body",
            featured: false,
            id: 7,
            slug: "zh-slug",
            summary: "Chinese summary",
            techs: [],
            title: "Chinese Source Title",
            translations: {
              en: {
                content_md: "",
                etag: '"abc"',
                exists: true,
                slug: "english-title",
                stale: false,
                summary: "English summary",
                title: "English title",
                translation_status: "reviewed",
              },
              ja: {
                content_md: "",
                etag: null,
                exists: false,
                slug: "",
                stale: false,
                summary: "",
                title: "",
                translation_status: "empty",
              },
            },
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      ),
    );

    const router = createMemoryRouter(
      [{ path: "/admin/projects/:id", element: <ContentEditPage resource="projects" /> }],
      { initialEntries: ["/admin/projects/7"] },
    );

    renderWithApp(<RouterProvider router={router} />);

    await userEvent.click(await screen.findByRole("tab", { name: "英文（辅）" }));
    const workflow = await screen.findByRole("region", { name: "英文翻译与发布" });
    expect(within(workflow).getByRole("button", { name: "取消发布并转为草稿" })).toBeInTheDocument();
  });

  it("creates the first writing translation with If-None-Match star", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content_md: "Chinese body",
            excerpt: "Chinese excerpt",
            featured: false,
            id: 9,
            slug: "zh-writing",
            tags: [],
            title: "Chinese Writing",
            translations: {
              en: {
                content_md: "",
                etag: null,
                exists: false,
                excerpt: "",
                seo_description: "",
                seo_title: "",
                slug: "",
                stale: false,
                title: "",
                translation_status: "empty",
              },
              ja: {
                content_md: "",
                etag: null,
                exists: false,
                excerpt: "",
                seo_description: "",
                seo_title: "",
                slug: "",
                stale: false,
                title: "",
                translation_status: "empty",
              },
            },
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const router = createMemoryRouter(
      [{ path: "/admin/writing/:id", element: <ContentEditPage resource="writing" /> }],
      { initialEntries: ["/admin/writing/9"] },
    );

    renderWithApp(<RouterProvider router={router} />);

    await userEvent.click(await screen.findByRole("tab", { name: "英文（辅）" }));
    const workflow = await screen.findByRole("region", { name: "英文翻译与发布" });
    await userEvent.clear(screen.getByLabelText("标题"));
    await userEvent.type(screen.getByLabelText("标题"), "English Writing");
    await userEvent.click(within(workflow).getByRole("button", { name: "保存人工修改" }));

    const init = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/admin/writing/9/translations/en");
    expect(new Headers(init.headers).get("If-None-Match")).toBe("*");
    expect(init.method).toBe("PUT");
  });

  it("shows the markdown import entry for draft writing only", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content_md: "Chinese body",
            excerpt: "Chinese excerpt",
            featured: false,
            id: 9,
            slug: "zh-writing",
            status: "draft",
            tags: [],
            title: "Chinese Writing",
            translations: {
              en: {
                content_md: "",
                etag: null,
                exists: false,
                excerpt: "",
                seo_description: "",
                seo_title: "",
                slug: "",
                stale: false,
                title: "",
                translation_status: "empty",
              },
              ja: {
                content_md: "",
                etag: null,
                exists: false,
                excerpt: "",
                seo_description: "",
                seo_title: "",
                slug: "",
                stale: false,
                title: "",
                translation_status: "empty",
              },
            },
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content_md: "Chinese body",
            excerpt: "Chinese excerpt",
            featured: false,
            id: 10,
            slug: "published-writing",
            status: "published",
            tags: [],
            title: "Published Writing",
            translations: {
              en: {
                content_md: "",
                etag: null,
                exists: false,
                excerpt: "",
                seo_description: "",
                seo_title: "",
                slug: "",
                stale: false,
                title: "",
                translation_status: "empty",
              },
              ja: {
                content_md: "",
                etag: null,
                exists: false,
                excerpt: "",
                seo_description: "",
                seo_title: "",
                slug: "",
                stale: false,
                title: "",
                translation_status: "empty",
              },
            },
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content_md: "Project body",
            featured: false,
            id: 7,
            slug: "project",
            status: "draft",
            summary: "Project summary",
            techs: [],
            title: "Project title",
            translations: {
              en: {
                content_md: "",
                etag: null,
                exists: false,
                slug: "",
                stale: false,
                summary: "",
                title: "",
                translation_status: "empty",
              },
              ja: {
                content_md: "",
                etag: null,
                exists: false,
                slug: "",
                stale: false,
                summary: "",
                title: "",
                translation_status: "empty",
              },
            },
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const draftRouter = createMemoryRouter(
      [{ path: "/admin/writing/:id", element: <ContentEditPage resource="writing" /> }],
      { initialEntries: ["/admin/writing/9"] },
    );
    renderWithApp(<RouterProvider router={draftRouter} />);

    expect(await screen.findByDisplayValue("Chinese Writing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入本地 Markdown" })).toBeInTheDocument();

    cleanup();

    const publishedRouter = createMemoryRouter(
      [{ path: "/admin/writing/:id", element: <ContentEditPage resource="writing" /> }],
      { initialEntries: ["/admin/writing/10"] },
    );
    renderWithApp(<RouterProvider router={publishedRouter} />);

    expect(await screen.findByDisplayValue("Published Writing")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导入本地 Markdown" })).not.toBeInTheDocument();

    cleanup();

    const projectRouter = createMemoryRouter(
      [{ path: "/admin/projects/:id", element: <ContentEditPage resource="projects" /> }],
      { initialEntries: ["/admin/projects/7"] },
    );
    renderWithApp(<RouterProvider router={projectRouter} />);

    expect(await screen.findByDisplayValue("Project title")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导入本地 Markdown" })).not.toBeInTheDocument();
  });

  it("generates talk translation from the locale tab", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            event_name: "Chinese Event",
            featured: false,
            id: 11,
            slug: "zh-talk",
            summary: "Chinese summary",
            title: "Chinese Talk",
            translations: {
              en: {
                etag: null,
                event_name: "",
                exists: false,
                seo_description: "",
                seo_title: "",
                slug: "",
                stale: false,
                summary: "",
                title: "",
                translation_status: "empty",
              },
              ja: {
                etag: null,
                event_name: "",
                exists: false,
                seo_description: "",
                seo_title: "",
                slug: "",
                stale: false,
                summary: "",
                title: "",
                translation_status: "empty",
              },
            },
            video_url: "",
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const router = createMemoryRouter(
      [{ path: "/admin/talks/:id", element: <ContentEditPage resource="talks" /> }],
      { initialEntries: ["/admin/talks/11"] },
    );

    renderWithApp(<RouterProvider router={router} />);

    await userEvent.click(await screen.findByRole("tab", { name: "英文（辅）" }));
    const workflow = await screen.findByRole("region", { name: "英文翻译与发布" });
    expect(within(workflow).getByRole("button", { name: "保存人工修改" })).toBeInTheDocument();
    expect(within(workflow).getByRole("button", { name: "人工审核并发布" })).toBeDisabled();
    await userEvent.click(within(workflow).getByRole("button", { name: "AI 翻译为英文" }));

    const generateCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/admin/talks/11/translations/en/generate" && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(generateCall).toBeTruthy();
  });

  it("saves experience translation fields to the singular endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            description: "Chinese description",
            id: 5,
            organization: "Chinese Org",
            period: "2024",
            title: "Chinese Experience",
            translations: {
              en: {
                description: "",
                etag: null,
                exists: false,
                organization: "",
                period: "",
                stale: false,
                title: "",
                translation_status: "empty",
              },
              ja: {
                description: "",
                etag: null,
                exists: false,
                organization: "",
                period: "",
                stale: false,
                title: "",
                translation_status: "empty",
              },
            },
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const router = createMemoryRouter(
      [{ path: "/admin/experience/:id", element: <ContentEditPage resource="experience" /> }],
      { initialEntries: ["/admin/experience/5"] },
    );

    renderWithApp(<RouterProvider router={router} />);

    await userEvent.click(await screen.findByRole("tab", { name: "日文（辅）" }));
    const workflow = await screen.findByRole("region", { name: "日文翻译与发布" });
    await userEvent.clear(screen.getByLabelText("机构"));
    await userEvent.type(screen.getByLabelText("机构"), "Tokyo Org");
    await userEvent.click(within(workflow).getByRole("button", { name: "保存人工修改" }));

    const saveCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/admin/experience/5/translations/ja" && (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(saveCall).toBeTruthy();
    const body = JSON.parse(String((saveCall?.[1] as RequestInit | undefined)?.body));
    expect(body).toMatchObject({
      description: "",
      organization: "Tokyo Org",
      period: "",
      title: "",
    });
  });
});

describe("ContentListPage", () => {
  it("renders the structured overview layout for content collections", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              featured: true,
              id: 7,
              published_at: "2026-06-20T00:00:00Z",
              slug: "existing",
              status: "published",
              summary: "A polished case study",
              title: "Existing",
            },
          ]),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      ),
    );

    renderWithApp(
      <MemoryRouter>
        <ContentListPage resource="projects" />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("admin-overview-grid")).toBeInTheDocument();
    expect(screen.getByTestId("admin-content-list")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "编辑" })).toHaveAttribute("href", "/admin/projects/7");
    expect(screen.getAllByText("案例、演示、仓库与重点项目内容。")).toHaveLength(2);
  });
});
