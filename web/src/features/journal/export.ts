import { apiFetch, APIRequestError } from "../../lib/api";
import { journalAPI } from "./api";
import { extractSceneText, JOURNAL_RENDER_STYLE as style } from "./scene";
import type { JournalElement, JournalEntry, JournalScene } from "./types";

function safeFilename(value: string) {
  return (
    Array.from(value, (character) =>
      character.charCodeAt(0) < 32 || /[\\/:*?"<>|]/.test(character)
        ? "-"
        : character,
    )
      .join("")
      .slice(0, 100) || "journal"
  );
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeFilename(filename);
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function checkResponse(response: Response) {
  if (response.ok) return;
  const payload = await response.json().catch(() => null);
  throw new APIRequestError(
    response.status,
    payload?.error
      ? payload
      : {
          error: {
            code: "export_failed",
            message: "导出失败，请检查登录状态后重试。",
          },
        },
  );
}

export function wrapJournalText(
  text: string,
  width: number,
  measure: (value: string) => number,
): string[] {
  const lines: string[] = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const { segment } of segmenter.segment(paragraph)) {
      if (line && measure(line + segment) > width) {
        const lastSpace = line.lastIndexOf(" ");
        const tail = lastSpace >= 0 ? line.slice(lastSpace + 1) + segment : "";
        if (lastSpace > 0 && tail && measure(tail) <= width) {
          lines.push(line.slice(0, lastSpace + 1));
          line = tail;
        } else {
          lines.push(line);
          line = segment;
        }
      } else line += segment;
    }
    lines.push(line);
  }
  return lines;
}

function drawText(context: CanvasRenderingContext2D, element: JournalElement) {
  const size = element.font_size ?? style.fontSize;
  const padding = element.type === "note" ? style.notePadding : 0;
  const width = Math.max(1, element.width - padding * 2);
  context.fillStyle =
    element.type === "note" ? style.ink : element.color || style.ink;
  context.font = `${element.italic ? "italic " : ""}${element.bold ? "700" : "400"} ${size}px ${style.fontFamily}`;
  context.textAlign = element.align ?? "left";
  context.textBaseline = "alphabetic";
  const lineHeight = size * style.lineHeight;
  const metrics = context.measureText("国Mg");
  const ascent = metrics.fontBoundingBoxAscent || size;
  const descent = metrics.fontBoundingBoxDescent || size * 0.2;
  let y = padding + (lineHeight - ascent - descent) / 2 + ascent;
  const x =
    padding +
    (element.align === "right"
      ? width
      : element.align === "center"
        ? width / 2
        : 0);
  for (const line of wrapJournalText(
    element.text ?? "",
    width,
    (value) => context.measureText(value).width,
  )) {
    context.fillText(line, x, y);
    y += lineHeight;
  }
}

async function privateImage(
  id: number,
): Promise<{ image: HTMLImageElement; dispose: () => void }> {
  const response = await fetch(journalAPI.assetURL(id), {
    credentials: "include",
    cache: "no-store",
  });
  await checkResponse(response);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/"))
    throw new Error("照片读取失败，导出已停止。");
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    return { image, dispose: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("照片无法解码，导出已停止。");
  }
}

export async function renderJournalScene(
  scene: JournalScene,
): Promise<HTMLCanvasElement> {
  await document.fonts?.ready;
  const canvas = document.createElement("canvas");
  const scale = Math.min(2, 4096 / Math.max(scene.width, scene.height));
  canvas.width = Math.round(scene.width * scale);
  canvas.height = Math.round(scene.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法生成手帐图片。");
  context.scale(scale, scale);
  context.fillStyle = style.paper;
  context.fillRect(0, 0, scene.width, scene.height);
  if (scene.paper === "ruled") {
    context.strokeStyle = style.ruledColor;
    context.lineWidth = 1;
    for (
      let y = style.ruledSpacing - 1;
      y < scene.height;
      y += style.ruledSpacing
    ) {
      context.beginPath();
      context.moveTo(0, y + 0.5);
      context.lineTo(scene.width, y + 0.5);
      context.stroke();
    }
  } else if (scene.paper === "dots") {
    context.fillStyle = style.dotsColor;
    for (let y = 12; y < scene.height; y += style.dotsSpacing)
      for (let x = 12; x < scene.width; x += style.dotsSpacing) {
        context.beginPath();
        context.arc(x, y, 1, 0, 2 * Math.PI);
        context.fill();
      }
  }
  for (const element of scene.elements) {
    context.save();
    context.translate(
      element.x + element.width / 2,
      element.y + element.height / 2,
    );
    context.rotate((element.rotation * Math.PI) / 180);
    context.translate(-element.width / 2, -element.height / 2);
    context.beginPath();
    context.rect(0, 0, element.width, element.height);
    context.clip();
    if (element.type === "photo") {
      context.fillStyle = style.photoPlaceholder;
      context.fillRect(0, 0, element.width, element.height);
      if (element.asset_id) {
        const loaded = await privateImage(element.asset_id);
        try {
          const ratio = Math.min(
            element.width / loaded.image.naturalWidth,
            element.height / loaded.image.naturalHeight,
          );
          const width = loaded.image.naturalWidth * ratio;
          const height = loaded.image.naturalHeight * ratio;
          context.drawImage(
            loaded.image,
            (element.width - width) / 2,
            (element.height - height) / 2,
            width,
            height,
          );
        } finally {
          loaded.dispose();
        }
      } else {
        context.fillStyle = style.photoPlaceholder;
        context.fillRect(0, 0, element.width, element.height);
        context.fillStyle = style.ink;
        context.font = `20px ${style.fontFamily}`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(
          element.text || "照片",
          element.width / 2,
          element.height / 2,
          element.width - 16,
        );
      }
    } else {
      if (element.type === "note") {
        context.fillStyle = element.color || style.note;
        context.fillRect(0, 0, element.width, element.height);
      }
      drawText(context, element);
    }
    context.restore();
  }
  return canvas;
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  type: "image/png" | "image/jpeg",
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("图片生成失败，请重试。")),
      type,
      0.95,
    ),
  );
}

type PDFPage = {
  width: number;
  height: number;
  jpeg: Uint8Array;
  paperWidth?: number;
  paperHeight?: number;
};

// PDF offsets and stream lengths count bytes, including the binary JPEG streams.
export function buildJournalPDF(pages: PDFPage[]): Uint8Array<ArrayBuffer> {
  if (!pages.length) throw new Error("请选择需要导出的记录。");
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets = [0];
  let length = 0;
  const append = (value: string | Uint8Array) => {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: string) => {
    offsets[id] = length;
    append(`${id} 0 obj\n${body}\nendobj\n`);
  };
  append("%PDF-1.4\n%journal\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(
    2,
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] >>`,
  );
  pages.forEach((page, index) => {
    const id = 3 + index * 3;
    const width =
      Math.round((page.paperWidth ?? page.width) * 0.75 * 100) / 100;
    const height =
      Math.round((page.paperHeight ?? page.height) * 0.75 * 100) / 100;
    object(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`,
    );
    offsets[id + 1] = length;
    append(
      `${id + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    );
    append(page.jpeg);
    append("\nendstream\nendobj\n");
    const stream = `q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`;
    object(
      id + 2,
      `<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}endstream`,
    );
  });
  const xref = length;
  append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (const offset of offsets.slice(1))
    append(`${String(offset).padStart(10, "0")} 00000 n \n`);
  append(
    `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );
  const output = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}

export async function exportJournalEntry(
  entry: JournalEntry,
  format: "png" | "pdf",
) {
  if (format === "pdf")
    return exportJournalEntries(
      [entry],
      `${entry.entry_date}-${entry.title || "手帐"}`,
    );
  await apiFetch("/api/admin/me");
  const canvas = await renderJournalScene(entry.scene);
  const blob = await canvasBlob(canvas, "image/png");
  await apiFetch("/api/admin/me");
  download(blob, `${entry.entry_date}-${entry.title || "手帐"}.png`);
  canvas.width = canvas.height = 0;
}

export async function exportJournalEntries(
  entries: JournalEntry[],
  filename = "手帐",
) {
  if (!entries.length) throw new Error("请选择需要导出的记录。");
  await apiFetch("/api/admin/me");
  const pages: PDFPage[] = [];
  for (const entry of entries) {
    const canvas = await renderJournalScene(entry.scene);
    const jpeg = new Uint8Array(
      await (await canvasBlob(canvas, "image/jpeg")).arrayBuffer(),
    );
    pages.push({
      width: canvas.width,
      height: canvas.height,
      paperWidth: entry.scene.width,
      paperHeight: entry.scene.height,
      jpeg,
    });
    canvas.width = canvas.height = 0;
  }
  await apiFetch("/api/admin/me");
  download(
    new Blob([buildJournalPDF(pages)], { type: "application/pdf" }),
    `${filename}.pdf`,
  );
}

export async function downloadJournalArchive(
  bookID: number,
  entryIDs?: number | number[],
) {
  const ids = typeof entryIDs === "number" ? [entryIDs] : entryIDs;
  const query = ids?.length ? `?entry_ids=${ids.join(",")}` : "";
  const response = await fetch(
    `/api/admin/journal/notebooks/${bookID}/export.zip${query}`,
    { credentials: "include", cache: "no-store" },
  );
  await checkResponse(response);
  const blob = await response.blob();
  if (!blob.type.includes("zip")) throw new Error("备份文件生成失败，请重试。");
  download(blob, `手帐-${bookID}.zip`);
}

export async function exportJournalText(entry: JournalEntry) {
  await apiFetch("/api/admin/me");
  const text = [
    entry.title,
    entry.entry_date,
    [entry.mood, entry.weather].filter(Boolean).join(" · "),
    entry.tags.map((tag) => `#${tag}`).join(" "),
    "",
    extractSceneText(entry.scene),
  ]
    .filter((value) => value !== undefined)
    .join("\n");
  download(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
    `${entry.entry_date}-${entry.title || "手帐"}.txt`,
  );
}
