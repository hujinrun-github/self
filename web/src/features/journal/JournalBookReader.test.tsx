import type { ComponentProps } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JournalBookReader } from "./JournalBookReader";
import type { JournalEntry, JournalScene } from "./types";

vi.mock("./JournalCanvas", () => ({
  JournalCanvas: ({
    scene,
    thumbnail,
    readOnly,
    bookPage,
    immersive,
  }: {
    scene: JournalScene;
    thumbnail?: boolean;
    readOnly?: boolean;
    bookPage?: boolean;
    immersive?: boolean;
  }) => (
    <div
      data-testid={thumbnail ? "thumbnail-canvas" : "live-canvas"}
      data-read-only={String(readOnly)}
      data-book-page={String(bookPage)}
      data-immersive={String(immersive)}
    >
      {scene.elements.map((element) => (
        <span key={element.id}>{element.text}</span>
      ))}
      {!thumbnail && (
        <>
          <div tabIndex={0} data-testid="canvas-content">画布内容</div>
          <input aria-label="画布输入" />
          <button type="button">整页</button>
        </>
      )}
    </div>
  ),
}));

const entries: JournalEntry[] = [1, 2, 3].map((id) => ({
  id,
  notebook_id: 7,
  title: `第 ${id} 篇记录`,
  entry_date: `2026-10-0${id}`,
  mood: "😊",
  weather: "晴",
  tags: ["生活"],
  favorite: false,
  version: 1,
  deleted_at: null,
  created_at: "",
  updated_at: "",
  scene: {
    schemaVersion: 1,
    width: 800,
    height: 1100,
    paper: "plain",
    elements: [
      {
        id: `text-${id}`,
        type: "text",
        text: `第 ${id} 页的手帐内容`,
        x: 40,
        y: 60,
        width: 600,
        height: 200,
        rotation: 0,
        locked: false,
      },
    ],
  },
}));

type Props = ComponentProps<typeof JournalBookReader>;

function renderReader(overrides: Partial<Props> = {}) {
  const props: Props = {
    entry: entries[1],
    entries,
    bookTitle: "日常手帐",
    coverColor: "#789888",
    locale: "zh",
    assetURL: (id) => `/protected-assets/${id}`,
    loading: false,
    onNavigate: vi.fn(),
    ...overrides,
  };
  return { ...render(<JournalBookReader {...props} />), props };
}

function reader() {
  return screen.getByRole("region", { name: "手帐书页阅读器" });
}

function swipeStrip() {
  return screen.getByText("在这里左右滑动翻页").parentElement!;
}

function animationEnd(target: HTMLElement) {
  fireEvent.animationEnd(target);
  // JSDOM omits AnimationEvent, so React can select its WebKit event alias.
  fireEvent(target, new Event("webkitAnimationEnd", { bubbles: true }));
}

function swipe(
  target: HTMLElement,
  start: { x: number; y: number },
  end: { x: number; y: number },
  pointerType = "touch",
) {
  fireEvent.pointerDown(target, {
    pointerId: 1,
    pointerType,
    clientX: start.x,
    clientY: start.y,
  });
  fireEvent.pointerUp(target, {
    pointerId: 1,
    pointerType,
    clientX: end.x,
    clientY: end.y,
  });
}

beforeEach(() => {
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("JournalBookReader", () => {
  it.each([
    { index: 0, previousDisabled: true, nextDisabled: false, cue: "已经是第一页" },
    { index: 2, previousDisabled: false, nextDisabled: true, cue: "已经是最后一页" },
  ])("respects the navigation boundary at entry $index", ({ index, previousDisabled, nextDisabled, cue }) => {
    const { props } = renderReader({ entry: entries[index] });
    const previous = screen.getByRole("button", { name: "上一页" });
    const next = screen.getByRole("button", { name: "下一页" });
    expect(previous.hasAttribute("disabled")).toBe(previousDisabled);
    expect(next.hasAttribute("disabled")).toBe(nextDisabled);
    expect(screen.getByRole("status")).toHaveTextContent(cue);
    expect(screen.getByText(`页 ${index + 1} / 3`)).toBeInTheDocument();
    fireEvent.click(previousDisabled ? previous : next);
    expect(props.onNavigate).not.toHaveBeenCalled();
    fireEvent.click(previousDisabled ? next : previous);
    expect(props.onNavigate).toHaveBeenCalledExactlyOnceWith(entries[1]);
  });

  it("shows a one-page boundary and preserves the scene in the book canvas", () => {
    const { props } = renderReader({ entry: entries[0], entries: [entries[0]] });
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("这本手帐目前只有一页");
    expect(screen.getByTestId("live-canvas")).toHaveAttribute("data-read-only", "true");
    expect(screen.getByTestId("live-canvas")).toHaveAttribute("data-book-page", "true");
    expect(screen.getByTestId("live-canvas")).toHaveTextContent("第 1 页的手帐内容");
    fireEvent.keyDown(reader(), { key: "ArrowRight" });
    swipe(swipeStrip(), { x: 200, y: 10 }, { x: 60, y: 10 });
    expect(props.onNavigate).not.toHaveBeenCalled();
  });

  it("keeps both visible and turning pages read only in the immersive reader", () => {
    const { props, rerender } = renderReader({
      entry: entries[0],
      immersive: true,
    });
    expect(screen.getByTestId("live-canvas")).toHaveAttribute("data-immersive", "true");
    rerender(<JournalBookReader {...props} entry={entries[1]} />);
    for (const canvas of [
      screen.getByTestId("live-canvas"),
      screen.getByTestId("thumbnail-canvas"),
    ]) {
      expect(canvas).toHaveAttribute("data-read-only", "true");
      expect(canvas).toHaveAttribute("data-immersive", "true");
    }
    const outgoing = screen.getByTestId("thumbnail-canvas").closest<HTMLElement>('[aria-hidden="true"]')!;
    expect(outgoing).toHaveAttribute("inert");
    animationEnd(outgoing);
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(props.onNavigate).toHaveBeenCalledExactlyOnceWith(entries[2]);
  });

  it("blocks button, keyboard, and swipe navigation while a new page loads", () => {
    const { props, rerender } = renderReader({ loading: true });
    expect(reader()).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("正在打开书页…");
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    fireEvent.keyDown(reader(), { key: "ArrowLeft" });
    swipe(swipeStrip(), { x: 200, y: 10 }, { x: 60, y: 10 });
    expect(props.onNavigate).not.toHaveBeenCalled();
    rerender(<JournalBookReader {...props} loading={false} />);
    expect(reader()).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("button", { name: "上一页" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled();
  });

  it("keeps the outgoing page inert until its own animation finishes", () => {
    const { props, rerender } = renderReader({ entry: entries[0] });
    rerender(<JournalBookReader {...props} entry={entries[1]} />);
    const thumbnail = screen.getByTestId("thumbnail-canvas");
    const outgoing = thumbnail.closest<HTMLElement>('[aria-hidden="true"]')!;
    expect(thumbnail).toHaveTextContent("第 1 页的手帐内容");
    expect(screen.getByTestId("live-canvas")).toHaveTextContent("第 2 页的手帐内容");
    expect(outgoing).toHaveAttribute("aria-hidden", "true");
    expect(outgoing).toHaveAttribute("inert");
    expect(reader()).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("正在翻页…");
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
    fireEvent.keyDown(reader(), { key: "ArrowRight" });
    swipe(swipeStrip(), { x: 200, y: 10 }, { x: 60, y: 10 });
    expect(props.onNavigate).not.toHaveBeenCalled();
    animationEnd(thumbnail);
    expect(screen.getByTestId("thumbnail-canvas")).toBeInTheDocument();
    animationEnd(outgoing);
    expect(screen.queryByTestId("thumbnail-canvas")).not.toBeInTheDocument();
    expect(screen.queryByText("第 1 页的手帐内容")).not.toBeInTheDocument();
    expect(reader()).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("button", { name: "上一页" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled();
  });

  it("removes the outgoing content when animationEnd is unavailable", () => {
    vi.useFakeTimers();
    const { props, rerender, unmount } = renderReader({ entry: entries[0] });
    rerender(<JournalBookReader {...props} entry={entries[1]} />);
    expect(screen.getByTestId("thumbnail-canvas")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByTestId("thumbnail-canvas")).not.toBeInTheDocument();
    expect(reader()).toHaveAttribute("aria-busy", "false");
    rerender(<JournalBookReader {...props} entry={entries[2]} />);
    expect(screen.getByTestId("thumbnail-canvas")).toBeInTheDocument();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.queryByText("第 2 页的手帐内容")).not.toBeInTheDocument();
  });

  it("changes pages immediately when reduced motion is preferred", () => {
    vi.mocked(window.matchMedia).mockImplementation((query) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const { props, rerender } = renderReader({ entry: entries[0] });
    rerender(<JournalBookReader {...props} entry={entries[1]} />);
    expect(screen.queryByTestId("thumbnail-canvas")).not.toBeInTheDocument();
    expect(screen.queryByText("第 1 页的手帐内容")).not.toBeInTheDocument();
    expect(screen.getByTestId("live-canvas")).toHaveTextContent("第 2 页的手帐内容");
    expect(reader()).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled();
  });

  it("uses arrow keys at the reader while leaving canvas and form controls alone", () => {
    const { props } = renderReader();
    fireEvent.keyDown(screen.getByTestId("canvas-content"), { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByRole("button", { name: "整页" }), { key: "ArrowLeft" });
    const input = document.createElement("input");
    reader().append(input);
    fireEvent.keyDown(input, { key: "ArrowRight" });
    fireEvent.keyDown(reader(), { key: "ArrowRight", ctrlKey: true });
    fireEvent.keyDown(reader(), { key: "ArrowRight", repeat: true });
    expect(props.onNavigate).not.toHaveBeenCalled();
    fireEvent.keyDown(reader(), { key: "ArrowRight" });
    fireEvent.keyDown(reader(), { key: "ArrowLeft" });
    expect(props.onNavigate).toHaveBeenNthCalledWith(1, entries[2]);
    expect(props.onNavigate).toHaveBeenNthCalledWith(2, entries[0]);
  });

  it("turns pages for horizontal touch swipes without claiming canvas gestures", () => {
    const { props } = renderReader();
    swipe(swipeStrip(), { x: 220, y: 20 }, { x: 80, y: 25 });
    swipe(swipeStrip(), { x: 80, y: 20 }, { x: 220, y: 25 });
    expect(props.onNavigate).toHaveBeenNthCalledWith(1, entries[2]);
    expect(props.onNavigate).toHaveBeenNthCalledWith(2, entries[0]);
    swipe(screen.getByTestId("live-canvas"), { x: 220, y: 20 }, { x: 80, y: 25 });
    expect(props.onNavigate).toHaveBeenCalledTimes(2);
  });

  it("ignores vertical, short, mouse, cancelled, and multi-touch footer gestures", () => {
    const { props } = renderReader();
    const strip = swipeStrip();
    swipe(strip, { x: 100, y: 20 }, { x: 30, y: 160 });
    swipe(strip, { x: 100, y: 20 }, { x: 80, y: 22 });
    swipe(strip, { x: 220, y: 20 }, { x: 80, y: 25 }, "mouse");
    fireEvent.pointerDown(strip, { pointerId: 1, pointerType: "touch", clientX: 220, clientY: 20 });
    fireEvent.pointerCancel(strip, { pointerId: 1, pointerType: "touch", clientX: 80, clientY: 25 });
    fireEvent.pointerDown(strip, { pointerId: 1, pointerType: "touch", clientX: 220, clientY: 20 });
    fireEvent.pointerDown(strip, { pointerId: 2, pointerType: "touch", clientX: 210, clientY: 20 });
    fireEvent.pointerUp(strip, { pointerId: 2, pointerType: "touch", clientX: 80, clientY: 25 });
    fireEvent.pointerUp(strip, { pointerId: 1, pointerType: "touch", clientX: 80, clientY: 25 });
    expect(props.onNavigate).not.toHaveBeenCalled();
    swipe(strip, { x: 220, y: 20 }, { x: 80, y: 25 });
    expect(props.onNavigate).toHaveBeenCalledExactlyOnceWith(entries[2]);
  });
});
