import type { FormatAction } from "./markdownTools";

export type RichEditorHandle = {
  getSelectedText: () => string;
  format: (action: FormatAction) => void;
  insertMarkdown: (markdown: string, replaceSelection?: boolean, block?: boolean) => void;
  focus: () => void;
  goToHeading: (index: number) => void;
  undo: () => void;
  redo: () => void;
};

export type RichEditorProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onImagePaste?: (files: File[]) => void;
  onLinkShortcut?: () => void;
  fontSize: number;
};
