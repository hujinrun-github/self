import { commandsCtx, defaultValueCtx, Editor, editorViewCtx, editorViewOptionsCtx, parserCtx, rootCtx, serializerCtx } from "@milkdown/core";
import { history } from "@milkdown/plugin-history";
import {
  codeBlockSchema, commonmark, imageSchema, insertHrCommand, liftListItemCommand, toggleEmphasisCommand,
  toggleInlineCodeCommand, toggleStrongCommand, wrapInBlockquoteCommand, wrapInBulletListCommand,
  wrapInHeadingCommand, wrapInOrderedListCommand,
} from "@milkdown/preset-commonmark";
import { gfm, toggleStrikethroughCommand } from "@milkdown/preset-gfm";
import { lift } from "@milkdown/prose/commands";
import { closeHistory, redo, undo } from "@milkdown/prose/history";
import { Slice } from "@milkdown/prose/model";
import { EditorState, TextSelection } from "@milkdown/prose/state";
import type { Transaction } from "@milkdown/prose/state";
import type { EditorView, NodeView, NodeViewConstructor } from "@milkdown/prose/view";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { isSafeLink, resolveRemoteImageURL } from "../../../lib/media";
import { normalizeLooseImageReferences } from "./markdownTools";
import type { RichEditorHandle, RichEditorProps } from "./richEditorTypes";
import styles from "./RichEditor.module.css";

function imageDisplayURL(source: string): string {
  const media = source.match(/^media:\/\/asset\/(\d+)\/([a-z_][a-z0-9_-]*)$/);
  if (media) return `/media/${media[1]}/${media[2]}`;
  if (!isSafeLink(source) || source.trim().toLowerCase().startsWith("mailto:")) return "";
  return resolveRemoteImageURL(source) ?? "";
}

const safeImageSchema = imageSchema.extendSchema((previous) => (ctx) => {
  const base = previous(ctx);
  return {
    ...base,
    parseDOM: [{
      tag: "img[src]",
      getAttrs: (dom) => ({
        src: dom.getAttribute("data-markdown-src") ?? dom.getAttribute("src") ?? "",
        alt: dom.getAttribute("alt") ?? "", title: dom.getAttribute("title") ?? "",
      }),
    }],
    toDOM: (node) => ["img", {
      src: imageDisplayURL(String(node.attrs.src)), "data-markdown-src": node.attrs.src,
      alt: node.attrs.alt ?? "", title: node.attrs.title ?? "", loading: "lazy",
    }],
    parseMarkdown: {
      match: base.parseMarkdown.match,
      runner: (state, node, type) => {
        state.addNode(type, { src: node.url ?? "", alt: node.alt ?? "", title: node.title ?? "" });
      },
    },
  };
});

const metadataCodeSchema = codeBlockSchema.extendSchema((previous) => (ctx) => {
  const base = previous(ctx);
  return {
    ...base,
    attrs: { ...base.attrs, meta: { default: "", validate: "string" } },
    parseDOM: [{ tag: "pre", preserveWhitespace: "full", getAttrs: (dom) => ({
      language: dom.getAttribute("data-language") ?? "", meta: dom.getAttribute("data-meta") ?? "",
    }) }],
    toDOM: (node) => ["pre", { "data-language": node.attrs.language, "data-meta": node.attrs.meta }, ["code", 0]],
    parseMarkdown: {
      match: base.parseMarkdown.match,
      runner: (state, node, type) => {
        state.openNode(type, { language: node.lang ?? "", meta: node.meta ?? "" });
        if (node.value) state.addText(String(node.value));
        state.closeNode();
      },
    },
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        state.addNode("code", undefined, node.textContent, { lang: node.attrs.language, meta: node.attrs.meta || undefined });
      },
    },
  };
});

const richCommonmark = commonmark.filter((plugin) => !imageSchema.some((item) => item === plugin) && !codeBlockSchema.some((item) => item === plugin));

const taskItemView: NodeViewConstructor = (initialNode, view, getPos) => {
  let node = initialNode;
  const task = node.attrs.checked != null;
  const dom = document.createElement("li");
  const contentDOM = task ? document.createElement("div") : dom;
  const checkbox = task ? document.createElement("input") : null;
  const refresh = () => {
    dom.dataset.itemType = task ? "task" : "list";
    dom.dataset.label = String(node.attrs.label);
    dom.dataset.listType = String(node.attrs.listType);
    dom.dataset.spread = String(node.attrs.spread);
    if (checkbox) { checkbox.checked = Boolean(node.attrs.checked); dom.dataset.checked = String(node.attrs.checked); }
  };
  if (checkbox) {
    checkbox.type = "checkbox";
    checkbox.contentEditable = "false";
    checkbox.setAttribute("aria-label", "完成任务");
    checkbox.addEventListener("mousedown", (event) => event.preventDefault());
    checkbox.addEventListener("change", () => {
      const pos = getPos();
      if (pos == null) return;
      view.dispatch(closeHistory(view.state.tr).setNodeMarkup(pos, undefined, { ...node.attrs, checked: checkbox.checked }));
    });
    contentDOM.setAttribute("data-task-content", "");
    dom.append(checkbox, contentDOM);
  }
  refresh();
  const nodeView: NodeView = {
    dom, contentDOM,
    update(next) {
      if (next.type !== node.type || (next.attrs.checked != null) !== task) return false;
      node = next; refresh(); return true;
    },
    stopEvent: (event) => event.target === checkbox,
    ignoreMutation: (mutation) => mutation.type !== "selection" && mutation.target === checkbox,
  };
  return nodeView;
};

export const RichEditor = forwardRef<RichEditorHandle, RichEditorProps>(function RichEditor(props, ref) {
  const mountRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const propsRef = useRef(props);
  const appliedValueRef = useRef(props.value);
  const serializedValueRef = useRef("");
  const pendingValueRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useLayoutEffect(() => { propsRef.current = props; });

  function syncValue(editor: Editor, value: string) {
    if (value === appliedValueRef.current) return;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (view.composing) { pendingValueRef.current = value; return; }
      const doc = ctx.get(parserCtx)(normalizeLooseImageReferences(value));
      if (!doc) return;
      appliedValueRef.current = value;
      serializedValueRef.current = ctx.get(serializerCtx)(doc);
      pendingValueRef.current = null;
      // An external source replacement starts a fresh history, so undo cannot resurrect stale source.
      const state = EditorState.create({ doc, schema: view.state.schema, plugins: view.state.plugins });
      view.updateState(state);
    });
  }

  useImperativeHandle(ref, () => ({
    getSelectedText() {
      return editorRef.current?.action((ctx) => {
        const { doc, selection } = ctx.get(editorViewCtx).state;
        return doc.textBetween(selection.from, selection.to, "\n");
      }) ?? "";
    },
    format(action) {
      editorRef.current?.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const commands = ctx.get(commandsCtx);
        const ancestor = (type: string) => {
          for (let depth = view.state.selection.$from.depth; depth > 0; depth -= 1) {
            if (view.state.selection.$from.node(depth).type.name === type) return true;
          }
          return false;
        };
        if (action === "bold") commands.call(toggleStrongCommand.key);
        else if (action === "italic") commands.call(toggleEmphasisCommand.key);
        else if (action === "strike") commands.call(toggleStrikethroughCommand.key);
        else if (action === "inlineCode") commands.call(toggleInlineCodeCommand.key);
        else if (action === "divider") commands.call(insertHrCommand.key);
        else if (action.startsWith("heading")) commands.call(wrapInHeadingCommand.key, Number(action.slice(-1)));
        else if (action === "quote") {
          if (ancestor("blockquote")) lift(view.state, view.dispatch, view);
          else commands.call(wrapInBlockquoteCommand.key);
        } else if (action === "bulletList" || action === "orderedList") {
          const type = action === "bulletList" ? "bullet_list" : "ordered_list";
          const { $from } = view.state.selection;
          let listDepth = $from.depth;
          while (listDepth > 0 && !["bullet_list", "ordered_list"].includes($from.node(listDepth).type.name)) listDepth -= 1;
          if (listDepth > 0) {
            const list = $from.node(listDepth);
            if (list.type.name === type) commands.call(liftListItemCommand.key);
            else view.dispatch(closeHistory(view.state.tr).setNodeMarkup($from.before(listDepth), view.state.schema.nodes[type], { ...list.attrs, order: 1 }).scrollIntoView());
          } else commands.call(action === "bulletList" ? wrapInBulletListCommand.key : wrapInOrderedListCommand.key);
        } else if (action === "taskList") {
          if (!ancestor("list_item")) commands.call(wrapInBulletListCommand.key);
          const { state } = view;
          const transaction = state.tr;
          const items: Array<{ pos: number; checked: boolean | null }> = [];
          state.doc.nodesBetween(state.selection.from, Math.min(state.doc.content.size, state.selection.to + 1), (node, pos) => {
            if (node.type.name === "list_item") items.push({ pos, checked: node.attrs.checked });
          });
          const removeTasks = items.length > 0 && items.every((item) => item.checked != null);
          for (const { pos, checked } of items) {
            const node = state.doc.nodeAt(pos)!;
            transaction.setNodeMarkup(pos, undefined, { ...node.attrs, checked: removeTasks ? null : checked ?? false });
          }
          if (transaction.docChanged) view.dispatch(transaction);
        }
        view.focus();
      });
    },
    insertMarkdown(markdown, replaceSelection = true, block = false) {
      editorRef.current?.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const doc = ctx.get(parserCtx)(normalizeLooseImageReferences(markdown));
        if (!doc) return;
        const transaction = closeHistory(view.state.tr);
        if (!replaceSelection) transaction.setSelection(TextSelection.near(transaction.doc.resolve(transaction.selection.to)));
        const slice = block ? new Slice(doc.content, 0, 0) : Slice.maxOpen(doc.content);
        view.dispatch(transaction.replaceSelection(slice).scrollIntoView());
        view.focus();
      });
    },
    focus() { editorRef.current?.action((ctx) => ctx.get(editorViewCtx).focus()); },
    goToHeading(index) {
      editorRef.current?.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        let count = 0;
        let position: number | null = null;
        view.state.doc.descendants((node, pos) => {
          if (node.type.name === "heading" && count++ === index) position = pos + 1;
        });
        if (position != null) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position))).scrollIntoView());
        view.focus();
      });
    },
    undo() { editorRef.current?.action((ctx) => { const view = ctx.get(editorViewCtx); undo(view.state, view.dispatch); view.focus(); }); },
    redo() { editorRef.current?.action((ctx) => { const view = ctx.get(editorViewCtx); redo(view.state, view.dispatch); view.focus(); }); },
  }), []);

  useEffect(() => {
    if (!mountRef.current) return;
    let cancelled = false;
    let created = false;
    let disposed = false;
    const mount = document.createElement("div");
    mountRef.current.append(mount);
    const initial = propsRef.current;
    appliedValueRef.current = initial.value;
    const instance = Editor.make().config((ctx) => {
      ctx.set(rootCtx, mount);
      ctx.set(defaultValueCtx, normalizeLooseImageReferences(initial.value));
      ctx.update(editorViewOptionsCtx, (previous) => ({
        ...previous,
        attributes: { id: initial.id, role: "textbox", "aria-label": initial.label, "aria-multiline": "true", spellcheck: "false" },
        nodeViews: { ...previous.nodeViews, list_item: taskItemView },
        dispatchTransaction(this: EditorView, transaction: Transaction) {
          const previousDoc = this.state.doc;
          const next = this.state.applyTransaction(transaction);
          this.updateState(next.state);
          if (!created || cancelled || previousDoc.eq(next.state.doc)) return;
          const markdown = ctx.get(serializerCtx)(next.state.doc);
          if (markdown === serializedValueRef.current) return;
          serializedValueRef.current = markdown;
          appliedValueRef.current = markdown;
          propsRef.current.onChange(markdown);
        },
        handleDOMEvents: {
          paste: (_view, event) => {
            const images = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
            if (!images.length || !propsRef.current.onImagePaste) return false;
            event.preventDefault(); propsRef.current.onImagePaste(images); return true;
          },
          drop: (_view, event) => {
            const images = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith("image/"));
            if (!images.length || !propsRef.current.onImagePaste) return false;
            event.preventDefault(); propsRef.current.onImagePaste(images); return true;
          },
          dragover: (_view, event) => {
            if (!propsRef.current.onImagePaste || !Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === "file" && item.type.startsWith("image/"))) return false;
            event.preventDefault(); return true;
          },
          click: (_view, event) => {
            if (!(event.target instanceof Element) || !event.target.closest("a")) return false;
            event.preventDefault(); return true;
          },
          keydown: (_view, event) => {
            if (event.key.toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey) || !propsRef.current.onLinkShortcut) return false;
            event.preventDefault(); propsRef.current.onLinkShortcut(); return true;
          },
          compositionend: () => {
            queueMicrotask(() => {
              if (!cancelled && pendingValueRef.current != null) syncValue(instance, pendingValueRef.current);
            });
            return false;
          },
        },
      }));
    }).use(richCommonmark).use(gfm).use(safeImageSchema).use(metadataCodeSchema).use(history);

    const dispose = async () => {
      if (disposed) return;
      disposed = true;
      try { await instance.destroy(); } finally { mount.remove(); }
    };
    void instance.create().then(async () => {
      if (cancelled) { await dispose(); return; }
      created = true;
      editorRef.current = instance;
      serializedValueRef.current = instance.action((ctx) => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc));
      syncValue(instance, propsRef.current.value);
      setReady(true);
    }).catch(() => {
      mount.remove();
      if (!cancelled) setError("可视化编辑器暂时无法加载，请切换到源码模式继续编辑。");
    });
    return () => {
      cancelled = true;
      if (editorRef.current === instance) editorRef.current = null;
      if (created) void dispose().catch(() => {});
    };
  }, []);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    try { syncValue(editor, props.value); }
    catch { setError("当前内容暂时无法切换为可视化格式，请在源码模式中继续编辑。"); }
  }, [props.value]);

  return <div className={styles.host} style={{ "--rich-font-size": `${props.fontSize}px` } as CSSProperties}>
    <div ref={mountRef} data-rich-mount="" />
    {!ready && !error ? <p className={styles.loading} role="status">正在准备可视化编辑器…</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
  </div>;
});
