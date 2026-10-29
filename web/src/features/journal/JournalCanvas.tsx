import { useEffect, useId, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import {
  Copy,
  Expand,
  Hand,
  ImagePlus,
  Layers,
  Lock,
  Maximize,
  Minimize,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  RotateCcw,
  SlidersHorizontal,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Unlock,
} from "lucide-react";
import type { JournalAsset, JournalElement, JournalScene } from "./types";
import type { Locale } from "../public/locale";
import {
  expandJournalScene,
  journalElementID,
  makeJournalElement,
  moveJournalElement,
  orientJournalScene,
  reorderJournalElement,
  resizeJournalElement,
  sameJournalScene,
} from "./scene";
import styles from "./JournalCanvas.module.css";

type Props = {
  scene: JournalScene;
  onChange?: (scene: JournalScene) => void;
  readOnly?: boolean;
  thumbnail?: boolean;
  bookPage?: boolean;
  immersive?: boolean;
  assetURL: (id: number) => string;
  onUpload?: (file: File) => Promise<JournalAsset>;
  onUploadStateChange?: (busy: boolean) => void;
  disabled?: boolean;
  locale?: Locale;
  toolbarActions?: ReactNode;
};

type Point = { x: number; y: number };
type View = { zoom: number; x: number; y: number };
type Gesture =
  | {
      kind: "move" | "resize" | "rotate";
      start: Point;
      element: JournalElement;
      scene: JournalScene;
      zoom: number;
      center: Point;
    }
  | { kind: "pan"; start: Point; view: View }
  | { kind: "pinch"; distance: number; middle: Point; view: View };
const labels = { text: "文字", note: "便签", photo: "照片", sticker: "贴纸" };
const maxImageBytes = 5 * 1024 * 1024;
const clampZoom = (value: number, minimum = 0.02) =>
  Math.min(3, Math.max(minimum, value));
const pointDistance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const pointMiddle = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
const readerMessages = {
  zh: {
    reader: "手帐画布阅读器",
    view: "查看画布",
    smaller: "缩小画布",
    larger: "放大画布",
    zoom: "画布缩放比例",
    fit: "整页",
    hint: "拖动查看 · 双指缩放 · 保持原有排版",
    photo: "手帐照片",
    failed: "照片暂时无法加载",
  },
  en: {
    reader: "Journal canvas reader",
    view: "View canvas",
    smaller: "Zoom out",
    larger: "Zoom in",
    zoom: "Canvas zoom",
    fit: "Fit page",
    hint: "Drag to pan · Pinch to zoom · Original layout preserved",
    photo: "Journal photo",
    failed: "Photo is temporarily unavailable",
  },
  ja: {
    reader: "手帳キャンバス閲覧",
    view: "キャンバス表示",
    smaller: "縮小",
    larger: "拡大",
    zoom: "表示倍率",
    fit: "全体表示",
    hint: "ドラッグで移動 · ピンチで拡大・縮小 · レイアウトを維持",
    photo: "手帳の写真",
    failed: "写真を読み込めませんでした",
  },
};

function NumberProperty({
  label,
  value,
  min,
  max,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  return (
    <label className={styles.property}>
      {label}
      <input
        key={value}
        type="number"
        defaultValue={value}
        min={min}
        max={max}
        disabled={disabled}
        onBlur={(event) => {
          const next = Number(event.currentTarget.value);
          if (event.currentTarget.value.trim() && Number.isFinite(next))
            onCommit(Math.max(min ?? -100000, Math.min(max ?? 100000, next)));
          else event.currentTarget.value = String(value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}

function ProtectedPhoto({
  src,
  description,
  failedLabel,
}: {
  src: string;
  description: string;
  failedLabel: string;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  if (failedSource === src)
    return (
      <div
        className={styles.photoPlaceholder}
        role="img"
        aria-label={`${description} · ${failedLabel}`}
      >
        <ImagePlus size={38} />
        <span>{failedLabel}</span>
      </div>
    );
  return (
    <img
      src={src}
      alt={description}
      draggable={false}
      onError={() => setFailedSource(src)}
    />
  );
}

export function JournalCanvas(props: Props) {
  const [expectedScene, setExpectedScene] = useState(props.scene);
  const [session, setSession] = useState(0);
  if (expectedScene !== props.scene) {
    setExpectedScene(props.scene);
    // Ordinary controlled updates and server echoes preserve undo. A replacement
    // document (for example conflict reload) starts a fresh edit/upload session.
    if (!sameJournalScene(expectedScene, props.scene)) setSession(session + 1);
  }
  return (
    <JournalCanvasSession
      key={session}
      {...props}
      onChange={
        props.onChange
          ? (next) => {
              setExpectedScene(next);
              props.onChange?.(next);
            }
          : undefined
      }
    />
  );
}

function JournalCanvasSession({
  scene,
  onChange,
  readOnly: requestedReadOnly = false,
  thumbnail = false,
  bookPage = false,
  immersive = false,
  assetURL,
  onUpload,
  onUploadStateChange,
  disabled = false,
  locale = "zh",
  toolbarActions,
}: Props) {
  const readOnly = requestedReadOnly || thumbnail;
  const minimumZoom = 0.02;
  const reader = readerMessages[readOnly ? locale : "zh"];
  const editable = !readOnly && !disabled && !!onChange;
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const [preview, setPreview] = useState<JournalScene | null>(null);
  const [view, setView] = useState<View>({ zoom: 0.5, x: 0, y: 0 });
  const [mode, setMode] = useState<"select" | "pan">("select");
  const [snap, setSnap] = useState(true);
  const [past, setPast] = useState<JournalScene[]>([]);
  const [future, setFuture] = useState<JournalScene[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const inspectorID = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const fullscreenButton = useRef<HTMLButtonElement>(null);
  const inspectorButton = useRef<HTMLButtonElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const sceneRef = useRef(scene);
  const optionsRef = useRef({ editable, onChange, onUploadStateChange });
  const previewRef = useRef<JournalScene | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const textEditID = useRef<string | null>(null);
  const points = useRef(new Map<number, Point>());
  const alive = useRef(true);
  const uploadingRef = useRef(false);
  const displayed = readOnly || disabled ? scene : (preview ?? scene);
  const selected = displayed.elements.find(
    (element) => element.id === selectedID,
  );
  const expandedPaper = expandJournalScene(scene);

  useEffect(() => {
    sceneRef.current = scene;
    optionsRef.current = { editable, onChange, onUploadStateChange };
  }, [scene, editable, onChange, onUploadStateChange]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (uploadingRef.current) optionsRef.current.onUploadStateChange?.(false);
    };
  }, []);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const fit = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0)
        setView({
          zoom: clampZoom(
            Math.min((width - 48) / scene.width, (height - 48) / scene.height),
            minimumZoom,
          ),
          x: 0,
          y: 0,
        });
    };
    fit();
    window.addEventListener("resize", fit);
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(fit);
    observer?.observe(element);
    return () => {
      window.removeEventListener("resize", fit);
      observer?.disconnect();
    };
  }, [scene.width, scene.height, fullscreen, minimumZoom]);

  useEffect(() => {
    if (!fullscreen) return;
    const editor = root.current;
    if (!editor) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    const background: { element: HTMLElement; inert: boolean }[] = [];
    // Keep the same mounted canvas (and undo/upload session) in both layouts.
    // Inert siblings at each level make the page behind the overlay inaccessible.
    let ancestor: HTMLElement = editor;
    while (ancestor.parentElement && ancestor !== document.body) {
      for (const sibling of ancestor.parentElement.children) {
        if (
          sibling !== ancestor &&
          sibling instanceof HTMLElement &&
          !sibling.hasAttribute("data-journal-overlay")
        ) {
          background.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      ancestor = ancestor.parentElement;
    }
    document.body.style.overflow = "hidden";
    fullscreenButton.current?.focus();
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        setFullscreen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const surfaces = [
        editor,
        ...document.querySelectorAll<HTMLElement>("[data-journal-overlay]"),
      ];
      const controls = surfaces
        .flatMap((surface) => [
          ...surface.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
          ),
        ])
        .filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      for (const item of background) item.element.inert = item.inert;
      document.removeEventListener("keydown", handleKeyDown, true);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [fullscreen]);

  function commit(next: JournalScene) {
    if (
      !optionsRef.current.editable ||
      sameJournalScene(next, sceneRef.current)
    )
      return;
    const previous = sceneRef.current;
    setPast((history) => [...history.slice(-79), previous]);
    setFuture([]);
    sceneRef.current = next;
    optionsRef.current.onChange?.(next);
  }

  function patch(id: string, values: Partial<JournalElement>) {
    const current = sceneRef.current;
    const element = current.elements.find((item) => item.id === id);
    if (!element || (element.locked && values.locked !== false)) return;
    commit({
      ...current,
      elements: current.elements.map((item) =>
        item.id === id ? { ...item, ...values } : item,
      ),
    });
  }

  function editText(id: string, text: string) {
    if (!editable) return;
    const current = sceneRef.current;
    const element = current.elements.find((item) => item.id === id);
    if (!element || element.locked || element.text === text) return;
    const next = {
      ...current,
      elements: current.elements.map((item) =>
        item.id === id ? { ...item, text } : item,
      ),
    };
    // Each input reaches the page's draft immediately; one focused typing session is one undo step.
    if (textEditID.current !== id) {
      commit(next);
      textEditID.current = id;
    } else {
      sceneRef.current = next;
      onChange?.(next);
    }
  }

  function undo() {
    if (!editable || !past.length) return;
    const previous = past[past.length - 1];
    const current = sceneRef.current;
    setPast(past.slice(0, -1));
    setFuture((history) => [current, ...history]);
    sceneRef.current = previous;
    onChange?.(previous);
  }

  function redo() {
    if (!editable || !future.length) return;
    const current = sceneRef.current;
    setPast((history) => [...history, current]);
    setFuture(future.slice(1));
    sceneRef.current = future[0];
    onChange?.(future[0]);
  }

  function add(type: JournalElement["type"]) {
    const current = sceneRef.current;
    const offset = (current.elements.length % 8) * 18;
    const element = makeJournalElement(type, {
      x: 64 + offset,
      y: 72 + offset,
    });
    commit({ ...current, elements: [...current.elements, element] });
    setSelectedID(element.id);
    setMode("select");
  }

  function remove() {
    if (!selected || selected.locked) return;
    commit({
      ...sceneRef.current,
      elements: sceneRef.current.elements.filter(
        (item) => item.id !== selected.id,
      ),
    });
    setSelectedID(null);
  }

  function duplicate() {
    if (!selected || selected.locked) return;
    const copy = moveJournalElement(
      { ...selected, id: journalElementID() },
      24,
      24,
      scene,
      false,
    );
    commit({
      ...sceneRef.current,
      elements: [...sceneRef.current.elements, copy],
    });
    setSelectedID(copy.id);
  }

  function fitPage() {
    const size = viewport.current?.getBoundingClientRect();
    if (size && size.width > 0 && size.height > 0)
      setView({
        zoom: clampZoom(
          Math.min(
            (size.width - 48) / scene.width,
            (size.height - 48) / scene.height,
          ),
          minimumZoom,
        ),
        x: 0,
        y: 0,
      });
    else setView({ zoom: 0.5, x: 0, y: 0 });
  }

  function localPoint(event: { clientX: number; clientY: number }): Point {
    const rect = viewport.current?.getBoundingClientRect();
    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
  }

  function startGesture(
    event: ReactPointerEvent,
    element?: JournalElement,
    kind: "move" | "resize" | "rotate" = "move",
  ) {
    if (thumbnail || event.button !== 0) return;
    event.stopPropagation();
    // Keep text editing in ordinary DOM controls so IME and mobile keyboards work naturally.
    (document.activeElement as HTMLElement | null)?.blur?.();
    const point = localPoint(event);
    points.current.set(event.pointerId, point);
    viewport.current?.setPointerCapture?.(event.pointerId);
    if (points.current.size >= 2) {
      const [a, b] = [...points.current.values()];
      gesture.current = {
        kind: "pinch",
        distance: Math.max(1, pointDistance(a, b)),
        middle: pointMiddle(a, b),
        view,
      };
      previewRef.current = null;
      setPreview(null);
      return;
    }
    if (!editable || mode === "pan") {
      gesture.current = { kind: "pan", start: point, view };
      return;
    }
    if (!element) {
      setSelectedID(null);
      gesture.current = null;
      return;
    }
    setSelectedID(element.id);
    if (element.locked) return;
    const bounds = viewport.current?.getBoundingClientRect();
    const left = ((bounds?.width ?? 0) - scene.width * view.zoom) / 2 + view.x;
    const top = ((bounds?.height ?? 0) - scene.height * view.zoom) / 2 + view.y;
    gesture.current = {
      kind,
      start: point,
      element,
      scene: sceneRef.current,
      zoom: view.zoom,
      center: {
        x: left + (element.x + element.width / 2) * view.zoom,
        y: top + (element.y + element.height / 2) * view.zoom,
      },
    };
  }

  function moveGesture(event: ReactPointerEvent) {
    if (!points.current.has(event.pointerId)) return;
    const point = localPoint(event);
    points.current.set(event.pointerId, point);
    const active = gesture.current;
    if (!active) return;
    if (active.kind === "pinch") {
      if (points.current.size < 2) return;
      const [a, b] = [...points.current.values()];
      const middle = pointMiddle(a, b);
      const zoom = clampZoom(
        (active.view.zoom * pointDistance(a, b)) / active.distance,
        minimumZoom,
      );
      const rect = viewport.current?.getBoundingClientRect();
      const cx = (rect?.width ?? 0) / 2;
      const cy = (rect?.height ?? 0) / 2;
      setView({
        zoom,
        x:
          middle.x -
          cx -
          ((active.middle.x - cx - active.view.x) * zoom) / active.view.zoom,
        y:
          middle.y -
          cy -
          ((active.middle.y - cy - active.view.y) * zoom) / active.view.zoom,
      });
      return;
    }
    if (active.kind === "pan") {
      setView({
        ...active.view,
        x: active.view.x + point.x - active.start.x,
        y: active.view.y + point.y - active.start.y,
      });
      return;
    }
    if (!editable) return;
    const dx = (point.x - active.start.x) / active.zoom;
    const dy = (point.y - active.start.y) / active.zoom;
    let element: JournalElement;
    if (active.kind === "move")
      element = moveJournalElement(active.element, dx, dy, active.scene, snap);
    else if (active.kind === "resize") {
      const radians = (active.element.rotation * Math.PI) / 180;
      const localDX = dx * Math.cos(radians) + dy * Math.sin(radians);
      const localDY = -dx * Math.sin(radians) + dy * Math.cos(radians);
      element = resizeJournalElement(
        active.element,
        active.element.width + localDX,
        active.element.height + localDY,
        active.scene,
      );
    } else {
      const delta =
        Math.atan2(point.y - active.center.y, point.x - active.center.x) -
        Math.atan2(
          active.start.y - active.center.y,
          active.start.x - active.center.x,
        );
      const rotation = active.element.rotation + (delta * 180) / Math.PI;
      element = {
        ...active.element,
        rotation: Math.round(rotation / (snap ? 5 : 1)) * (snap ? 5 : 1),
      };
    }
    const next = {
      ...active.scene,
      elements: active.scene.elements.map((item) =>
        item.id === element.id ? element : item,
      ),
    };
    previewRef.current = next;
    setPreview(next);
  }

  function endGesture(event: ReactPointerEvent, cancel = false) {
    points.current.delete(event.pointerId);
    const active = gesture.current;
    if (
      !cancel &&
      previewRef.current &&
      active &&
      active.kind !== "pan" &&
      active.kind !== "pinch"
    ) {
      const current = sceneRef.current;
      const previous = current.elements.find(
        (element) => element.id === active.element.id,
      );
      const transformed = previewRef.current.elements.find(
        (element) => element.id === active.element.id,
      );
      if (previous && transformed && !previous.locked) {
        // Upload completion can add or replace a photo during a drag. Apply only
        // this gesture's geometry to the latest scene, never its stale snapshot.
        const changed =
          active.kind === "move"
            ? moveJournalElement(
                previous,
                transformed.x - previous.x,
                transformed.y - previous.y,
                current,
              )
            : active.kind === "resize"
              ? resizeJournalElement(
                  previous,
                  transformed.width,
                  transformed.height,
                  current,
                )
              : { ...previous, rotation: transformed.rotation };
        commit({
          ...current,
          elements: current.elements.map((element) =>
            element.id === previous.id ? changed : element,
          ),
        });
      }
    }
    previewRef.current = null;
    gesture.current = null;
    setPreview(null);
    if (viewport.current?.hasPointerCapture?.(event.pointerId))
      viewport.current.releasePointerCapture(event.pointerId);
  }

  function keyboard(event: KeyboardEvent) {
    if (
      !editable ||
      (event.target as HTMLElement).closest(
        'input,textarea,select,[contenteditable="true"]',
      )
    )
      return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
      event.preventDefault();
      duplicate();
      return;
    }
    if (event.key === "Escape") {
      setSelectedID(null);
      return;
    }
    if (!selected || selected.locked) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      remove();
      return;
    }
    const step = event.shiftKey ? 10 : 1;
    const moves: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    if (moves[event.key]) {
      event.preventDefault();
      patch(
        selected.id,
        moveJournalElement(
          selected,
          moves[event.key].x,
          moves[event.key].y,
          scene,
          false,
        ),
      );
    }
  }

  async function upload(file?: File) {
    if (!file || !onUpload || !editable || uploading) return;
    if (file.size > maxImageBytes) {
      setUploadError("照片不能超过 5 MB，请压缩后重试。");
      if (uploadInput.current) uploadInput.current.value = "";
      return;
    }
    const replacing =
      selected?.type === "photo" && !selected.locked ? selected.id : null;
    setUploadError("");
    setUploading(true);
    uploadingRef.current = true;
    onUploadStateChange?.(true);
    try {
      const asset = await onUpload(file);
      if (!alive.current || !optionsRef.current.editable) return;
      if (
        !(asset.id > 0) ||
        !(asset.width > 0) ||
        !(asset.height > 0) ||
        !asset.mime_type.startsWith("image/")
      )
        throw new Error("服务器未返回有效图片，请重试。");
      const current = sceneRef.current;
      const old = replacing
        ? current.elements.find((item) => item.id === replacing)
        : undefined;
      if (replacing && !old)
        throw new Error("原照片已移除，已取消替换；需要添加时请重新选择图片。");
      const width = Math.min(
        old?.width ?? 360,
        current.width - (old?.x ?? 64),
        ((current.height - (old?.y ?? 72)) * asset.width) / asset.height,
      );
      const element = makeJournalElement("photo", {
        ...(old ?? {}),
        asset_id: asset.id,
        text: old?.text || file.name,
        width: Math.round(width),
        height: Math.round((width * asset.height) / asset.width),
      });
      if (old?.locked) throw new Error("照片已锁定，请解锁后重新上传。");
      commit({
        ...current,
        elements: old
          ? current.elements.map((item) =>
              item.id === old.id ? element : item,
            )
          : [...current.elements, element],
      });
      setSelectedID(element.id);
    } catch (error) {
      if (alive.current)
        setUploadError(
          error instanceof Error
            ? `照片上传失败：${error.message}`
            : "照片上传失败，请重新选择图片重试。",
        );
    } finally {
      if (alive.current) {
        setUploading(false);
        uploadingRef.current = false;
        optionsRef.current.onUploadStateChange?.(false);
      }
      if (uploadInput.current) uploadInput.current.value = "";
    }
  }

  function updateSize(dimension: "width" | "height", value: number) {
    if (!selected) return;
    const width =
      dimension === "width"
        ? value
        : selected.type === "photo"
          ? (value * selected.width) / selected.height
          : selected.width;
    patch(
      selected.id,
      resizeJournalElement(
        selected,
        width,
        dimension === "height" ? value : selected.height,
        scene,
      ),
    );
  }

  return (
    <div
      ref={root}
      className={`${styles.editor} ${thumbnail ? styles.thumbnail : ""} ${bookPage ? styles.bookPage : ""} ${immersive && readOnly ? styles.immersive : ""} ${fullscreen ? styles.fullscreen : ""} ${inspectorOpen ? styles.inspectorOpen : ""}`}
      onKeyDown={keyboard}
      role={fullscreen ? "dialog" : undefined}
      aria-modal={fullscreen ? true : undefined}
      aria-label={readOnly ? reader.reader : "手帐画布编辑器"}
    >
      {!readOnly && (
        <div className={styles.toolbar} role="toolbar" aria-label="画布工具">
          <button
            type="button"
            onClick={() => add("text")}
            disabled={!editable}
          >
            <Type size={17} />
            文字
          </button>
          <button
            type="button"
            onClick={() => add("note")}
            disabled={!editable}
          >
            <StickyNote size={17} />
            便签
          </button>
          <button
            type="button"
            onClick={() => uploadInput.current?.click()}
            disabled={!editable || !onUpload || uploading}
          >
            <ImagePlus size={17} />
            {uploading ? "上传中…" : "照片"}
          </button>
          <button
            type="button"
            onClick={() => add("sticker")}
            disabled={!editable}
          >
            <span aria-hidden="true">✦</span>贴纸
          </button>
          <span className={styles.toolbarDivider} />
          <button
            type="button"
            onClick={undo}
            disabled={!editable || !past.length}
            title="撤销（⌘ / Ctrl Z）"
            aria-label="撤销"
          >
            <Undo2 size={18} />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!editable || !future.length}
            title="重做（⌘ / Ctrl Shift Z）"
            aria-label="重做"
          >
            <Redo2 size={18} />
          </button>
          {fullscreen && (
            <button
              ref={inspectorButton}
              type="button"
              className={styles.inspectorToggle}
              aria-controls={inspectorID}
              aria-expanded={inspectorOpen}
              onClick={() => setInspectorOpen((open) => !open)}
            >
              <SlidersHorizontal size={17} />
              属性
            </button>
          )}
          <div className={styles.toolbarActions}>
            {toolbarActions}
            <button
              ref={fullscreenButton}
              type="button"
              aria-label={fullscreen ? "退出全屏编辑" : "全屏编辑"}
              title={fullscreen ? "退出全屏编辑（Esc）" : "全屏编辑"}
              onClick={() => {
                setInspectorOpen(false);
                setFullscreen((active) => !active);
              }}
            >
              {fullscreen ? <Minimize size={17} /> : <Expand size={17} />}
              <span>{fullscreen ? "退出全屏" : "全屏"}</span>
            </button>
          </div>
          <input
            ref={uploadInput}
            className={styles.fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label="上传手帐照片"
            disabled={!editable || uploading}
            onChange={(event) => {
              void upload(event.target.files?.[0]);
            }}
          />
        </div>
      )}
      {!readOnly && uploading && (
        <p className={styles.notice} role="status" aria-label="照片上传状态">
          照片正在上传，完成后才会加入画布；请保留此页面。
        </p>
      )}
      {!readOnly && uploadError && (
        <p className={styles.error} role="alert">
          {uploadError}
        </p>
      )}
      <div className={`${styles.workspace} ${readOnly ? styles.readOnly : ""}`}>
        <div className={styles.stage}>
          <div
            ref={viewport}
            className={`${styles.viewport} ${mode === "pan" || readOnly ? styles.panMode : ""}`}
            data-testid="journal-viewport"
            onPointerDown={(event) => startGesture(event)}
            onPointerMove={moveGesture}
            onPointerUp={(event) => endGesture(event)}
            onPointerCancel={(event) => endGesture(event, true)}
            onWheel={(event) => {
              if (event.ctrlKey || event.metaKey) {
                setView((previous) => ({
                  ...previous,
                  zoom: clampZoom(
                    previous.zoom * (event.deltaY > 0 ? 0.92 : 1.08),
                    minimumZoom,
                  ),
                }));
              }
            }}
          >
            <div
              className={`${styles.paper} ${styles[displayed.paper]}`}
              data-testid="journal-paper"
              style={
                {
                  width: displayed.width,
                  height: displayed.height,
                  transform: `translate(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px)) scale(${view.zoom})`,
                } as CSSProperties
              }
            >
              {displayed.elements.map((element, index) => {
                const active = !readOnly && selectedID === element.id;
                return (
                  <div
                    key={element.id}
                    role={readOnly ? undefined : "button"}
                    tabIndex={readOnly ? undefined : 0}
                    aria-label={
                      readOnly
                        ? undefined
                        : `${labels[element.type]}：${element.text?.slice(0, 24) || "未命名"}${element.locked ? "（已锁定）" : ""}`
                    }
                    aria-pressed={readOnly ? undefined : active}
                    data-element-id={element.id}
                    data-testid={`journal-element-${element.id}`}
                    className={`${styles.element} ${styles[element.type]} ${active ? styles.selected : ""} ${element.locked ? styles.locked : ""}`}
                    style={{
                      left: element.x,
                      top: element.y,
                      width: element.width,
                      height: element.height,
                      transform: `rotate(${element.rotation}deg)`,
                      zIndex: index + 1,
                      fontSize: element.font_size || 24,
                      fontWeight: element.bold ? 700 : 400,
                      fontStyle: element.italic ? "italic" : "normal",
                      textAlign: element.align || "left",
                      color:
                        element.type === "note"
                          ? "#51493e"
                          : element.color || "#51493e",
                      backgroundColor:
                        element.type === "note"
                          ? element.color || "#e9efd9"
                          : undefined,
                    }}
                    onFocus={() => {
                      if (!readOnly) setSelectedID(element.id);
                    }}
                    onClick={() => {
                      if (!readOnly) setSelectedID(element.id);
                    }}
                    onPointerDown={(event) => startGesture(event, element)}
                  >
                    {element.type === "photo" ? (
                      element.asset_id ? (
                        <ProtectedPhoto
                          src={assetURL(element.asset_id)}
                          description={element.text || reader.photo}
                          failedLabel={reader.failed}
                        />
                      ) : (
                        <div className={styles.photoPlaceholder}>
                          <ImagePlus size={38} />
                          <span>
                            {element.text ||
                              (readOnly
                                ? reader.photo
                                : "选择照片，留住这一刻")}
                          </span>
                        </div>
                      )
                    ) : (
                      <div className={styles.elementText}>{element.text}</div>
                    )}
                    {active && element.locked && (
                      <span className={styles.lockBadge} aria-hidden="true">
                        <Lock size={20} />
                      </span>
                    )}
                    {active && editable && !element.locked && (
                      <>
                        <button
                          type="button"
                          className={styles.resizeHandle}
                          style={{ transform: `scale(${1 / view.zoom})` }}
                          aria-label="拖动调整尺寸"
                          onPointerDown={(event) =>
                            startGesture(event, element, "resize")
                          }
                          tabIndex={-1}
                        >
                          ↘
                        </button>
                        <button
                          type="button"
                          className={styles.rotateHandle}
                          style={{ transform: `scale(${1 / view.zoom})` }}
                          aria-label="拖动旋转"
                          onPointerDown={(event) =>
                            startGesture(event, element, "rotate")
                          }
                          tabIndex={-1}
                        >
                          <RotateCcw size={16} />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
              {!readOnly && displayed.elements.length === 0 && (
                <div className={styles.blankHint}>
                  <StickyNote size={48} />
                  <span>一页空白，留给此刻的你</span>
                  <small>添加文字、照片或便签开始记录</small>
                </div>
              )}
              {!readOnly && preview && snap && selected && (
                <>
                  {Math.abs(selected.x + selected.width / 2 - scene.width / 2) <
                    1 && <div className={styles.verticalGuide} />}
                  {Math.abs(
                    selected.y + selected.height / 2 - scene.height / 2,
                  ) < 1 && <div className={styles.horizontalGuide} />}
                </>
              )}
            </div>
          </div>
          {!thumbnail && (
            <div
              className={styles.viewbar}
              role="toolbar"
              aria-label={reader.view}
            >
              {!readOnly && (
                <div className={styles.modeButtons}>
                  <button
                    type="button"
                    aria-label="选择元素"
                    aria-pressed={mode === "select"}
                    onClick={() => setMode("select")}
                  >
                    <MousePointer2 size={17} />
                    <span>选择</span>
                  </button>
                  <button
                    type="button"
                    aria-label="移动页面"
                    aria-pressed={mode === "pan"}
                    onClick={() => setMode("pan")}
                  >
                    <Hand size={17} />
                    <span>移动</span>
                  </button>
                </div>
              )}
              <button
                type="button"
                aria-label={reader.smaller}
                onClick={() =>
                  setView((previous) => ({
                    ...previous,
                    zoom: clampZoom(previous.zoom / 1.2, minimumZoom),
                  }))
                }
              >
                <Minus size={17} />
              </button>
              <output className={styles.zoomValue} aria-label={reader.zoom}>
                {Math.round(view.zoom * 100)}%
              </output>
              <button
                type="button"
                aria-label={reader.larger}
                onClick={() =>
                  setView((previous) => ({
                    ...previous,
                    zoom: clampZoom(previous.zoom * 1.2, minimumZoom),
                  }))
                }
              >
                <Plus size={17} />
              </button>
              <button type="button" onClick={fitPage}>
                <Maximize size={17} />
                <span>{reader.fit}</span>
              </button>
            </div>
          )}
          {!thumbnail && (
            <p className={styles.hint}>
              {readOnly
                ? reader.hint
                : "Tab 选择元素 · 方向键微调 · Shift 加速 · 双指缩放页面"}
            </p>
          )}
        </div>
        {!readOnly && (
          <aside
            className={styles.inspector}
            aria-label="画布属性"
            id={inspectorID}
          >
            <div className={styles.inspectorHeading}>
              <span>
                {selected ? labels[selected.type] + "属性" : "页面设置"}
              </span>
              {fullscreen && (
                <button
                  type="button"
                  className={styles.inspectorToggle}
                  onClick={() => {
                    setInspectorOpen(false);
                    inspectorButton.current?.focus();
                  }}
                >
                  收起属性
                </button>
              )}
              {selected && (
                <button
                  type="button"
                  aria-label={selected.locked ? "解锁元素" : "锁定元素"}
                  disabled={!editable}
                  onClick={() =>
                    patch(selected.id, { locked: !selected.locked })
                  }
                >
                  {selected.locked ? <Lock size={17} /> : <Unlock size={17} />}
                </button>
              )}
            </div>
            {selected ? (
              <>
                {selected.locked && (
                  <p className={styles.notice}>
                    此元素已锁定，解锁后可以编辑。
                  </p>
                )}
                <label className={styles.property}>
                  {selected.type === "photo"
                    ? "照片说明"
                    : selected.type === "sticker"
                      ? "贴纸符号"
                      : "内容"}
                  <textarea
                    key={selected.id}
                    aria-label={
                      selected.type === "photo"
                        ? "照片说明"
                        : selected.type === "sticker"
                          ? "贴纸符号"
                          : "元素内容"
                    }
                    value={selected.text ?? ""}
                    disabled={!editable || selected.locked}
                    rows={selected.type === "sticker" ? 2 : 5}
                    maxLength={20000}
                    onChange={(event) =>
                      editText(selected.id, event.currentTarget.value)
                    }
                    onBlur={() => {
                      textEditID.current = null;
                    }}
                  />
                </label>
                {selected.type === "photo" ? (
                  <button
                    type="button"
                    disabled={
                      !editable || selected.locked || !onUpload || uploading
                    }
                    onClick={() => uploadInput.current?.click()}
                  >
                    <ImagePlus size={16} />
                    {selected.asset_id ? "更换照片" : "填入照片"}
                  </button>
                ) : (
                  <>
                    {selected.type === "sticker" ? (
                      <div className={styles.stickers} aria-label="基础贴纸">
                        {["✦", "✿", "♡", "☀", "☁", "☕", "★", "❀"].map(
                          (symbol) => (
                            <button
                              type="button"
                              key={symbol}
                              aria-label={`使用贴纸 ${symbol}`}
                              disabled={!editable || selected.locked}
                              onClick={() =>
                                patch(selected.id, { text: symbol })
                              }
                            >
                              {symbol}
                            </button>
                          ),
                        )}
                      </div>
                    ) : (
                      <div className={styles.formatButtons}>
                        <button
                          type="button"
                          aria-label="加粗"
                          aria-pressed={!!selected.bold}
                          disabled={!editable || selected.locked}
                          onClick={() =>
                            patch(selected.id, { bold: !selected.bold })
                          }
                        >
                          <b>B</b>
                        </button>
                        <button
                          type="button"
                          aria-label="斜体"
                          aria-pressed={!!selected.italic}
                          disabled={!editable || selected.locked}
                          onClick={() =>
                            patch(selected.id, { italic: !selected.italic })
                          }
                        >
                          <i>I</i>
                        </button>
                        <button
                          type="button"
                          disabled={!editable || selected.locked}
                          onClick={() =>
                            patch(selected.id, {
                              text: (selected.text || "")
                                .split("\n")
                                .map((line) => `• ${line}`)
                                .join("\n"),
                            })
                          }
                        >
                          列表
                        </button>
                        <button
                          type="button"
                          disabled={!editable || selected.locked}
                          onClick={() =>
                            patch(selected.id, {
                              text: (selected.text || "")
                                .split("\n")
                                .map((line) => `☐ ${line}`)
                                .join("\n"),
                            })
                          }
                        >
                          待办
                        </button>
                      </div>
                    )}
                    <div className={styles.propertyGrid}>
                      <NumberProperty
                        label="字号"
                        value={selected.font_size || 24}
                        min={10}
                        max={160}
                        disabled={!editable || selected.locked}
                        onCommit={(value) =>
                          patch(selected.id, { font_size: value })
                        }
                      />
                      <label className={styles.property}>
                        {selected.type === "note" ? "便签底色" : "文字颜色"}
                        <input
                          key={selected.color}
                          type="color"
                          aria-label={
                            selected.type === "note" ? "便签底色" : "文字颜色"
                          }
                          defaultValue={
                            selected.color ||
                            (selected.type === "note" ? "#e9efd9" : "#51493e")
                          }
                          disabled={!editable || selected.locked}
                          onBlur={(event) =>
                            patch(selected.id, {
                              color: event.currentTarget.value,
                            })
                          }
                        />
                      </label>
                    </div>
                    <label className={styles.property}>
                      文字对齐
                      <select
                        value={selected.align || "left"}
                        disabled={!editable || selected.locked}
                        onChange={(event) =>
                          patch(selected.id, {
                            align: event.currentTarget
                              .value as JournalElement["align"],
                          })
                        }
                      >
                        <option value="left">左对齐</option>
                        <option value="center">居中</option>
                        <option value="right">右对齐</option>
                      </select>
                    </label>
                  </>
                )}
                <div className={styles.propertyGrid}>
                  <NumberProperty
                    label="横向位置"
                    value={selected.x}
                    min={0}
                    max={Math.max(0, scene.width - selected.width)}
                    disabled={!editable || selected.locked}
                    onCommit={(value) => patch(selected.id, { x: value })}
                  />
                  <NumberProperty
                    label="纵向位置"
                    value={selected.y}
                    min={0}
                    max={Math.max(0, scene.height - selected.height)}
                    disabled={!editable || selected.locked}
                    onCommit={(value) => patch(selected.id, { y: value })}
                  />
                  <NumberProperty
                    label="宽度"
                    value={selected.width}
                    min={24}
                    max={scene.width - selected.x}
                    disabled={!editable || selected.locked}
                    onCommit={(value) => updateSize("width", value)}
                  />
                  <NumberProperty
                    label="高度"
                    value={selected.height}
                    min={24}
                    max={scene.height - selected.y}
                    disabled={!editable || selected.locked}
                    onCommit={(value) => updateSize("height", value)}
                  />
                  <NumberProperty
                    label="旋转角度"
                    value={selected.rotation}
                    min={-360}
                    max={360}
                    disabled={!editable || selected.locked}
                    onCommit={(value) =>
                      patch(selected.id, { rotation: value })
                    }
                  />
                </div>
                {selected.type === "photo" && (
                  <p className={styles.hint}>照片调整尺寸时保持原图比例。</p>
                )}
                <div className={styles.layerActions}>
                  {(
                    [
                      ["back", "置底"],
                      ["backward", "后移"],
                      ["forward", "前移"],
                      ["front", "置顶"],
                    ] as const
                  ).map(([action, label]) => (
                    <button
                      type="button"
                      key={action}
                      disabled={!editable || selected.locked}
                      onClick={() =>
                        commit(
                          reorderJournalElement(
                            sceneRef.current,
                            selected.id,
                            action,
                          ),
                        )
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className={styles.elementActions}>
                  <button
                    type="button"
                    disabled={!editable || selected.locked}
                    onClick={duplicate}
                  >
                    <Copy size={16} />
                    复制
                  </button>
                  <button
                    type="button"
                    className={styles.deleteButton}
                    disabled={!editable || selected.locked}
                    onClick={remove}
                  >
                    <Trash2 size={16} />
                    删除
                  </button>
                </div>
              </>
            ) : (
              <p className={styles.hint}>
                选择纸上的元素，调整内容、样式与位置。也可以从下方图层列表选择。
              </p>
            )}
            <div className={styles.pageSettings}>
              <div className={styles.property}>
                纸张大小
                <div className={styles.paperSize}>
                  <span>{scene.width} × {scene.height}</span>
                  <button
                    type="button"
                    disabled={!editable || expandedPaper === scene}
                    onClick={() => commit(expandJournalScene(sceneRef.current))}
                  >
                    <Plus size={16} />
                    扩大纸张
                  </button>
                </div>
              </div>
              <p className={styles.hint}>
                {expandedPaper === scene
                  ? "纸张已达最大尺寸，可撤销恢复上一次扩展。"
                  : `扩展为 ${expandedPaper.width} × ${expandedPaper.height}，内容位置与大小不变，可撤销。`}
              </p>
              <label className={styles.property}>
                纸张方向
                <select
                  aria-label="纸张方向"
                  disabled={!editable}
                  value={scene.width > scene.height ? "landscape" : "portrait"}
                  onChange={(event) =>
                    commit(
                      orientJournalScene(
                        sceneRef.current,
                        event.currentTarget.value as "portrait" | "landscape",
                      ),
                    )
                  }
                >
                  <option value="portrait">纵向</option>
                  <option value="landscape">横向</option>
                </select>
              </label>
              <p className={styles.hint}>
                切换方向会等比缩放并居中现有内容，可撤销恢复。
              </p>
              <label className={styles.property}>
                纸张样式
                <select
                  aria-label="纸张样式"
                  disabled={!editable}
                  value={scene.paper}
                  onChange={(event) =>
                    commit({
                      ...sceneRef.current,
                      paper: event.currentTarget.value as JournalScene["paper"],
                    })
                  }
                >
                  <option value="plain">暖白纸</option>
                  <option value="ruled">横线纸</option>
                  <option value="dots">点阵纸</option>
                </select>
              </label>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={snap}
                  onChange={(event) => setSnap(event.currentTarget.checked)}
                />
                对齐参考线与吸附
              </label>
              <p className={styles.hint}>
                {scene.width} × {scene.height} · {scene.elements.length} 个元素
              </p>
            </div>
            <h3 className={styles.layerHeading}>
              <Layers size={16} />
              图层<span>上方显示在前</span>
            </h3>
            <div className={styles.layers}>
              {[...scene.elements].reverse().map((element) => (
                <button
                  type="button"
                  key={element.id}
                  className={
                    selectedID === element.id ? styles.activeLayer : ""
                  }
                  aria-pressed={selectedID === element.id}
                  aria-label={`选择图层 ${labels[element.type]} ${element.text?.slice(0, 18) || "未命名"}`}
                  onClick={() => {
                    setSelectedID(element.id);
                    setMode("select");
                  }}
                >
                  <span className={styles.layerType}>
                    {labels[element.type]}
                  </span>
                  <span className={styles.layerName}>
                    {element.text?.slice(0, 22) || "未命名"}
                  </span>
                  {element.locked && <Lock size={13} />}
                </button>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
