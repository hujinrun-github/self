import { describe, expect, it, vi } from "vitest";
import { buildJournalPDF, renderJournalScene, wrapJournalText } from "./export";

describe("journal text export", () => {
  it("preserves blank lines and wraps Chinese and composed emoji without breaking graphemes", () => {
    const measure = (value: string) =>
      [
        ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
          value,
        ),
      ].length;
    expect(wrapJournalText("今天晴天\n\n👩‍👩‍👧‍👦春天", 2, measure)).toEqual([
      "今天",
      "晴天",
      "",
      "👩‍👩‍👧‍👦春",
      "天",
    ]);
  });
  it("keeps words together when they fit a line", () => {
    expect(wrapJournalText("hello world", 7, (value) => value.length)).toEqual([
      "hello ",
      "world",
    ]);
  });
});

describe("journal PDF serialization", () => {
  it("writes valid byte offsets and binary stream lengths for multiple pages", () => {
    const jpeg = new Uint8Array([255, 216, 128, 0, 255, 217]);
    const pdf = buildJournalPDF([
      { width: 800, height: 1080, jpeg },
      { width: 1080, height: 800, jpeg },
    ]);
    // Latin-1 preserves one character per byte so offsets can be independently inspected.
    const text = Array.from(pdf, (byte) => String.fromCharCode(byte)).join("");
    expect(text).toContain("/Count 2 /Kids [3 0 R 6 0 R]");
    expect(text).toContain("/MediaBox [0 0 600 810]");
    expect(text).toContain("/MediaBox [0 0 810 600]");
    const start = Number(text.match(/startxref\n(\d+)/)?.[1]);
    expect(text.slice(start, start + 4)).toBe("xref");
    const rows = text.slice(start).split("\n").slice(3, 11);
    rows.forEach((row, index) => {
      const offset = Number(row.slice(0, 10));
      expect(text.slice(offset)).toMatch(new RegExp(`^${index + 1} 0 obj\\n`));
    });
    for (const match of text.matchAll(/\/Length (\d+) >>\nstream\n/g)) {
      const streamStart = match.index + match[0].length;
      expect(
        text.slice(streamStart + Number(match[1])).replace(/^\n/, ""),
      ).toMatch(/^endstream/);
    }
  });
  it("rejects an empty PDF", () => {
    expect(() => buildJournalPDF([])).toThrow();
  });
  it("preserves expanded paper dimensions when its image is limited to 4096 pixels", () => {
    const pdf = buildJournalPDF([
      {
        width: 3072,
        height: 4096,
        paperWidth: 3000,
        paperHeight: 4000,
        jpeg: new Uint8Array([255, 216, 255, 217]),
      },
    ]);
    const text = new TextDecoder().decode(pdf);
    expect(text).toContain("/MediaBox [0 0 2250 3000]");
    expect(text).toContain("/Width 3072 /Height 4096");
    expect(text).toContain("2250 0 0 3000 0 0 cm");
  });
});

describe("journal expanded paper image export", () => {
  it("includes the full paper and content beyond the old bounds without exceeding the raster limit", async () => {
    const context = {
      scale: vi.fn(),
      fillRect: vi.fn(),
      save: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      measureText: vi.fn(() => ({ width: 40 })),
      fillText: vi.fn(),
      restore: vi.fn(),
    };
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(context as unknown as CanvasRenderingContext2D);
    try {
      const canvas = await renderJournalScene({
        schemaVersion: 1,
        width: 3000,
        height: 4000,
        paper: "plain",
        elements: [
          {
            id: "expanded-paper-text",
            type: "text",
            x: 2800,
            y: 3800,
            width: 160,
            height: 120,
            rotation: 0,
            locked: false,
            text: "页角记录",
          },
        ],
      });
      expect([canvas.width, canvas.height]).toEqual([3072, 4096]);
      expect(context.fillRect).toHaveBeenCalledWith(0, 0, 3000, 4000);
      expect(context.translate).toHaveBeenCalledWith(2880, 3860);
      expect(context.fillText).toHaveBeenCalledWith(
        "页角记录",
        0,
        expect.any(Number),
      );
    } finally {
      getContext.mockRestore();
    }
  });
});
