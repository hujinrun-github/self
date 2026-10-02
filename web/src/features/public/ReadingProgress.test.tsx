import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useReadingProgress } from "./useReadingProgress";
import { WritingDetailPage } from "./WritingDetailPage";

let scrollPosition = 0;
let bodyHeight = 2000;
let firstHeadingPosition = 400;
let resizeCallback: () => void;
let frames: Map<number, FrameRequestCallback>;
const disconnect = vi.fn();

function Reader({ headings = true }: { headings?: boolean }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const { progress, activeHeadingID } = useReadingProgress(bodyRef, "article");
  return <>
    <output data-testid="progress">{progress}</output>
    <output data-testid="active-heading">{activeHeadingID}</output>
    <div id="article-body" ref={bodyRef} style={{ scrollMarginTop: 104 }}>
      {headings ? <><h2 id="first">First</h2><h2 id="second">Second</h2></> : null}
      <img alt="Article illustration" />
    </div>
    <section style={{ height: 10000 }}>Comments do not count as article reading.</section>
  </>;
}

function flushFrame() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  });
}

function scrollTo(position: number) {
  scrollPosition = position;
  fireEvent.scroll(window);
  flushFrame();
}

beforeEach(() => {
  scrollPosition = 0;
  bodyHeight = 2000;
  firstHeadingPosition = 400;
  frames = new Map();
  let frameID = 0;
  vi.stubGlobal("innerHeight", 800);
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    frames.set(++frameID, callback);
    return frameID;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => frames.delete(id)));
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resizeCallback = callback; }
    observe() {}
    disconnect = disconnect;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.id === "article-body") return new DOMRect(0, 400 - scrollPosition, 600, bodyHeight);
    if (this.id === "first") return new DOMRect(0, firstHeadingPosition - scrollPosition, 600, 40);
    if (this.id === "second") return new DOMRect(0, 1400 - scrollPosition, 600, 40);
    return new DOMRect();
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  disconnect.mockClear();
});

describe("article reading feedback", () => {
  it("tracks the visible article and current section without counting the comments", () => {
    render(<Reader />);
    flushFrame();
    expect(screen.getByTestId("progress")).toHaveTextContent("0");
    expect(screen.getByTestId("active-heading")).toHaveTextContent("first");

    scrollTo(1000);
    expect(screen.getByTestId("progress")).toHaveTextContent("54");
    expect(screen.getByTestId("active-heading")).toHaveTextContent("first");
    scrollTo(1350);
    expect(screen.getByTestId("active-heading")).toHaveTextContent("second");
    scrollTo(1600);
    expect(screen.getByTestId("progress")).toHaveTextContent("100");
    scrollTo(2500);
    expect(screen.getByTestId("progress")).toHaveTextContent("100");
    expect(screen.getByTestId("active-heading")).toBeEmptyDOMElement();
  });

  it("recalculates after resizing and image loading, and cleans up pending work", () => {
    const { unmount } = render(<Reader />);
    scrollTo(1000);
    bodyHeight = 3000;
    act(() => resizeCallback());
    flushFrame();
    expect(screen.getByTestId("progress")).toHaveTextContent("31");
    bodyHeight = 2000;
    fireEvent.load(screen.getByAltText("Article illustration"));
    flushFrame();
    expect(screen.getByTestId("progress")).toHaveTextContent("54");

    fireEvent.scroll(window);
    expect(frames.size).toBe(1);
    unmount();
    expect(frames.size).toBe(0);
    expect(disconnect).toHaveBeenCalledOnce();
    fireEvent.scroll(window);
    expect(frames.size).toBe(0);
  });

  it("keeps the section at the reading line active when the final section is visible below it", () => {
    bodyHeight = 1300;
    firstHeadingPosition = 1004;
    render(<Reader />);

    scrollTo(900);

    expect(document.getElementById("second")!.getBoundingClientRect().top).toBe(500);
    expect(screen.getByTestId("progress")).toHaveTextContent("100");
    expect(screen.getByTestId("active-heading")).toHaveTextContent("first");
  });

  it("handles short articles and articles without headings", () => {
    bodyHeight = 200;
    render(<Reader headings={false} />);
    flushFrame();
    expect(screen.getByTestId("progress")).toHaveTextContent("100");
    expect(screen.getByTestId("active-heading")).toBeEmptyDOMElement();
    bodyHeight = 0;
    fireEvent.resize(window);
    flushFrame();
    expect(screen.getByTestId("progress")).toHaveTextContent("0");
  });

  it.each([ ["zh", "阅读进度"], ["en", "Reading progress"], ["ja", "読書の進捗"] ])("exposes progress and the current section in both %s contents lists", async (locale, label) => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const body = url.pathname === "/api/site/writing/example"
        ? { item: { id: 1, slug: "example", title: "An article", content_md: "## First\nBody\n## Second\nMore body" }, requested_locale: locale, resolved_locale: locale, alternates: [] }
        : url.pathname.endsWith("/engagement")
          ? { like_count: 0, liked: false, view_count: 0, visitor_count: 0, comment_count: 0, comments: [], page: 1, limit: 10, has_more: false }
          : { items: [] };
      return Promise.resolve(new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }));
    }));
    render(<MemoryRouter initialEntries={[`/${locale}/writing/example`]}>
      <Routes><Route path="/:locale/writing/:slug" element={<WritingDetailPage />} /></Routes>
    </MemoryRouter>);
    await screen.findByRole("heading", { name: "An article" });
    scrollTo(1350);
    expect(screen.getByRole("progressbar", { name: label })).toHaveAttribute("aria-valuenow", "81");
    const currentLinks = document.querySelectorAll('a[href="#second"]');
    expect(currentLinks).toHaveLength(2);
    currentLinks.forEach((link) => expect(link).toHaveAttribute("aria-current", "location"));
    expect(document.getElementById("second")).toHaveTextContent("Second");
  });
});
