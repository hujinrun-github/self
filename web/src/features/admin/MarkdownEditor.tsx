import {
  Bold, Braces, Code, Columns2, Download, Eye, FileCode2, ImagePlus, Italic,
  Keyboard, Link2, List, ListOrdered, ListTodo, Maximize2, Minimize2, Minus, MoreHorizontal,
  PanelLeft, PenLine, Quote, Redo2, Search, Settings2, Strikethrough, Table2, Undo2, X,
} from "lucide-react";
import {
  lazy, Suspense, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type ComponentProps, type FormEvent, type ReactNode, type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { EditorState } from "@codemirror/state";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { EditorMediaPanel, uploadEditorImage } from "./markdown/EditorMediaPanel";
import type { CursorPosition, SourceEditorHandle } from "./markdown/editorTypes";
import type { RichEditorHandle } from "./markdown/richEditorTypes";
import {
  codeBlockMarkdown, documentStats, extractOutline, formatEdit, linkMarkdown,
  markdownPreviewSource, tableMarkdown, type FormatAction,
} from "./markdown/markdownTools";
import styles from "./markdown/MarkdownWorkspace.module.css";

const SourceEditor = lazy(() => import("./markdown/SourceEditor").then((module) => ({ default: module.SourceEditor })));
const RichEditor = lazy(() => import("./markdown/RichEditor").then((module) => ({ default: module.RichEditor })));

type Mode = "source" | "split" | "preview" | "rich";
type InsertKind = "link" | "table" | "code" | "image" | "help";
type MarkdownEditorProps = {
  description?: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
};

const insertTitles: Record<InsertKind, string> = {
  link: "插入链接", table: "插入表格", code: "插入代码块", image: "插入图片", help: "快捷键与语法",
};

export function MarkdownEditor({ description, id, label, onChange, value }: MarkdownEditorProps) {
  const compact = useCompactViewport();
  const [mode, setMode] = useState<Mode>("split");
  const [richVisited, setRichVisited] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [moreToolsOpen, setMoreToolsOpen] = useState(false);
  const [lineWrapping, setLineWrapping] = useState(true);
  const [fontSize, setFontSize] = useState(15);
  const [followSource, setFollowSource] = useState(true);
  const [position, setPosition] = useState<CursorPosition>({ line: 1, column: 1 });
  const [dialog, setDialog] = useState<InsertKind | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const sourceRef = useRef<SourceEditorHandle>(null);
  const richRef = useRef<RichEditorHandle>(null);
  const editorStateRef = useRef<EditorState | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const scrollRatioRef = useRef(0);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const normalMountRef = useRef<HTMLDivElement>(null);
  const fullscreenMountRef = useRef<HTMLDivElement>(null);
  const [workspaceHost] = useState(() => {
    const host = document.createElement("div");
    host.className = styles.workspaceHost;
    return host;
  });
  const uploadRef = useRef<AbortController | null>(null);
  const latestValue = useRef(value);
  const effectiveMode = compact && mode === "split" ? "source" : mode;
  const activeModeRef = useRef<Mode>(effectiveMode);
  const stats = useMemo(() => documentStats(value), [value]);
  const headings = useMemo(() => extractOutline(value), [value]);
  const deferredValue = useDeferredValue(value);
  const previewSource = useMemo(() => markdownPreviewSource(deferredValue), [deferredValue]);
  const previewHeadingLines = useMemo(() => {
    const original = extractOutline(deferredValue);
    return new Map(extractOutline(previewSource).map((heading, index) => [heading.line, original[index]?.line ?? heading.line]));
  }, [deferredValue, previewSource]);
  const headingID = (line = 0) => `${id}-line-${previewHeadingLines.get(line) ?? line}`;

  useLayoutEffect(() => { latestValue.current = value; activeModeRef.current = effectiveMode; }, [value, effectiveMode]);
  useLayoutEffect(() => {
    // Keep both editor instances alive when moving into fullscreen, including their selection and undo history.
    (fullscreen ? fullscreenMountRef.current : normalMountRef.current)?.append(workspaceHost);
  }, [fullscreen, workspaceHost]);
  useEffect(() => () => uploadRef.current?.abort(), []);
  useLayoutEffect(() => {
    const preview = previewRef.current;
    if (preview && followSource && effectiveMode === "split") {
      preview.scrollTop = scrollRatioRef.current * (preview.scrollHeight - preview.clientHeight);
    }
  }, [previewSource, effectiveMode, followSource]);
  useModalFocus(fullscreenRef, fullscreen, () => setFullscreen(false), focusEditor);
  useVisibleViewport(fullscreenRef, fullscreen);

  function focusEditor() {
    if (activeModeRef.current === "rich") richRef.current?.focus();
    else sourceRef.current?.focus();
  }

  function changeValue(next: string) {
    latestValue.current = next;
    onChange(next);
  }

  function openSearch() {
    if (effectiveMode === "rich") {
      setMode(compact ? "source" : "split");
      setNotice("查找与替换在源码中进行，修改会同步到所见即所得模式。");
      requestAnimationFrame(() => sourceRef.current?.openSearch());
    } else ensureEditing(() => sourceRef.current?.openSearch());
  }

  function ensureEditing(action: () => void) {
    if (effectiveMode === "preview") {
      setMode(compact ? "source" : "split");
      requestAnimationFrame(action);
    } else action();
  }

  function format(action: FormatAction) {
    if (effectiveMode === "rich") { richRef.current?.format(action); return; }
    const editor = sourceRef.current;
    if (!editor) return;
    ensureEditing(() => editor.applyEdit(formatEdit(latestValue.current, editor.getSelection(), action)));
  }

  function openInsert(kind: InsertKind) {
    const selection = sourceRef.current?.getSelection();
    setSelectedText(effectiveMode === "rich" ? richRef.current?.getSelectedText() ?? "" : selection ? latestValue.current.slice(selection.from, selection.to) : "");
    setDialog(kind);
  }

  function insertMarkdown(markdown: string, block = true, replaceSelection = true) {
    setMoreToolsOpen(false);
    if (activeModeRef.current === "rich") {
      richRef.current?.insertMarkdown(markdown, replaceSelection, block);
      setDialog(null);
      requestAnimationFrame(focusEditor);
      return;
    }
    const editor = sourceRef.current;
    if (!editor) return;
    const selection = editor.getSelection();
    const from = selection.from;
    const to = replaceSelection ? selection.to : selection.from;
    const document = latestValue.current;
    const before = document.slice(0, from);
    const after = document.slice(to);
    const prefix = block && before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
    const suffix = block && after && !after.startsWith("\n\n") ? (after.startsWith("\n") ? "\n" : "\n\n") : "";
    const insert = `${prefix}${markdown}${suffix}`;
    setDialog(null);
    ensureEditing(() => editor.applyEdit({ from, to, insert, anchor: from + insert.length }));
    requestAnimationFrame(() => editor.focus());
  }

  async function pasteImages(files: File[]) {
    if (uploadRef.current) return;
    const controller = new AbortController();
    uploadRef.current = controller;
    setUploading(true);
    setNotice("正在上传图片…");
    let inserted = 0;
    try {
      for (const file of files) {
        const markdown = await uploadEditorImage(file, controller.signal);
        if (controller.signal.aborted) return;
        // Insert at the current cursor; never overwrite text typed while an upload was running.
        insertMarkdown(markdown, true, false);
        inserted += 1;
      }
      setNotice(`已插入 ${inserted} 张图片，请保存正文。`);
    } catch (error) {
      if (!controller.signal.aborted) setNotice(`${inserted ? `已插入 ${inserted} 张图片。` : ""}${error instanceof Error ? error.message : "图片上传失败，请重试。"}`);
    } finally {
      if (!controller.signal.aborted) { setUploading(false); uploadRef.current = null; }
    }
  }

  function exportMarkdown() {
    const url = URL.createObjectURL(new Blob([value], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "document.md";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("已导出当前 Markdown 正文。");
  }

  function jumpToHeading(line: number) {
    if (compact) setOutlineOpen(false);
    if (effectiveMode === "rich") {
      richRef.current?.goToHeading(headings.findIndex((heading) => heading.line === line));
    } else if (effectiveMode === "preview") {
      document.getElementById(`${id}-line-${line}`)?.scrollIntoView({ block: "start" });
    } else sourceRef.current?.goToLine(line);
  }

  const workspace = (
    <div
      className={`${styles.workspace} ${fullscreen ? styles.fullscreen : ""}`}
      onKeyDown={(event) => {
        if (!(event.metaKey || event.ctrlKey) || event.altKey || event.nativeEvent.isComposing) return;
        if (event.target instanceof HTMLElement && event.target.closest(".ProseMirror") && event.key.toLowerCase() === "f") {
          event.preventDefault(); openSearch(); return;
        }
        if (!(event.target instanceof HTMLElement) || !event.target.closest(".cm-editor")) return;
        const actions: Record<string, FormatAction> = { b: "bold", i: "italic" };
        const action = actions[event.key.toLowerCase()];
        if (action) { event.preventDefault(); format(action); }
        if (event.key.toLowerCase() === "k") { event.preventDefault(); openInsert("link"); }
      }}
    >
      <header className={styles.workspaceHeader}>
        <div className={styles.modeGroup} role="tablist" aria-label="编辑模式">
          {([
            ["source", "源码", FileCode2], ["split", "分屏", Columns2], ["rich", "所见即所得", PenLine], ["preview", "预览", Eye],
          ] as const).filter(([key]) => !compact || key !== "split").map(([key, text, Icon]) => (
            <button key={key} type="button" role="tab" aria-selected={effectiveMode === key} title={text} onClick={() => { if (key === "rich") setRichVisited(true); setMoreToolsOpen(false); setMode(key); }}>
              <Icon size={15} aria-hidden="true" />{text}
            </button>
          ))}
        </div>
        <div className={styles.headerActions}>
          <ToolButton label="文档目录" caption={compact ? "目录" : undefined} icon={PanelLeft} pressed={outlineOpen} onClick={() => setOutlineOpen(!outlineOpen)} />
          <ToolButton label="查找与替换" caption={compact ? "查找" : undefined} icon={Search} shortcut="⌘/Ctrl F" onClick={openSearch} />
          {!compact ? <ToolButton label="导出 Markdown" icon={Download} onClick={exportMarkdown} /> : null}
          <ToolButton label={fullscreen ? "退出全屏" : "全屏写作"} caption={compact ? fullscreen ? "退出全屏" : "全屏" : undefined} icon={fullscreen ? Minimize2 : Maximize2} onClick={() => setFullscreen(!fullscreen)} />
        </div>
      </header>

      {compact ? <>
        <div className={`${styles.toolbar} ${styles.compactToolbar}`} role="toolbar" aria-label="Markdown 格式工具">
          <ToolButton label="撤销" icon={Undo2} onClick={() => effectiveMode === "rich" ? richRef.current?.undo() : ensureEditing(() => sourceRef.current?.undo())} />
          <ToolButton label="加粗" icon={Bold} onClick={() => format("bold")} />
          <ToolButton label="斜体" icon={Italic} onClick={() => format("italic")} />
          <ToolButton label="插入图片" icon={ImagePlus} onClick={() => openInsert("image")} disabled={uploading} />
          <ToolButton label={moreToolsOpen ? "收起工具" : "更多工具"} caption={moreToolsOpen ? "收起" : "更多"} icon={moreToolsOpen ? X : MoreHorizontal} aria-expanded={moreToolsOpen} aria-controls={`${id}-more-tools`} onClick={() => setMoreToolsOpen(!moreToolsOpen)} />
        </div>
        {moreToolsOpen ? <div className={styles.moreTools} id={`${id}-more-tools`} role="toolbar" aria-label="更多 Markdown 工具">
          <label className={styles.mobileHeading}>插入标题<select aria-label="插入标题" value="" onChange={(event) => { if (event.target.value) { format(event.target.value as FormatAction); setMoreToolsOpen(false); } }}><option value="" disabled>选择层级</option><option value="heading1">一级标题</option><option value="heading2">二级标题</option><option value="heading3">三级标题</option></select></label>
          {([
            ["strike", "删除线", Strikethrough], ["inlineCode", "行内代码", Code], ["quote", "引用", Quote],
            ["bulletList", "无序列表", List], ["orderedList", "有序列表", ListOrdered], ["taskList", "任务清单", ListTodo], ["divider", "分隔线", Minus],
          ] as const).map(([action, text, Icon]) => <ToolButton key={action} label={text} caption={text} icon={Icon} onClick={() => { format(action); setMoreToolsOpen(false); }} />)}
          {([ ["link", Link2], ["table", Table2], ["code", Braces], ["help", Keyboard] ] as const).map(([kind, Icon]) => <ToolButton key={kind} label={insertTitles[kind]} caption={insertTitles[kind]} icon={Icon} onClick={() => openInsert(kind)} />)}
          <ToolButton label="重做" caption="重做" icon={Redo2} onClick={() => { if (effectiveMode === "rich") richRef.current?.redo(); else ensureEditing(() => sourceRef.current?.redo()); setMoreToolsOpen(false); }} />
          <ToolButton label="导出 Markdown" caption="导出正文" icon={Download} onClick={exportMarkdown} />
        </div> : null}
      </> : <div className={styles.toolbar} role="toolbar" aria-label="Markdown 格式工具">
        <div className={styles.toolGroup}>
          <ToolButton label="撤销" icon={Undo2} shortcut="⌘/Ctrl Z" onClick={() => effectiveMode === "rich" ? richRef.current?.undo() : ensureEditing(() => sourceRef.current?.undo())} />
          <ToolButton label="重做" icon={Redo2} shortcut="⌘/Ctrl Shift Z" onClick={() => effectiveMode === "rich" ? richRef.current?.redo() : ensureEditing(() => sourceRef.current?.redo())} />
        </div>
        <div className={styles.toolGroup}>
          <select aria-label="插入标题" value="" onChange={(event) => { if (event.target.value) format(event.target.value as FormatAction); }}>
            <option value="" disabled>标题</option><option value="heading1">一级标题</option><option value="heading2">二级标题</option><option value="heading3">三级标题</option>
          </select>
          <ToolButton label="加粗" icon={Bold} shortcut="⌘/Ctrl B" onClick={() => format("bold")} />
          <ToolButton label="斜体" icon={Italic} shortcut="⌘/Ctrl I" onClick={() => format("italic")} />
          <ToolButton label="删除线" icon={Strikethrough} onClick={() => format("strike")} />
          <ToolButton label="行内代码" icon={Code} onClick={() => format("inlineCode")} />
        </div>
        <div className={styles.toolGroup}>
          <ToolButton label="引用" icon={Quote} onClick={() => format("quote")} />
          <ToolButton label="无序列表" icon={List} onClick={() => format("bulletList")} />
          <ToolButton label="有序列表" icon={ListOrdered} onClick={() => format("orderedList")} />
          <ToolButton label="任务清单" icon={ListTodo} onClick={() => format("taskList")} />
          <ToolButton label="分隔线" icon={Minus} onClick={() => format("divider")} />
        </div>
        <div className={styles.toolGroup}>
          <ToolButton label="插入链接" icon={Link2} shortcut="⌘/Ctrl K" onClick={() => openInsert("link")} />
          <ToolButton label="插入图片" icon={ImagePlus} onClick={() => openInsert("image")} disabled={uploading} />
          <ToolButton label="插入表格" icon={Table2} onClick={() => openInsert("table")} />
          <ToolButton label="插入代码块" icon={Braces} onClick={() => openInsert("code")} />
        </div>
        <ToolButton label="快捷键与语法" icon={Keyboard} onClick={() => openInsert("help")} />
      </div>}

      <div className={styles.workArea} data-outline={outlineOpen}>
        {outlineOpen ? (
          <nav className={styles.outline} aria-label="文档目录">
            <div className={styles.outlineHeader}><strong>文档目录</strong><span>{headings.length} 个标题</span></div>
            {headings.length ? headings.map((heading) => (
              <button type="button" key={heading.line} style={{ paddingLeft: 14 + (heading.level - 1) * 10 }} onClick={() => jumpToHeading(heading.line)} title={heading.text}>
                <span aria-hidden="true">H{heading.level}</span>{heading.text}
              </button>
            )) : <p>使用 #、##、### 创建标题，目录会自动显示在这里。</p>}
          </nav>
        ) : null}
        <div className={styles.canvas} data-mode={effectiveMode}>
          <div className={styles.sourcePane} aria-hidden={effectiveMode === "preview" || effectiveMode === "rich" ? true : undefined}>
            <div className={styles.paneLabel}><span>Markdown 源码</span><span>支持粘贴或拖入图片</span></div>
            <Suspense fallback={<div className={styles.loading} role="status">正在准备编辑器…</div>}>
              <SourceEditor
                ref={sourceRef} id={id} label={label} value={value} onChange={changeValue}
                lineWrapping={lineWrapping} fontSize={fontSize} stateRef={editorStateRef}
                onCursorChange={setPosition} onImagePaste={(files) => void pasteImages(files)}
                onScroll={(ratio) => {
                  scrollRatioRef.current = ratio;
                  const preview = previewRef.current;
                  if (preview && followSource && effectiveMode === "split") preview.scrollTop = ratio * (preview.scrollHeight - preview.clientHeight);
                }}
              />
            </Suspense>
          </div>
          {richVisited ? <section className={styles.richPane} hidden={effectiveMode !== "rich"} aria-label="所见即所得编辑区">
            <div className={styles.paneLabel}><span>所见即所得</span><span>直接编辑正文，支持工具栏与 Markdown 快捷输入</span></div>
            <Suspense fallback={<div className={styles.loading} role="status">正在准备所见即所得编辑器…</div>}>
              <RichEditor ref={richRef} id={`${id}-rich`} label={`${label}（所见即所得）`} value={value} onChange={changeValue} fontSize={fontSize}
                onImagePaste={(files) => void pasteImages(files)} onLinkShortcut={() => openInsert("link")} />
            </Suspense>
          </section> : null}
          {effectiveMode === "split" || effectiveMode === "preview" ? (
            <section className={styles.previewPane} aria-label="Markdown 预览">
              <div className={styles.paneLabel}><span>阅读预览</span><span>与公开页面使用相同 Markdown 语法</span></div>
              <div className={styles.previewScroll} ref={previewRef}>
                {value.trim() ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} skipHtml components={{
                    h1: ({ node, ...props }) => <h1 {...props} id={headingID(node?.position?.start.line)} />,
                    h2: ({ node, ...props }) => <h2 {...props} id={headingID(node?.position?.start.line)} />,
                    h3: ({ node, ...props }) => <h3 {...props} id={headingID(node?.position?.start.line)} />,
                    h4: ({ node, ...props }) => <h4 {...props} id={headingID(node?.position?.start.line)} />,
                    h5: ({ node, ...props }) => <h5 {...props} id={headingID(node?.position?.start.line)} />,
                    h6: ({ node, ...props }) => <h6 {...props} id={headingID(node?.position?.start.line)} />,
                    a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
                    img: ({ src, alt }) => <img src={src} alt={alt ?? ""} loading="lazy" onLoad={() => {
                      const preview = previewRef.current;
                      if (preview && followSource && effectiveMode === "split") preview.scrollTop = scrollRatioRef.current * (preview.scrollHeight - preview.clientHeight);
                    }} />,
                  }}>{previewSource}</ReactMarkdown>
                ) : <div className={styles.previewEmpty}><FileCode2 size={26} /><strong>从第一行开始</strong><p>左侧输入 Markdown，在这里查看排版效果。</p></div>}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <footer className={styles.statusBar}>
        <div className={styles.stats}><span>{stats.words.toLocaleString()} 字</span><span>{stats.characters.toLocaleString()} 字符</span><span>{stats.lines} 行</span><span>阅读约 {stats.readingMinutes} 分钟</span></div>
        <div className={styles.statusControls}>
          <span className={styles.cursor}>{effectiveMode === "rich" ? "Markdown 同步" : `行 ${position.line}，列 ${position.column}`}</span>
          <details className={styles.settings}>
            <summary aria-label="编辑器设置"><Settings2 size={15} /><span>设置</span></summary>
            <div className={styles.settingsPanel}>
              {effectiveMode !== "rich" ? <><label><input type="checkbox" checked={lineWrapping} onChange={(event) => setLineWrapping(event.target.checked)} />自动换行</label>
              <label><input type="checkbox" checked={followSource} onChange={(event) => setFollowSource(event.target.checked)} />预览跟随源码滚动</label></> : null}
              <label>字号<select aria-label="编辑字号" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))}>{[14, 15, 16, 18, 20].map((size) => <option value={size} key={size}>{size}px</option>)}</select></label>
            </div>
          </details>
        </div>
      </footer>
      {notice ? <div className={styles.notice} role="status">{notice}<button type="button" aria-label="关闭编辑提示" onClick={() => setNotice("")}><X size={14} /></button></div> : null}
    </div>
  );

  return (
    <div className={styles.field}>
      <div className={styles.fieldHeader}><label htmlFor={effectiveMode === "rich" ? `${id}-rich` : id}>{label}</label>{description ? <span>{description}</span> : null}</div>
      <div ref={normalMountRef} />
      {fullscreen ? createPortal(
        <div ref={fullscreenRef} className={styles.fullscreenOverlay} role="dialog" aria-label={`${label} · 全屏写作`} aria-modal="true" data-editor-modal="true">
          <div ref={fullscreenMountRef} className={styles.fullscreenContainer} />
        </div>, document.body,
      ) : null}
      {createPortal(workspace, workspaceHost)}
      <p className={styles.saveHint}>{compact ? "修改后请保存正文。更多工具中可插入标题、列表、表格与链接。" : "修改后请使用页面的保存按钮。可用 ⌘ / Ctrl + F 查找，⌘ / Ctrl + Z 撤销。"}</p>
      {dialog ? <EditorDialog title={insertTitles[dialog]} onClose={() => setDialog(null)}>
        {dialog === "image" ? <EditorMediaPanel onInsert={(markdown) => insertMarkdown(markdown)} onCancel={() => setDialog(null)} />
          : dialog === "help" ? <ShortcutGuide />
            : <InsertForm key={dialog} kind={dialog} selectedText={selectedText} onCancel={() => setDialog(null)} onInsert={(markdown) => insertMarkdown(markdown, dialog !== "link")} />}
      </EditorDialog> : null}
    </div>
  );
}

function ToolButton({ label, caption, icon: Icon, shortcut, pressed, ...props }: {
  label: string; caption?: string; icon: typeof Bold; shortcut?: string; pressed?: boolean;
} & ComponentProps<"button">) {
  return <button {...props} type="button" className={`${styles.toolButton} ${caption ? styles.captionButton : ""}`} aria-label={label} aria-pressed={pressed} title={`${label}${shortcut ? ` (${shortcut})` : ""}`}><Icon size={16} aria-hidden="true" />{caption ? <span>{caption}</span> : null}</button>;
}

function InsertForm({ kind, selectedText, onInsert, onCancel }: {
  kind: "table" | "link" | "code"; selectedText: string; onInsert: (value: string) => void; onCancel: () => void;
}) {
  const [rows, setRows] = useState("3");
  const [columns, setColumns] = useState("3");
  const [text, setText] = useState(selectedText);
  const [url, setURL] = useState("");
  const [language, setLanguage] = useState("typescript");
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (kind === "link") {
      const markdown = linkMarkdown(text || url, url);
      if (!markdown) { setError("请输入有效的链接地址，例如 https://example.com。"); return; }
      onInsert(markdown);
    } else if (kind === "table") {
      const rowCount = Number(rows), columnCount = Number(columns);
      if (!Number.isInteger(rowCount) || rowCount < 1 || rowCount > 20 || !Number.isInteger(columnCount) || columnCount < 1 || columnCount > 10) { setError("表格支持 1–20 行、1–10 列。"); return; }
      onInsert(tableMarkdown(rowCount, columnCount));
    } else onInsert(codeBlockMarkdown(language, text));
  }
  return <form className={styles.insertForm} onSubmit={submit}>
    {kind === "link" ? <><label>显示文字<input data-focus-entry value={text} onChange={(event) => setText(event.target.value)} placeholder="链接文字" /></label><label>链接地址<input value={url} onChange={(event) => setURL(event.target.value)} placeholder="https://example.com" required /></label></> : null}
    {kind === "table" ? <><p>选择表格大小，插入后可直接编辑表头和单元格内容。</p><div className={styles.formGrid}><label>正文行数<input data-focus-entry type="number" min="1" max="20" value={rows} onChange={(event) => setRows(event.target.value)} required /></label><label>列数<input type="number" min="1" max="10" value={columns} onChange={(event) => setColumns(event.target.value)} required /></label></div><pre className={styles.tableExample}>{tableMarkdown(Math.min(3, Number(rows) || 1), Math.min(4, Number(columns) || 1))}</pre></> : null}
    {kind === "code" ? <><label>代码语言<select aria-label="代码语言" data-focus-entry value={language} onChange={(event) => setLanguage(event.target.value)}>{["text", "typescript", "javascript", "go", "python", "json", "bash", "sql", "html", "css", "yaml", "java", "rust", "cpp"].map((lang) => <option key={lang}>{lang}</option>)}</select></label><label>代码内容<textarea rows={8} value={text} onChange={(event) => setText(event.target.value)} placeholder="在这里粘贴代码…" /></label></> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    <div className={styles.dialogActions}><button type="button" onClick={onCancel}>取消</button><button className={styles.primary} type="submit">{insertTitles[kind]}</button></div>
  </form>;
}

function ShortcutGuide() {
  return <div className={styles.guide}><p>macOS 使用 ⌘，Windows / Linux 使用 Ctrl。</p><dl>{[["加粗", "⌘ / Ctrl + B"], ["斜体", "⌘ / Ctrl + I"], ["插入链接", "⌘ / Ctrl + K"], ["查找 / 替换", "⌘ / Ctrl + F"], ["撤销", "⌘ / Ctrl + Z"], ["重做", "⌘ / Ctrl + Shift + Z"], ["退出全屏或关闭窗口", "Esc"]].map(([label, keys]) => <div key={label}><dt>{label}</dt><dd><kbd>{keys}</kbd></dd></div>)}</dl><p>支持标准 Markdown、表格、任务清单和围栏代码块。Tab 可移到下一个控件。</p></div>;
}

function EditorDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  useModalFocus(ref, true, onClose);
  useVisibleViewport(overlayRef, true);
  return createPortal(<div ref={overlayRef} className={styles.dialogOverlay} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={ref} className={styles.dialog} role="dialog" aria-modal="true" aria-label={title} data-editor-modal="true"><header><h2>{title}</h2><button type="button" onClick={onClose} aria-label={`关闭${title}`}><X size={19} /></button></header>{children}</div></div>, document.body);
}

function useVisibleViewport(ref: RefObject<HTMLDivElement | null>, active: boolean) {
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    const node = ref.current;
    if (!active || !node || !viewport) return;
    // The software keyboard resizes the visual viewport on mobile without always changing dvh.
    const update = () => {
      if (viewport.scale !== 1) return;
      node.style.top = `${viewport.offsetTop}px`;
      node.style.height = `${viewport.height}px`;
      node.style.bottom = "auto";
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [active, ref]);
}

function useModalFocus(ref: RefObject<HTMLDivElement | null>, active: boolean, onClose: () => void, onRestore?: () => void) {
  const callbacks = useRef({ onClose, onRestore });
  useEffect(() => { callbacks.current = { onClose, onRestore }; }, [onClose, onRestore]);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!active || !node) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const siblings = Array.from(document.body.children).filter((child): child is HTMLElement => child instanceof HTMLElement && !child.contains(node));
    const inertStates = siblings.map((element) => ({ element, inert: element.inert }));
    siblings.forEach((element) => { element.inert = true; });
    document.body.style.overflow = "hidden";
    (node.querySelector<HTMLElement>("[data-focus-entry]") ?? node.querySelector<HTMLElement>("button"))?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (Array.from(document.querySelectorAll("[data-editor-modal='true']")).at(-1) !== node) return;
      if (event.key === "Escape") {
        if (event.target instanceof HTMLElement && event.target.closest(".cm-editor") && node.querySelector(".cm-search")) return;
        event.preventDefault(); event.stopImmediatePropagation(); callbacks.current.onClose();
      }
      if (event.key === "Tab") {
        const controls = Array.from(node.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select, a[href], [tabindex="0"]')).filter((element) => element.getClientRects().length > 0 && !element.closest("[aria-hidden='true']"));
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      inertStates.forEach(({ element, inert }) => { element.inert = inert; });
      if (previousFocus?.isConnected) previousFocus.focus();
      else requestAnimationFrame(() => callbacks.current.onRestore?.());
    };
  }, [active, ref]);
}

function useCompactViewport() {
  const queryText = "(max-width: 720px), (max-height: 500px) and (pointer: coarse)";
  const [compact, setCompact] = useState(() => window.matchMedia(queryText).matches);
  useEffect(() => {
    const query = window.matchMedia(queryText);
    const update = () => setCompact(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [queryText]);
  return compact;
}
