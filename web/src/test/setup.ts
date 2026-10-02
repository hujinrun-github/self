import "@testing-library/jest-dom/vitest";

// JSDOM has no scrolling viewport; navigation tests spy on this browser API.
Object.defineProperty(window, "scrollTo", { configurable: true, value: () => {}, writable: true });

// JSDOM has no text layout. CodeMirror still measures ranges for its selection layer.
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      addEventListener: () => {},
      addListener: () => {},
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: () => {},
      removeListener: () => {},
    }),
    writable: true,
  });
}
