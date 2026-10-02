import type { EditorState } from "@codemirror/state";
import type { MutableRefObject } from "react";

export type TextSelection = { from: number; to: number };
export type TextEdit = TextSelection & {
  insert: string;
  anchor?: number;
  head?: number;
};

export type CursorPosition = { line: number; column: number };
export type SourceEditorHandle = {
  getSelection: () => TextSelection;
  applyEdit: (edit: TextEdit) => void;
  focus: () => void;
  goToLine: (line: number) => void;
  undo: () => void;
  redo: () => void;
  openSearch: () => void;
};

export type SourceEditorProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onCursorChange?: (position: CursorPosition) => void;
  onScroll?: (ratio: number) => void;
  onImagePaste?: (files: File[]) => void;
  lineWrapping: boolean;
  fontSize: number;
  stateRef: MutableRefObject<EditorState | null>;
};
