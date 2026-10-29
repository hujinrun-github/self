import type { JournalElement, JournalScene } from "./types";

export const JOURNAL_MAX_PAPER_DIMENSION = 4000;

export const JOURNAL_RENDER_STYLE = {
  paper: "#fcfaf5",
  ink: "#51493e",
  note: "#e9efd9",
  photoPlaceholder: "#eef0e9",
  fontFamily:
    "'Avenir Next', 'PingFang SC', 'Hiragino Sans GB', 'Segoe UI', sans-serif",
  fontSize: 24,
  lineHeight: 1.65,
  notePadding: 24,
  ruledColor: "#e6ded0",
  ruledSpacing: 36,
  dotsColor: "#d9d2c4",
  dotsSpacing: 24,
} as const;

export function journalElementID(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `element-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function makeJournalElement(
  type: JournalElement["type"],
  overrides: Partial<JournalElement> = {},
): JournalElement {
  return {
    id: journalElementID(),
    type,
    x: 64,
    y: 72,
    width: type === "sticker" ? 100 : 280,
    height: type === "sticker" ? 100 : type === "text" ? 120 : 220,
    rotation: 0,
    locked: false,
    text:
      type === "sticker"
        ? "✦"
        : type === "text"
          ? "写下此刻的心情…"
          : type === "note"
            ? "今天值得记住的小事"
            : "",
    color: type === "note" ? "#e9efd9" : "#51493e",
    font_size: type === "sticker" ? 72 : 24,
    ...overrides,
  };
}

export function createJournalScene(
  template: "blank" | "daily" | "travel" = "blank",
  paper: JournalScene["paper"] = "plain",
): JournalScene {
  const scene: JournalScene = {
    schemaVersion: 1,
    width: 800,
    height: 1080,
    paper,
    elements: [],
  };
  if (template === "daily") {
    scene.elements = [
      makeJournalElement("text", {
        x: 64,
        y: 64,
        width: 660,
        height: 68,
        text: "今日小结",
        font_size: 40,
        bold: true,
      }),
      makeJournalElement("photo", {
        x: 68,
        y: 160,
        width: 420,
        height: 310,
        rotation: -3,
        text: "今天的照片",
      }),
      makeJournalElement("note", {
        x: 500,
        y: 200,
        width: 240,
        height: 235,
        rotation: 4,
        text: "今天最开心的事\n\n",
      }),
      makeJournalElement("note", {
        x: 68,
        y: 525,
        width: 310,
        height: 290,
        rotation: -2,
        text: "一件小小的收获\n\n",
        color: "#f5e2bd",
      }),
      makeJournalElement("note", {
        x: 416,
        y: 555,
        width: 310,
        height: 290,
        rotation: 3,
        text: "留给明天的自己\n☐ \n☐ ",
        color: "#e1eaf1",
      }),
      makeJournalElement("sticker", {
        x: 600,
        y: 890,
        text: "✿",
        color: "#a77d3b",
      }),
    ];
  } else if (template === "travel") {
    scene.elements = [
      makeJournalElement("text", {
        x: 64,
        y: 64,
        width: 650,
        height: 90,
        text: "出发，去看看世界",
        font_size: 38,
        bold: true,
      }),
      makeJournalElement("photo", {
        x: 64,
        y: 185,
        width: 320,
        height: 260,
        rotation: -4,
        text: "沿途风景",
      }),
      makeJournalElement("photo", {
        x: 420,
        y: 220,
        width: 310,
        height: 260,
        rotation: 4,
        text: "难忘瞬间",
      }),
      makeJournalElement("note", {
        x: 72,
        y: 555,
        width: 300,
        height: 330,
        text: "今天的路线\n\n起点 → 目的地",
        color: "#f5e2bd",
        rotation: -2,
      }),
      makeJournalElement("text", {
        x: 430,
        y: 575,
        width: 300,
        height: 335,
        text: "沿途见闻\n\n记下遇见的人、吃过的美食、意外的惊喜。",
        font_size: 25,
      }),
      makeJournalElement("sticker", {
        x: 610,
        y: 918,
        text: "♡",
        color: "#b26059",
      }),
    ];
  }
  return scene;
}

export function extractSceneText(scene: JournalScene): string {
  return scene.elements
    .filter((element) => element.type !== "sticker")
    .map((element) => element.text ?? "")
    .filter(Boolean)
    .join("\n");
}

export function sameJournalScene(
  left: JournalScene,
  right: JournalScene,
): boolean {
  return (
    left === right ||
    (left.schemaVersion === right.schemaVersion &&
      left.width === right.width &&
      left.height === right.height &&
      left.paper === right.paper &&
      left.elements.length === right.elements.length &&
      left.elements.every((element, index) => {
        const other = right.elements[index];
        const required = [
          "id",
          "type",
          "x",
          "y",
          "width",
          "height",
          "rotation",
          "locked",
        ] as const;
        const defaultColor =
          element.type === "note"
            ? JOURNAL_RENDER_STYLE.note
            : JOURNAL_RENDER_STYLE.ink;
        // Go omitempty removes zero/empty optional fields. Compare their rendered
        // meanings so a successful save cannot erase the local undo session.
        return (
          required.every((key) => element[key] === other[key]) &&
          (element.text || "") === (other.text || "") &&
          !!element.bold === !!other.bold &&
          !!element.italic === !!other.italic &&
          (element.asset_id || 0) === (other.asset_id || 0) &&
          (element.color || defaultColor) === (other.color || defaultColor) &&
          (element.font_size || JOURNAL_RENDER_STYLE.fontSize) ===
            (other.font_size || JOURNAL_RENDER_STYLE.fontSize) &&
          (element.align || "left") === (other.align || "left")
        );
      }))
  );
}

export function expandJournalScene(
  scene: JournalScene,
  factor = 1.5,
): JournalScene {
  const longestEdge = Math.max(scene.width, scene.height);
  if (
    !Number.isFinite(factor) ||
    factor <= 1 ||
    !Number.isFinite(scene.width) ||
    !Number.isFinite(scene.height) ||
    scene.width <= 0 ||
    scene.height <= 0 ||
    longestEdge >= JOURNAL_MAX_PAPER_DIMENSION
  )
    return scene;
  const scale = Math.min(factor, JOURNAL_MAX_PAPER_DIMENSION / longestEdge);
  // Extend the paper from its top-left corner; existing content keeps its exact
  // position, dimensions and element references for editing and undo history.
  const width = Math.min(
    JOURNAL_MAX_PAPER_DIMENSION,
    Math.ceil(scene.width * scale),
  );
  const height = Math.min(
    JOURNAL_MAX_PAPER_DIMENSION,
    Math.ceil(scene.height * scale),
  );
  if (width === scene.width && height === scene.height) return scene;
  return { ...scene, width, height };
}

export function orientJournalScene(
  scene: JournalScene,
  orientation: "portrait" | "landscape",
): JournalScene {
  if (
    (orientation === "landscape" && scene.width >= scene.height) ||
    (orientation === "portrait" && scene.height >= scene.width)
  )
    return scene;
  const width = scene.height;
  const height = scene.width;
  // Include rotated bounds, so changing orientation also keeps edge decorations visible.
  let left = 0,
    top = 0,
    right = scene.width,
    bottom = scene.height;
  for (const element of scene.elements) {
    const angle = (element.rotation * Math.PI) / 180;
    const halfWidth =
      (Math.abs(element.width * Math.cos(angle)) +
        Math.abs(element.height * Math.sin(angle))) /
      2;
    const halfHeight =
      (Math.abs(element.width * Math.sin(angle)) +
        Math.abs(element.height * Math.cos(angle))) /
      2;
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    left = Math.min(left, cx - halfWidth);
    right = Math.max(right, cx + halfWidth);
    top = Math.min(top, cy - halfHeight);
    bottom = Math.max(bottom, cy + halfHeight);
  }
  const scale = Math.min(width / (right - left), height / (bottom - top));
  const offsetX = (width - (right - left) * scale) / 2 - left * scale;
  const offsetY = (height - (bottom - top) * scale) / 2 - top * scale;
  return {
    ...scene,
    width,
    height,
    elements: scene.elements.map((element) => ({
      ...element,
      x: element.x * scale + offsetX,
      y: element.y * scale + offsetY,
      width: Math.max(1, element.width * scale),
      height: Math.max(1, element.height * scale),
      ...(element.type !== "photo"
        ? { font_size: Math.max(8, (element.font_size || 24) * scale) }
        : {}),
    })),
  };
}

export function moveJournalElement(
  element: JournalElement,
  dx: number,
  dy: number,
  scene: Pick<JournalScene, "width" | "height">,
  snap = false,
): JournalElement {
  if (element.locked) return element;
  const step = snap ? 10 : 1;
  let x = Math.round((element.x + dx) / step) * step;
  let y = Math.round((element.y + dy) / step) * step;
  if (snap && Math.abs(x + element.width / 2 - scene.width / 2) < 12)
    x = (scene.width - element.width) / 2;
  if (snap && Math.abs(y + element.height / 2 - scene.height / 2) < 12)
    y = (scene.height - element.height) / 2;
  return {
    ...element,
    x: Math.max(0, Math.min(scene.width - element.width, x)),
    y: Math.max(0, Math.min(scene.height - element.height, y)),
  };
}

export function resizeJournalElement(
  element: JournalElement,
  width: number,
  height: number,
  scene: Pick<JournalScene, "width" | "height">,
): JournalElement {
  if (element.locked) return element;
  const maxWidth = Math.max(24, scene.width - element.x);
  const maxHeight = Math.max(24, scene.height - element.y);
  if (element.type === "photo") {
    const ratio = element.width / element.height;
    const size = Math.max(24, Math.min(width, maxWidth, maxHeight * ratio));
    return {
      ...element,
      width: Math.round(size),
      height: Math.round(size / ratio),
    };
  }
  return {
    ...element,
    width: Math.round(Math.max(24, Math.min(maxWidth, width))),
    height: Math.round(Math.max(24, Math.min(maxHeight, height))),
  };
}

export function reorderJournalElement(
  scene: JournalScene,
  id: string,
  action: "forward" | "backward" | "front" | "back",
): JournalScene {
  const index = scene.elements.findIndex((element) => element.id === id);
  if (index < 0 || scene.elements[index].locked) return scene;
  const target =
    action === "front"
      ? scene.elements.length - 1
      : action === "back"
        ? 0
        : action === "forward"
          ? Math.min(scene.elements.length - 1, index + 1)
          : Math.max(0, index - 1);
  if (target === index) return scene;
  const elements = [...scene.elements];
  const [element] = elements.splice(index, 1);
  elements.splice(target, 0, element);
  return { ...scene, elements };
}
