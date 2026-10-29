import { describe, expect, it } from "vitest";
import {
  createJournalScene,
  expandJournalScene,
  extractSceneText,
  makeJournalElement,
  moveJournalElement,
  orientJournalScene,
  reorderJournalElement,
  resizeJournalElement,
  sameJournalScene,
} from "./scene";

describe("journal scene transformations", () => {
  it("creates independent editable templates without URLs or uploaded image assumptions", () => {
    const first = createJournalScene("daily", "dots");
    const second = createJournalScene("daily");
    expect(first.paper).toBe("dots");
    expect(first.elements.some((element) => element.type === "photo")).toBe(
      true,
    );
    expect(first.elements.every((element) => !element.locked)).toBe(true);
    expect(
      first.elements
        .map((element) => element.id)
        .some((id) => second.elements.some((element) => element.id === id)),
    ).toBe(false);
    expect(
      first.elements
        .filter((element) => element.type === "photo")
        .every((element) => element.asset_id === undefined),
    ).toBe(true);
    expect(createJournalScene("blank").elements).toEqual([]);
  });

  it("keeps elements inside the page and snaps centers without mutating the input", () => {
    const page = createJournalScene();
    const element = makeJournalElement("note", {
      x: 40,
      y: 60,
      width: 280,
      height: 200,
    });
    expect(moveJournalElement(element, -100, 5000, page)).toMatchObject({
      x: 0,
      y: 880,
    });
    expect(moveJournalElement(element, 215, 0, page, true).x).toBe(260);
    expect(element).toMatchObject({ x: 40, y: 60 });
    expect(
      moveJournalElement({ ...element, locked: true }, 200, 100, page).x,
    ).toBe(40);
  });

  it("preserves photo aspect ratio at page boundaries while allowing text wrapping widths", () => {
    const page = createJournalScene();
    const photo = makeJournalElement("photo", {
      x: 100,
      y: 980,
      width: 200,
      height: 100,
    });
    const resized = resizeJournalElement(photo, 500, 300, page);
    expect(resized.width / resized.height).toBe(2);
    expect(resized.y + resized.height).toBeLessThanOrEqual(page.height);
    expect(
      resizeJournalElement(makeJournalElement("text"), 150, 250, page),
    ).toMatchObject({ width: 150, height: 250 });
  });

  it("reorders layers with stable IDs and preserves locked layers", () => {
    const page = createJournalScene("daily");
    const id = page.elements[0].id;
    const front = reorderJournalElement(page, id, "front");
    expect(front.elements.at(-1)?.id).toBe(id);
    expect(page.elements[0].id).toBe(id);
    expect(reorderJournalElement(front, id, "back").elements[0].id).toBe(id);
    const locked = {
      ...page,
      elements: page.elements.map((element) => ({ ...element, locked: true })),
    };
    expect(reorderJournalElement(locked, id, "front")).toBe(locked);
  });

  it("extracts note, text and photo captions without including decorative symbols", () => {
    const page = createJournalScene();
    page.elements = [
      makeJournalElement("text", { text: "今天" }),
      makeJournalElement("note", { text: "散步" }),
      makeJournalElement("photo", { text: "晚霞" }),
      makeJournalElement("sticker", { text: "✿" }),
    ];
    expect(extractSceneText(page)).toBe("今天\n散步\n晚霞");
  });

  it("fits the whole composition into landscape paper, preserving photo ratio, paper and rotated bounds", () => {
    const page = createJournalScene("blank", "dots");
    page.elements = [
      makeJournalElement("photo", {
        x: 0,
        y: 20,
        width: 400,
        height: 200,
        rotation: -30,
        asset_id: 8,
        locked: true,
      }),
      makeJournalElement("text", {
        x: 500,
        y: 930,
        width: 280,
        height: 140,
        font_size: 10,
        text: "旅途",
      }),
    ];
    const changed = orientJournalScene(page, "landscape");
    expect(changed).toMatchObject({ width: 1080, height: 800, paper: "dots" });
    expect(changed.elements[0].width / changed.elements[0].height).toBe(2);
    expect(changed.elements[0]).toMatchObject({
      id: page.elements[0].id,
      asset_id: 8,
      locked: true,
      rotation: -30,
    });
    expect(changed.elements[1].font_size).toBeGreaterThanOrEqual(8);
    for (const element of changed.elements) {
      const angle = (element.rotation * Math.PI) / 180;
      const halfWidth =
        (Math.abs(element.width * Math.cos(angle)) +
          Math.abs(element.height * Math.sin(angle))) /
        2;
      const halfHeight =
        (Math.abs(element.width * Math.sin(angle)) +
          Math.abs(element.height * Math.cos(angle))) /
        2;
      const cx = element.x + element.width / 2,
        cy = element.y + element.height / 2;
      expect(cx - halfWidth).toBeGreaterThanOrEqual(-0.001);
      expect(cy - halfHeight).toBeGreaterThanOrEqual(-0.001);
      expect(cx + halfWidth).toBeLessThanOrEqual(changed.width + 0.001);
      expect(cy + halfHeight).toBeLessThanOrEqual(changed.height + 0.001);
    }
    expect(page).toMatchObject({ width: 800, height: 1080 });
    expect(orientJournalScene(changed, "landscape")).toBe(changed);
  });

  it("extends paper without changing existing content, locked elements or their references", () => {
    const page = createJournalScene("travel", "dots");
    page.elements[1] = {
      ...page.elements[1],
      asset_id: 8,
      locked: true,
    };
    const original = structuredClone(page);
    const expanded = expandJournalScene(page);
    expect(expanded).toMatchObject({
      width: 1200,
      height: 1620,
      schemaVersion: 1,
      paper: "dots",
    });
    expect(expanded.elements).toBe(page.elements);
    for (let index = 0; index < page.elements.length; index++)
      expect(expanded.elements[index]).toBe(page.elements[index]);
    expect(expanded.elements).toEqual(original.elements);
    expect(page).toEqual(original);
  });

  it("preserves landscape direction and extends empty pages without adding content", () => {
    const page = {
      ...createJournalScene(),
      width: 1080,
      height: 800,
    };
    const expanded = expandJournalScene(page);
    expect(expanded).toMatchObject({ width: 1620, height: 1200 });
    expect(expanded.elements).toBe(page.elements);
    expect(expanded.elements).toEqual([]);
  });

  it("caps proportional expansion at 4000 and makes a full-sized page a no-op", () => {
    const page = {
      ...createJournalScene("daily"),
      width: 2400,
      height: 3240,
    };
    const expanded = expandJournalScene(page);
    expect(expanded.height).toBe(4000);
    expect(expanded.width).toBe(2963);
    expect(Math.abs(expanded.width / expanded.height - 2400 / 3240)).toBeLessThan(
      1 / expanded.height,
    );
    expect(expanded.elements).toBe(page.elements);
    expect(expandJournalScene(expanded)).toBe(expanded);
    expect(expandJournalScene(page, Number.MAX_VALUE)).toMatchObject({
      width: 2963,
      height: 4000,
    });
    const landscape = { ...page, width: 4000, height: 2963 };
    expect(expandJournalScene(landscape)).toBe(landscape);
  });

  it("keeps square pages square and never rounds a growing edge down", () => {
    const page = { ...createJournalScene(), width: 801, height: 801 };
    expect(expandJournalScene(page)).toMatchObject({ width: 1202, height: 1202 });
    const nearlyFull = { ...page, width: 3000.4, height: 3999.8 };
    const expanded = expandJournalScene(nearlyFull);
    expect(expanded.width).toBeGreaterThanOrEqual(nearlyFull.width);
    expect(expanded.height).toBe(4000);
  });

  it.each([0, -2, 0.5, 1, Number.NaN, Number.POSITIVE_INFINITY])(
    "does not modify paper for invalid or non-growing multiplier %s",
    (factor) => {
      const page = createJournalScene("daily");
      expect(expandJournalScene(page, factor)).toBe(page);
    },
  );

  it("treats omitted optional fields as their rendered defaults without ignoring real formatting changes", () => {
    const scene = createJournalScene();
    const required = {
      id: "one",
      type: "text" as const,
      x: 20,
      y: 20,
      width: 200,
      height: 120,
      rotation: 0,
      locked: false,
    };
    scene.elements = [
      {
        ...required,
        text: "",
        bold: false,
        italic: false,
        asset_id: 0,
        color: "",
        font_size: 0,
      },
    ];
    const omitted = { ...scene, elements: [required] };
    expect(sameJournalScene(scene, omitted)).toBe(true);
    expect(
      sameJournalScene(scene, {
        ...scene,
        elements: [
          { ...required, color: "#51493e", font_size: 24, align: "left" },
        ],
      }),
    ).toBe(true);
    expect(
      sameJournalScene(scene, {
        ...scene,
        elements: [{ ...required, bold: true }],
      }),
    ).toBe(false);
    expect(
      sameJournalScene(scene, {
        ...scene,
        elements: [{ ...required, text: "新增内容" }],
      }),
    ).toBe(false);
    expect(
      sameJournalScene(scene, {
        ...scene,
        elements: [{ ...required, font_size: 28 }],
      }),
    ).toBe(false);
  });
});
