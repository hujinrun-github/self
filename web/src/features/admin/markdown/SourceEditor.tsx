import { defaultKeymap, history, historyKeymap, isolateHistory, redo, undo } from "@codemirror/commands";
import { markdown, markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown";
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { Annotation, Compartment, EditorState, StateEffect, Transaction } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { CSSProperties } from "react";

import type { SourceEditorHandle, SourceEditorProps } from "./editorTypes";
import styles from "./SourceEditor.module.css";

const controlledUpdate = Annotation.define<boolean>();
const searchPhrases = {
  Find: "查找",
  Replace: "替换为",
  next: "下一处",
  previous: "上一处",
  all: "选择全部",
  "match case": "区分大小写",
  regexp: "正则表达式",
  "by word": "全词匹配",
  replace: "替换",
  "replace all": "全部替换",
  close: "关闭查找",
  "Go to line": "跳转到行",
  go: "跳转",
  "current match": "当前匹配",
  "on line": "所在行",
  "replaced $ matches": "已替换 $ 处",
};

function contentAttributes(id: string, label: string) {
  return EditorView.contentAttributes.of({ id, "aria-label": label, "aria-multiline": "true", role: "textbox", spellcheck: "false" });
}

function clamp(position: number, length: number) {
  return Math.max(0, Math.min(length, Number.isFinite(position) ? Math.trunc(position) : 0));
}

export const SourceEditor = forwardRef<SourceEditorHandle, SourceEditorProps>(function SourceEditor(props, ref) {
  const { id, label, value, lineWrapping, fontSize } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const propsRef = useRef(props);
  const wrappingRef = useRef(new Compartment());
  const attributesRef = useRef(new Compartment());

  useLayoutEffect(() => {
    propsRef.current = props;
  });

  useImperativeHandle(ref, () => ({
    getSelection() {
      const selection = viewRef.current?.state.selection.main;
      return { from: selection?.from ?? 0, to: selection?.to ?? 0 };
    },
    applyEdit(edit) {
      const view = viewRef.current;
      if (!view) return;
      const from = clamp(edit.from, view.state.doc.length);
      const to = Math.max(from, clamp(edit.to, view.state.doc.length));
      const nextLength = view.state.doc.length - (to - from) + edit.insert.length;
      const anchor = clamp(edit.anchor ?? from + edit.insert.length, nextLength);
      const head = clamp(edit.head ?? anchor, nextLength);
      view.dispatch({
        changes: { from, to, insert: edit.insert },
        selection: { anchor, head },
        annotations: isolateHistory.of("full"),
        userEvent: "input.toolbar",
        scrollIntoView: true,
      });
      view.focus();
    },
    focus() {
      viewRef.current?.focus();
    },
    goToLine(number) {
      const view = viewRef.current;
      if (!view) return;
      const line = view.state.doc.line(Math.max(1, clamp(number, view.state.doc.lines)));
      view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
      view.focus();
    },
    undo() {
      const view = viewRef.current;
      if (view) { undo(view); view.focus(); }
    },
    redo() {
      const view = viewRef.current;
      if (view) { redo(view); view.focus(); }
    },
    openSearch() {
      const view = viewRef.current;
      if (view) openSearchPanel(view);
    },
  }), []);

  useEffect(() => {
    if (!hostRef.current) return;
    const current = propsRef.current;
    const reportCursor = (state: EditorState) => {
      const head = state.selection.main.head;
      const line = state.doc.lineAt(head);
      propsRef.current.onCursorChange?.({ line: line.number, column: head - line.from + 1 });
    };
    const acceptImages = (files: FileList | undefined, event: Event) => {
      const images = Array.from(files ?? []).filter((file) => file.type.startsWith("image/"));
      if (!images.length || !propsRef.current.onImagePaste) return false;
      event.preventDefault();
      propsRef.current.onImagePaste(images);
      return true;
    };
    const extensions = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      drawSelection(),
      history(),
      bracketMatching(),
      markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false }),
      syntaxHighlighting(defaultHighlightStyle),
      search({ top: true }),
      highlightSelectionMatches(),
      EditorState.phrases.of(searchPhrases),
      keymap.of([
        ...markdownKeymap,
        ...searchKeymap,
        // The workbench owns Mod-i for Markdown emphasis, overriding CodeMirror's syntax selection.
        ...defaultKeymap.filter((binding) => binding.key !== "Mod-i"),
        ...historyKeymap,
      ]),
      wrappingRef.current.of(current.lineWrapping ? EditorView.lineWrapping : []),
      attributesRef.current.of(contentAttributes(current.id, current.label)),
      EditorView.updateListener.of((update) => {
        propsRef.current.stateRef.current = update.state;
        if (update.docChanged && update.transactions.some((transaction) => transaction.docChanged && !transaction.annotation(controlledUpdate))) {
          propsRef.current.onChange(update.state.doc.toString());
        }
        if (update.docChanged || update.selectionSet) reportCursor(update.state);
      }),
      EditorView.domEventHandlers({
        paste: (event) => acceptImages(event.clipboardData?.files, event),
        drop: (event) => acceptImages(event.dataTransfer?.files, event),
        dragover: (event) => {
          const hasImages = Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === "file" && item.type.startsWith("image/"));
          if (!hasImages || !propsRef.current.onImagePaste) return false;
          event.preventDefault();
          return true;
        },
        scroll: (_event, view) => {
          const { scrollTop, scrollHeight, clientHeight } = view.scrollDOM;
          const range = scrollHeight - clientHeight;
          propsRef.current.onScroll?.(range > 0 ? Math.max(0, Math.min(1, scrollTop / range)) : 0);
        },
      }),
    ];
    // Keep document, selection and history while replacing closures from a previous portal mount.
    let state = current.stateRef.current
      ? current.stateRef.current.update({ effects: StateEffect.reconfigure.of(extensions) }).state
      : EditorState.create({ doc: current.value, extensions });
    if (state.doc.toString() !== current.value) {
      state = state.update({
        changes: { from: 0, to: state.doc.length, insert: current.value },
        annotations: [controlledUpdate.of(true), Transaction.addToHistory.of(false)],
      }).state;
    }
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    current.stateRef.current = state;
    reportCursor(state);
    return () => {
      propsRef.current.stateRef.current = view.state;
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Flush parent values during commit, before another native input can advance the document.
  // A delayed passive effect could otherwise replay an earlier echo over newly typed text.
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: [controlledUpdate.of(true), Transaction.addToHistory.of(false)],
    });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: wrappingRef.current.reconfigure(lineWrapping ? EditorView.lineWrapping : []) });
  }, [lineWrapping]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: attributesRef.current.reconfigure(contentAttributes(id, label)) });
  }, [id, label]);

  return <div ref={hostRef} className={styles.source} style={{ "--source-font-size": `${fontSize}px` } as CSSProperties} />;
});
