import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { PublicLayout } from "./PublicLayout";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderLayout(path = "/en/projects/example") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/:locale/*" element={<PublicLayout><h1>Page content</h1></PublicLayout>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("public layout keyboard navigation", () => {
  it("starts a newly opened page at the top without animating the old scroll position", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const user = userEvent.setup();
    renderLayout();
    expect(scrollTo).not.toHaveBeenCalled();

    await user.click(within(screen.getByRole("navigation", { name: "Primary" })).getByRole("link", { name: "Writing" }));

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "instant" });
    scrollTo.mockRestore();
  });

  it("connects the menu toggle to its navigation and closes it with Escape", async () => {
    const user = userEvent.setup();
    renderLayout();

    const menuButton = screen.getByRole("button", { name: "Toggle navigation" });
    const navigation = screen.getByRole("navigation", { name: "Primary" });
    expect(menuButton).toHaveAttribute("aria-controls", navigation.id);
    expect(navigation).toHaveAttribute("id", "public-navigation");
    expect(menuButton).toHaveAttribute("aria-expanded", "false");

    await user.click(menuButton);
    expect(menuButton).toHaveAttribute("aria-expanded", "true");
    within(navigation).getByRole("link", { name: "Projects" }).focus();
    await user.keyboard("{Escape}");

    expect(menuButton).toHaveAttribute("aria-expanded", "false");
    expect(navigation).toHaveAttribute("data-open", "false");
    expect(menuButton).toHaveFocus();
  });

  it("dismisses the mobile menu when the reader taps the page outside the header", async () => {
    const user = userEvent.setup();
    renderLayout();
    const menuButton = screen.getByRole("button", { name: "Toggle navigation" });

    await user.click(menuButton);
    expect(menuButton).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("heading", { name: "Page content" }));

    expect(menuButton).toHaveAttribute("aria-expanded", "false");
  });

  it("does not move focus when Escape is pressed with the menu closed", async () => {
    const user = userEvent.setup();
    renderLayout();
    const projects = within(screen.getByRole("navigation", { name: "Primary" })).getByRole("link", { name: "Projects" });
    projects.focus();

    await user.keyboard("{Escape}");

    expect(projects).toHaveFocus();
  });

  it("marks only the matching primary destination as current, including detail pages", () => {
    renderLayout();
    const navigation = screen.getByRole("navigation", { name: "Primary" });

    expect(within(navigation).getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "page");
    expect(within(navigation).getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    expect(within(navigation).getAllByRole("link").filter((link) => link.hasAttribute("aria-current"))).toHaveLength(1);
  });

  it.each([
    ["zh", "跳到主要内容"],
    ["en", "Skip to main content"],
    ["ja", "メインコンテンツへスキップ"],
  ])("offers a working localized skip link for %s", async (locale, label) => {
    const user = userEvent.setup();
    renderLayout(`/${locale}`);
    const main = screen.getByRole("main");

    await user.tab();
    const skipLink = screen.getByRole("link", { name: label });
    expect(skipLink).toHaveFocus();
    expect(skipLink).toHaveAttribute("href", "#main-content");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");

    await user.keyboard("{Enter}");
    expect(main).toHaveFocus();
  });
});
