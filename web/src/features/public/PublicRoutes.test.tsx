import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

import { routes } from "../../app/routes";
import { renderWithApp } from "../../test/render";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubPublicFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const rawURL = typeof input === "string" ? input : input.toString();
      const url = new URL(rawURL, "http://localhost");
      const locale = url.searchParams.get("locale") ?? "zh";
      if (url.pathname === "/api/site/home") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              experiences: [],
              projects: [],
              requested_locale: locale,
              resolved_locale: locale,
              talks: [],
              writing: [],
            }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          ),
        );
      }
      if (url.pathname === "/api/site/profile") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              bio: "",
              email: "",
              headline: "",
              name: "",
              requested_locale: locale,
              resolved_locale: locale,
              social_links: [],
              summary: "",
            }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          ),
        );
      }
      if (url.pathname === "/api/site/projects" || url.pathname === "/api/site/writing" || url.pathname === "/api/site/talks") {
        return Promise.resolve(
          new Response(
            JSON.stringify({ items: [], requested_locale: locale, resolved_locale: locale }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            alternates: [],
            item: { content_md: "", title: "Example" },
            requested_locale: locale,
            resolved_locale: locale,
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      );
    }),
  );
}

describe("public locale routes", () => {
  it("redirects bare root to /zh", async () => {
    stubPublicFetch();
    const memoryRouter = createMemoryRouter(routes, { initialEntries: ["/"] });

    renderWithApp(<RouterProvider router={memoryRouter} />);

    await waitFor(() => {
      expect(memoryRouter.state.location.pathname).toBe("/zh");
    });
  });

  it("redirects legacy public talks routes to the locale home", async () => {
    stubPublicFetch();
    const bareTalksRouter = createMemoryRouter(routes, { initialEntries: ["/talks"] });

    renderWithApp(<RouterProvider router={bareTalksRouter} />);

    await waitFor(() => {
      expect(bareTalksRouter.state.location.pathname).toBe("/zh");
    });

    cleanup();
    vi.unstubAllGlobals();
    stubPublicFetch();

    const localizedTalksRouter = createMemoryRouter(routes, { initialEntries: ["/en/talks"] });
    renderWithApp(<RouterProvider router={localizedTalksRouter} />);

    await waitFor(() => {
      expect(localizedTalksRouter.state.location.pathname).toBe("/en");
    });
  });

  it("redirects unsupported locale prefixes to /zh equivalents", async () => {
    stubPublicFetch();
    const memoryRouter = createMemoryRouter(routes, { initialEntries: ["/fr/projects"] });

    renderWithApp(<RouterProvider router={memoryRouter} />);

    await waitFor(() => {
      expect(memoryRouter.state.location.pathname).toBe("/zh/projects");
    });
  });

  it("activates supported locale routes and preserves the locale in primary navigation", async () => {
    stubPublicFetch();
    const memoryRouter = createMemoryRouter(routes, { initialEntries: ["/en/projects"] });

    renderWithApp(<RouterProvider router={memoryRouter} />);

    expect(await screen.findByRole("link", { name: "Bio" })).toHaveAttribute("href", "/en/bio");
    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute("href", "/en/projects");
    expect(screen.queryByRole("link", { name: "Talks" })).not.toBeInTheDocument();
  });

  it("renders localized shell copy on the zh homepage", async () => {
    stubPublicFetch();
    const memoryRouter = createMemoryRouter(routes, { initialEntries: ["/zh"] });

    renderWithApp(<RouterProvider router={memoryRouter} />);

    expect(await screen.findByRole("heading", { name: "作品集" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "联系" }).some((link) => link.getAttribute("href") === "/zh/contact")).toBe(true);
    expect(screen.getAllByRole("link", { name: "项目" }).some((link) => link.getAttribute("href") === "/zh/projects")).toBe(true);
  });

  it("renders a full home layout even when public content is empty", async () => {
    stubPublicFetch();
    const memoryRouter = createMemoryRouter(routes, { initialEntries: ["/zh"] });

    renderWithApp(<RouterProvider router={memoryRouter} />);

    expect(await screen.findByTestId("public-hero")).toBeInTheDocument();
    expect(screen.getByTestId("public-section-writing")).toBeInTheDocument();
    expect(screen.getByTestId("public-section-projects")).toBeInTheDocument();
    expect(screen.queryByTestId("public-section-talks")).not.toBeInTheDocument();
  });

  it("renders experience tech tags on the homepage timeline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const rawURL = typeof input === "string" ? input : input.toString();
        const url = new URL(rawURL, "http://localhost");
        const locale = url.searchParams.get("locale") ?? "zh";
        if (url.pathname === "/api/site/home") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                experiences: [
                  {
                    description: "Built AI platform systems.",
                    id: 1,
                    organization: "Acme",
                    period: "2021.03 - 2024.06",
                    techs: [
                      { name: "React", slug: "react", sort_order: 10 },
                      { name: "PostgreSQL", slug: "postgresql", sort_order: 20 },
                    ],
                    title: "Staff Engineer",
                  },
                ],
                projects: [],
                requested_locale: locale,
                resolved_locale: locale,
                talks: [],
                writing: [],
              }),
              { headers: { "Content-Type": "application/json" }, status: 200 },
            ),
          );
        }
        if (url.pathname === "/api/site/profile") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                bio: "",
                email: "",
                headline: "Builder",
                name: "Chinese Name",
                requested_locale: locale,
                resolved_locale: locale,
                social_links: [],
                summary: "",
              }),
              { headers: { "Content-Type": "application/json" }, status: 200 },
            ),
          );
        }
        return Promise.resolve(new Response("{}", { headers: { "Content-Type": "application/json" }, status: 200 }));
      }),
    );
    const memoryRouter = createMemoryRouter(routes, { initialEntries: ["/zh"] });

    renderWithApp(<RouterProvider router={memoryRouter} />);

    expect(await screen.findByRole("heading", { name: "Staff Engineer" })).toBeInTheDocument();
    expect(screen.getByText("React")).toBeInTheDocument();
    expect(screen.getByText("PostgreSQL")).toBeInTheDocument();
  });

  it("keeps a long profile summary readable and links to the full bio", async () => {
    const longSummary =
      "I design scalable recommendation systems, AI products, and dependable platform foundations for complex, high-volume business workflows.";
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const rawURL = typeof input === "string" ? input : input.toString();
        const url = new URL(rawURL, "http://localhost");
        const locale = url.searchParams.get("locale") ?? "zh";
        if (url.pathname === "/api/site/home") {
          return Promise.resolve(
            new Response(
              JSON.stringify({ experiences: [], projects: [], requested_locale: locale, resolved_locale: locale, writing: [] }),
              { headers: { "Content-Type": "application/json" }, status: 200 },
            ),
          );
        }
        if (url.pathname === "/api/site/profile") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                bio: "Full biography",
                email: "",
                headline: "Software architect",
                name: "Ada",
                requested_locale: locale,
                resolved_locale: locale,
                social_links: [],
                summary: longSummary,
              }),
              { headers: { "Content-Type": "application/json" }, status: 200 },
            ),
          );
        }
        return Promise.resolve(new Response("{}", { headers: { "Content-Type": "application/json" }, status: 200 }));
      }),
    );
    const memoryRouter = createMemoryRouter(routes, { initialEntries: ["/zh"] });

    renderWithApp(<RouterProvider router={memoryRouter} />);

    await screen.findByRole("heading", { name: "Ada" });
    const hero = screen.getByTestId("public-hero");
    expect(within(hero).getByTestId("home-profile-summary")).toHaveTextContent(longSummary);
    expect(within(hero).getByRole("link", { name: "了解更多" })).toHaveAttribute("href", "/zh/bio");
  });

  it("renders the configured profile avatar on the homepage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const rawURL = typeof input === "string" ? input : input.toString();
        const url = new URL(rawURL, "http://localhost");
        const locale = url.searchParams.get("locale") ?? "zh";
        if (url.pathname === "/api/site/home") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                experiences: [],
                projects: [],
                requested_locale: locale,
                resolved_locale: locale,
                talks: [],
                writing: [],
              }),
              { headers: { "Content-Type": "application/json" }, status: 200 },
            ),
          );
        }
        if (url.pathname === "/api/site/profile") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                avatar_media_id: 42,
                bio: "",
                email: "",
                headline: "Builder",
                name: "Chinese Name",
                requested_locale: locale,
                resolved_locale: locale,
                social_links: [],
                summary: "",
              }),
              { headers: { "Content-Type": "application/json" }, status: 200 },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({ items: [], requested_locale: locale, resolved_locale: locale }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          ),
        );
      }),
    );
    const memoryRouter = createMemoryRouter(routes, { initialEntries: ["/zh"] });

    renderWithApp(<RouterProvider router={memoryRouter} />);

    const avatar = await screen.findByRole("img", { name: "Chinese Name" });
    expect(avatar).toHaveAttribute("src", "/media/42/avatar");
  });

  it("renders profile social links with uploaded social images on the homepage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const rawURL = typeof input === "string" ? input : input.toString();
        const url = new URL(rawURL, "http://localhost");
        const locale = url.searchParams.get("locale") ?? "zh";
        if (url.pathname === "/api/site/home") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                experiences: [],
                projects: [],
                requested_locale: locale,
                resolved_locale: locale,
                talks: [],
                writing: [],
              }),
              { headers: { "Content-Type": "application/json" }, status: 200 },
            ),
          );
        }
        if (url.pathname === "/api/site/profile") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                bio: "",
                email: "",
                headline: "Builder",
                name: "Chinese Name",
                requested_locale: locale,
                resolved_locale: locale,
                social_links: [{ icon: "media://asset/9/avatar", id: 9, label: "X", url: "https://x.com/ada" }],
                summary: "",
              }),
              { headers: { "Content-Type": "application/json" }, status: 200 },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({ items: [], requested_locale: locale, resolved_locale: locale }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          ),
        );
      }),
    );
    const memoryRouter = createMemoryRouter(routes, { initialEntries: ["/zh"] });

    renderWithApp(<RouterProvider router={memoryRouter} />);

    const socialLink = await screen.findByRole("link", { name: "X https://x.com/ada" });
    expect(socialLink).toHaveAttribute("href", "https://x.com/ada");
    expect(screen.getByAltText("X")).toHaveAttribute("src", "/media/9/avatar");
  });

  it("renders localized list headings and empty states on ja routes", async () => {
    stubPublicFetch();
    const memoryRouter = createMemoryRouter(routes, { initialEntries: ["/ja/projects"] });

    renderWithApp(<RouterProvider router={memoryRouter} />);

    expect(await screen.findByRole("heading", { name: "プロジェクト" })).toBeInTheDocument();
    expect(screen.getByText("公開済みの項目はまだありません。")).toBeInTheDocument();
  });

  it("renders a structured editorial layout for writing routes", async () => {
    stubPublicFetch();
    const memoryRouter = createMemoryRouter(routes, { initialEntries: ["/zh/writing"] });

    renderWithApp(<RouterProvider router={memoryRouter} />);

    expect(await screen.findByTestId("public-writing-layout")).toBeInTheDocument();
    expect(screen.getByTestId("public-list-hero")).toBeInTheDocument();
    expect(screen.getByTestId("public-writing-list")).toBeInTheDocument();
  });

  it("renders a showcase layout for project routes", async () => {
    stubPublicFetch();
    const memoryRouter = createMemoryRouter(routes, { initialEntries: ["/zh/projects"] });

    renderWithApp(<RouterProvider router={memoryRouter} />);

    expect(await screen.findByTestId("public-projects-layout")).toBeInTheDocument();
    expect(screen.getByTestId("public-list-hero")).toBeInTheDocument();
    expect(screen.getByTestId("public-project-grid")).toBeInTheDocument();
  });

  it("uses detail alternates for the locale switcher and marks fallback pages as noindex", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const rawURL = typeof input === "string" ? input : input.toString();
        const url = new URL(rawURL, "http://localhost");
        const locale = url.searchParams.get("locale") ?? "zh";
        if (url.pathname === "/api/site/writing/example") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                alternates: [
                  { kind: "source", locale: "zh", path: "/zh/writing/zh-example", reviewed: true, slug: "zh-example" },
                  { kind: "translation", locale: "en", path: "/en/writing/example", reviewed: true, slug: "example" },
                ],
                fallback_from: "en",
                item: { content_md: "", excerpt: "Summary", title: "Example" },
                requested_locale: locale,
                resolved_locale: "zh",
              }),
              { headers: { "Content-Type": "application/json" }, status: 200 },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({ items: [], requested_locale: locale, resolved_locale: locale }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          ),
        );
      }),
    );

    const memoryRouter = createMemoryRouter(routes, { initialEntries: ["/en/writing/example"] });

    renderWithApp(<RouterProvider router={memoryRouter} />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "ZH" })).toHaveAttribute("href", "/zh/writing/zh-example");
      expect(screen.getByRole("link", { name: "EN" })).toHaveAttribute("href", "/en/writing/example");
      expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, follow");
    });
  });

  it("renders writing quick jumps and supports server likes and moderated comments", async () => {
    window.localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const rawURL = typeof input === "string" ? input : input.toString();
        const url = new URL(rawURL, "http://localhost");
        const locale = url.searchParams.get("locale") ?? "zh";
        const method = init?.method ?? "GET";
        if (url.pathname === "/api/site/writing/example/like" && method === "POST") {
          return Promise.resolve(
            new Response(JSON.stringify({ like_count: 4, liked: true }), { headers: { "Content-Type": "application/json" }, status: 200 }),
          );
        }
        if (url.pathname === "/api/site/writing/example/comments" && method === "POST") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                author_name: "Lin",
                body: "New thought",
                created_at: "2026-07-20T10:00:00Z",
                id: 2,
                status: "pending",
              }),
              { headers: { "Content-Type": "application/json" }, status: 201 },
            ),
          );
        }
        if (url.pathname === "/api/site/writing/example/engagement") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                comments: [{ author_name: "Ada", body: "First comment", created_at: "2026-07-19T10:00:00Z", id: 1 }],
                like_count: 3,
                liked: false,
                comment_count: 1,
                view_count: 10,
                visitor_count: 8,
                page: 1,
                limit: 10,
                has_more: false,
              }),
              { headers: { "Content-Type": "application/json" }, status: 200 },
            ),
          );
        }
        if (url.pathname === "/api/site/writing/example/view") {
          return Promise.resolve(new Response(JSON.stringify({ view_count: 11, visitor_count: 8 }), { headers: { "Content-Type": "application/json" }, status: 200 }));
        }
        if (url.pathname === "/api/site/writing/example") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                alternates: [],
                item: {
                  content_md: "# Body",
                  excerpt: "Article summary",
                  id: 10,
                  tags: [{ name: "AI", slug: "ai" }],
                  title: "Article Title",
                },
                requested_locale: locale,
                resolved_locale: locale,
              }),
              { headers: { "Content-Type": "application/json" }, status: 200 },
            ),
          );
        }
        if (url.pathname === "/api/site/writing") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                items: [
                  { excerpt: "Read next", id: 11, slug: "related-note", title: "Related Note" },
                  { excerpt: "Current", id: 10, slug: "example", title: "Article Title" },
                ],
                requested_locale: locale,
                resolved_locale: locale,
              }),
              { headers: { "Content-Type": "application/json" }, status: 200 },
            ),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ items: [], requested_locale: locale, resolved_locale: locale }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
        );
      }),
    );

    const memoryRouter = createMemoryRouter(routes, { initialEntries: ["/zh/writing/example"] });

    renderWithApp(<RouterProvider router={memoryRouter} />);

    expect(await screen.findByRole("heading", { name: "Article Title" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "快捷跳转" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Related Note/ })).toHaveAttribute("href", "/zh/writing/related-note");
    expect(await screen.findByText("First comment")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /点赞/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /取消点赞/ })).toHaveTextContent("4");
    });

    await userEvent.type(screen.getByLabelText("昵称"), "Lin");
    await userEvent.type(screen.getByLabelText("评论内容"), "New thought");
    await userEvent.click(screen.getByRole("button", { name: "提交评论" }));

    expect(await screen.findByRole("status")).toHaveTextContent("审核通过后公开");
    expect(screen.queryByText("New thought")).not.toBeInTheDocument();
  });

  it("loads the localized bio page from profile data and noindexes fallback locales", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const rawURL = typeof input === "string" ? input : input.toString();
        const url = new URL(rawURL, "http://localhost");
        const locale = url.searchParams.get("locale") ?? "zh";
        if (url.pathname === "/api/site/profile") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                bio: "Chinese Bio",
                email: "ada@example.com",
                fallback_from: "ja",
                headline: "Chinese Headline",
                name: "Chinese Name",
                requested_locale: locale,
                resolved_locale: "zh",
                social_links: [],
                summary: "Chinese Summary",
              }),
              { headers: { "Content-Type": "application/json" }, status: 200 },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({ items: [], requested_locale: locale, resolved_locale: locale }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          ),
        );
      }),
    );

    const memoryRouter = createMemoryRouter(routes, { initialEntries: ["/ja/bio"] });

    renderWithApp(<RouterProvider router={memoryRouter} />);

    expect(await screen.findByText("Chinese Name")).toBeInTheDocument();
    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, follow");
  });

  it("renders a structured bio layout even when profile content is empty", async () => {
    stubPublicFetch();
    const memoryRouter = createMemoryRouter(routes, { initialEntries: ["/zh/bio"] });

    renderWithApp(<RouterProvider router={memoryRouter} />);

    expect(await screen.findByTestId("public-profile-hero")).toBeInTheDocument();
    expect(screen.getByTestId("public-profile-sidebar")).toBeInTheDocument();
  });
});
