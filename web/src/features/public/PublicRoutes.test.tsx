import { cleanup, screen, waitFor, within } from "@testing-library/react";
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
